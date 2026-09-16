/**
 * Weather.ts — custom-match weather presets.
 *
 * Weather is a PRESENTATION setting, not a simulation one: it changes sky
 * colour, fog density and light intensity, and nothing else. That is a
 * deliberate boundary. The moment weather affected sightlines or movement it
 * would have to become authoritative server state and be replicated, because
 * a client that renders clear weather while the server thinks it is foggy
 * would have an advantage. Keeping it visual keeps it honest.
 *
 * Each preset is expressed as MULTIPLIERS and tints over the level's own
 * definition rather than absolute values, so a preset works on every map
 * instead of overwriting each level's carefully-chosen palette with one
 * global look.
 */

export interface WeatherPreset {
  readonly id: string;
  readonly displayName: string;
  /** Tint applied to the level's sky colour. 1 = unchanged. */
  readonly skyTint: readonly [number, number, number];
  /** Multiplier on the level's fog density. */
  readonly fogScale: number;
  /** Multiplier on directional (sun) light intensity. */
  readonly sunScale: number;
  /** Multiplier on ambient/hemisphere light intensity. */
  readonly ambientScale: number;
}

export const WEATHER: readonly WeatherPreset[] = [
  {
    id: 'clear',
    displayName: 'Clear',
    skyTint: [1, 1, 1],
    fogScale: 1,
    sunScale: 1,
    ambientScale: 1,
  },
  {
    // Flat, grey, diffuse: the sun goes soft and the sky loses its blue.
    id: 'overcast',
    displayName: 'Overcast',
    skyTint: [0.82, 0.85, 0.88],
    fogScale: 1.8,
    sunScale: 0.45,
    ambientScale: 1.15,
  },
  {
    // Thick fog: sightlines close right down, which changes how a map plays
    // without changing any rule.
    id: 'fog',
    displayName: 'Fog',
    skyTint: [0.88, 0.89, 0.9],
    fogScale: 6.5,
    sunScale: 0.35,
    ambientScale: 0.95,
  },
  {
    // Night: dark and blue, but never so dark the map is unreadable --
    // an unplayable match is not a feature.
    id: 'night',
    displayName: 'Night',
    skyTint: [0.14, 0.17, 0.28],
    fogScale: 2.4,
    sunScale: 0.16,
    ambientScale: 0.42,
  },
];

const BY_ID = new Map(WEATHER.map((w) => [w.id, w]));

/** Look up a preset. Unknown ids fall back to clear rather than throwing. */
export function getWeather(id: string | null | undefined): WeatherPreset {
  return (id ? BY_ID.get(id) : undefined) ?? WEATHER[0];
}

/** Apply a preset's tint to a packed 0xRRGGBB colour. */
export function tintColour(hex: number, tint: readonly [number, number, number]): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * tint[0]));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * tint[1]));
  const b = Math.min(255, Math.round((hex & 0xff) * tint[2]));
  return (r << 16) | (g << 8) | b;
}

export default WEATHER;
