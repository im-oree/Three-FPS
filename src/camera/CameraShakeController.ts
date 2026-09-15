/**
 * CameraShakeController.ts — Document E §1. The trauma-model camera shake
 * engine: one generic, reusable system every other subsystem feeds.
 *
 * WHY THIS IS SEPARATE FROM RECOIL
 * --------------------------------
 * Document C's per-shot recoil punch is DETERMINISTIC — a fixed, learnable
 * pattern per weapon. Shake is STOCHASTIC: explosions, hard landings, damage,
 * a helicopter overhead. Conflating them gives you either unlearnable recoil
 * or unconvincing explosions. They stay separate systems that happen to
 * compose at the same additive seam in PlayerCamera.
 *
 * THE TRAUMA MODEL
 * ----------------
 * `trauma` (0..1) is "how rattled the camera is". It decays LINEARLY, but the
 * applied offset is trauma SQUARED, so small knocks stay gentle while big ones
 * escalate sharply — that non-linearity is what makes it read as impact rather
 * than vibration.
 *
 * Offsets come from continuous simplex noise, NOT per-frame randomness. Naive
 * `Math.random()` per frame produces a high-frequency buzz that looks like a
 * broken display; sampling a smooth noise field at a walking rate produces
 * motion that reads as a physical camera being knocked about.
 */
import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import eventBus from '../core/EventBus';
import settingsStore from '../core/SettingsStore';
import { CAMERA_SHAKE } from '../utils/Constants';

export interface ShakeOutput {
  readonly position: THREE.Vector3;
  readonly rotation: THREE.Euler;
}

const _src = new THREE.Vector3();

export class CameraShakeController {
  private trauma = 0;
  private readonly noise = createNoise3D();
  private readonly seed = {
    x: Math.random() * 100,
    y: Math.random() * 100,
    z: Math.random() * 100,
  };
  private time = 0;
  /** Player-facing accessibility scale, 0..1, persisted in SettingsStore. */
  private intensity: number;

  readonly output: ShakeOutput = {
    position: new THREE.Vector3(),
    rotation: new THREE.Euler(),
  };

  constructor() {
    this.intensity = settingsStore.get<number>('camera.shakeIntensity', 1);
  }

  /** Live from the Settings menu slider (Document E §1.3). */
  setIntensity(value: number): void {
    this.intensity = THREE.MathUtils.clamp(value, 0, 1);
    settingsStore.set('camera.shakeIntensity', this.intensity);
  }

  getIntensity(): number {
    return this.intensity;
  }

  /** Test/debug seam. */
  get currentTrauma(): number {
    return this.trauma;
  }

  /**
   * THE generic entry point. Any system — weapon, explosion, environment,
   * killstreak, future AI — calls this and needs to know nothing else about
   * the camera.
   */
  addTrauma(amount: number): void {
    if (amount <= 0) return;
    this.trauma = THREE.MathUtils.clamp(
      this.trauma + amount * this.intensity, 0, 1,
    );
  }

  /**
   * World-space convenience with quadratic distance falloff — sharp near the
   * source, gentle at the rim. This is the API explosions are built around.
   */
  addTraumaAtDistance(
    baseAmount: number,
    sourceWorldPos: THREE.Vector3 | { x: number; y: number; z: number },
    listenerWorldPos: THREE.Vector3,
    maxRadius: number,
  ): void {
    if (maxRadius <= 0) return;
    _src.set(sourceWorldPos.x, sourceWorldPos.y, sourceWorldPos.z);
    const distance = _src.distanceTo(listenerWorldPos);
    if (distance >= maxRadius) return;
    const falloff = 1 - distance / maxRadius;
    this.addTrauma(baseAmount * falloff * falloff);
  }

  /**
   * Listen for the generic environment hook. This is the documented way any
   * level trigger, destructible, vehicle or future AI ability shakes the
   * camera WITHOUT holding a reference to the camera or the player.
   */
  bindEnvironmentHook(getListenerPosition: () => THREE.Vector3): void {
    eventBus.on('camera:shakeRequest', (payload) => {
      const p = payload as {
        worldPos?: { x: number; y: number; z: number };
        amount?: number;
        radius?: number;
      };
      const amount = p.amount ?? 0.2;
      if (p.worldPos && p.radius) {
        this.addTraumaAtDistance(
          amount, p.worldPos, getListenerPosition(), p.radius,
        );
      } else {
        this.addTrauma(amount);
      }
    });
  }

  update(dt: number): void {
    this.trauma = Math.max(0, this.trauma - CAMERA_SHAKE.DECAY_PER_SECOND * dt);
    this.time += dt * CAMERA_SHAKE.NOISE_FREQUENCY;

    // Squared: the non-linearity that makes this read as impact.
    const shake = this.trauma * this.trauma;
    if (shake <= 0) {
      this.output.position.set(0, 0, 0);
      this.output.rotation.set(0, 0, 0);
      return;
    }

    const rot = THREE.MathUtils.degToRad(CAMERA_SHAKE.MAX_OFFSET_ROT_DEG);
    this.output.rotation.x = rot * shake * this.noise(this.seed.x, this.time, 0);
    this.output.rotation.y = rot * shake * this.noise(this.seed.y, this.time, 0);
    // Roll is deliberately halved — full-amplitude roll reads as nausea.
    this.output.rotation.z = rot * 0.5 * shake * this.noise(this.seed.z, this.time, 0);

    const pos = CAMERA_SHAKE.MAX_OFFSET_POS;
    this.output.position.x = pos * shake * this.noise(this.seed.x, this.time, 50);
    this.output.position.y = pos * shake * this.noise(this.seed.y, this.time, 50);
  }

  /**
   * Sample the shared noise field directly. Lets other systems (the airborne
   * hand micro-drift, thruster flicker) reuse one continuous noise source
   * rather than each rolling their own.
   */
  sampleNoise(channel: number, t: number): number {
    return this.noise(this.seed.x + channel * 13.7, t, 100 + channel);
  }

  /** Test seam / hard reset on teleport or state change. */
  reset(): void {
    this.trauma = 0;
    this.output.position.set(0, 0, 0);
    this.output.rotation.set(0, 0, 0);
  }
}

export const cameraShake = new CameraShakeController();
export default cameraShake;
