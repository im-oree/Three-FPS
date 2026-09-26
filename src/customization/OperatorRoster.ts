/**
 * OperatorRoster.ts — who the player can deploy as.
 *
 * The game previously had exactly one body with no notion of identity. This
 * introduces a roster: a faction, a callsign, a colour treatment and a
 * description per operator, persisted like any other loadout choice.
 *
 * Operators currently share one mesh and are distinguished by their material
 * treatment, which is honest about what exists rather than promising per
 * operator models that do not. Adding a real model later is one extra field
 * (`bodyPath`) read by the showcase -- the roster shape already allows it.
 */
import eventBus from '../core/EventBus';
import settingsStore from '../core/SettingsStore';

export type Faction = 'COALITION' | 'ALLEGIANCE';

export interface Operator {
  readonly id: string;
  readonly name: string;
  readonly faction: Faction;
  readonly role: string;
  readonly description: string;
  /** Base fatigue colour; the showcase tints the body with it. */
  readonly primaryColor: number;
  /** Webbing/armour accent. */
  readonly accentColor: number;
  /** Optional dedicated mesh. Falls back to the shared body when absent. */
  readonly bodyPath?: string;
}

export const OPERATORS: readonly Operator[] = [
  {
    id: 'ghost',
    name: 'GHOST',
    faction: 'COALITION',
    role: 'Assault',
    description: 'Balaclava and hard eyes. Moves first, explains later.',
    primaryColor: 0x2f3438,
    accentColor: 0x1b1e21,
  },
  {
    id: 'sentry',
    name: 'SENTRY',
    faction: 'COALITION',
    role: 'Support',
    description: 'Holds an angle until the angle gives up.',
    primaryColor: 0x4a5340,
    accentColor: 0x2d3327,
  },
  {
    id: 'nomad',
    name: 'NOMAD',
    faction: 'COALITION',
    role: 'Recon',
    description: 'Desert kit, long patrols, longer patience.',
    primaryColor: 0x8a7754,
    accentColor: 0x5d4f36,
  },
  {
    id: 'warden',
    name: 'WARDEN',
    faction: 'ALLEGIANCE',
    role: 'Breacher',
    description: 'Believes every door is a suggestion.',
    primaryColor: 0x3a3f4a,
    accentColor: 0x23262d,
  },
  {
    id: 'vandal',
    name: 'VANDAL',
    faction: 'ALLEGIANCE',
    role: 'Assault',
    description: 'Urban grey and a short temper.',
    primaryColor: 0x55585c,
    accentColor: 0x34363a,
  },
  {
    id: 'ronin',
    name: 'RONIN',
    faction: 'ALLEGIANCE',
    role: 'Flanker',
    description: 'Arrives from the side you stopped watching.',
    primaryColor: 0x4b3034,
    accentColor: 0x2b1b1e,
  },
];

const STORAGE_KEY = 'loadout.operator';
const DEFAULT_ID = 'ghost';

export function getOperator(id: string): Operator | null {
  return OPERATORS.find((operator) => operator.id === id) ?? null;
}

export class OperatorRoster {
  private selectedId: string;

  constructor() {
    const stored = settingsStore.get<string>(STORAGE_KEY, DEFAULT_ID);
    // Validate against the roster: a stored id from an older build (or a
    // hand-edited store) must not leave the player with no operator at all.
    this.selectedId = getOperator(stored) ? stored : DEFAULT_ID;
  }

  get selected(): Operator {
    return getOperator(this.selectedId) ?? OPERATORS[0];
  }

  get selectedId_(): string { return this.selectedId; }

  byFaction(faction: Faction): readonly Operator[] {
    return OPERATORS.filter((operator) => operator.faction === faction);
  }

  select(id: string): boolean {
    if (!getOperator(id)) return false;
    if (id === this.selectedId) return true;
    this.selectedId = id;
    settingsStore.set(STORAGE_KEY, id);
    eventBus.emit('operator:changed', { id });
    return true;
  }
}

export const operatorRoster = new OperatorRoster();
export default operatorRoster;
