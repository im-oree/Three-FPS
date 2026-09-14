#!/usr/bin/env node
/**
 * generateAudio.mjs — synthesizes every sound the game references as a real
 * .wav file under /assets/audio, per the standing asset policy in
 * tools/README.md: assets are real static files produced by a /tools script,
 * never constructed inside /src at runtime.
 *
 *   node tools/generateAudio.mjs
 *
 * Everything here is plain DSP written by hand: noise bursts shaped by
 * envelopes, damped sine bodies, short FM clicks, filtered noise beds. The
 * results are deliberately synthetic -- this is a procedurally-generated
 * project end to end -- but they are correctly pitched, correctly enveloped
 * and mix sensibly against each other, which is what the audio SYSTEM needs
 * in order to be provably working. Swapping in recorded samples later is a
 * pure file replacement with zero code changes.
 */
import fs from 'node:fs';
import path from 'node:path';

const RATE = 44100;
const OUT = 'assets/audio';

// --- tiny DSP toolkit -------------------------------------------------------

const noise = () => Math.random() * 2 - 1;

/** Exponential decay envelope: 1 -> 0 over `secs`, curvature by `power`. */
const decay = (t, secs, power = 3) => {
  if (t >= secs) return 0;
  return (1 - t / secs) ** power;
};

/** Fast attack then exponential decay — the shape of almost any impact. */
const hit = (t, attack, release, power = 3) => {
  if (t < attack) return t / attack;
  return decay(t - attack, release, power);
};

/** One-pole low-pass. Call with state, returns [value, newState]. */
const lowpass = (x, state, cutoff) => {
  const a = Math.min(1, cutoff / (RATE / 2));
  const y = state + a * (x - state);
  return y;
};

/** Render `secs` of audio from a per-sample function into a Float array. */
function render(secs, fn) {
  const n = Math.max(1, Math.floor(secs * RATE));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) out[i] = fn(i / RATE, i) || 0;
  return out;
}

/** Peak-normalize to `peak`, then hard-clip for safety. */
function normalize(buf, peak = 0.85) {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  if (max < 1e-9) return buf;
  const g = peak / max;
  for (let i = 0; i < buf.length; i += 1) {
    buf[i] = Math.max(-1, Math.min(1, buf[i] * g));
  }
  return buf;
}

/** Concatenate with an offset in seconds (for multi-part sounds). */
function mixAt(target, src, atSecs, gain = 1) {
  const off = Math.floor(atSecs * RATE);
  for (let i = 0; i < src.length; i += 1) {
    const j = off + i;
    if (j >= 0 && j < target.length) target[j] += src[i] * gain;
  }
  return target;
}

function writeWav(name, buf, { fadeOut = 0.005 } = {}) {
  // Always fade the tail so nothing ends on a discontinuity (audible click).
  const fadeN = Math.floor(fadeOut * RATE);
  for (let i = 0; i < fadeN && i < buf.length; i += 1) {
    buf[buf.length - 1 - i] *= i / fadeN;
  }
  const n = buf.length;
  const bytes = Buffer.alloc(44 + n * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + n * 2, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);            // PCM
  bytes.writeUInt16LE(1, 22);            // mono
  bytes.writeUInt32LE(RATE, 24);
  bytes.writeUInt32LE(RATE * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) {
    bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), 44 + i * 2);
  }
  const full = path.join(OUT, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, bytes);
  return { name, secs: +(n / RATE).toFixed(3), bytes: bytes.length };
}

// --- sound designs ----------------------------------------------------------

/**
 * Gunshot: a bright noise crack over a low "body" thump, plus a short
 * filtered tail standing in for the room. `size` scales pitch and length, so
 * one function covers a pistol through a rocket launcher.
 */
function gunshot({ secs, bodyHz, crack, tail, grit = 1 }) {
  let lp = 0;
  let lp2 = 0;
  const buf = render(secs, (t) => {
    // Transient crack: full-band noise, extremely short.
    const crackEnv = decay(t, 0.035, 4);
    const n = noise();
    lp = lowpass(n, lp, 9000);
    const bright = (n * 0.6 + lp * 0.4) * crackEnv * crack;

    // Body: damped low sine that drops in pitch as pressure releases.
    const f = bodyHz * (1 + 1.6 * decay(t, 0.05, 1));
    const body = Math.sin(2 * Math.PI * f * t) * decay(t, 0.16, 3);

    // Tail: low-passed noise, longer, quieter — the room answering back.
    lp2 = lowpass(noise(), lp2, 1200);
    const room = lp2 * decay(t, secs, 2) * tail;

    return bright + body * 0.9 + room * 0.5 + noise() * crackEnv * 0.15 * grit;
  });
  return normalize(buf);
}

/** Mechanical click: a tiny FM tick, used for triggers and empty chambers. */
function click({ hz = 2200, secs = 0.05, noiseAmt = 0.5 }) {
  return normalize(render(secs, (t) => {
    const env = decay(t, secs, 5);
    const fm = Math.sin(2 * Math.PI * hz * t + Math.sin(2 * Math.PI * hz * 2.7 * t) * 2);
    return (fm * (1 - noiseAmt) + noise() * noiseAmt) * env;
  }), 0.6);
}

/** Metallic clack: two detuned partials, for mag/bolt/slide handling. */
function clack({ hz = 520, secs = 0.12, bright = 0.5 }) {
  let lp = 0;
  return normalize(render(secs, (t) => {
    const env = hit(t, 0.002, secs, 3);
    const a = Math.sin(2 * Math.PI * hz * t);
    const b = Math.sin(2 * Math.PI * hz * 1.94 * t) * 0.6;
    lp = lowpass(noise(), lp, 5200);
    return (a + b) * env * 0.5 + lp * env * bright;
  }), 0.7);
}

/** A reload is a little SCENE: several handling noises in sequence. */
function reload(beats, total) {
  const buf = new Float64Array(Math.floor(total * RATE));
  for (const [at, sound, gain] of beats) mixAt(buf, sound, at, gain ?? 1);
  return normalize(buf, 0.8);
}

/** Footstep: a soft body thump plus surface-colored noise scuff. */
function footstep({ bodyHz, cutoff, secs = 0.16, scuff = 0.5, power = 3 }) {
  let lp = 0;
  return normalize(render(secs, (t) => {
    const env = hit(t, 0.004, secs, power);
    const body = Math.sin(2 * Math.PI * bodyHz * t) * decay(t, 0.07, 3);
    lp = lowpass(noise(), lp, cutoff);
    return body * 0.7 + lp * env * scuff;
  }), 0.55);
}

/** Bullet impact on a surface: sharp tick + surface-tinted debris noise. */
function impact({ cutoff, secs = 0.22, tick = 1, bodyHz = 180 }) {
  let lp = 0;
  return normalize(render(secs, (t) => {
    const env = decay(t, secs, 3.5);
    lp = lowpass(noise(), lp, cutoff);
    const body = Math.sin(2 * Math.PI * bodyHz * t) * decay(t, 0.05, 3);
    return lp * env + body * 0.4 + noise() * decay(t, 0.012, 4) * tick;
  }), 0.7);
}

/** UI blip: a clean two-partial tone, no noise — reads as "interface". */
function blip({ hz, secs = 0.09, second = 0 }) {
  return normalize(render(secs, (t) => {
    const env = hit(t, 0.004, secs, 3);
    let v = Math.sin(2 * Math.PI * hz * t);
    if (second) v += Math.sin(2 * Math.PI * second * t) * 0.5;
    return v * env;
  }), 0.5);
}

/**
 * Seamless ambience loop: several detuned low sines plus slow filtered noise.
 * The sine frequencies are chosen so a whole number of cycles fits the loop
 * length exactly, which is what makes the wrap inaudible.
 */
function ambience({ secs = 8, base = 55, noiseLevel = 0.22, cutoff = 700, partials = [1, 1.5, 2.01, 3.02] }) {
  let lp = 0;
  const buf = render(secs, (t) => {
    let v = 0;
    for (let i = 0; i < partials.length; i += 1) {
      // Snap each partial to an exact number of cycles across the loop.
      const target = base * partials[i];
      const cycles = Math.max(1, Math.round(target * secs));
      const f = cycles / secs;
      v += Math.sin(2 * Math.PI * f * t) * (0.5 / (i + 1));
    }
    lp = lowpass(noise(), lp, cutoff);
    return v * 0.5 + lp * noiseLevel;
  });
  // Cross-fade the ends into each other so the loop point is continuous.
  const xf = Math.floor(0.25 * RATE);
  for (let i = 0; i < xf; i += 1) {
    const a = i / xf;
    const head = buf[i];
    const tail = buf[buf.length - xf + i];
    buf[buf.length - xf + i] = tail * (1 - a) + head * a;
  }
  return normalize(buf, 0.35);
}

// --- the manifest -----------------------------------------------------------

const written = [];
const w = (name, buf, opts) => written.push(writeWav(name, buf, opts));

// Weapons -------------------------------------------------------------------
w('weapons/weapon_ar_fire.wav', gunshot({ secs: 0.30, bodyHz: 120, crack: 0.9, tail: 0.5 }));
w('weapons/weapon_smg_fire.wav', gunshot({ secs: 0.22, bodyHz: 155, crack: 0.85, tail: 0.35 }));
w('weapons/weapon_pistol_fire.wav', gunshot({ secs: 0.26, bodyHz: 145, crack: 0.8, tail: 0.4 }));
w('weapons/weapon_sg_fire.wav', gunshot({ secs: 0.52, bodyHz: 80, crack: 1.0, tail: 0.85, grit: 1.5 }));
w('weapons/weapon_sniper_fire.wav', gunshot({ secs: 0.70, bodyHz: 68, crack: 1.0, tail: 1.0 }));
w('weapons/weapon_launcher_fire.wav', gunshot({ secs: 0.90, bodyHz: 52, crack: 0.7, tail: 1.2, grit: 1.8 }));

// Reloads: magazine out, magazine in, bolt/charging handle.
const magOut = clack({ hz: 430, secs: 0.14, bright: 0.55 });
const magIn = clack({ hz: 300, secs: 0.17, bright: 0.45 });
const boltBack = clack({ hz: 700, secs: 0.10, bright: 0.7 });
const boltFwd = clack({ hz: 560, secs: 0.12, bright: 0.6 });
const shellIn = clack({ hz: 640, secs: 0.11, bright: 0.5 });

w('weapons/weapon_ar_reload_tactical.wav',
  reload([[0.02, magOut], [0.55, magIn, 1.1], [1.05, boltFwd, 0.8]], 1.45));
w('weapons/weapon_ar_reload_empty.wav',
  reload([[0.02, magOut], [0.60, magIn, 1.1], [1.25, boltBack], [1.50, boltFwd]], 1.95));
w('weapons/weapon_pistol_reload_tactical.wav',
  reload([[0.02, magOut, 0.8], [0.45, magIn, 0.9], [0.85, boltFwd, 0.6]], 1.20));
w('weapons/weapon_pistol_reload_empty.wav',
  reload([[0.02, magOut, 0.8], [0.50, magIn, 0.9], [1.00, boltBack, 0.7], [1.20, boltFwd, 0.7]], 1.60));
w('weapons/weapon_sg_reload_tactical.wav',
  reload([[0.02, shellIn], [0.45, shellIn], [0.90, shellIn], [1.35, boltFwd, 0.8]], 1.70));
w('weapons/weapon_sg_reload_empty.wav',
  reload([[0.02, shellIn], [0.42, shellIn], [0.84, shellIn], [1.26, shellIn],
    [1.68, shellIn], [2.10, boltFwd, 0.8]], 2.50));

// Handling
w('weapons/weapon_generic_switch_out.wav', clack({ hz: 380, secs: 0.18, bright: 0.35 }));
w('weapons/weapon_generic_switch_in.wav', clack({ hz: 470, secs: 0.20, bright: 0.45 }));
w('weapons/weapon_generic_empty_click.wav', click({ hz: 2600, secs: 0.045, noiseAmt: 0.35 }));
w('weapons/weapon_check.wav', reload([[0.0, clack({ hz: 520, secs: 0.10, bright: 0.4 })],
  [0.35, clack({ hz: 410, secs: 0.12, bright: 0.35 })]], 0.65));
// Pump/bolt cycling (Document D).
w('weapons/weapon_pump_cycle.wav', reload([[0.0, boltBack], [0.22, boltFwd]], 0.42));
w('weapons/weapon_bolt_cycle.wav', reload([[0.0, boltBack, 0.9], [0.40, boltFwd, 0.9]], 0.72));

// Footsteps: 4 variants per surface so repeats are not obvious ---------------
const SURFACES = {
  concrete: { bodyHz: 95, cutoff: 3400, scuff: 0.55 },
  metal: { bodyHz: 150, cutoff: 6500, scuff: 0.75 },
  wood: { bodyHz: 110, cutoff: 2600, scuff: 0.45 },
  dirt: { bodyHz: 72, cutoff: 1500, scuff: 0.70 },
  gravel: { bodyHz: 80, cutoff: 4200, scuff: 0.95 },
};
for (const [surface, cfg] of Object.entries(SURFACES)) {
  for (let i = 1; i <= 4; i += 1) {
    // Jitter each variant slightly so the set sounds like four real steps.
    const k = 0.88 + i * 0.06;
    w(`footsteps/footstep_${surface}_0${i}.wav`, footstep({
      bodyHz: cfg.bodyHz * k,
      cutoff: cfg.cutoff * (0.9 + Math.random() * 0.25),
      scuff: cfg.scuff,
      secs: 0.14 + Math.random() * 0.05,
    }));
  }
  w(`footsteps/land_${surface}.wav`, footstep({
    bodyHz: cfg.bodyHz * 0.75, cutoff: cfg.cutoff, scuff: cfg.scuff * 1.2,
    secs: 0.30, power: 2.2,
  }));
}

// Impacts -------------------------------------------------------------------
w('impacts/impact_concrete.wav', impact({ cutoff: 3000, bodyHz: 190 }));
w('impacts/impact_metal.wav', impact({ cutoff: 7500, bodyHz: 420, tick: 1.3, secs: 0.30 }));
w('impacts/impact_wood.wav', impact({ cutoff: 2200, bodyHz: 160 }));
w('impacts/impact_dirt.wav', impact({ cutoff: 1100, bodyHz: 110, tick: 0.5 }));
w('impacts/impact_gravel.wav', impact({ cutoff: 3800, bodyHz: 130, tick: 0.8 }));
w('impacts/impact_flesh.wav', impact({ cutoff: 900, bodyHz: 90, tick: 0.35, secs: 0.18 }));
w('impacts/impact_dust.wav', impact({ cutoff: 1800, bodyHz: 120, tick: 0.4 }));
w('impacts/impact_spark.wav', impact({ cutoff: 8000, bodyHz: 500, tick: 1.4, secs: 0.24 }));
// Explosion: a long, deep version of a gunshot with a heavy tail.
w('impacts/explosion.wav', gunshot({ secs: 1.6, bodyHz: 38, crack: 0.8, tail: 1.6, grit: 2 }));

// UI ------------------------------------------------------------------------
w('ui/ui_hover.wav', blip({ hz: 880, secs: 0.055 }));
w('ui/ui_click.wav', blip({ hz: 1320, secs: 0.075, second: 1980 }));
w('ui/ui_confirm.wav', reload([[0.0, blip({ hz: 880, secs: 0.08 })],
  [0.07, blip({ hz: 1320, secs: 0.12 })]], 0.24));
w('ui/ui_back.wav', reload([[0.0, blip({ hz: 660, secs: 0.08 })],
  [0.07, blip({ hz: 440, secs: 0.14 })]], 0.26));
w('ui/ui_hit_marker.wav', blip({ hz: 2400, secs: 0.05 }));
w('ui/ui_kill_marker.wav', reload([[0.0, blip({ hz: 2400, secs: 0.05 })],
  [0.05, blip({ hz: 3200, secs: 0.09 })]], 0.16));
w('ui/ui_damage.wav', impact({ cutoff: 700, bodyHz: 70, tick: 0.3, secs: 0.26 }));

// Ambience: one loop per level ----------------------------------------------
w('ambient/ambient_warehouse.wav', ambience({ secs: 8, base: 48, noiseLevel: 0.20, cutoff: 520 }));
w('ambient/ambient_facility.wav', ambience({ secs: 8, base: 62, noiseLevel: 0.26, cutoff: 900,
  partials: [1, 2.02, 3.01, 4.5] }));
w('ambient/ambient_range.wav', ambience({ secs: 8, base: 40, noiseLevel: 0.30, cutoff: 1400,
  partials: [1, 1.49, 2.51] }));

const totalBytes = written.reduce((a, f) => a + f.bytes, 0);
for (const f of written) {
  console.log(`[generateAudio] ${f.name.padEnd(42)} ${String(f.secs).padStart(6)}s  ${(f.bytes / 1024).toFixed(1)} KiB`);
}
console.log(`\n[generateAudio] ${written.length} files, ${(totalBytes / 1024 / 1024).toFixed(2)} MiB total`);
