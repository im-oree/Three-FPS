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
    this.previewScene.add(new THREE.HemisphereLight(0xbcc6d4, 0x20242a, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(1.5, 2, 1.8);
    this.previewScene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 1.1);
    rim.position.set(-2, 0.5, -1.5);
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

  // --- 3D preview ----------------------------------------------------------

  private startPreview(): void {
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.setSize(360, 360, false);
      this.renderer.setClearColor(0x0e1115, 1);
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
    const longest = Math.max(size.x, size.y, size.z) || 1;
    model.position.sub(centre);
    const holder = new THREE.Group();
    holder.add(model);
    holder.scale.setScalar(0.62 / longest);
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
