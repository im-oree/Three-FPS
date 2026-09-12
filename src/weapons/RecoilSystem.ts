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
import type { PlayerCamera } from '../player/PlayerCamera';
import { RECOIL, WEAPON } from '../utils/Constants';
import { AssaultRifle } from './definitions/AssaultRifle';
import { Pistol } from './definitions/Pistol';
import { SMG } from './definitions/SMG';
import RECOIL_PATTERNS, { type RecoilPatternEntry, type RecoilPatternId } from './RecoilPatterns';
import type { WeaponSway } from './WeaponSway';

const PATTERN_BY_WEAPON: Record<string, RecoilPatternId> = {
  [AssaultRifle.id]: AssaultRifle.recoilPatternId as RecoilPatternId,
  [Pistol.id]: Pistol.recoilPatternId as RecoilPatternId,
  [SMG.id]: SMG.recoilPatternId as RecoilPatternId,
};

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
      this.camera.applyRecoilKick(pitch, yaw);
      this.sway.notifyKick(pitch, yaw);
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
