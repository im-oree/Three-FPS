/**
 * GroundTargetingMode.ts — Document H §2.2.
 *
 * "Raycast from the crosshair, show a marker where it hits the ground, wait
 * for confirmation." Deliberately generic and streak-agnostic: the airstrike
 * uses it now, and any future placed/directional streak (a care package, a
 * mortar barrage, the guided missile's designation step) reuses it unchanged.
 */
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

const _down = new THREE.Vector3(0, -1, 0);

export class GroundTargetingMode {
  private marker: THREE.Object3D | null = null;
  private scene: THREE.Scene | null = null;
  private physics: PhysicsWorld | null = null;
  private active = false;
  private readonly point = new THREE.Vector3();
  private valid = false;

  attach(scene: THREE.Scene, physics: PhysicsWorld): void {
    this.scene = scene;
    this.physics = physics;
  }

  get isActive(): boolean { return this.active; }
  get hasValidTarget(): boolean { return this.valid; }
  get targetPoint(): THREE.Vector3 { return this.point.clone(); }

  begin(): void {
    if (!this.scene) return;
    this.active = true;
    if (!this.marker) this.marker = this.buildMarker();
    this.scene.add(this.marker);
  }

  end(): void {
    this.active = false;
    this.valid = false;
    if (this.marker) this.marker.parent?.remove(this.marker);
  }

  /**
   * Project the crosshair onto the world. Two casts: forward from the eye to
   * find what is being looked at, then straight DOWN from there so the marker
   * lands on the floor rather than floating at the point of a wall hit.
   */
  update(eye: THREE.Vector3, forward: THREE.Vector3, maxRange = 200): void {
    if (!this.active || !this.physics || !this.marker) return;

    const hit = this.physics.castRayStatic(eye, forward, maxRange);
    if (hit) {
      this.point.copy(hit.point);
    } else {
      // Nothing struck: project to max range, then drop to the ground.
      this.point.copy(eye).addScaledVector(forward, maxRange);
    }

    const above = this.point.clone();
    above.y += 60;
    const groundHit = this.physics.castRayStatic(above, _down, 200);
    if (groundHit) this.point.copy(groundHit.point);

    this.valid = true;
    this.marker.position.copy(this.point);
    this.marker.position.y += 0.06; // avoid z-fighting with the floor
    this.marker.rotation.y += 0.02; // slow spin so it reads as live
    this.marker.visible = true;
  }

  private buildMarker(): THREE.Object3D {
    const group = new THREE.Group();
    group.name = 'GroundTargetMarker';
    const ringGeo = new THREE.RingGeometry(1.6, 2.0, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff5533, transparent: true, opacity: 0.85,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
    // Cross hairs inside the ring so the exact centre is unambiguous.
    const barMat = new THREE.MeshBasicMaterial({
      color: 0xff7755, transparent: true, opacity: 0.9, depthWrite: false,
    });
    for (const rot of [0, Math.PI / 2]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.12), barMat);
      bar.rotation.x = -Math.PI / 2;
      bar.rotation.z = rot;
      group.add(bar);
    }
    return group;
  }
}

export const groundTargeting = new GroundTargetingMode();
export default groundTargeting;
