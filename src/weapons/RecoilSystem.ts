/**
 * RecoilSystem.ts — turns fired shots into view kicks (Document 3 §10.2).
 * Subscribes to `weapon:fired`, walks the weapon's RecoilPatterns table
 * (holding the last entry past the pattern length), applies ±RECOIL.JITTER,
 * then punches the TRUE camera aim via PlayerCamera.applyRecoilKick() (the
 * dedicated spring-backed offset, deliberately NOT camera shake) and sends an
 * exaggerated jolt to the viewmodel through WeaponSway.notifyKick().
 * Pattern index resets after WEAPON.PATTERN_RESET_GRACE_SECONDS of no fire.
 */
import eventBus from '../core/EventBus';
import cameraShake from '../camera/CameraShakeController';
import type { PlayerCamera } from '../player/PlayerCamera';
import { CAMERA_SHAKE, RECOIL, WEAPON } from '../utils/Constants';
import { Rifle } from './definitions/Rifle';
import { Pistol } from './definitions/Pistol';
import { Shotgun } from './definitions/Shotgun';
import { SMG } from './definitions/SMG';
import { Sniper } from './definitions/Sniper';
import { RocketLauncher } from './definitions/RocketLauncher';
import RECOIL_PATTERNS, { type RecoilPatternEntry, type RecoilPatternId } from './RecoilPatterns';
import type { WeaponSway } from './WeaponSway';

/**
 * Every fireable weapon sends its OWN pattern (Document C §1.3). SMG, Sniper
 * and the Launcher used to silently fall through — they had authored patterns
 * in the table that were never reached, so document-D weapons fired with NO
 * camera kick at all.
 */
const PATTERN_BY_WEAPON: Record<string, RecoilPatternId> = {
  [Rifle.id]: Rifle.recoilPatternId as RecoilPatternId,
  [Pistol.id]: Pistol.recoilPatternId as RecoilPatternId,
  [Shotgun.id]: Shotgun.recoilPatternId as RecoilPatternId,
  [SMG.id]: SMG.recoilPatternId as RecoilPatternId,
  [Sniper.id]: Sniper.recoilPatternId as RecoilPatternId,
  [RocketLauncher.id]: RocketLauncher.recoilPatternId as RecoilPatternId,
};

/** Document E §2.8: only AUTOMATIC fire adds the hand-fatigue wobble tick. */
const AUTOMATIC_WEAPONS = new Set<string>([Rifle.id, SMG.id]);

export class RecoilSystem {
  private readonly shotIndex = new Map<string, number>();
  private clock = 0;
  private lastShotClock = -Infinity;

  constructor(private readonly camera: PlayerCamera, private readonly sway: WeaponSway) {
    eventBus.on('weapon:fired', (payload) => {
      const { weaponId } = payload as { weaponId: string };
      const patternId = PATTERN_BY_WEAPON[weaponId];
      if (!patternId) return; // fists / melee: no directional recoil kick
      const pattern: RecoilPatternEntry[] = RECOIL_PATTERNS[patternId];
      // Grace-period reset: a fresh burst starts at entry 0 again.
      let index = this.shotIndex.get(weaponId) ?? 0;
      if (this.clock - this.lastShotClock > WEAPON.PATTERN_RESET_GRACE_SECONDS) index = 0;
      this.lastShotClock = this.clock;
      const entry = pattern[Math.min(index, pattern.length - 1)];
      const jitter = () => 1 + (Math.random() * 2 - 1) * RECOIL.JITTER_FRACTION;
      const pitch = entry.pitchDeg * jitter();
      const yaw = entry.yawDeg * jitter();
      this.camera.applyRecoilKick(pitch, yaw, index);
      this.sway.notifyKick(pitch, yaw);
      // Document E §1.4/§2.8: on TOP of the deterministic learnable kick, a
      // tiny stochastic wobble per shot while an automatic is cycling —
      // scale-warmed with burst length so the first round of a burst still
      // jumps clean. Semi/bolt weapons deliberately skip this: their per-shot
      // motion should read crisp and deliberate, never chaotic.
      if (AUTOMATIC_WEAPONS.has(weaponId)) {
        const warmth = Math.min(1, 0.4 + index * 0.08);
        cameraShake.addTrauma(CAMERA_SHAKE.AUTO_FIRE_SUPPLEMENTAL_TRAUMA * warmth);
      }
      this.shotIndex.set(weaponId, index + 1);
    });
  }

  update(dt: number): void {
    this.clock += dt;
  }

  /** Weapon switch: drop accumulated pattern progress (clean first burst). */
  resetPattern(weaponId: string): void {
    this.shotIndex.delete(weaponId);
  }
}

export default RecoilSystem;
