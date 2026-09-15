/**
 * index.ts — the three tactical throwables (Document F §2).
 *
 * Pure data. The smoke grenade detonates on impact for fast deployment; the
 * stun and flashbang run a fuse so they can be cooked and air-burst.
 */
import type { ThrowableProfile } from './types';

export const SMOKE_GRENADE: ThrowableProfile = {
  id: 'smoke_grenade',
  displayName: 'Smoke Grenade',
  iconLabel: 'SMOKE',
  category: 'tactical',
  modelPath: 'equipment/smoke_grenade.glb',
  throwForce: 13,
  gravityScale: 1.0,
  fuseSeconds: 1.2,
  // Impact: smoke is a deployment tool, and waiting on a fuse to start
  // covering a doorway defeats the point.
  detonationTrigger: 'impact',
  cookable: false,
  maxCookSeconds: 0,
  effectRadius: 7,
  effectFalloff: 'linear',
  carryCount: 2,
  smokeLingerSeconds: 15,
  screenEffect: null,
  soundKeys: {
    pinPull: 'grenade_pin_pull',
    throw: 'grenade_throw_whoosh',
    bounce: 'grenade_bounce_metal',
    detonate: 'smoke_hiss_loop',
  },
};

export const STUN_GRENADE: ThrowableProfile = {
  id: 'stun_grenade',
  displayName: 'Stun Grenade',
  iconLabel: 'STUN',
  category: 'tactical',
  modelPath: 'equipment/stun_grenade.glb',
  throwForce: 12,
  gravityScale: 1.0,
  fuseSeconds: 1.6,
  detonationTrigger: 'fuse',
  cookable: true,
  // 1.4 of a 1.6 s fuse: a real margin, so cooking is a risk you can read.
  maxCookSeconds: 1.4,
  effectRadius: 8,
  effectFalloff: 'linear',
  carryCount: 2,
  slowMoveMultiplier: 0.4,
  slowDuration: 3.5,
  screenEffect: 'concussionBlur',
  screenEffectPeakDuration: 1.0,
  screenEffectFadeDuration: 3.0,
  audioMuffleDuration: 3.5,
  soundKeys: {
    pinPull: 'grenade_pin_pull',
    throw: 'grenade_throw_whoosh',
    bounce: 'grenade_bounce_metal',
    detonate: 'stun_detonate',
    ringTone: 'concussion_ring',
  },
};

export const FLASHBANG: ThrowableProfile = {
  id: 'flashbang',
  displayName: 'Flashbang',
  iconLabel: 'FLASH',
  category: 'tactical',
  modelPath: 'equipment/flashbang.glb',
  throwForce: 12,
  gravityScale: 1.0,
  fuseSeconds: 1.8,
  detonationTrigger: 'fuse',
  cookable: true,
  maxCookSeconds: 1.5,
  effectRadius: 12,
  effectFalloff: 'linear',
  carryCount: 2,
  // Deliberately NO movement slow — that is the stun's identity. A flash
  // blinds you; it does not slow you down.
  screenEffect: 'flashWhiteout',
  screenEffectPeakDuration: 0.05,
  screenEffectFadeDuration: 4.5,
  audioMuffleDuration: 4.0,
  soundKeys: {
    pinPull: 'grenade_pin_pull',
    throw: 'grenade_throw_whoosh',
    bounce: 'grenade_bounce_metal',
    detonate: 'flash_detonate',
    ringTone: 'flashbang_ring',
  },
};

export const ALL_THROWABLES: readonly ThrowableProfile[] = [
  SMOKE_GRENADE, STUN_GRENADE, FLASHBANG,
];

export function getThrowable(id: string): ThrowableProfile | null {
  return ALL_THROWABLES.find((t) => t.id === id) ?? null;
}
