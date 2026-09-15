/**
 * IconLibrary.ts — Document J §1.4.
 *
 * Maps a killstreak id to its baked glyph. One file per streak; locked /
 * ready / active are runtime tint and overlay, never extra baked variants.
 */
export const KILLSTREAK_ICONS: Record<string, string> = {
  uav: '/assets/ui/killstreak_icons/uav.png',
  airstrike: '/assets/ui/killstreak_icons/airstrike.png',
  attack_helicopter: '/assets/ui/killstreak_icons/attack_helicopter.png',
  guided_missile: '/assets/ui/killstreak_icons/guided_missile.png',
};

export function killstreakIcon(id: string): string | null {
  return KILLSTREAK_ICONS[id] ?? null;
}

/** Every icon path, for AssetLoader.preload() during LOADING. */
export function allIconPaths(): string[] {
  return Object.values(KILLSTREAK_ICONS);
}
