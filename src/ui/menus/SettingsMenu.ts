/**
 * SettingsMenu.ts — Document 5 §7.4 (Video / Audio / Controls tabs).
 *
 * The Controls tab is ControlsMenu's content, embedded as a tab rather than a
 * separate screen: it is the first thing in the project to actually call
 * InputManager.rebind(), which has been sitting unused since Document 1.
 *
 * Sensitivity and invert-Y deliberately write to the SAME SettingsStore keys
 * PlayerCamera already reads, so wiring them required zero camera changes.
 */
import eventBus from '../../core/EventBus';
import cameraShake from '../../camera/CameraShakeController';
import settingsStore from '../../core/SettingsStore';
import { GameState } from '../../state/GameStateManager';
import { button, choiceRow, div, el, prettyAction, prettyKey, slider, toggle, uiSound } from '../dom';
import minimapPreview from '../hud/MinimapPreview';
import {
  getMinimapMode, getMinimapRotate, getMinimapZoomMeters,
  MINIMAP_ZOOM, setMinimapMode, setMinimapRotate, setMinimapZoomMeters,
} from '../hud/MinimapSettings';
import type AudioManager from '../../audio/AudioManager';
import type { InputManager } from '../../core/InputManager';
import type { Screen } from '../UIManager';

type Tab = 'video' | 'audio' | 'controls';

export class SettingsMenu implements Screen {
  readonly element = div('screen');
  private readonly bodies = new Map<Tab, HTMLElement>();
  private readonly tabButtons = new Map<Tab, HTMLButtonElement>();
  private active: Tab = 'video';
  private listening: string | null = null;
  private readonly controlsBody = div('tab-body');
  /** Where "Back" goes — Pause opens this as an overlay and wants to return. */
  private returnTo: 'menu' | 'pause' = 'menu';

  constructor(
    private readonly input: InputManager,
    private readonly audio: AudioManager,
    private readonly onFovChanged: (fov: number) => void,
  ) {
    const inner = div('screen__inner');
    const panel = div('panel');

    panel.appendChild(el('h2', 'title', 'SETTINGS'));

    const tabs = div('tabs');
    for (const name of ['video', 'audio', 'controls'] as Tab[]) {
      const b = button(name, 'tab', () => this.selectTab(name));
      this.tabButtons.set(name, b);
      tabs.appendChild(b);
    }
    panel.appendChild(tabs);

    panel.appendChild(this.buildVideo());
    panel.appendChild(this.buildAudio());
    panel.appendChild(this.controlsBody);
    this.bodies.set('controls', this.controlsBody);
    this.controlsBody.classList.add('tab-body');

    const footer = div('btn-row');
    footer.style.marginTop = '22px';
    footer.append(
      button('Back', 'btn', () => {
        uiSound('back');
        if (this.returnTo === 'pause') {
          eventBus.emit('ui:overlay', { name: 'settings', open: false });
        } else {
          eventBus.emit('ui:navigate', { to: GameState.MAIN_MENU });
        }
      }),
      button('Reset Defaults', 'btn btn--ghost btn--danger', () => {
        settingsStore.resetToDefaults();
        window.location.reload();
      }),
    );
    panel.appendChild(footer);

    inner.appendChild(panel);
    this.element.appendChild(inner);
    this.selectTab('video');
  }

  /** Pause opens this as an overlay; Back must return there, not to the menu. */
  setReturnTarget(target: 'menu' | 'pause'): void {
    this.returnTo = target;
  }

  onShow(): void {
    // Rebuild the controls list each time so it reflects live bindings.
    this.rebuildControls();
  }

  onHide(): void {
    this.cancelListening();
  }

  private selectTab(tab: Tab): void {
    this.active = tab;
    for (const [name, body] of this.bodies) {
      body.classList.toggle('tab-body--active', name === tab);
    }
    for (const [name, b] of this.tabButtons) {
      b.classList.toggle('tab--active', name === tab);
    }
    if (tab === 'controls') this.rebuildControls();
  }

  // --- video ---------------------------------------------------------------

  private buildVideo(): HTMLElement {
    const body = div('tab-body');
    this.bodies.set('video', body);

    // RenderQualityManager owns what each tier means and listens for the
    // write on the event bus, so the menu stays a pure settings surface.
    const quality = settingsStore.get<string>('video.quality', 'High');
    body.appendChild(choiceRow(
      'Quality Preset',
      ['Potato', 'Low', 'Medium', 'High', 'Ultra'],
      quality,
      (choice) => { settingsStore.set('video.quality', choice); },
    ));

    // The safety net for weak hardware: render below native resolution and
    // upscale, trading sharpness for a stable frame rate. On by default.
    const adaptive = settingsStore.get<boolean>('video.adaptiveResolution', true);
    body.appendChild(toggle('Adaptive Resolution', adaptive, (on) => {
      settingsStore.set('video.adaptiveResolution', on);
    }));

    const fov = settingsStore.get<number>('baseFOV', 90);
    body.appendChild(slider('Field of View', {
      min: 65, max: 120, step: 1, value: fov,
      format: (v) => `${v.toFixed(0)}°`,
      onInput: (v) => {
        settingsStore.set('baseFOV', v);
        this.onFovChanged(v);
      },
    }));

    // Document E §1.3: one accessibility knob live-scales EVERY camera-shake
    // source simultaneously (landings, explosions, sprint waver, bursts),
    // persisted by the controller itself. 0% disables shake entirely.
    body.appendChild(slider('Camera Shake Intensity', {
      min: 0, max: 1, step: 0.05, value: cameraShake.getIntensity(),
      format: (v) => `${(v * 100).toFixed(0)}%`,
      onInput: (v) => cameraShake.setIntensity(v),
    }));

    // --- Minimap -----------------------------------------------------------
    // One live, following top-down render of the world serves every map;
    // 'radar' keeps the classic abstract dish as a lightweight alternative.
    // Rotate + zoom feed the exact same values the HUD reads, and the small
    // canvas below renders an ANIMATED preview through the same capture pass
    // (spinning demo yaw), so what you see here is what the dish will do.
    body.appendChild(el('h3', 'field__section', 'Minimap'));
    body.appendChild(choiceRow('Minimap Style', ['Live Map', 'Tactical Radar'],
      getMinimapMode() === 'live' ? 'Live Map' : 'Tactical Radar', (choice) => {
        setMinimapMode(choice === 'Live Map' ? 'live' : 'radar');
      }));
    body.appendChild(toggle('Rotate Map With Player', getMinimapRotate(), (v) => {
      setMinimapRotate(v);
    }));
    body.appendChild(slider('Minimap Zoom', {
      min: MINIMAP_ZOOM.MIN, max: MINIMAP_ZOOM.MAX, step: 1,
      value: getMinimapZoomMeters(),
      format: (v) => `${v.toFixed(0)} m`,
      onInput: (v) => setMinimapZoomMeters(v),
    }));
    const previewWrap = div('minimap-preview');
    const previewCanvas = document.createElement('canvas');
    previewCanvas.className = 'minimap-preview__canvas';
    previewWrap.appendChild(previewCanvas);
    const previewLabel = div('minimap-preview__label', 'LIVE PREVIEW — the dish follows a rotating demo observer; your options apply immediately');
    previewWrap.appendChild(previewLabel);
    body.appendChild(previewWrap);
    minimapPreview.attach(previewCanvas);
    return body;
  }

  // --- audio ---------------------------------------------------------------

  private buildAudio(): HTMLElement {
    const body = div('tab-body');
    this.bodies.set('audio', body);
    const v = this.audio.getVolumes();
    const pct = (x: number) => `${Math.round(x * 100)}%`;

    body.append(
      slider('Master', { min: 0, max: 1, step: 0.01, value: v.master, format: pct,
        onInput: (x) => this.audio.setMasterVolume(x) }),
      slider('SFX', { min: 0, max: 1, step: 0.01, value: v.sfx, format: pct,
        onInput: (x) => this.audio.setSFXVolume(x) }),
      slider('Music', { min: 0, max: 1, step: 0.01, value: v.music, format: pct,
        onInput: (x) => this.audio.setMusicVolume(x) }),
      slider('Interface', { min: 0, max: 1, step: 0.01, value: v.ui, format: pct,
        onInput: (x) => this.audio.setUIVolume(x) }),
    );
    const note = div('field__label',
      'Music is reserved: the slider and bus are live, nothing plays on it yet.');
    note.style.width = 'auto';
    note.style.fontSize = '12px';
    note.style.marginTop = '10px';
    body.appendChild(note);
    return body;
  }

  // --- controls ------------------------------------------------------------

  private rebuildControls(): void {
    this.cancelListening();
    this.controlsBody.replaceChildren();

    const sens = settingsStore.get<number>('mouseSensitivity', 1);
    this.controlsBody.appendChild(slider('Mouse Sensitivity', {
      min: 0.1, max: 3, step: 0.05, value: sens,
      onInput: (v) => settingsStore.set('mouseSensitivity', v),
    }));
    this.controlsBody.appendChild(toggle(
      'Invert Vertical Look',
      settingsStore.get<boolean>('invertY', false),
      (v) => settingsStore.set('invertY', v),
    ));

    const list = div('binding-list');
    list.appendChild(div('section-heading', 'Key Bindings'));
    const bindings = this.input.getBindings();
    for (const action of Object.keys(bindings)) {
      const row = div('binding');
      row.appendChild(div('binding__name', prettyAction(action)));
      const keyButton = el('button', 'binding__key', prettyKey(bindings[action]));
      keyButton.type = 'button';
      keyButton.addEventListener('click', () => this.beginListening(action, keyButton));
      row.appendChild(keyButton);
      list.appendChild(row);
    }
    this.controlsBody.appendChild(list);
  }

  /**
   * Capture the next key press and bind it. A one-shot listener rather than a
   * persistent mode, so an accidental click cannot leave input swallowed.
   */
  private beginListening(action: string, target: HTMLElement): void {
    this.cancelListening();
    this.listening = action;
    target.classList.add('binding__key--listening');
    target.textContent = 'PRESS ANY KEY';

    const finish = (code: string | null): void => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      target.classList.remove('binding__key--listening');
      this.listening = null;
      if (code) {
        this.input.rebind(action, code);
        uiSound('confirm');
      } else {
        uiSound('back');
      }
      this.rebuildControls();
    };
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      finish(e.code === 'Escape' ? null : e.code);
    };
    const onMouse = (e: MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      finish(`Mouse${e.button}`);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
  }

  private cancelListening(): void {
    this.listening = null;
  }

  /** Test seams. */
  get activeTab(): Tab { return this.active; }
  get isListening(): boolean { return this.listening !== null; }
  selectTabForTest(tab: Tab): void { this.selectTab(tab); }
}

export default SettingsMenu;
