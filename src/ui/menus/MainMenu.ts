/**
 * MainMenu.ts — the Call of Duty multiplayer lobby, restructured.
 *
 * LAYOUT, matching the reference screenshots 1:1:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ MULTIPLAYER      PLAY WEAPONS OPERATORS BARRACKS   [player]  │  top bar
 *   ├───────────────┬──────────────────────────┬───────────────────┤
 *   │ QUICK PLAY    │                          │ Daily Challenges  │
 *   │ GROUND WAR    │      operator stands     │                   │
 *   │ GUNFIGHT      │      here, holding the   │ Active Mission    │
 *   │ FREE-FOR-ALL  │      equipped weapon     │                   │
 *   │ REALISM       │                          │ [featured card]   │
 *   ├───────────────┴──────────────────────────┴───────────────────┤
 *   │ Back        Options        Select              ticker text   │  footer
 *   └──────────────────────────────────────────────────────────────┘
 *
 * The centre is NOT an image. It is a live 3D scene (OperatorShowcase)
 * rendering the actual equipped primary, because the pose has to change when
 * the loadout does.
 *
 * The mode list doubles as the level select: picking a mode card deploys to
 * that level, so the COD structure is a reskin of the real flow rather than
 * a decorative shell in front of it.
 */
import eventBus from '../../core/EventBus';
import cheatsStore, { CheatId, type CheatIdValue } from '../../core/CheatsStore';
import { GameState, type GameStateValue } from '../../state/GameStateManager';
import {
  LEVELS, ROTATION_LEVELS, getLevel, previewUrl,
} from '../../environment/LevelDefinition';
import {
  GAME_MODES, getGameMode, type GameModeOverrides,
} from '../../server/GameModes';
import loadoutManager from '../../customization/LoadoutManager';
import { getWeapon } from '../../weapons/definitions';
import { MENU_SHOWCASE } from '../../utils/Constants';
import { button, div, el, uiSound } from '../dom';
import type { Screen } from '../UIManager';
import type { OperatorShowcase } from '../showcase/OperatorShowcase';

/** Top navigation, mirroring the reference. */
const TABS = ['PLAY', 'WEAPONS', 'OPERATORS', 'BARRACKS', 'STORE'] as const;
type Tab = typeof TABS[number];

/** Which tabs route to an existing screen rather than a placeholder panel. */
const TAB_ROUTES: Partial<Record<Tab, GameStateValue>> = {
  WEAPONS: GameState.LOADOUT,
  OPERATORS: GameState.OPERATORS,
};

const CHEATS: ReadonlyArray<{ id: CheatIdValue; name: string; desc: string }> = [
  {
    id: CheatId.INFINITE_STUFF,
    name: 'Infinite Stuff',
    desc: 'Bottomless magazines and reserves; killstreaks always ready.',
  },
  {
    id: CheatId.GOD_MODE,
    name: 'God Mode',
    desc: 'Damage still lands but health can never hit zero.',
  },
];

/**
 * Playlist entries, as the reference presents them.
 *
 * These are presentation over the one real match type the game has; naming
 * them honestly as playlists (rather than inventing rulesets that do not
 * exist) keeps the lobby looking right without lying about what deploying
 * actually does.
 */
/**
 * The playable modes, built from the SERVER's own registry.
 *
 * Derived rather than hand-written, so a card cannot advertise rules the
 * server does not implement. These used to be four decorative cards that all
 * started the same free-for-all -- picking "Search & Destroy" gave you FFA.
 */
const MODES: ReadonlyArray<{ id: string; name: string; desc: string }> =
  GAME_MODES.map((mode) => ({
    id: mode.id,
    name: mode.displayName.toUpperCase(),
    desc: mode.teamBased
      ? `Team battle. First team to ${mode.scoreLimit} wins.`
      : `Every operator for themselves. First to ${mode.scoreLimit}.`,
  }));

/** Daily challenges, presented the way the reference does. */
const CHALLENGES: ReadonlyArray<{ text: string; progress: number; goal: number }> = [
  { text: 'Get 2 Kills while Dead Silence is Active', progress: 0, goal: 2 },
  { text: 'Get 50 Kills with a Weapon with 0 attachments', progress: 0, goal: 50 },
  { text: 'Get 30 Assists', progress: 0, goal: 30 },
];

/** Custom-match rule choices offered to the host. */
const SCORE_CHOICES = [10, 20, 30, 50, 75, 100] as const;
const TIME_CHOICES = [5, 10, 15, 20] as const;
const PLAYER_CHOICES = [2, 4, 6, 8, 10, 12] as const;
const RESPAWN_CHOICES = [
  { value: 1.5, label: 'FAST' },
  { value: 3, label: 'NORMAL' },
  { value: 6, label: 'SLOW' },
] as const;

/**
 * The offered choice closest to `target`.
 *
 * A mode's real default need not be one of the round numbers on offer (team
 * deathmatch scores to 75, respawns after 5 s). Highlighting the nearest
 * offer keeps the dialog honest instead of leaving a row with nothing lit or,
 * worse, lighting a value the match will not use.
 */
function nearestChoice(choices: readonly number[], target: number): number {
  let best = choices[0];
  for (const choice of choices) {
    if (Math.abs(choice - target) < Math.abs(best - target)) best = choice;
  }
  return best;
}

export class MainMenu implements Screen {
  readonly element = div('screen screen--cod');

  private readonly stage = div('cod__stage');
  private readonly modeList = div('cod__modes');
  private readonly rightRail = div('cod__rail');
  private readonly tabRow = div('cod__tabs');
  private readonly footerHint = div('cod__ticker');
  private activeTab: Tab = 'PLAY';
  private mode: 'root' | 'levels' | 'quit' = 'root';
  private showcase: OperatorShowcase | null = null;
  /** When set, Quick Play always deploys here instead of a random map. */
  private filterLevelId: string | null = null;

  constructor(
    private readonly onPlayLevel: (
      levelId: string,
      options?: { modeId?: string; overrides?: GameModeOverrides; weather?: string },
    ) => void,
  ) {
    this.element.append(this.buildTopBar(), this.buildBody(), this.buildFooter());
    this.showRoot();
  }

  /** Injected after construction so the menu does not own asset loading. */
  attachShowcase(showcase: OperatorShowcase): void {
    this.showcase = showcase;
  }

  // --- structure -----------------------------------------------------------

  private buildTopBar(): HTMLElement {
    const bar = div('cod__topbar');

    for (const tab of TABS) {
      const btn = el('button', 'cod__tab');
      btn.type = 'button';
      btn.textContent = tab;
      btn.dataset.tab = tab;
      btn.addEventListener('click', () => this.selectTab(tab));
      this.tabRow.appendChild(btn);
    }

    // Player identity block, right-aligned as in the reference.
    const player = div('cod__player');
    const rank = div('cod__rank');
    rank.append(div('cod__rank-badge', '1'), div('cod__rank-label', 'OPERATOR'));
    const bar2 = div('cod__xpbar');
    bar2.appendChild(div('cod__xpbar-fill'));
    const named = div('cod__player-meta');
    named.append(div('cod__player-name', 'OPERATOR#0001'), bar2);
    player.append(rank, named);

    bar.append(this.tabRow, player);
    this.paintTabs();
    return bar;
  }

  private buildBody(): HTMLElement {
    const body = div('cod__body');
    body.append(this.modeList, this.stage, this.rightRail);
    return body;
  }

  private buildFooter(): HTMLElement {
    const footer = div('cod__footer');
    const keys = div('cod__keys');
    keys.append(
      this.footKey('Esc', 'Back'),
      this.footKey('Tab', 'Options'),
      this.footKey('Enter', 'Select'),
    );
    this.footerHint.textContent = 'Welcome to OPERATOR. Have fun, stay frosty.';
    footer.append(keys, this.footerHint);
    return footer;
  }

  private footKey(key: string, label: string): HTMLElement {
    const wrap = div('cod__key');
    wrap.append(div('cod__key-cap', key), div('cod__key-label', label));
    return wrap;
  }

  // --- tabs ----------------------------------------------------------------

  private selectTab(tab: Tab): void {
    const route = TAB_ROUTES[tab];
    if (route) {
      uiSound('confirm');
      eventBus.emit('ui:navigate', { to: route });
      return;
    }
    uiSound('confirm');
    this.activeTab = tab;
    this.paintTabs();
    this.showRoot();
  }

  private paintTabs(): void {
    for (const node of this.tabRow.children) {
      const btn = node as HTMLElement;
      btn.classList.toggle('cod__tab--active', btn.dataset.tab === this.activeTab);
    }
  }

  // --- panes ---------------------------------------------------------------

  onShow(): void {
    this.activeTab = 'PLAY';
    this.paintTabs();
    this.showRoot();
    void this.refreshShowcase();
  }

  onHide(): void {
    this.showcase?.unmount();
  }

  /** Put the current primary in the operator's hands and mount the scene. */
  private async refreshShowcase(): Promise<void> {
    if (!this.showcase) return;
    this.showcase.mount(this.stage);
    this.showcase.setStance('stand');
    this.showcase.setExposure(1);
    this.showcase.setBodyYaw(MENU_SHOWCASE.BODY_YAW);
    const primary = loadoutManager.getCurrentLoadout().primaryId;
    if (getWeapon(primary)) await this.showcase.setWeapon(primary);
    this.showcase.resize();
  }

  private showRoot(): void {
    this.mode = 'root';
    this.buildModeList();
    this.buildRail();
  }

  /**
   * The mode list IS the level list.
   *
   * Presenting real levels as COD-style mode cards keeps the reference
   * structure honest: every card deploys somewhere that actually exists,
   * rather than decorating the screen with modes that do nothing.
   */
  private buildModeList(): void {
    this.modeList.replaceChildren();

    // QUICK PLAY deploys immediately to a random map. It is the primary
    // action on the screen, so it must not open a submenu first -- and it
    // must never sit behind a "start" button once the map is chosen.
    const quick = div('cod__mode cod__mode--featured');
    quick.append(
      div('cod__mode-tag', 'FAST'),
      div('cod__mode-name', 'QUICK PLAY'),
      div('cod__mode-desc', this.filterLevelId
        ? `Deploying to ${getLevel(this.filterLevelId).displayName}.`
        : 'Deploy immediately to a random map.'),
    );
    quick.addEventListener('click', () => {
      uiSound('confirm');
      this.onPlayLevel(this.pickQuickPlayLevel(), { modeId: 'ffa' });
    });
    this.modeList.appendChild(quick);

    for (const mode of MODES) {
      const card = el('button', 'cod__mode');
      card.type = 'button';
      card.dataset.modeId = mode.id;
      card.append(
        div('cod__mode-name', mode.name),
        div('cod__mode-desc', mode.desc),
      );
      card.addEventListener('click', () => {
        uiSound('confirm');
        // Deploy into THIS mode, not whatever the last one was.
        this.onPlayLevel(this.pickQuickPlayLevel(), { modeId: mode.id });
      });
      this.modeList.appendChild(card);
    }

    // CUSTOM MATCH: the same modes, with the rules opened up.
    const custom = el('button', 'cod__mode cod__mode--custom');
    custom.type = 'button';
    custom.append(
      div('cod__mode-tag', 'HOST'),
      div('cod__mode-name', 'CUSTOM MATCH'),
      div('cod__mode-desc', 'Set the mode, map, score limit, time and weather.'),
    );
    custom.addEventListener('click', () => {
      uiSound('confirm');
      this.openCustomMatch();
    });
    this.modeList.appendChild(custom);

    // The map filter: opens the map browser rather than listing levels here,
    // so the left column stays a MODE list like the reference.
    const maps = el('button', 'cod__mode cod__mode--maps');
    maps.type = 'button';
    maps.append(
      div('cod__mode-name', 'MAPS'),
      div('cod__mode-desc', this.filterLevelId
        ? getLevel(this.filterLevelId).displayName
        : 'All maps in rotation. Click to filter.'),
    );
    maps.addEventListener('click', () => {
      uiSound('confirm');
      this.openMapBrowser();
    });
    this.modeList.appendChild(maps);
  }

  /**
   * Close any open modal window.
   *
   * One window at a time: opening a second over the first leaves the new
   * window's controls underneath a stale overlay, so clicks land on
   * something the player cannot see.
   */
  private closeWindows(): void {
    for (const win of this.element.querySelectorAll('.mapwin')) win.remove();
  }

  /** The level Quick Play deploys to: the filter if set, else random. */
  private pickQuickPlayLevel(): string {
    if (this.filterLevelId) return this.filterLevelId;
    // ROTATION_LEVELS, not LEVELS: developer sandboxes are reachable only by
    // picking them explicitly in the map window.
    const pool = ROTATION_LEVELS.length ? ROTATION_LEVELS : LEVELS;
    return pool[Math.floor(Math.random() * pool.length)].id;
  }

  /**
   * The map browser, as a modal window over the lobby.
   *
   * A window rather than a pane swap: the reference treats map selection as
   * an overlay on top of the lobby, and it keeps the operator and the rest
   * of the screen visible behind it, which is most of the atmosphere.
   */
  private openMapBrowser(): void {
    this.closeWindows();
    const overlay = div('mapwin');
    const panel = div('mapwin__panel');

    const head = div('mapwin__head');
    head.append(
      div('mapwin__title', 'SELECT MAP'),
      button('CLOSE', 'btn btn--small btn--ghost', () => {
        uiSound('back');
        overlay.remove();
      }),
    );

    const grid = div('mapwin__grid');

    // "Any map" restores the random rotation.
    const anyCard = el('button', 'mapcard mapcard--any');
    anyCard.type = 'button';
    anyCard.classList.toggle('mapcard--active', this.filterLevelId === null);
    anyCard.append(
      div('mapcard__shot mapcard__shot--any', 'ANY'),
      div('mapcard__name', 'RANDOM'),
      div('mapcard__desc', 'Deploy to any map in rotation.'),
    );
    anyCard.addEventListener('click', () => {
      uiSound('confirm');
      this.filterLevelId = null;
      overlay.remove();
      this.buildModeList();
    });
    grid.appendChild(anyCard);

    for (const level of LEVELS) {
      const card = el('button', 'mapcard');
      card.type = 'button';
      card.dataset.levelId = level.id;
      card.classList.toggle('mapcard--active', this.filterLevelId === level.id);

      const shot = div('mapcard__shot');
      // Previews are generated by tools/generateMapPreviews.mjs and are
      // compulsory: verify:previews fails the build when one is missing.
      shot.style.backgroundImage = `url('${previewUrl(level.id)}')`;

      card.append(
        shot,
        div('mapcard__name', level.displayName.toUpperCase()),
        div('mapcard__desc', level.description),
      );
      card.addEventListener('click', () => {
        uiSound('confirm');
        // Selecting a map DEPLOYS. No second "start" click.
        overlay.remove();
        this.onPlayLevel(level.id);
      });
      // Right-click sets it as the filter without deploying.
      card.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        uiSound('confirm');
        this.filterLevelId = level.id;
        overlay.remove();
        this.buildModeList();
      });
      grid.appendChild(card);
    }

    const foot = div('mapwin__foot',
      'Click a map to deploy now. Right-click to set it as your filter.');

    panel.append(head, grid, foot);
    overlay.appendChild(panel);
    // Click-away closes, which is what a window is expected to do.
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        uiSound('back');
        overlay.remove();
      }
    });
    this.element.appendChild(overlay);
  }

  /**
   * The custom match window: host a game with the rules opened up.
   *
   * Every control here edits a GameModeOverrides patch against a real mode
   * definition, and the server applies it with the same `customise()` a
   * built-in mode goes through. There is no separate custom-match code path,
   * which is exactly what makes every setting work by construction rather
   * than each one needing to be plumbed individually.
   */
  private openCustomMatch(): void {
    this.closeWindows();
    const overlay = div('mapwin');
    const panel = div('mapwin__panel mapwin__panel--custom');

    // Working state. Starts as a copy of the base mode's own rules, so the
    // dialog opens showing the real defaults rather than invented ones.
    let modeId = 'ffa';
    let levelId = this.filterLevelId ?? this.pickQuickPlayLevel();
    let weather = 'clear';
    const overrides: {
      scoreLimit?: number; timeLimitSeconds?: number;
      maxPlayers?: number; respawnDelaySeconds?: number;
    } = {};

    const head = div('mapwin__head');
    head.append(
      div('mapwin__title', 'CUSTOM MATCH'),
      button('CLOSE', 'btn btn--small btn--ghost', () => {
        uiSound('back');
        overlay.remove();
      }),
    );

    const body = div('custom__body');
    const summary = div('custom__summary');

    const refreshSummary = (): void => {
      const base = getGameMode(modeId);
      const limit = overrides.scoreLimit
        ?? nearestChoice(SCORE_CHOICES, base.scoreLimit);
      const minutes = Math.round((overrides.timeLimitSeconds
        ?? nearestChoice(TIME_CHOICES.map((n) => n * 60), base.timeLimitSeconds)) / 60);
      const players = overrides.maxPlayers
        ?? nearestChoice(PLAYER_CHOICES, base.maxPlayers);
      summary.textContent = `${base.displayName} · ${getLevel(levelId).displayName}`
        + ` · ${limit} to win · ${minutes} min · ${players} players`
        + ` · ${weather}`;
    };

    /**
     * A row of mutually-exclusive choices.
     *
     * Returns the row plus a `select` hook so rows whose correct value
     * depends on another row (the rule rows all follow MODE) can be
     * re-pointed when that other row changes. Without it the highlight
     * keeps showing the old mode's default while the match actually uses
     * the new one -- the UI and the server disagreeing about the rules.
     */
    const choiceRow = <T>(
      label: string,
      options: ReadonlyArray<{ value: T; label: string }>,
      initial: T,
      onPick: (value: T) => void,
    ): { row: HTMLElement; select: (value: T) => void } => {
      const row = div('custom__row');
      row.appendChild(div('custom__label', label));
      const choices = div('custom__choices');
      let current = initial;
      const buttons: Array<{ node: HTMLElement; value: T }> = [];
      const paint = (): void => {
        for (const b of buttons) {
          b.node.classList.toggle('custom__choice--on', b.value === current);
        }
      };
      for (const option of options) {
        const node = el('button', 'custom__choice', option.label);
        node.type = 'button';
        node.addEventListener('click', () => {
          uiSound('confirm');
          current = option.value;
          onPick(option.value);
          paint();
          refreshSummary();
        });
        buttons.push({ node, value: option.value });
        choices.appendChild(node);
      }
      paint();
      row.appendChild(choices);
      return {
        row,
        select: (value: T) => { current = value; paint(); },
      };
    };

    // Assigned once the rows exist; MODE re-points them on every change.
    let syncRuleRows = (): void => {};

    const modeRow = choiceRow(
      'MODE',
      GAME_MODES.map((m) => ({ value: m.id, label: m.displayName.toUpperCase() })),
      modeId,
      (value) => {
        modeId = value;
        // Clearing the overrides on a mode change is deliberate: a score
        // limit of 30 is right for FFA and absurd for team deathmatch, so
        // carrying it across would silently produce a broken match.
        overrides.scoreLimit = undefined;
        overrides.timeLimitSeconds = undefined;
        overrides.maxPlayers = undefined;
        overrides.respawnDelaySeconds = undefined;
        // ...and the rows must now show the NEW mode's defaults.
        syncRuleRows();
      },
    );
    const mapRow = choiceRow(
      'MAP',
      (ROTATION_LEVELS.length ? ROTATION_LEVELS : LEVELS)
        .map((l) => ({ value: l.id, label: l.displayName.toUpperCase() })),
      levelId,
      (value) => { levelId = value; },
    );
    const scoreRow = choiceRow(
      'SCORE LIMIT',
      SCORE_CHOICES.map((n) => ({ value: n, label: String(n) })),
      nearestChoice(SCORE_CHOICES, getGameMode(modeId).scoreLimit),
      (value) => { overrides.scoreLimit = value; },
    );
    const timeRow = choiceRow(
      'TIME LIMIT',
      TIME_CHOICES.map((n) => ({ value: n * 60, label: `${n} MIN` })),
      nearestChoice(TIME_CHOICES.map((n) => n * 60), getGameMode(modeId).timeLimitSeconds),
      (value) => { overrides.timeLimitSeconds = value; },
    );
    const playerRow = choiceRow(
      'PLAYERS',
      PLAYER_CHOICES.map((n) => ({ value: n, label: String(n) })),
      nearestChoice(PLAYER_CHOICES, getGameMode(modeId).maxPlayers),
      (value) => { overrides.maxPlayers = value; },
    );
    const respawnRow = choiceRow(
      'RESPAWN',
      RESPAWN_CHOICES,
      nearestChoice(
        RESPAWN_CHOICES.map((c) => c.value),
        getGameMode(modeId).respawnDelaySeconds,
      ),
      (value) => { overrides.respawnDelaySeconds = value; },
    );
    const weatherRow = choiceRow(
      'WEATHER',
      [{ value: 'clear', label: 'CLEAR' }, { value: 'overcast', label: 'OVERCAST' },
        { value: 'fog', label: 'FOG' }, { value: 'night', label: 'NIGHT' }],
      weather,
      (value) => { weather = value; },
    );

    // Point every rule row at the current mode's real defaults. The offered
    // choices are round numbers, so a mode whose default is not one of them
    // (team deathmatch wants 75) highlights the closest offer -- and the
    // summary reads from the same resolved numbers, so what the host sees
    // highlighted is exactly what the match will run.
    syncRuleRows = (): void => {
      const base = getGameMode(modeId);
      scoreRow.select(nearestChoice(SCORE_CHOICES, base.scoreLimit));
      timeRow.select(nearestChoice(TIME_CHOICES.map((n) => n * 60), base.timeLimitSeconds));
      playerRow.select(nearestChoice(PLAYER_CHOICES, base.maxPlayers));
      respawnRow.select(nearestChoice(
        RESPAWN_CHOICES.map((c) => c.value), base.respawnDelaySeconds,
      ));
      refreshSummary();
    };

    body.append(
      modeRow.row, mapRow.row, scoreRow.row, timeRow.row,
      playerRow.row, respawnRow.row, weatherRow.row,
    );

    refreshSummary();

    const foot = div('mapwin__foot custom__foot');
    foot.append(summary);
    const start = button('START MATCH', 'btn btn--primary', () => {
      uiSound('confirm');
      overlay.remove();
      // Drop the untouched fields so the server keeps its own defaults for
      // anything the host did not actually change.
      const patch: GameModeOverrides = {
        ...(overrides.scoreLimit !== undefined
          ? { scoreLimit: overrides.scoreLimit } : {}),
        ...(overrides.timeLimitSeconds !== undefined
          ? { timeLimitSeconds: overrides.timeLimitSeconds } : {}),
        ...(overrides.maxPlayers !== undefined
          ? { maxPlayers: overrides.maxPlayers } : {}),
        ...(overrides.respawnDelaySeconds !== undefined
          ? { respawnDelaySeconds: overrides.respawnDelaySeconds } : {}),
      };
      this.onPlayLevel(levelId, { modeId, overrides: patch, weather });
    });
    foot.appendChild(start);

    panel.append(head, body, foot);
    overlay.appendChild(panel);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        uiSound('back');
        overlay.remove();
      }
    });
    this.element.appendChild(overlay);
  }

  private buildRail(): void {
    this.rightRail.replaceChildren();

    // --- daily challenges ----------------------------------------------------
    const challenges = div('cod__card');
    challenges.appendChild(div('cod__card-title', 'Daily Challenges'));
    for (const challenge of CHALLENGES) {
      const row = div('cod__challenge');
      row.append(
        div('cod__challenge-text', challenge.text),
        (() => {
          const track = div('cod__challenge-track');
          const fill = div('cod__challenge-fill');
          fill.style.width = `${(challenge.progress / challenge.goal) * 100}%`;
          track.appendChild(fill);
          return track;
        })(),
        div('cod__challenge-count', `${challenge.progress}/${challenge.goal}`),
      );
      challenges.appendChild(row);
    }
    this.rightRail.appendChild(challenges);

    // --- cheats, kept but restyled into the rail ---------------------------
    const cheats = div('cod__card');
    cheats.appendChild(div('cod__card-title', 'Cheats'));
    for (const cheat of CHEATS) {
      const row = div('cheat-row');
      const info = div('cheat-row__info');
      info.append(
        div('cheat-row__name', cheat.name),
        div('cheat-row__desc', cheat.desc),
      );
      const toggle = el('button', 'cheat-row__toggle');
      toggle.type = 'button';
      const paint = (on: boolean): void => {
        toggle.textContent = on ? 'ON' : 'OFF';
        toggle.classList.toggle('cheat-row__toggle--on', on);
        row.classList.toggle('cheat-row--on', on);
      };
      paint(cheatsStore.get(cheat.id));
      toggle.addEventListener('click', () => {
        paint(cheatsStore.toggle(cheat.id));
        uiSound('confirm');
      });
      row.append(info, toggle);
      cheats.appendChild(row);
    }
    this.rightRail.appendChild(cheats);

    // --- settings / quit ----------------------------------------------------
    const actions = div('cod__card cod__card--actions');
    actions.append(
      button('Settings', 'btn btn--small', () => {
        uiSound('confirm');
        eventBus.emit('ui:navigate', { to: GameState.SETTINGS });
      }),
      button('Quit', 'btn btn--small btn--ghost btn--danger', () => this.showQuit()),
    );
    this.rightRail.appendChild(actions);
  }

  /** A page cannot close its own tab, so Quit explains rather than pretends. */
  private showQuit(): void {
    this.mode = 'quit';
    this.rightRail.replaceChildren();
    const panel = div('cod__card');
    panel.append(
      div('cod__card-title', 'Session Ended'),
      div('cod__card-body', 'Thanks for playing. Close the tab to exit, or head back in.'),
      button('Back to Menu', 'btn btn--small', () => {
        uiSound('back');
        this.showRoot();
      }),
    );
    this.rightRail.appendChild(panel);
  }

  /** Test seam. */
  get currentMode(): string { return this.mode; }
  get currentTab(): string { return this.activeTab; }
}

export default MainMenu;
