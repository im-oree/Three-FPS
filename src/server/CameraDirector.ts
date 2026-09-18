/**
 * CameraDirector.ts — how to FILM a kill, decided from data.
 *
 * The recording layer answers "what happened". This answers "what shot to
 * cut". They are deliberately separate: the replay stores raw events forever
 * and never bakes in presentation, so improving the camera logic later makes
 * every previously saved replay look better without re-recording anything.
 *
 * THE EXTENSIBILITY CONTRACT
 * --------------------------
 * There is no `if (capabilityId === 'FragGrenade')` anywhere in this file, and
 * there must never be one. A capability is looked up by id; an unregistered
 * id falls back to a generic cinematic profile that is always valid. So:
 *
 *   - adding an ability requires ZERO changes here, and its kills still film
 *   - registering a profile is OPTIONAL, and only upgrades the shot
 *
 * That is what makes "nothing new can be added without being added to it"
 * false by construction, which is the property the architecture demands.
 *
 * Lives on the server because the plan is built from server-authoritative
 * events; the client executes the plan it is handed. Renderer-free.
 */

/** Where the camera rides. Names describe INTENT, not any specific weapon. */
export type TravelPath =
  /** The kill happened at a point; nothing to chase. */
  | 'none'
  /** Something physical flew: grenade, rocket, drone, vehicle. */
  | 'projectile'
  /** A thing being piloted by a player (a possessed entity). */
  | 'possessed';

export type ShotStyle =
  /** Over the killer's shoulder — the classic COD killcam. */
  | 'killer-pov'
  /** On the victim, pulling back to reveal what got them. */
  | 'victim-reaction'
  /** A two-hander framing both parties. Always safe. */
  | 'cinematic-pair'
  /** Ride the instrument of death from launch to impact. */
  | 'follow-instrument';

export interface CameraDirectorProfile {
  readonly travelPath: TravelPath;
  readonly style: ShotStyle;
  /** Which actor the camera attaches to. */
  readonly follow: 'causer' | 'killer' | 'victim';
  /** Seconds of lead-in before the killing blow. */
  readonly leadSeconds: number;
  /** Seconds to linger afterwards. */
  readonly tailSeconds: number;
  /** Time scale at the moment of impact. 1 = none, 0.3 = dramatic. */
  readonly slowMoAtImpact: number;
}

/**
 * The fallback.
 *
 * Deliberately generic and always filmable: a pair framing works whether the
 * killer is a player, a vehicle, or nothing at all. Every unregistered
 * capability gets this, which is why an unknown ability can never produce a
 * broken or missing killcam.
 */
export const DEFAULT_PROFILE: CameraDirectorProfile = {
  travelPath: 'none',
  style: 'cinematic-pair',
  follow: 'killer',
  leadSeconds: 3,
  tailSeconds: 2,
  slowMoAtImpact: 1,
};

/**
 * The profile for a death nobody else caused.
 *
 * Fall damage, your own grenade, an environmental hazard. Pulls back off the
 * victim with a long lead so the replay shows the run-up -- the height they
 * fell from, the grenade they cooked too long. Nothing special had to be
 * recorded for this: the data was already there.
 */
export const SELF_INFLICTED_KEY = '__self__';

const registry = new Map<string, CameraDirectorProfile>();

export const CameraDirectorRegistry = {
  /** Register or override a profile. Safe to call at any time. */
  register(capabilityId: string, profile: Partial<CameraDirectorProfile>): void {
    registry.set(capabilityId, { ...DEFAULT_PROFILE, ...profile });
  },

  /** Never throws and never returns undefined — that is the whole point. */
  resolve(capabilityId: string | null | undefined): CameraDirectorProfile {
    if (!capabilityId) return DEFAULT_PROFILE;
    return registry.get(capabilityId) ?? DEFAULT_PROFILE;
  },

  has(capabilityId: string): boolean { return registry.has(capabilityId); },
  get size(): number { return registry.size; },
  /** Test seam: start from a known state. */
  clear(): void { registry.clear(); },
};

/** The built-in profiles. Data, not logic — every one of these is optional. */
export function registerBuiltinCameraProfiles(): void {
  CameraDirectorRegistry.register('Shoot', {
    travelPath: 'none',
    style: 'killer-pov',
    follow: 'killer',
    leadSeconds: 2.5,
    tailSeconds: 1.5,
    slowMoAtImpact: 0.6,
  });

  // A fall is the archetypal self-inflicted death: long lead so the replay
  // shows the player walking off the edge, not just the landing.
  CameraDirectorRegistry.register('Fall', {
    travelPath: 'none',
    style: 'victim-reaction',
    follow: 'victim',
    leadSeconds: 4,
    tailSeconds: 2,
    slowMoAtImpact: 0.5,
  });

  CameraDirectorRegistry.register(SELF_INFLICTED_KEY, {
    travelPath: 'none',
    style: 'victim-reaction',
    follow: 'victim',
    leadSeconds: 4,
    tailSeconds: 2,
    slowMoAtImpact: 0.5,
  });

  // Killstreaks ride the aircraft/missile in. Registered per streak id, but
  // an unregistered streak still films fine via the default.
  CameraDirectorRegistry.register('Killstreak_guided_missile', {
    travelPath: 'possessed',
    style: 'follow-instrument',
    follow: 'causer',
    leadSeconds: 4,
    tailSeconds: 2,
    slowMoAtImpact: 0.4,
  });
  CameraDirectorRegistry.register('Killstreak_airstrike', {
    travelPath: 'projectile',
    style: 'follow-instrument',
    follow: 'causer',
    leadSeconds: 3.5,
    tailSeconds: 2.5,
    slowMoAtImpact: 0.35,
  });
  CameraDirectorRegistry.register('Killstreak_attack_helicopter', {
    travelPath: 'possessed',
    style: 'follow-instrument',
    follow: 'causer',
    leadSeconds: 3,
    tailSeconds: 2.5,
    slowMoAtImpact: 1,
  });
}

// --- the plan ---------------------------------------------------------------

export interface CameraShot {
  readonly kind: 'follow' | 'impact-hold' | 'victim-reaction' | 'pair-orbit';
  /** Whoever this shot watches. Null when the actor was never recorded. */
  readonly subject: string | null;
  /** The second party, for a pair framing. */
  readonly other?: string | null;
  readonly fromTick: number;
  readonly toTick: number;
  readonly firstPerson?: boolean;
}

export interface KillcamPlan {
  readonly shots: readonly CameraShot[];
  readonly impactTick: number;
  readonly slowMoAtImpact: number;
  readonly fromTick: number;
  readonly toTick: number;
  /** Which profile produced this, for debugging and for tests. */
  readonly profileKey: string;
}

/** What the planner needs from a kill. Mirrors the recorded event payload. */
export interface KillFacts {
  readonly tick: number;
  readonly victim: string;
  readonly killer: string | null;
  readonly causer: string | null;
  readonly capabilityId: string | null;
  readonly selfInflicted: boolean;
}

/**
 * Turn a recorded kill into a shot list.
 *
 * Pure: same facts in, same plan out, no world access. That is what lets a
 * plan be rebuilt for a replay saved months ago under camera logic that did
 * not exist when it was recorded.
 */
export function buildKillcamPlan(
  kill: KillFacts, tickHz: number,
): KillcamPlan {
  // Self-inflicted is decided upstream, in the damage chokepoint, so there is
  // no detection logic here -- only a different lookup key.
  const profileKey = kill.selfInflicted
    ? SELF_INFLICTED_KEY
    : (kill.capabilityId ?? '');
  const profile = CameraDirectorRegistry.resolve(profileKey);

  const fromTick = Math.max(0, kill.tick - Math.round(profile.leadSeconds * tickHz));
  const toTick = kill.tick + Math.round(profile.tailSeconds * tickHz);

  const subjectFor = (which: CameraDirectorProfile['follow']): string | null => {
    if (which === 'victim') return kill.victim;
    if (which === 'causer') return kill.causer ?? kill.killer;
    return kill.killer;
  };

  const shots: CameraShot[] = [];
  const rides = profile.travelPath === 'projectile' || profile.travelPath === 'possessed';
  const instrument = subjectFor(profile.follow);

  if (rides && instrument) {
    // Chase the thing that did it, then hold on the impact.
    shots.push({
      kind: 'follow', subject: instrument, fromTick, toTick: kill.tick,
    });
    shots.push({
      kind: 'impact-hold', subject: kill.victim, fromTick: kill.tick, toTick,
    });
  } else if (profile.style === 'killer-pov' && kill.killer) {
    shots.push({
      kind: 'follow', subject: kill.killer, fromTick, toTick: kill.tick,
      firstPerson: true,
    });
    shots.push({
      kind: 'victim-reaction', subject: kill.victim,
      fromTick: kill.tick, toTick,
    });
  } else if (profile.style === 'victim-reaction') {
    shots.push({
      kind: 'victim-reaction', subject: kill.victim, fromTick, toTick,
    });
  } else {
    // The always-available fallback. Works even when the killer is unknown,
    // which is exactly the case an unregistered ability tends to produce.
    shots.push({
      kind: 'pair-orbit',
      subject: kill.killer ?? kill.victim,
      other: kill.victim,
      fromTick,
      toTick,
    });
  }

  return {
    shots,
    impactTick: kill.tick,
    slowMoAtImpact: profile.slowMoAtImpact,
    fromTick,
    toTick,
    profileKey: CameraDirectorRegistry.has(profileKey) ? profileKey : 'default',
  };
}
