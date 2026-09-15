/**
 * OperatorsMenu.ts — operator select, matching the reference layout.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ OPERATOR SELECT                                              │
 *   │ [COALITION] [ALLEGIANCE]                                     │
 *   ├─────────────┬────────────────────────────────────────────────┤
 *   │  faction    │                                                │
 *   │  crest      │            operator stands here                │
 *   │  CALLSIGN   │                                                │
 *   │  role/desc  │                                                │
 *   ├─────────────┴────────────────────────────────────────────────┤
 *   │  [ ][ ][ ][ ][ ]  operator thumbnails                        │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * The same OperatorShowcase instance the main menu uses is reused here rather
 * than a second scene: two live WebGL contexts for the same soldier would
 * double the cost for no visible gain.
 */
import eventBus from '../../core/EventBus';
import { GameState } from '../../state/GameStateManager';
import operatorRoster, { OPERATORS, type Faction, type Operator } from '../../customization/OperatorRoster';
import loadoutManager from '../../customization/LoadoutManager';
import { getWeapon } from '../../weapons/definitions';
import { button, div, el, uiSound } from '../dom';
import type { Screen } from '../UIManager';
import type { OperatorShowcase } from '../showcase/OperatorShowcase';

const FACTIONS: readonly Faction[] = ['COALITION', 'ALLEGIANCE'];

export class OperatorsMenu implements Screen {
  readonly element = div('screen screen--cod screen--operators');

  private readonly stage = div('cod__stage cod__stage--tall');
  private readonly factionRow = div('cod__faction-row');
  private readonly info = div('op__info');
  private readonly roster = div('op__roster');
  private showcase: OperatorShowcase | null = null;
  private activeFaction: Faction = 'COALITION';

  constructor() {
    const top = div('cod__topbar');
    top.append(
      div('cod__mode-title', 'OPERATOR SELECT'),
      this.factionRow,
      button('Back', 'btn btn--small btn--ghost', () => {
        uiSound('back');
        eventBus.emit('ui:navigate', { to: GameState.MAIN_MENU });
      }),
    );

    for (const faction of FACTIONS) {
      const tab = el('button', 'cod__tab');
      tab.type = 'button';
      tab.textContent = faction;
      tab.dataset.faction = faction;
      tab.addEventListener('click', () => {
        uiSound('confirm');
        this.activeFaction = faction;
        this.paint();
      });
      this.factionRow.appendChild(tab);
    }

    const body = div('op__body');
    body.append(this.info, this.stage);

    this.element.append(top, body, this.roster);
  }

  attachShowcase(showcase: OperatorShowcase): void {
    this.showcase = showcase;
  }

  onShow(): void {
    this.activeFaction = operatorRoster.selected.faction;
    this.paint();
    void this.mountShowcase();
  }

  onHide(): void {
    this.showcase?.unmount();
  }

  private async mountShowcase(): Promise<void> {
    if (!this.showcase) return;
    this.showcase.mount(this.stage);
    // A wider, more heroic stance than the main menu's low ready.
    this.showcase.setStance('stand');
    const primary = loadoutManager.getCurrentLoadout().primaryId;
    if (getWeapon(primary)) await this.showcase.setWeapon(primary);
    this.showcase.setOperatorTint(operatorRoster.selected);
    this.showcase.resize();
  }

  private paint(): void {
    for (const node of this.factionRow.children) {
      const tab = node as HTMLElement;
      tab.classList.toggle('cod__tab--active', tab.dataset.faction === this.activeFaction);
    }
    this.paintInfo(operatorRoster.selected);
    this.paintRoster();
  }

  private paintInfo(operator: Operator): void {
    this.info.replaceChildren();
    const crest = div('op__crest');
    crest.style.setProperty('--crest', `#${operator.accentColor.toString(16).padStart(6, '0')}`);
    crest.textContent = operator.name.slice(0, 1);
    this.info.append(
      crest,
      div('op__faction', operator.faction),
      div('op__name', operator.name),
      div('op__role', operator.role),
      div('op__desc', operator.description),
    );
  }

  private paintRoster(): void {
    this.roster.replaceChildren();
    for (const operator of OPERATORS.filter((o) => o.faction === this.activeFaction)) {
      const card = el('button', 'op__card');
      card.type = 'button';
      card.dataset.operatorId = operator.id;
      card.classList.toggle('op__card--active', operator.id === operatorRoster.selected.id);

      const swatch = div('op__card-swatch');
      swatch.style.background =
        `linear-gradient(160deg, #${operator.primaryColor.toString(16).padStart(6, '0')}, `
        + `#${operator.accentColor.toString(16).padStart(6, '0')})`;
      card.append(swatch, div('op__card-name', operator.name));

      card.addEventListener('click', () => {
        if (!operatorRoster.select(operator.id)) return;
        uiSound('confirm');
        this.paintInfo(operator);
        this.paintRoster();
        this.showcase?.setOperatorTint(operator);
      });
      this.roster.appendChild(card);
    }
  }

  /** Test seam. */
  get shownFaction(): string { return this.activeFaction; }
}

export default OperatorsMenu;
