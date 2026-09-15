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
import { LEVELS, getLevel } from '../../environment/LevelDefinition';
import loadoutManager from '../../customization/LoadoutManager';
import { getWeapon } from '../../weapons/definitions';
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
const MODES: ReadonlyArray<{ name: string; desc: string }> = [
  { name: 'TEAM DEATHMATCH', desc: 'Standard engagement. First to the score cap.' },
  { name: 'FREE-FOR-ALL', desc: 'Every operator for themselves.' },
  { name: 'HARDPOINT', desc: 'Hold the rotating objective.' },
  { name: 'SEARCH & DESTROY', desc: 'One life. Plant or defuse.' },
];

/** Daily challenges, presented the way the reference does. */
const CHALLENGES: ReadonlyArray<{ text: string; progress: number; goal: number }> = [
  { text: 'Get 2 Kills while Dead Silence is Active', progress: 0, goal: 2 },
  { text: 'Get 50 Kills with a Weapon with 0 attachments', progress: 0, goal: 50 },
  { text: 'Get 30 Assists', progress: 0, goal: 30 },
];

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

  constructor(private readonly onPlayLevel: (levelId: string) => void) {
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
      this.onPlayLevel(this.pickQuickPlayLevel());
    });
    this.modeList.appendChild(quick);

    for (const mode of MODES) {
      const card = el('button', 'cod__mode');
      card.type = 'button';
      card.append(
        div('cod__mode-name', mode.name),
        div('cod__mode-desc', mode.desc),
      );
      card.addEventListener('click', () => {
        uiSound('confirm');
        this.onPlayLevel(this.pickQuickPlayLevel());
      });
      this.modeList.appendChild(card);
    }

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

  /** The level Quick Play deploys to: the filter if set, else random. */
  private pickQuickPlayLevel(): string {
    if (this.filterLevelId) return this.filterLevelId;
    return LEVELS[Math.floor(Math.random() * LEVELS.length)].id;
  }

  /**
   * The map browser, as a modal window over the lobby.
   *
   * A window rather than a pane swap: the reference treats map selection as
   * an overlay on top of the lobby, and it keeps the operator and the rest
   * of the screen visible behind it, which is most of the atmosphere.
   */
  private openMapBrowser(): void {
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
      shot.style.backgroundImage = `url('assets/previews/${level.id}.jpg')`;

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
