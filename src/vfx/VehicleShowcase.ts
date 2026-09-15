/**
 * VehicleShowcase.ts — a PLACEHOLDER so the new vehicle models can be seen in
 * motion before the full killstreak framework (Documents H/I) is built.
 *
 * This is scaffolding, not a shipping system: it loads the three vehicles,
 * spins their rotors via VehicleAnimator, and flies the helicopter and UAV on
 * simple orbits so their scale and animation can be judged in-world.
 *
 * DELETE (or fold into the real killstreak controllers) once Document H's
 * KillstreakManager owns vehicle spawning properly.
 */
import * as THREE from 'three';
import VehicleAnimator, { faceForward } from './VehicleAnimator';
import type { AssetLoader } from '../core/AssetLoader';

interface ShowVehicle {
  model: THREE.Object3D;
  animator: VehicleAnimator;
  /** Orbit parameters; radius 0 means "hold a fixed pose". */
  radius: number;
  height: number;
  speed: number;
  angle: number;
  centre: THREE.Vector3;
}

export class VehicleShowcase {
  private readonly vehicles: ShowVehicle[] = [];
  private scene: THREE.Scene | null = null;
  private active = false;

  async load(assetLoader: AssetLoader, scene: THREE.Scene): Promise<void> {
    this.scene = scene;
    const [heli, uav, missile] = await Promise.all([
      assetLoader.loadModel('vehicles/attack_helicopter.glb'),
      assetLoader.loadModel('vehicles/uav_drone.glb'),
      assetLoader.loadModel('vehicles/guided_missile.glb'),
    ]);

    // Helicopter: low, close orbit so its size against the player is legible.
    this.add(heli, new VehicleAnimator(heli, [
      { nodeName: 'Bone_MainRotorHub', axis: 'y', radiansPerSecond: 26 },
      { nodeName: 'Bone_TailRotorHub', axis: 'y', radiansPerSecond: 48 },
    ]), 26, 16, 0.22);

    // UAV: high, wide, slow orbit — it is a distant observer.
    this.add(uav, new VehicleAnimator(uav, [
      { nodeName: 'Bone_PropHub', axis: 'z', radiansPerSecond: 55 },
    ]), 48, 34, 0.13);

    // Missile: parked on a stand near the player, purely to inspect it.
    const missileAnim = new VehicleAnimator(missile, []);
    missile.rotation.y = Math.PI * 0.25;
    this.add(missile, missileAnim, 0, 1.4, 0);
  }

  private add(
    model: THREE.Object3D, animator: VehicleAnimator,
    radius: number, height: number, speed: number,
  ): void {
    model.visible = false;
    this.scene?.add(model);
    this.vehicles.push({
      model, animator, radius, height, speed,
      angle: Math.random() * Math.PI * 2,
      centre: new THREE.Vector3(),
    });
  }

  /** Show the showcase, orbiting around `centre`. */
  show(centre: THREE.Vector3): void {
    this.active = true;
    for (const v of this.vehicles) {
      v.centre.copy(centre);
      v.model.visible = true;
      v.animator.snapToFullSpeed();
      if (v.radius === 0) {
        // The parked missile sits just in front of the viewer.
        v.model.position.set(centre.x + 2.5, centre.y + v.height, centre.z - 4);
      }
    }
  }

  hide(): void {
    this.active = false;
    for (const v of this.vehicles) v.model.visible = false;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Test seam. */
  get vehicleCount(): number {
    return this.vehicles.length;
  }

  update(dt: number): void {
    if (!this.active) return;
    for (const v of this.vehicles) {
      v.animator.update(dt, true);
      if (v.radius === 0) continue;
      v.angle += v.speed * dt;
      v.model.position.set(
        v.centre.x + Math.cos(v.angle) * v.radius,
        v.height,
        v.centre.z + Math.sin(v.angle) * v.radius,
      );
      // Face along the tangent of travel, converting for the -Z-forward
      // authoring convention, then bank into the turn.
      const ahead = v.angle + 0.08;
      faceForward(
        v.model,
        v.centre.x + Math.cos(ahead) * v.radius,
        v.height,
        v.centre.z + Math.sin(ahead) * v.radius,
        -0.22,
      );
    }
  }
}

export const vehicleShowcase = new VehicleShowcase();
export default vehicleShowcase;
