import { bell, noise, tone } from '../engine/audio';

/**
 * Growcore's sound effects. One palette for all of them: glass bells, soft swells and breaths
 * of air, nearly everything sent into the shared hall reverb, so the game sounds airy and
 * spacious rather than beepy. Pitches come from the C-pentatonic scale (see `note`), which
 * fits the music's A-minor key.
 */

const SCALE = [0, 2, 4, 7, 9];
/** Pentatonic steps from C5, so rising notes always sound musical. */
export const note = (step: number) =>
  523.25 * 2 ** ((SCALE[step % SCALE.length] + 12 * Math.floor(step / SCALE.length)) / 12);

/** The pull: an open A–E chord, voiced like a distant choir (see Shimmer). */
export const PULL_VOICES: [number, number][] = [
  [220, 0.5],
  [329.63, 0.4],
  [440, 0.35],
  [659.25, 0.2],
  [880, 0.1],
];

/** A breath of air sweeping up or down: band-passed noise that fades in. */
function whoosh(from: number, to: number, dur: number, gain: number, delay = 0) {
  noise(dur, gain, from, { type: 'bandpass', to, attack: dur * 0.4, wet: 0.6, delay });
}

/** A crystal reaches the core: one bell, a fifth-ish pair for Citrino, a three-note chime for Rodonita. */
export function catchSfx(kind: string, step: number) {
  if (kind === 'pink') {
    bell(note(step), { gain: 0.17, dur: 1.4 });
    bell(note(step + 2), { gain: 0.11, dur: 1.3, delay: 0.07 });
    bell(note(step + 4), { gain: 0.1, dur: 1.6, delay: 0.14 });
    noise(0.5, 0.03, 6000, { type: 'highpass', attack: 0.1, wet: 0.8, delay: 0.05 });
  } else if (kind === 'yellow') {
    bell(note(step), { gain: 0.17, dur: 1.1 });
    bell(note(step + 2), { gain: 0.1, dur: 1.1, delay: 0.06 });
  } else {
    bell(note(step), { gain: 0.17, dur: 0.9 });
  }
}

/** The core steps up a multiplier tier: a quick harp run above the catch note. */
export function tierUpSfx(step: number) {
  for (let i = 0; i < 4; i++) bell(note(step + 2 + i), { gain: 0.05, dur: 0.7, delay: 0.05 + i * 0.045 });
}

/** Shield picked up: a rising arpeggio of bells over a soft swell, like a choir taking a breath. */
export function shieldSfx() {
  [0, 1, 2, 3, 5].forEach((s, i) => bell(note(s), { gain: 0.08, dur: 1.5, delay: i * 0.07, wet: 0.7 }));
  tone({ freq: note(0) / 2, dur: 1.4, type: 'sine', gain: 0.06, attack: 0.2, wet: 0.8 });
  whoosh(800, 4000, 0.6, 0.05);
}

/** A bomb shatters on the shield: a bright glass ting over a muffled thump. */
export function blockSfx() {
  bell(2637, { gain: 0.1, dur: 1.4, wet: 0.7 });
  bell(3951, { gain: 0.05, dur: 1, delay: 0.02, wet: 0.7 });
  tone({ freq: 140, to: 60, dur: 0.25, type: 'sine', gain: 0.2 });
  noise(0.2, 0.12, 3000, { type: 'bandpass', wet: 0.5 });
}

/** A bomb brushed past the core: air rushing by and a small bell of relief. */
export function nearMissSfx() {
  whoosh(700, 4000, 0.35, 0.05);
  bell(note(9), { gain: 0.035, dur: 1, delay: 0.12 });
}

/** Cash-out: a cascade of bells, longer and higher for bigger tiers, over a soft low bloom. */
export function cashOutSfx(tier: number) {
  for (let i = 0; i <= tier + 2; i++) {
    bell(note(i * 2 + tier * 2), { gain: 0.1, dur: 1.2, delay: i * 0.05 });
  }
  tone({ freq: 130, to: 65, dur: 0.6, type: 'sine', gain: 0.22, attack: 0.02, wet: 0.3 });
  noise(0.6, 0.03 + tier * 0.01, 5000, { type: 'highpass', attack: 0.15, wet: 0.8 });
}

/** Passed your best mid-run. */
export function recordSfx() {
  [0, 2, 4, 5, 7].forEach((s, i) => bell(note(s + 5), { gain: 0.08, dur: 1.4, delay: i * 0.07, wet: 0.7 }));
}

/**
 * A phase with a banner begins: a soft swipe of air, no bells, so it never blends with the catch
 * sounds. The sweep up matches the banner sliding in; a low swell underneath gives it body
 * well below the bells' range, and a quieter sweep back down trails off in the hall.
 */
export function phaseSfx() {
  whoosh(300, 5000, 0.45, 0.2);
  whoosh(4000, 900, 0.6, 0.06, 0.3);
  tone({ freq: 110, to: 165, dur: 0.7, type: 'sine', gain: 0.09, attack: 0.25, wet: 0.5 });
}

/** Tap to play: a rising sweep, like lifting off. */
export function startSfx() {
  tone({ freq: 220, to: 660, dur: 0.5, type: 'sine', gain: 0.1, attack: 0.05, wet: 0.6 });
  whoosh(600, 3000, 0.5, 0.06);
}

/** Hit by a bomb: a low boom with a long tail in the hall. */
export function deathSfx() {
  noise(0.6, 0.35, 1500, { wet: 0.4 });
  tone({ freq: 160, to: 40, dur: 0.6, type: 'sine', gain: 0.35, wet: 0.3 });
}

/** Results score counting up: tiny bells climbing the scale (`k` goes 0 → 1). */
export function countTickSfx(k: number) {
  bell(note(2 + Math.floor(k * 7)), { gain: 0.03, dur: 0.3, wet: 0.3 });
}

/** Results score lands. */
export function scoreLandSfx() {
  [0, 2, 4].forEach((s, i) => bell(note(s + 5), { gain: 0.08, dur: 1.2, delay: i * 0.03 }));
}

/** Results coins land. */
export function coinsSfx() {
  bell(1318, { gain: 0.08, dur: 0.8 });
  bell(1760, { gain: 0.07, dur: 1, delay: 0.06 });
}

/** New best run on the results screen. */
export function newBestSfx() {
  [0, 2, 4, 7, 9].forEach((s, i) => bell(note(s + 5), { gain: 0.09, dur: 1.6, delay: i * 0.08, wet: 0.7 }));
  whoosh(800, 5000, 0.8, 0.04);
}

/** Results message without a record: two soft falling bells. */
export function notBestSfx() {
  bell(880, { gain: 0.05, dur: 0.8 });
  bell(659.25, { gain: 0.05, dur: 1.2, delay: 0.12 });
}

/** The first tap (the one that wakes the audio up): a slow swell of air and a low tone. */
export function enterSfx() {
  whoosh(300, 1800, 1.6, 0.05);
  tone({ freq: 130.81, dur: 2.2, type: 'sine', gain: 0.06, attack: 0.7, wet: 0.8 });
}

/** One title letter landing: the letters play a rising harp line, C5 upward. */
export function titleLetterSfx(i: number) {
  bell(note(i), { gain: 0.06, dur: 1.6, wet: 0.7 });
}
