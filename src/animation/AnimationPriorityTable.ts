/**
 * AnimationPriorityTable.ts — Document B §8: the consolidated 10-tier
 * interrupt table. Whoever owns a joint owns its spring target; a one-shot
 * may only start if its tier >= everything currently running.
 */
export const PRIORITY = {
  Death: 10,
  Melee: 9,
  Switch: 8,
  Reload: 7,
  Fire: 6,
  TacSprintTransition: 5,
  SprintTransition: 4,
  AdsGuard: 3,
  IdleFidget: 2,
  Base: 1,
} as const;

export type PriorityName = keyof typeof PRIORITY;

/** Clip-name → tier for one-shot arbitration (data, not code paths). */
const CLIP_TIERS: Record<string, PriorityName> = {
  melee_punch_01: 'Melee',
  melee_punch_02: 'Melee',
  melee_punch_03: 'Melee',
  switch_out: 'Switch',
  switch_in: 'Switch',
  rifle_reload_tactical: 'Reload',
  rifle_reload_empty: 'Reload',
  pistol_reload_tactical: 'Reload',
  pistol_reload_empty: 'Reload',
  shotgun_reload_tactical: 'Reload',
  shotgun_reload_empty: 'Reload',
  inspect: 'IdleFidget',
};

export function tierOf(clipName: string): number {
  return PRIORITY[CLIP_TIERS[clipName] ?? 'Base'];
}

/** May `incoming` interrupt `current` (with its remaining seconds)? */
export function canInterrupt(current: string | null, incoming: string): boolean {
  if (!current) return true;
  return tierOf(incoming) >= tierOf(current);
}
