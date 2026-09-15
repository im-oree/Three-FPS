/**
 * ShadowDirector.ts — makes the sun's shadow map cover the PLAYER, not the map.
 *
 * THE PROBLEM THIS SOLVES
 * LevelLoader sized the sun's orthographic shadow camera to `groundHalfSize`.
 * On Firing Range that is 75, so the shadow box spanned 150x150 m. A 2048px
 * map stretched over 150 m gives ~13.6 texels per metre: a character is ~20
 * texels wide, so their shadow is a shimmering grey smudge. Worse, EVERY
 * shadow-casting object inside that 150 m box is re-rendered into the depth
 * map every frame, including the ~200 trees behind the perimeter that the
 * player can never see a shadow from.
 *
 * THE FIX — two independent wins from one change:
 *   1. QUALITY. A 40 m box on the same 2048 map is ~51 texels/metre, 3.7x
 *      sharper, because the box follows the player instead of covering ground
 *      nobody is standing on.
 *   2. COST. Anything outside that box is outside the shadow frustum and is
 *      skipped by three's own shadow-pass culling for free. The caster set
 *      shrinks from "the whole level" to "what is near the player".
 *
 * TEXEL SNAPPING. Moving a shadow camera continuously makes every shadow edge
 * crawl and sparkle, because the depth samples land on different sub-texel
 * positions each frame. The camera is therefore quantised to whole shadow
 * texels — the standard fix, and the reason this is a class rather than two
 * lines in the render loop.
 *
 * A second, complementary lever lives here too: distant props are told to
 * stop casting at all (`casterDistance`). Culling by frustum is automatic;
 * turning castShadow off for far objects additionally spares the per-object
 * CPU work of considering them.
 */
import * as THREE from 'three';

export interface ShadowDirectorOptions {
  /** Half-extent of the shadow box in metres. */
  radius?: number;
  /** Beyond this distance from the player, registered casters stop casting. */
  casterDistance?: number;
  /** Shadow-map resolution (square). */
  mapSize?: number;
  shadowType?: THREE.ShadowMapType;
  enabled?: boolean;
}

interface CasterEntry {
  object: THREE.Object3D;
  position: THREE.Vector3;
  /** castShadow as authored — restored when the object comes back in range. */
  wanted: boolean;
  casting: boolean;
}

export class ShadowDirector {
  private light: THREE.DirectionalLight | null = null;
  /** The light's direction, preserved as an offset from its target. */
  private readonly sunOffset = new THREE.Vector3(18, 34, 12);
  private readonly casters: CasterEntry[] = [];
  private readonly focus = new THREE.Vector3();
  private radius: number;
  private casterDistance: number;
  private mapSize: number;
  private enabled: boolean;
  /** Re-evaluating hundreds of caster distances every frame is pointless
   *  when the player moves ~0.1 m per frame; do it a few times a second. */
  private casterTimer = 0;
  private static readonly CASTER_INTERVAL = 0.25;

  constructor(options: ShadowDirectorOptions = {}) {
    this.radius = options.radius ?? 44;
    this.casterDistance = options.casterDistance ?? 75;
    this.mapSize = options.mapSize ?? 2048;
    this.enabled = options.enabled ?? true;
  }

  /** Adopt the level's sun. Called by LevelLoader once the light exists. */
  setSun(light: THREE.DirectionalLight): void {
    this.light = light;
    this.sunOffset.copy(light.position);
    if (!light.target.parent && light.parent) light.parent.add(light.target);
    this.applyLightSettings();
  }

  /** Register a shadow-caster for distance-based caster culling. */
  registerCaster(object: THREE.Object3D): void {
    const position = new THREE.Vector3();
    object.getWorldPosition(position);
    this.casters.push({
      object, position, wanted: object.castShadow, casting: object.castShadow,
    });
  }

  clearCasters(): void {
    for (const c of this.casters) c.object.castShadow = c.wanted;
    this.casters.length = 0;
  }

  /** Level swap: forget the sun as well as the casters. */
  reset(): void {
    this.clearCasters();
    this.light = null;
  }

  configure(options: ShadowDirectorOptions): void {
    if (options.radius !== undefined) this.radius = options.radius;
    if (options.casterDistance !== undefined) this.casterDistance = options.casterDistance;
    if (options.mapSize !== undefined) this.mapSize = options.mapSize;
    // shadowType is a RENDERER-level flag (renderer.shadowMap.type) owned by
    // RenderQualityManager; it is accepted in the options for symmetry with
    // the preset shape but there is nothing per-light to apply it to.
    if (options.enabled !== undefined) this.enabled = options.enabled;
    this.applyLightSettings();
    // A preset change resizes the box; re-run caster selection immediately
    // rather than waiting out the interval.
    this.casterTimer = ShadowDirector.CASTER_INTERVAL;
  }

  private applyLightSettings(): void {
    const light = this.light;
    if (!light) return;
    light.castShadow = this.enabled;
    if (!this.enabled) return;
    if (light.shadow.mapSize.width !== this.mapSize) {
      light.shadow.mapSize.set(this.mapSize, this.mapSize);
      // Force three to drop the old depth target so the new size takes hold.
      light.shadow.map?.dispose();
      light.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    const cam = light.shadow.camera;
    cam.left = -this.radius;
    cam.right = this.radius;
    cam.top = this.radius;
    cam.bottom = -this.radius;
    cam.near = 0.5;
    // Deep enough that the box can sit anywhere under the sun's offset.
    cam.far = this.radius * 2 + this.sunOffset.length() + 30;
    cam.updateProjectionMatrix();
    // Depth bias scales with world-units-per-texel, so it must be re-derived
    // whenever the box or the map size changes, or the sharper tiers acne.
    const texelWorldSize = (this.radius * 2) / this.mapSize;
    light.shadow.bias = -texelWorldSize * 0.0016 - 0.00008;
    light.shadow.normalBias = Math.max(0.012, texelWorldSize * 1.15);
  }

  /**
   * Per-frame: centre the shadow box on the player, snapped to whole texels.
   */
  update(dt: number, playerPosition: THREE.Vector3): void {
    const light = this.light;
    if (!light || !this.enabled) return;

    // Push the box slightly ahead of the player: they see forward, so the
    // shadow budget belongs in front of them rather than centred on them.
    this.focus.copy(playerPosition);

    // TEXEL SNAP. World size of one shadow texel; quantise the focus to that
    // grid so shadow samples land identically frame to frame.
    const texelWorldSize = (this.radius * 2) / this.mapSize;
    this.focus.x = Math.round(this.focus.x / texelWorldSize) * texelWorldSize;
    this.focus.z = Math.round(this.focus.z / texelWorldSize) * texelWorldSize;
    this.focus.y = Math.round(this.focus.y / texelWorldSize) * texelWorldSize;

    light.target.position.copy(this.focus);
    light.target.updateMatrixWorld();
    light.position.copy(this.focus).add(this.sunOffset);
    light.updateMatrixWorld();

    this.casterTimer += dt;
    if (this.casterTimer >= ShadowDirector.CASTER_INTERVAL) {
      this.casterTimer = 0;
      this.updateCasters(playerPosition);
    }
  }

  private updateCasters(playerPosition: THREE.Vector3): void {
    const maxSq = this.casterDistance * this.casterDistance;
    for (const c of this.casters) {
      if (!c.wanted) continue;
      const shouldCast = c.position.distanceToSquared(playerPosition) <= maxSq;
      if (shouldCast !== c.casting) {
        c.casting = shouldCast;
        c.object.castShadow = shouldCast;
      }
    }
  }

  getStats(): { casters: number; casting: number; radius: number; mapSize: number; enabled: boolean } {
    let casting = 0;
    for (const c of this.casters) if (c.casting) casting += 1;
    return {
      casters: this.casters.length,
      casting,
      radius: this.radius,
      mapSize: this.mapSize,
      enabled: this.enabled,
    };
  }
}

export default ShadowDirector;
