/**
 * dom.ts — tiny element helpers shared by every menu.
 *
 * Exists so the menu files describe STRUCTURE rather than repeating
 * createElement/className/appendChild boilerplate, and so UI click/hover
 * sounds are attached in exactly one place (Document 5 §9.3's requirement
 * that button audio be wired generically, not per button).
 */
import type AudioManager from '../audio/AudioManager';

let audio: AudioManager | null = null;

/** Called once at boot so every button created here becomes audible. */
export function setUIAudio(manager: AudioManager): void {
  audio = manager;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function div(className?: string, text?: string): HTMLDivElement {
  return el('div', className, text);
}

/**
 * Every button in the game goes through here, so hover/click sounds and
 * pointer-events are guaranteed consistent.
 */
export function button(
  label: string, className = 'btn', onClick?: () => void,
): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('mouseenter', () => {
    audio?.playSound2D('ui/ui_hover.wav', { volume: 0.45, key: 'ui_hover' });
  });
  node.addEventListener('click', () => {
    audio?.playSound2D('ui/ui_click.wav', { volume: 0.7, key: 'ui_click' });
    onClick?.();
  });
  return node;
}

/** Play a one-off UI sound from non-button code (confirm/back transitions). */
export function uiSound(name: 'confirm' | 'back'): void {
  audio?.playSound2D(`ui/ui_${name}.wav`, { volume: 0.7, key: `ui_${name}` });
}

export interface SliderOptions {
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
  onInput: (value: number) => void;
}

/** A labelled range row: label | slider | live numeric readout. */
export function slider(label: string, options: SliderOptions): HTMLElement {
  const row = div('field');
  row.appendChild(div('field__label', label));
  const control = div('field__control');
  const input = el('input');
  input.type = 'range';
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = String(options.step);
  input.value = String(options.value);
  const readout = div('field__value');
  const fmt = options.format ?? ((v: number) => v.toFixed(2));
  readout.textContent = fmt(options.value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    readout.textContent = fmt(v);
    options.onInput(v);
  });
  control.append(input, readout);
  row.appendChild(control);
  return row;
}

/** A labelled checkbox row. */
export function toggle(
  label: string, value: boolean, onChange: (v: boolean) => void,
): HTMLElement {
  const row = div('field');
  row.appendChild(div('field__label', label));
  const control = div('field__control');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  control.appendChild(input);
  row.appendChild(control);
  return row;
}

/** A row of mutually-exclusive choice buttons. */
export function choiceRow(
  label: string, choices: readonly string[], current: string,
  onChoose: (choice: string) => void,
): HTMLElement {
  const row = div('field');
  row.appendChild(div('field__label', label));
  const control = div('field__control');
  const buttons: HTMLButtonElement[] = [];
  for (const choice of choices) {
    const b = button(choice, 'btn btn--small', () => {
      for (const other of buttons) other.classList.remove('btn--active');
      b.classList.add('btn--active');
      onChoose(choice);
    });
    if (choice === current) b.classList.add('btn--active');
    buttons.push(b);
    control.appendChild(b);
  }
  row.appendChild(control);
  return row;
}

/** Human-readable name for a KeyboardEvent.code / Mouse<n> binding. */
export function prettyKey(code: string): string {
  if (!code) return 'UNBOUND';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5).toUpperCase();
  if (code === 'Mouse0') return 'LEFT MOUSE';
  if (code === 'Mouse1') return 'MIDDLE MOUSE';
  if (code === 'Mouse2') return 'RIGHT MOUSE';
  if (code === 'ShiftLeft') return 'L SHIFT';
  if (code === 'ShiftRight') return 'R SHIFT';
  if (code === 'ControlLeft') return 'L CTRL';
  if (code === 'Space') return 'SPACE';
  return code.toUpperCase();
}

/** Turn `weaponSlot3` into `Weapon Slot 3`. */
export function prettyAction(action: string): string {
  return action
    .replace(/([A-Z])/g, ' $1')
    .replace(/(\d+)/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
