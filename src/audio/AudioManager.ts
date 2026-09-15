/**
 * AudioManager.ts — Document 5 §9.1.
 *
 * One THREE.AudioListener on the main camera, four chained gain buses
 * (sfx/ui/music -> master), and per-key pools so rapid automatic fire or
 * several overlapping footsteps never cut each other off.
 *
 * Why pools: a single THREE.Audio can only play one instance of itself at a
 * time — retriggering it restarts playback and truncates the previous shot.
 * At 950 RPM that is extremely audible, so each key keeps a small ring of
 * voices and round-robins through them.
 *
 * Volume settings are read from SettingsStore on construction and applied
 * live from the Settings menu with no reload.
 */
import * as THREE from 'three';
import eventBus from '../core/EventBus';
import { busFor } from './SoundLibrary';
import type { AssetLoader } from '../core/AssetLoader';
import type { SettingsStore } from '../core/SettingsStore';

interface Voice {
  audio: THREE.Audio | THREE.PositionalAudio;
  positional: boolean;
}

const POOL_SIZE_2D = 6;
const POOL_SIZE_3D = 5;

export class AudioManager {
  private listener: THREE.AudioListener | null = null;
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  /**
   * Document F §6.2: a low-pass in the master path, animated down on a
   * concussion and back up as hearing recovers. Inserted ONCE into the chain
   * rather than being created per effect.
   */
  private muffleFilter: BiquadFilterNode | null = null;
  private muffleTimer = 0;
  private muffleTotal = 0;
  private sfxGain: GainNode | null = null;
  private uiGain: GainNode | null = null;
  private musicGain: GainNode | null = null;

  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly pools2D = new Map<string, Voice[]>();
  private readonly pools3D = new Map<string, Voice[]>();
  private readonly cursors = new Map<string, number>();
  /** Parent for transient positional voices, so they live in the scene. */
  private scene: THREE.Scene | null = null;
  private ambient: THREE.Audio | null = null;
  private ambientKey: string | null = null;
  private started = false;

  private volumes = { master: 0.8, sfx: 0.9, ui: 0.7, music: 0.6 };

  constructor(
    private readonly assetLoader: AssetLoader,
    private readonly settings: SettingsStore,
  ) {}

  /** Attach to the camera. Must happen before any 3D sound is meaningful. */
  attach(camera: THREE.Camera, scene: THREE.Scene): void {
    if (this.listener) return;
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.scene = scene;

    this.context = this.listener.context;
    const ctx = this.context;
    this.masterGain = ctx.createGain();
    this.sfxGain = ctx.createGain();
    this.uiGain = ctx.createGain();
    this.musicGain = ctx.createGain();
    // sfx/ui/music -> master -> listener's own input
    this.sfxGain.connect(this.masterGain);
    this.uiGain.connect(this.masterGain);
    this.musicGain.connect(this.masterGain);
    // master -> muffle -> listener, so every bus is affected together.
    this.muffleFilter = ctx.createBiquadFilter();
    this.muffleFilter.type = 'lowpass';
    this.muffleFilter.frequency.value = 20000; // transparent when not muffled
    this.masterGain.connect(this.muffleFilter);
    this.muffleFilter.connect(this.listener.getInput());

    this.volumes = {
      master: this.num('audio.master', 0.8),
      sfx: this.num('audio.sfx', 0.9),
      ui: this.num('audio.ui', 0.7),
      music: this.num('audio.music', 0.6),
    };
    this.applyGains();
  }

  private num(key: string, fallback: number): number {
    const raw = this.settings.get<number>(key, fallback);
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
  }

  get isReady(): boolean {
    return this.started;
  }

  get listenerRef(): THREE.AudioListener | null {
    return this.listener;
  }

  /** Test/debug seam: how many buffers are actually decoded and playable. */
  get loadedCount(): number {
    return this.buffers.size;
  }

  /**
   * Browsers start the AudioContext suspended until a user gesture. Call this
   * from the same click that requests pointer lock.
   */
  async resume(): Promise<void> {
    if (this.context && this.context.state === 'suspended') {
      await this.context.resume();
    }
    this.started = true;
  }

  /** Decode every path up front (called during LOADING). */
  async preload(paths: readonly string[]): Promise<void> {
    await Promise.all(paths.map(async (path) => {
      if (this.buffers.has(path)) return;
      try {
        const buffer = await this.assetLoader.loadAudio(path);
        this.buffers.set(path, buffer);
      } catch {
        // A missing sound must never break a match; it just stays silent.
        console.warn(`[AudioManager] missing audio: ${path}`);
      }
    }));
  }

  // --- volume -------------------------------------------------------------

  setMasterVolume(v: number): void { this.volumes.master = v; this.applyGains(); this.persist(); }
  setSFXVolume(v: number): void { this.volumes.sfx = v; this.applyGains(); this.persist(); }
  setUIVolume(v: number): void { this.volumes.ui = v; this.applyGains(); this.persist(); }
  setMusicVolume(v: number): void { this.volumes.music = v; this.applyGains(); this.persist(); }

  getVolumes(): { master: number; sfx: number; ui: number; music: number } {
    return { ...this.volumes };
  }

  private applyGains(): void {
    if (!this.masterGain) return;
    this.masterGain.gain.value = this.volumes.master;
    if (this.sfxGain) this.sfxGain.gain.value = this.volumes.sfx;
    if (this.uiGain) this.uiGain.gain.value = this.volumes.ui;
    if (this.musicGain) this.musicGain.gain.value = this.volumes.music;
  }

  private persist(): void {
    this.settings.set('audio.master', this.volumes.master);
    this.settings.set('audio.sfx', this.volumes.sfx);
    this.settings.set('audio.ui', this.volumes.ui);
    this.settings.set('audio.music', this.volumes.music);
  }

  private busNodeFor(key: string): GainNode | null {
    return busFor(key) === 'ui' ? this.uiGain : this.sfxGain;
  }

  // --- playback -----------------------------------------------------------

  /** Non-positional: your own weapon, UI, ambience — "in your ears". */
  playSound2D(path: string, { volume = 1, key = path }: { volume?: number; key?: string } = {}): void {
    const buffer = this.buffers.get(path);
    if (!buffer || !this.listener) return;
    const voice = this.nextVoice(this.pools2D, key, false);
    if (!voice) return;
    const audio = voice.audio as THREE.Audio;
    if (audio.isPlaying) audio.stop();
    audio.setBuffer(buffer);
    audio.setVolume(volume);
    audio.play();
  }

  /** Positional: world sounds that must pan and attenuate with distance. */
  playSound3D(
    path: string,
    position: THREE.Vector3,
    { volume = 1, refDistance = 6, key = path }:
      { volume?: number; refDistance?: number; key?: string } = {},
  ): void {
    const buffer = this.buffers.get(path);
    if (!buffer || !this.listener || !this.scene) return;
    const voice = this.nextVoice(this.pools3D, key, true);
    if (!voice) return;
    const audio = voice.audio as THREE.PositionalAudio;
    if (audio.isPlaying) audio.stop();
    audio.setBuffer(buffer);
    audio.setVolume(volume);
    audio.setRefDistance(refDistance);
    audio.position.copy(position);
    audio.play();
  }

  private nextVoice(
    pools: Map<string, Voice[]>, key: string, positional: boolean,
  ): Voice | null {
    if (!this.listener) return null;
    let pool = pools.get(key);
    if (!pool) {
      const size = positional ? POOL_SIZE_3D : POOL_SIZE_2D;
      pool = [];
      for (let i = 0; i < size; i += 1) {
        const audio = positional
          ? new THREE.PositionalAudio(this.listener)
          : new THREE.Audio(this.listener);
        // Route through our own bus instead of straight to the listener.
        const bus = this.busNodeFor(key);
        if (bus) {
          audio.gain.disconnect();
          audio.gain.connect(bus);
        }
        if (positional) this.scene?.add(audio);
        pool.push({ audio, positional });
      }
      pools.set(key, pool);
    }
    // Prefer a free voice; otherwise steal the oldest (round-robin).
    const free = pool.find((v) => !v.audio.isPlaying);
    if (free) return free;
    const cursor = (this.cursors.get(key) ?? 0) % pool.length;
    this.cursors.set(key, cursor + 1);
    return pool[cursor];
  }

  // --- ambience -----------------------------------------------------------

  startAmbience(path: string, volume = 0.45): void {
    if (!this.listener) return;
    if (this.ambientKey === path && this.ambient?.isPlaying) return;
    this.stopAmbience();
    const buffer = this.buffers.get(path);
    if (!buffer) return;
    const audio = new THREE.Audio(this.listener);
    const bus = this.sfxGain;
    if (bus) {
      audio.gain.disconnect();
      audio.gain.connect(bus);
    }
    audio.setBuffer(buffer);
    audio.setLoop(true);
    audio.setVolume(volume);
    audio.play();
    this.ambient = audio;
    this.ambientKey = path;
  }

  stopAmbience(): void {
    if (this.ambient) {
      if (this.ambient.isPlaying) this.ambient.stop();
      this.ambient.disconnect();
      this.ambient = null;
    }
    this.ambientKey = null;
  }

  get ambiencePlaying(): boolean {
    return Boolean(this.ambient?.isPlaying);
  }

  /**
   * Duck hearing for `seconds`, recovering smoothly. `strength` 0..1 sets how
   * deep the initial cut is.
   */
  applyMuffle(seconds: number, strength: number): void {
    if (!this.muffleFilter || seconds <= 0) return;
    this.muffleTimer = Math.max(this.muffleTimer, seconds);
    this.muffleTotal = Math.max(this.muffleTotal, seconds);
    const cut = 20000 - (20000 - 380) * Math.min(1, strength);
    this.muffleFilter.frequency.value = Math.max(380, cut);
  }

  get muffleSecondsRemaining(): number { return this.muffleTimer; }
  get muffleCutoffHz(): number { return this.muffleFilter?.frequency.value ?? 20000; }

  /** Advance the hearing-recovery ramp. */
  update(dt: number): void {
    if (!this.muffleFilter || this.muffleTimer <= 0) return;
    this.muffleTimer = Math.max(0, this.muffleTimer - dt);
    const t = this.muffleTotal > 0 ? 1 - this.muffleTimer / this.muffleTotal : 1;
    // Exponential recovery: hearing returns fast at first, then settles.
    const current = this.muffleFilter.frequency.value;
    const target = 380 + (20000 - 380) * Math.pow(t, 0.55);
    this.muffleFilter.frequency.value = Math.max(current, target);
    if (this.muffleTimer <= 0) this.muffleFilter.frequency.value = 20000;
  }

  /** Stop every voice (level unload, quit to menu). */
  stopAll(): void {
    this.stopAmbience();
    for (const pools of [this.pools2D, this.pools3D]) {
      for (const pool of pools.values()) {
        for (const voice of pool) if (voice.audio.isPlaying) voice.audio.stop();
      }
    }
  }
}

/** Convenience: fire-and-forget UI sound helper used by every menu button. */
export function attachButtonSounds(
  element: HTMLElement, audio: AudioManager | null,
): void {
  if (!audio) return;
  element.addEventListener('mouseenter', () => {
    audio.playSound2D('ui/ui_hover.wav', { volume: 0.5, key: 'ui_hover' });
  });
  element.addEventListener('click', () => {
    audio.playSound2D('ui/ui_click.wav', { volume: 0.7, key: 'ui_click' });
  });
}

export default AudioManager;

// Re-export for consumers that want the event name without importing the bus.
export const AUDIO_READY_EVENT = 'audio:ready';
void eventBus;
