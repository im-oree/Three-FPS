/**
 * LevelLoader.ts — Document 4/5: builds a playable level from a
 * LevelDefinition and tears it down completely again.
 *
 * Contract (the thing the rest of the game depends on):
 *   load(levelId)          -> Promise, emits 'level:loaded'
 *   unloadCurrentLevel()   -> disposes meshes, colliders, hittables, ambience
 *   current                -> the active definition, or null
 *
 * Teardown is the part that is easy to get wrong and expensive to debug, so
 * every resource acquired here is tracked and released: geometries and
 * materials are disposed, Rapier bodies are removed through ColliderFactory,
 * and every hittable registered with BallisticsSystem is unregistered. A
 * level swap must leave no residue, or the second match inherits the first
 * one's colliders and starts failing in ways that look random.
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import ballistics from '../weapons/BallisticsSystem';
import { TrainingDummy } from './TrainingDummy';
import { getLevel, LEVELS, type LevelDefinition } from './LevelDefinition';
import MapBuilder from './MapBuilder';
import HDRISkyManager from './HDRISkyManager';
import calloutZoneRegistry from '../world/CalloutZoneRegistry';
import RAPIER from '@dimforge/rapier3d-compat';
import { LAYER, setLayerRecursive } from '../core/RenderLayers';
import type ColliderFactory from '../physics/ColliderFactory';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { AssetLoader } from '../core/AssetLoader';
import type { CullingHandle, FrustumCullingManager } from '../core/FrustumCullingManager';

/** Optional dependencies required only by Document K/L prop-built levels. */
export interface LevelBuilderDeps {
  physics: PhysicsWorld;
  assetLoader: AssetLoader;
  renderer: THREE.WebGLRenderer;
  /** Global union culling (SceneManager-owned). Optional so exact-array
   *  levels and old call sites stay source-compatible. */
  culling?: FrustumCullingManager;
}

/** Collision nodes inside a shell .glb carry this prefix (Document L §2). */
const COLLECTION_PREFIX = /^COL_/;

export class LevelLoader {
  readonly scene = new THREE.Scene();
  /** Axis-aligned world boxes, for systems that want cheap bounds. */
  readonly colliders: THREE.Box3[] = [];
  /** Solid world meshes (casing bounce probes etc.). */
  readonly staticMeshes: THREE.Mesh[] = [];

  private definition: LevelDefinition | null = null;
  /** Stashed while an aerial view suppresses fog (Document I §6). */
  private suppressedFog: THREE.Scene["fog"] = null;
  private readonly dummies: TrainingDummy[] = [];
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  private readonly colliderHandles: number[] = [];
  private readonly hittableObjects: THREE.Object3D[] = [];
  private readonly levelRoot = new THREE.Group();
  private readonly cullingHandles: CullingHandle[] = [];
  private mapBuilder: MapBuilder | null = null;
  private hdriSky: HDRISkyManager | null = null;
  /** Document N: heightfield terrain body, removed wholesale on unload. */
  private terrainBody: RAPIER.RigidBody | null = null;

  constructor(
    private readonly colliderFactory: ColliderFactory,
    private readonly builderDeps: LevelBuilderDeps | null = null,
  ) {
    this.levelRoot.name = 'LevelRoot';
    this.scene.add(this.levelRoot);
  }

  get current(): LevelDefinition | null {
    return this.definition;
  }

  /** Dynamic-prop layer (barrel hittable handles etc.), or null. */
  get mapProps(): MapBuilder | null { return this.mapBuilder; }

  /**
   * Temporarily remove atmospheric fog.
   *
   * Ground-level fog is tuned for a player standing in the world, where a
   * 200 m sightline SHOULD fade out. Seen from a missile 210 m up, that same
   * density leaves single-digit visibility and the whole feed is a grey wash
   * — which reads as "the missile explodes early" because you never see it
   * arrive. Aerial views therefore fly fog-free and restore it on return.
   */
  setFogSuppressed(suppressed: boolean): void {
    if (suppressed) {
      if (this.scene.fog) {
        this.suppressedFog = this.scene.fog;
        this.scene.fog = null;
      }
      return;
    }
    if (this.suppressedFog) {
      this.scene.fog = this.suppressedFog;
      this.suppressedFog = null;
    }
  }

  get availableLevels(): readonly LevelDefinition[] {
    return LEVELS;
  }

  /** Drive dummy flash/respawn timers + the prop layer (barrels, cranes). */
  update(dt: number): void {
    for (const dummy of this.dummies) dummy.update(dt);
    this.mapBuilder?.update(dt);
  }

  async load(levelId: string): Promise<LevelDefinition> {
    this.unloadCurrentLevel();
    const def = getLevel(levelId);
    this.definition = def;

    this.scene.background = new THREE.Color(def.skyColor);
    this.scene.fog = new THREE.FogExp2(def.skyColor, def.fogDensity);

    this.buildLights(def);
    if (def.shellFile) {
      await this.buildShell(def);
    } else {
      this.buildGround(def);
      for (const box of def.boxes) this.buildBox(box);
    }
    // Document N §2.4: terrain collision BEFORE props, so anything that
    // queries ground height during placement sees the real surface.
    if (def.terrainCollision) await this.buildTerrainCollision(def);
    if (def.calloutZonesFile) await this.loadCalloutZones(def);
    if (def.propManifest) await this.buildProps(def);
    if (def.hdri) await this.applyHDRI(def);
    this.buildDummies(def);

    // Yield one frame so a caller awaiting this sees the progress bar paint.
    await new Promise((resolve) => setTimeout(resolve, 0));

    eventBus.emit('level:loaded', {
      levelId: def.id,
      displayName: def.displayName,
      ambientSoundKey: def.ambientSoundKey,
      spawn: def.spawn,
      spawnYaw: def.spawnYaw,
    });
    return def;
  }

  unloadCurrentLevel(): void {
    if (!this.definition) return;

    this.mapBuilder?.dispose();
    this.mapBuilder = null;
    this.hdriSky?.clear();
    calloutZoneRegistry.clear();
    if (this.terrainBody) {
      for (let i = 0; i < this.terrainBody.numColliders(); i += 1) {
        this.colliderFactory.byHandle.delete(this.terrainBody.collider(i).handle);
      }
      this.builderDeps?.physics.world.removeRigidBody(this.terrainBody);
      this.terrainBody = null;
    }

    for (const handle of this.cullingHandles) handle.release();
    this.cullingHandles.length = 0;

    for (const object of this.hittableObjects) ballistics.unregisterHittable(object);
    this.hittableObjects.length = 0;

    for (const handle of this.colliderHandles) this.colliderFactory.removeByHandle(handle);
    this.colliderHandles.length = 0;

    this.levelRoot.clear();
    for (const resource of this.disposables) resource.dispose();
    this.disposables.length = 0;

    this.dummies.length = 0;
    this.colliders.length = 0;
    this.staticMeshes.length = 0;
    this.scene.fog = null;
    this.definition = null;
    eventBus.emit('level:unloaded', {});
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(resource: T): T {
    this.disposables.push(resource);
    return resource;
  }

  private buildLights(def: LevelDefinition): void {
    // Ambient fill as well as the hemisphere: pure hemi + sun leaves every
    // surface facing away from the sun almost black, which made the first
    // playable build unreadable.
    this.levelRoot.add(new THREE.AmbientLight(0x8e97a8, 0.55));
    const hemi = new THREE.HemisphereLight(0xaab4c4, 0x4a4740, def.hemiIntensity);
    const sun = new THREE.DirectionalLight(0xfff2e0, def.sunIntensity);
    sun.position.set(18, 34, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const r = def.groundHalfSize;
    sun.shadow.camera.left = -r;
    sun.shadow.camera.right = r;
    sun.shadow.camera.top = r;
    sun.shadow.camera.bottom = -r;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 100;
    this.levelRoot.add(hemi, sun);
  }

  private buildGround(def: LevelDefinition): void {
    const h = def.groundHalfSize;
    this.addSolid(
      new THREE.Box3(
        new THREE.Vector3(-h, -1, -h),
        new THREE.Vector3(h, 0, h),
      ),
      def.groundColor,
      def.groundSurface,
      'Ground',
    );
  }

  private buildBox(box: { min: readonly [number, number, number];
    max: readonly [number, number, number]; surface: string; color: number; name?: string }): void {
    this.addSolid(
      new THREE.Box3(
        new THREE.Vector3(...box.min),
        new THREE.Vector3(...box.max),
      ),
      box.color,
      box.surface,
      box.name ?? 'Solid',
    );
  }

  /** One axis-aligned solid: mesh + Rapier collider + surface tag. */
  private addSolid(box: THREE.Box3, color: number, surface: string, name: string): void {
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const geometry = this.track(new THREE.BoxGeometry(size.x, size.y, size.z));
    const material = this.track(new THREE.MeshStandardMaterial({
      color, roughness: 0.92, metalness: surface === 'metal' ? 0.45 : 0.04,
    }));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.copy(center);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.levelRoot.add(mesh);
    this.staticMeshes.push(mesh);
    this.colliders.push(box.clone());

    const collider = this.colliderFactory.addStaticBox(box, surface);
    this.colliderHandles.push(collider.handle);
  }

  /**
   * Document L §4: a shell .glb supplies the level's architecture. Nodes
   * named `COL_*` become static colliders (AABB-registered, invisible
   * meshes, skipped as visuals); everything else is added as visual
   * geometry. Background dressing carries the name marker so it never
   * lands in collision.
   */
  private async buildShell(def: LevelDefinition): Promise<void> {
    if (!this.builderDeps) throw new Error('LevelLoader: shell file needs builderDeps');
    if (!def.shellFile) return;
    const shell = await this.builderDeps.assetLoader.loadModel(def.shellFile);
    shell.updateMatrixWorld(true);

    const collisionNodes: THREE.Object3D[] = [];
    shell.traverse((node) => {
      if (COLLECTION_PREFIX.test(node.name)) collisionNodes.push(node);
    });
    for (const node of collisionNodes) {
      // Collision nodes are COLLISION ONLY — force-hide them here. (The
      // glTF round trip cannot carry "material.visible = false": the
      // exporter strips the flag and the loader rebuilds a DEFAULT WHITE
      // material, so invisible collision boxes were rendering as white
      // sheets over the ground/walls — the "map going white" bug.)
      node.visible = false;
      const box = new THREE.Box3().setFromObject(node);
      const tag = node.name === 'COL_GroundPlane' || node.name.startsWith('COL_Ground')
        ? def.groundSurface
        : 'concrete';
      const collider = this.colliderFactory.addStaticBox(box, tag);
      this.colliderHandles.push(collider.handle);
      this.colliders.push(box);
    }

    // Visuals: everything that is not a collision-only node stays attached
    // to the same world-space transform it was authored with.
    this.levelRoot.add(shell);
    setLayerRecursive(shell, LAYER.WORLD);
    shell.traverse((node) => {
      if ((node as THREE.Mesh).isMesh && !COLLECTION_PREFIX.test(node.name)) {
        this.staticMeshes.push(node as THREE.Mesh);
      }
    });
    // Global culling: every non-collision top-level shell node (ground,
    // wall visuals, distant skyline) gets auto-derived world bounds. The
    // shell is huge, so this is frustum-only — no distance band.
    // NOTE: the exporter wraps authored nodes in single-child wrapper
    // groups ('ShipmentShell' etc.) — unwrap those chains first or every
    // registration collapses into one sphere around the entire map.
    if (this.builderDeps.culling) {
      const unwrap = (node: THREE.Object3D): THREE.Object3D => {
        let n = node;
        while (
          !(n as THREE.Mesh).isMesh
          && n.children.length === 1
          && !(n.children[0] as THREE.Mesh).isMesh
        ) {
          n = n.children[0];
        }
        return n;
      };
      for (const rawChild of shell.children) {
        const node = unwrap(rawChild);
        const targets = (node as THREE.Mesh).isMesh ? [node] : node.children;
        for (const child of targets) {
          if (COLLECTION_PREFIX.test(child.name)) continue;
          this.cullingHandles.push(
            this.builderDeps.culling.register(child, {
              id: `shell:${child.name}`,
              margin: 2,
            }),
          );
        }
      }
    }
    eventBus.emit('level:shellLoaded', { levelId: def.id, collisionNodes: collisionNodes.length });
  }

  /** Document K §3.3: prop manifest → instanced/pooled set dressing. */
  private async buildProps(def: LevelDefinition): Promise<void> {
    if (!this.builderDeps) throw new Error('LevelLoader: prop manifest needs builderDeps');
    if (!def.propManifest) return;
    this.mapBuilder = new MapBuilder(
      this.scene,
      this.builderDeps.physics,
      this.colliderFactory,
      this.builderDeps.assetLoader,
      this.builderDeps.culling ?? null,
    );
    await this.mapBuilder.build(
      def.propManifest, def.propPoolSizes ?? {}, def.windSwayPropTypes ?? [],
    );
  }

  /** Document K §5: HDRI background + IBL for prop-built levels. */
  /**
   * Document N §2.4: terrain collision from a baked heightfield.
   *
   * The sample grid was produced by the SAME height function that generated
   * the visual terrain mesh (tools/lib/TerrainHeightfieldBuilder.js), so the
   * collider cannot drift from what the player sees — the usual failure of
   * hand-tuned terrain collision.
   *
   * Rapier's heightfield stores heights COLUMN-MAJOR as
   * index = col * (nrows + 1) + row, with `row` running along +Z and `col`
   * along +X, and centres the field on its rigid body. Transposing those is
   * the classic bug here: the terrain mirrors across the diagonal and only
   * looks wrong where the map is asymmetric.
   */
  private async buildTerrainCollision(def: LevelDefinition): Promise<void> {
    if (!def.terrainCollision || !this.builderDeps) return;
    const data = await fetch(def.terrainCollision).then((r) => {
      if (!r.ok) throw new Error(`LevelLoader: ${def.terrainCollision} -> HTTP ${r.status}`);
      return r.json();
    }) as {
      width: number; depth: number; nrows: number; ncols: number;
      scale: { x: number; y: number; z: number }; heights: number[];
    };

    const expected = (data.nrows + 1) * (data.ncols + 1);
    if (data.heights.length !== expected) {
      console.error(
        `LevelLoader: terrain heightfield size mismatch — got ${data.heights.length}, `
        + `expected ${expected} for ${data.nrows}x${data.ncols}. Terrain collision SKIPPED.`,
      );
      return;
    }

    const world = this.builderDeps.physics.world;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
    const collider = world.createCollider(
      RAPIER.ColliderDesc.heightfield(
        data.nrows, data.ncols, new Float32Array(data.heights),
        new THREE.Vector3(data.scale.x, data.scale.y, data.scale.z),
      ),
      body,
    );
    this.colliderFactory.byHandle.set(collider.handle, {
      topY: 0,                       // terrain has no single top; unused for ground
      surfaceType: def.groundSurface,
    });
    this.terrainBody = body;
    console.log(
      `[LevelLoader] terrain heightfield ${data.nrows}x${data.ncols} `
      + `over ${data.width}x${data.depth} m (surface '${def.groundSurface}').`,
    );
  }

  /** Document N §7: load named callout polygons into the shared registry. */
  private async loadCalloutZones(def: LevelDefinition): Promise<void> {
    if (!def.calloutZonesFile) return;
    try {
      const zones = await fetch(def.calloutZonesFile).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }) as { name: string; polygon: [number, number][] }[];
      calloutZoneRegistry.loadZones(zones);
      console.log(`[LevelLoader] ${calloutZoneRegistry.count} callout zones registered.`);
    } catch (err) {
      // Callouts are HUD garnish: a failure must not block the match.
      console.error('LevelLoader: callout zones failed to load —', err);
    }
  }

  private async applyHDRI(def: LevelDefinition): Promise<void> {
    if (!this.builderDeps || !def.hdri) return;
    this.hdriSky = new HDRISkyManager(this.builderDeps.renderer, this.scene);
    await this.hdriSky.apply(def.hdri, def.hdriIntensity ?? 1.0);
  }

  private buildDummies(def: LevelDefinition): void {
    const faceTowards = new THREE.Vector3(...def.spawn);
    for (let i = 0; i < def.dummies.length; i += 1) {
      const position = new THREE.Vector3(...def.dummies[i]);
      const dummy = new TrainingDummy(`dummy_${def.id}_${i}`, position, faceTowards);
      this.dummies.push(dummy);
      this.levelRoot.add(dummy);
      this.hittableObjects.push(dummy);
    }
  }
}

export default LevelLoader;
