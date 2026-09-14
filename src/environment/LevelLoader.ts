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
import type ColliderFactory from '../physics/ColliderFactory';

export class LevelLoader {
  readonly scene = new THREE.Scene();
  /** Axis-aligned world boxes, for systems that want cheap bounds. */
  readonly colliders: THREE.Box3[] = [];
  /** Solid world meshes (casing bounce probes etc.). */
  readonly staticMeshes: THREE.Mesh[] = [];

  private definition: LevelDefinition | null = null;
  private readonly dummies: TrainingDummy[] = [];
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  private readonly colliderHandles: number[] = [];
  private readonly hittableObjects: THREE.Object3D[] = [];
  private readonly levelRoot = new THREE.Group();

  constructor(private readonly colliderFactory: ColliderFactory) {
    this.levelRoot.name = 'LevelRoot';
    this.scene.add(this.levelRoot);
  }

  get current(): LevelDefinition | null {
    return this.definition;
  }

  get availableLevels(): readonly LevelDefinition[] {
    return LEVELS;
  }

  /** Drive dummy flash/respawn timers. */
  update(dt: number): void {
    for (const dummy of this.dummies) dummy.update(dt);
  }

  async load(levelId: string): Promise<LevelDefinition> {
    this.unloadCurrentLevel();
    const def = getLevel(levelId);
    this.definition = def;

    this.scene.background = new THREE.Color(def.skyColor);
    this.scene.fog = new THREE.FogExp2(def.skyColor, def.fogDensity);

    this.buildLights(def);
    this.buildGround(def);
    for (const box of def.boxes) this.buildBox(box);
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
