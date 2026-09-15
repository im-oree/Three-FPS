/**
 * LoadoutMenu.ts — Document 5 §7.3.
 *
 * Primary + secondary weapon selection, a skin per slot, and a live rotating
 * 3D preview.
 *
 * ONE-RENDERER EXCEPTION, documented as required: this screen owns a small
 * second WebGLRenderer for the preview viewport. That does not violate the
 * Document 1 "one renderer" rule, which is about the GAME VIEW — this is an
 * offscreen preview panel that only runs while the screen is visible, and is
 * explicitly stopped in onHide() so it costs nothing during a match.
 */
import * as THREE from 'three';
import eventBus from '../../core/EventBus';
import { GameState } from '../../state/GameStateManager';
import loadoutManager, {
  PRIMARY_CHOICES, SECONDARY_CHOICES, type Loadout,
} from '../../customization/LoadoutManager';
import { SKINS } from '../../customization/SkinManager';
import settingsStore from '../../core/SettingsStore';
import equipmentManager from '../../equipment/EquipmentManager';
import { ALL_THROWABLES } from '../../equipment/definitions';
import killstreakManager from '../../killstreaks/KillstreakManager';
import { KILLSTREAK } from '../../utils/Constants';
import {
  ALL_KILLSTREAKS, DEFAULT_KILLSTREAK_LOADOUT,
} from '../../killstreaks/definitions';
import { button, div, el, uiSound } from '../dom';
import type SkinManager from '../../customization/SkinManager';
import type { AssetLoader } from '../../core/AssetLoader';
import type { Screen } from '../UIManager';

const WEAPON_LABELS: Record<string, string> = {
  rifle: 'Assault Rifle',
  smg: 'Submachine Gun',
  shotgun: 'Pump Shotgun',
  sniper: 'Bolt Sniper',
  rocket_launcher: 'Rocket Launcher',
  pistol: 'Sidearm',
};

const MODEL_PATHS: Record<string, string> = {
  rifle: 'weapons/rifle.glb',
  smg: 'weapons/smg.glb',
  shotgun: 'weapons/shotgun.glb',
  sniper: 'weapons/sniper.glb',
  rocket_launcher: 'weapons/rocket_launcher.glb',
  pistol: 'weapons/pistol.glb',
};

export class LoadoutMenu implements Screen {
  readonly element = div('screen');
  private readonly previewHost = div('loadout__preview');
  private readonly primaryCol = div();
  private readonly secondaryCol = div();

  // Preview viewport.
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly previewScene = new THREE.Scene();
  private readonly previewCamera = new THREE.PerspectiveCamera(38, 1, 0.01, 20);
  private readonly turntable = new THREE.Group();
  private rafHandle = 0;
  private previewToken = 0;
  /** Which slot the preview is showing. */
  private focus: 'primary' | 'secondary' = 'primary';

  constructor(
    private readonly assetLoader: AssetLoader,
    private readonly skins: SkinManager,
  ) {
    const inner = div('screen__inner');
    const panel = div('panel');
    panel.append(el('p', 'subtitle', 'Prepare'), el('h2', 'title', 'LOADOUT'));

    const grid = div('loadout__grid');
    grid.append(this.primaryCol, this.secondaryCol, this.previewHost);
    panel.appendChild(grid);

    const footer = div('btn-row');
    footer.style.marginTop = '22px';
    footer.appendChild(button('Back', 'btn', () => {
      uiSound('back');
      eventBus.emit('ui:navigate', { to: GameState.MAIN_MENU });
    }));
    panel.appendChild(footer);

    inner.appendChild(panel);
    this.element.appendChild(inner);

    this.previewCamera.position.set(0, 0.08, 0.95);
    this.previewCamera.lookAt(0, 0, 0);
    // Product-shot lighting. The weapons are near-black gunmetal, so a dim
    // setup renders them as a silhouette you cannot actually evaluate. Fill
    // generously, then key/rim for form.
    this.previewScene.add(new THREE.AmbientLight(0xffffff, 1.6));
    this.previewScene.add(new THREE.HemisphereLight(0xcfd8e6, 0x3a4048, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(1.5, 2, 1.8);
    this.previewScene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 1.4);
    fill.position.set(-1.8, 0.4, 1.2);
    this.previewScene.add(fill);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 2.0);
    rim.position.set(-2, 0.8, -1.8);
    this.previewScene.add(rim);
    this.previewScene.add(this.turntable);
  }

  onShow(): void {
    this.rebuild();
    this.startPreview();
  }

  onHide(): void {
    this.stopPreview();
  }

  // --- selection UI --------------------------------------------------------

  private rebuild(): void {
    const current = loadoutManager.getCurrentLoadout();
    this.buildSlot(this.primaryCol, 'Primary', PRIMARY_CHOICES, current.primaryId,
      current.primarySkinId, 'primary');
    this.buildSlot(this.secondaryCol, 'Secondary', SECONDARY_CHOICES, current.secondaryId,
      current.secondarySkinId, 'secondary');
  }

  private buildSlot(
    host: HTMLElement, title: string, choices: readonly string[],
    selectedId: string, selectedSkin: string, slot: 'primary' | 'secondary',
  ): void {
    host.replaceChildren();
    host.appendChild(div('section-heading', title));

    const list = div('btn-column');
    list.style.width = '100%';
    for (const id of choices) {
      const b = button(WEAPON_LABELS[id] ?? id, 'btn btn--small', () => {
        const patch: Partial<Loadout> = slot === 'primary'
          ? { primaryId: id } : { secondaryId: id };
        loadoutManager.set(patch);
        this.focus = slot;
        this.rebuild();
        void this.loadPreview();
      });
      if (id === selectedId) b.classList.add('btn--active');
      list.appendChild(b);
    }
    host.appendChild(list);

    if (slot === 'secondary') {
      this.buildTacticalRow(host);
      this.buildKillstreakRow(host);
    }
    host.appendChild(div('section-heading', 'Finish'));
    const row = div('skin-row');
    for (const skin of SKINS) {
      const swatch = el('button', 'skin-swatch');
      swatch.type = 'button';
      swatch.style.background = skin.swatch;
      swatch.title = skin.displayName;
      if (skin.id === selectedSkin) swatch.classList.add('skin-swatch--active');
      swatch.addEventListener('click', () => {
        const patch: Partial<Loadout> = slot === 'primary'
          ? { primarySkinId: skin.id } : { secondarySkinId: skin.id };
        loadoutManager.set(patch);
        this.focus = slot;
        this.rebuild();
        void this.loadPreview();
      });
      row.appendChild(swatch);
    }
    host.appendChild(row);
  }

  /**
   * Document F §3: tactical equipment reuses the existing selection-card
   * pattern — one more row, zero new UI architecture.
   */
  private buildTacticalRow(host: HTMLElement): void {
    host.appendChild(div('section-heading', 'Tactical'));
    const current = settingsStore.get<string>('loadout.tactical', 'flashbang');
    const row = div('btn-row');
    for (const t of ALL_THROWABLES) {
      const b = button(t.iconLabel, 'btn btn--small', () => {
        settingsStore.set('loadout.tactical', t.id);
        equipmentManager.setTactical(t.id);
        this.rebuild();
      });
      if (t.id === current) b.classList.add('btn--active');
      row.appendChild(b);
    }
    host.appendChild(row);
  }

  /**
   * Killstreak selection: four exist, three are equipped.
   *
   * Modelled as a toggle set rather than three independent dropdowns, because
   * the real constraint is "choose a subset of a fixed size" and a dropdown
   * per slot lets the player pick the same streak three times. Clicking an
   * equipped streak removes it; clicking an unequipped one takes the oldest
   * slot, so the list always holds exactly KILLSTREAK.SLOTS entries and the
   * player never has to deselect before selecting.
   */
  private buildKillstreakRow(host: HTMLElement): void {
    host.appendChild(div('section-heading', 'Killstreaks (pick 3)'));
    const equipped = this.getEquippedKillstreaks();

    const row = div('btn-row');
    for (const streak of ALL_KILLSTREAKS) {
      const slot = equipped.indexOf(streak.id);
      const isEquipped = slot >= 0;
      // Show the slot number so the mapping to the 1/2/3 activation keys is
      // visible at a glance -- the order matters at runtime.
      const label = isEquipped
        ? `${slot + 1}. ${streak.iconLabel}`
        : streak.iconLabel;

      const b = button(label, 'btn btn--small', () => {
        const next = [...this.getEquippedKillstreaks()];
        const at = next.indexOf(streak.id);
        if (at >= 0) {
          // Deselecting would leave a gap in a fixed-size loadout, so instead
          // swap in the first streak that is NOT equipped. The set always
          // holds exactly KILLSTREAK.SLOTS entries, which is what the HUD and
          // the 1/2/3 activation keys assume.
          const replacement = ALL_KILLSTREAKS
            .find((k) => !next.includes(k.id));
          if (!replacement) return;   // nothing to swap to
          next[at] = replacement.id;
        } else {
          if (next.length >= KILLSTREAK.SLOTS) next.shift();
          next.push(streak.id);
        }
        this.setEquippedKillstreaks(next);
        this.rebuild();
      });
      if (isEquipped) b.classList.add('btn--active');
      b.title = `${streak.displayName} — ${streak.killsRequired} kills`;
      row.appendChild(b);
    }
    host.appendChild(row);
  }

  private getEquippedKillstreaks(): string[] {
    const stored = settingsStore.get<string[]>(
      'loadout.killstreaks', [...DEFAULT_KILLSTREAK_LOADOUT],
    );
    // Drop ids that no longer exist, so removing a streak from the game
    // cannot leave a saved loadout pointing at nothing.
    const valid = stored.filter((id) => ALL_KILLSTREAKS.some((k) => k.id === id));
    return valid.length ? valid : [...DEFAULT_KILLSTREAK_LOADOUT];
  }

  private setEquippedKillstreaks(ids: string[]): void {
    settingsStore.set('loadout.killstreaks', ids);
    killstreakManager.setLoadout(ids);
  }

  // --- 3D preview ----------------------------------------------------------

  private startPreview(): void {
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.setSize(360, 360, false);
      this.renderer.setClearColor(0x20242b, 1);
      this.previewHost.appendChild(this.renderer.domElement);
    }
    void this.loadPreview();
    const tick = (): void => {
      this.rafHandle = requestAnimationFrame(tick);
      this.turntable.rotation.y += 0.006;
      this.renderer?.render(this.previewScene, this.previewCamera);
    };
    cancelAnimationFrame(this.rafHandle);
    tick();
  }

  private stopPreview(): void {
    cancelAnimationFrame(this.rafHandle);
    this.rafHandle = 0;
  }

  private async loadPreview(): Promise<void> {
    const token = ++this.previewToken;
    const loadout = loadoutManager.getCurrentLoadout();
    const id = this.focus === 'primary' ? loadout.primaryId : loadout.secondaryId;
    const skinId = this.focus === 'primary' ? loadout.primarySkinId : loadout.secondarySkinId;
    const path = MODEL_PATHS[id];
    if (!path) return;

    const model = await this.assetLoader.loadModel(path);
    // A newer selection landed while this was loading.
    if (token !== this.previewToken) return;

    this.turntable.clear();
    this.skins.apply(model, skinId);

    // Frame the weapon: centre it on the turntable and scale to a constant
    // apparent size, so a pistol and a rocket launcher both fill the panel.
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(centre);
    model.position.sub(centre);
    const holder = new THREE.Group();
    holder.add(model);

    // FRAMING. Scale on the DIAGONAL of the bounding box, not the longest
    // single axis: the turntable spins the model, so at 45 degrees a long
    // weapon presents its diagonal to the camera. Scaling by the longest axis
    // alone let a compact weapon like the pistol over-scale and clip out of
    // frame as it rotated. The diagonal is the true worst case.
    const diagonal = Math.hypot(size.x, size.y, size.z) || 1;
    holder.scale.setScalar(0.78 / diagonal);
    // A slight downward tilt shows the top rail and the side profile at once
    // rather than a flat broadside.
    holder.rotation.x = 0.16;
    this.turntable.add(holder);
  }

  /** Test seams. */
  get previewWeaponId(): string {
    const l = loadoutManager.getCurrentLoadout();
    return this.focus === 'primary' ? l.primaryId : l.secondaryId;
  }
  get isPreviewRunning(): boolean { return this.rafHandle !== 0; }
}

export default LoadoutMenu;
