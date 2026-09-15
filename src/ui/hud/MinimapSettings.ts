/**
 * MinimapSettings.ts — single source of truth for minimap presentation.
 *
 * All values live in SettingsStore (persisted across sessions), read live on
 * every draw so the settings menu's changes apply instantly — which is also
 * exactly what the settings menu's animated preview consumes, so preview and
 * HUD can never be looking at different values.
 */
import settingsStore from '../../core/SettingsStore';

export type MinimapMode = 'live' | 'radar';

export const MINIMAP_ZOOM = {
  /** World metres from the player (dish centre) to the dish edge. */
  MIN: 15,
  MAX: 75,
  DEFAULT: 45,
} as const;

export function getMinimapMode(): MinimapMode {
  return settingsStore.get<MinimapMode>('minimap.mode', 'live');
}

export function setMinimapMode(mode: MinimapMode): void {
  settingsStore.set('minimap.mode', mode);
}

export function getMinimapRotate(): boolean {
  return settingsStore.get<boolean>('minimap.rotate', false);
}

export function setMinimapRotate(rotate: boolean): void {
  settingsStore.set('minimap.rotate', rotate);
}

export function getMinimapZoomMeters(): number {
  return settingsStore.get<number>('minimap.zoom', MINIMAP_ZOOM.DEFAULT);
}

export function setMinimapZoomMeters(meters: number): void {
  settingsStore.set('minimap.zoom', meters);
}
