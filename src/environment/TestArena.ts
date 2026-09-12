// TEMPORARY — placeholder test environment for Document 2 movement validation.
// Deleted in Document 4 once real levels exist.
//
// Procedural construction is explicitly permitted here ONLY as a development
// scaffold per Document 1's asset-policy carve-out for Document 2's test arena.
// Every shape is registered as an axis-aligned box and handed to
// PlayerCollider's constructor — that box list is the generic data source
// Document 4 will replace with a real CollisionWorld.

import * as THREE from 'three';
import ballistics from '../weapons/BallisticsSystem';
import { TrainingDummy } from './TrainingDummy';

export class TestArena {
  readonly scene = new THREE.Scene();
  readonly colliders: THREE.Box3[] = [];
  private readonly dummies: TrainingDummy[] = [];

  constructor() {
    this.scene.background = new THREE.Color(0x141821);
    this.buildLights();
    this.buildGeometry();
    this.buildDummies();
  }

  /** Document 3: drive dummy flash/respawn timers. */
  update(dt: number): void {
    for (const dummy of this.dummies) dummy.update(dt);
  }

  /**
   * Document 3 §13: three static training dummies along the x = 20 lane
   * (kept clear of every Document 2 movement-validation lane: sprint x=0..3,
   * bob x=-4.5, stairs x=12..16.4, crates). Natural firing position for the
   * distance ladder is (20, eye, 25) facing -z → 5 m, 25 m and 50 m targets.
   */
  private buildDummies(): void {
    const firingSpot = new THREE.Vector3(20, 0, 25);
    const spots: Array<[string, THREE.Vector3]> = [
      ['5m', new THREE.Vector3(20, 0, 20)],
      ['25m', new THREE.Vector3(20, 0, 0)],
      ['50m', new THREE.Vector3(20, 0, -25)],
    ];
    for (const [label, pos] of spots) {
      const dummy = new TrainingDummy(`dummy_${label}`, pos, firingSpot);
      this.dummies.push(dummy);
      this.scene.add(dummy);
    }
  }

  private buildLights(): void {
    this.scene.add(new THREE.AmbientLight(0x404050, 0.5));
    const sun = new THREE.DirectionalLight(0xfff2e0, 1.4);
    sun.position.set(18, 30, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -35;
    sun.shadow.camera.right = 35;
    sun.shadow.camera.top = 35;
    sun.shadow.camera.bottom = -35;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 80;
    this.scene.add(sun);
  }

  private buildGeometry(): void {
    // Ground slab (top surface at y = 0).
    this.addBox(-40, -1, -40, 40, 0, 40, 0x8a8a8a);

    // Boundary walls.
    this.addBox(-31, 0, -31, 31, 4, -30, 0x6d6f75);
    this.addBox(-31, 0, 30, 31, 4, 31, 0x6d6f75);
    this.addBox(-31, 0, -30, -30, 4, 30, 0x6d6f75);
    this.addBox(30, 0, -30, 31, 4, 30, 0x6d6f75);

    // Low step platform — verifies smooth step-up ground snapping (§6.7).
    this.addBox(4, 0, -8, 8, 0.4, -4, 0x9a7b4f);

    // Tall crates — must be walked around.
    this.addBox(-9, 0, -9, -6, 3, -6, 0x7a5230);
    this.addBox(9, 0, 6, 12, 2.2, 9, 0x7a5230);

    // Crouch tunnel: 1.25 m clearance — stand height (1.8) cannot pass,
    // crouch (1.15) can; standing up underneath must be refused (§6.5).
    this.addBox(-3, 1.25, 4, 3, 2.4, 8, 0x556070);
    this.addBox(-3.4, 0, 3.6, -3, 2.4, 8.4, 0x47505c);
    this.addBox(3, 0, 3.6, 3.4, 2.4, 8.4, 0x47505c);

    // Medium cover boxes.
    this.addBox(-12, 0, 4, -9, 1.1, 7, 0x8a8a6a);
    this.addBox(14, 0, -14, 17, 1.4, -11, 0x8a8a6a);

    // Stair of five 0.4 m steps (each within MAX_STEP_HEIGHT) climbing to
    // 2.0 m — verifies repeated step-up snapping, then a >threshold fall for
    // the hard-landing event when walked off the top.
    for (let i = 0; i < 5; i += 1) {
      this.addBox(12 + i * 0.8, 0, -4, 12 + (i + 1) * 0.8, 0.4 * (i + 1), 0, 0x77808c);
    }

    // Open sprint lane runs along x ≈ 0..3 from z = -20 to z = 20 (left clear).
  }

  private addBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, color: number): void {
    const size = new THREE.Vector3(maxX - minX, maxY - minY, maxZ - minZ);
    const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05 }),
    );
    mesh.position.copy(center);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.colliders.push(new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ)));
    // Document 3: static world geometry is hittable too (generic surface —
    // impacts decal + puff dust; no takeDamage sink).
    ballistics.registerHittable(mesh, { surfaceType: 'generic' });
  }
}

export default TestArena;
