import { bell, noise, tone } from '../engine/audio';
import { hz, type Track } from '../engine/music';

/**
 * Growcore's music: synthesized loops on the same Am – F – C – G progression, in A minor so
 * they share notes with the C-pentatonic catch sounds and never clash with them.
 */
const PROG = [
  { root: 45, tones: [57, 60, 64] }, // Am
  { root: 41, tones: [53, 57, 60] }, // F
  { root: 48, tones: [55, 60, 64] }, // C
  { root: 43, tones: [55, 59, 62] }, // G
];

/** A-minor pentatonic, high up: notes that sit well over any chord of PROG. */
const SKY = [81, 84, 86, 88, 91, 93];

/**
 * The bed: no percussion, no pulse, just slow swelling chords and a few glass bells drifting
 * in a big hall. It never stops; the game ducks it under DRIVE.
 * Level 0 (menus): the full progression, two bars per chord, with a slow bell melody.
 * Level 1 (under the game): only an open A–E drone and sparse bells, so whatever chord DRIVE
 * is on, nothing rubs.
 */
export const AMBIENT: Track = {
  bpm: 60,
  steps: 128, // 8 bars of 4 s
  gain: 0.8,
  step(i, { delay, out, space, level, stepDur }) {
    const bar = i >> 4;
    const s = i & 15;
    const at = { delay, dest: out, wetDest: space };
    const barDur = stepDur * 16;

    if (level >= 1) {
      if (s === 0 && bar % 2 === 0) {
        for (const n of [57, 64, 69]) {
          tone({ freq: hz(n), dur: barDur * 2.2, type: 'triangle', gain: 0.025, attack: 2, filter: 1100, wet: 0.7, ...at });
        }
      }
      if ((s === 0 || s === 10) && bar % 2) bell(hz(SKY[(bar * 3 + s) % SKY.length]), { gain: 0.04, dur: 2.5, wet: 0.9, ...at });
      return;
    }

    const chord = PROG[(bar >> 1) % 4];
    if (s === 0 && bar % 2 === 0) {
      for (const n of chord.tones) {
        tone({ freq: hz(n), dur: barDur * 2.3, type: 'triangle', gain: 0.03, attack: 2.2, filter: 1300, wet: 0.7, ...at });
        tone({ freq: hz(n + 12), dur: barDur * 2, type: 'sine', gain: 0.012, attack: 3, wet: 0.9, ...at });
      }
      tone({ freq: hz(chord.root + 12), dur: barDur * 2.2, type: 'sine', gain: 0.05, attack: 1.5, ...at });
    }
    // A slow melody: one or two bells a bar, picked from the chord so it always fits.
    const melody: Record<number, number> = bar % 2 ? { 4: 1, 10: 2 } : { 0: 2, 8: 0 };
    const pick = melody[s];
    if (pick !== undefined) {
      bell(hz(chord.tones[pick] + 24), { gain: 0.045, dur: 3, wet: 0.9, ...at });
    }
    // Every fourth bar, a little sparkle of three falling sky notes.
    if (bar % 4 === 3 && s === 12) {
      [5, 3, 1].forEach((k, j) => bell(hz(SKY[k]), { gain: 0.025, dur: 1.5, wet: 0.9, ...at, delay: delay + j * 0.12 }));
    }
  },
};

/**
 * In game: driving four-on-the-floor from the first second, and it keeps building. Layers stack
 * with the music level (see LEVEL_BY_PHASE), and every level also nudges the tempo up:
 * 0 kick, bass, hats, pad and a bell arpeggio; 1 claps and a busier bass; 2 a sixteenth-note
 * lead; 3 rolling hats, a brighter mix and a sub drop at the top of the loop; 4 open hats and
 * a high bell counter-melody.
 */
export const DRIVE: Track = {
  bpm: 126,
  bpmPerLevel: 2,
  steps: 64,
  gain: 0.7,
  step(i, { delay, out, space, level, stepDur }) {
    const bar = i >> 4;
    const s = i & 15;
    const chord = PROG[bar];
    const at = { delay, dest: out, wetDest: space };

    // Kick: a pitched thump plus a tiny click so it still reads on phone speakers.
    const kick = s % 4 === 0 || (level >= 3 && bar === 3 && s === 14);
    if (kick) {
      tone({ freq: 170, to: 45, dur: 0.2, type: 'sine', gain: 0.34, ...at });
      noise(0.012, 0.06, 2500, { type: 'highpass', ...at });
    }

    // Bass: octave-jumping eighths; from level 1, a sixteenth pickup into each beat.
    if (s % 2 === 0) {
      const n = chord.root + (s % 4 === 0 ? 12 : 24);
      tone({ freq: hz(n), dur: stepDur * 1.6, type: 'triangle', gain: 0.1, filter: 900 + level * 250, ...at });
    }
    if (level >= 1 && s % 4 === 3) {
      tone({ freq: hz(chord.root + 24), dur: stepDur * 0.8, type: 'triangle', gain: 0.06, filter: 1200, ...at });
    }

    if (s === 0) {
      for (const n of chord.tones) {
        tone({ freq: hz(n), dur: stepDur * 16, type: 'triangle', gain: 0.02, attack: 0.15, filter: 1200 + level * 400, wet: 0.5, ...at });
      }
    }
    if (level >= 3 && i === 0) tone({ freq: hz(33), to: hz(28), dur: 1.2, type: 'sine', gain: 0.16, ...at });

    // Hats: off-beats from the start (open from level 4), rolling sixteenths from level 3.
    if (s % 4 === 2) noise(level >= 4 ? 0.16 : 0.05, 0.07, 7000, { type: 'highpass', ...at });
    if (level >= 3 && s % 2) noise(0.03, 0.03, 9000, { type: 'highpass', ...at });

    // Bell arpeggio on eighths, from the start: chord tones up an octave, in the hall.
    if (s % 2 === 0) {
      const arp = [...chord.tones.map((n) => n + 12), chord.tones[0] + 24];
      const pattern = [0, 1, 2, 3, 2, 1, 2, 1];
      bell(hz(arp[pattern[s / 2]]), { gain: 0.03, dur: 0.5, wet: 0.45, ...at });
    }

    if (level >= 1 && (s === 4 || s === 12)) noise(0.14, 0.12, 1500, { type: 'bandpass', wet: 0.35, ...at });

    if (level >= 2) {
      const lead = [...chord.tones.map((n) => n + 12), chord.tones[1] + 24];
      const pattern = bar % 2 ? [3, 2, 1, 0] : [0, 1, 2, 3];
      const n = lead[pattern[s % 4]];
      tone({ freq: hz(n), dur: 0.12, type: 'triangle', gain: 0.028, filter: 3000, wet: 0.25, ...at });
    }

    if (level >= 4 && (s === 0 || s === 8)) {
      bell(hz(chord.tones[s ? 1 : 2] + 24), { gain: 0.04, dur: 1.6, wet: 0.7, ...at });
    }
  },

  /**
   * Two bars that wind up into the loop, so the beat doesn't slam in cold: F then G, landing
   * on the loop's Am. Bar 1 is a swelling pad, a held bass and a slow bell arpeggio under a
   * rising sweep of air; bar 2 brings in the kick and hats, doubles the arpeggio and rolls a
   * snare that speeds up, and a crash marks the loop's first beat.
   */
  intro: {
    steps: 32,
    step(i, { delay, out, space, stepDur }) {
      const bar = i >> 4;
      const s = i & 15;
      const chord = PROG[bar ? 3 : 1];
      const at = { delay, dest: out, wetDest: space };

      if (i === 0) noise(stepDur * 32, 0.035, 300, { type: 'bandpass', to: 8000, attack: stepDur * 30, wet: 0.5, ...at });
      if (s === 0) {
        for (const n of chord.tones) {
          tone({ freq: hz(n), dur: stepDur * 16, type: 'triangle', gain: 0.016, attack: stepDur * 8, filter: bar ? 1600 : 900, wet: 0.6, ...at });
        }
        tone({ freq: hz(chord.root + 12), dur: stepDur * 16, type: 'triangle', gain: bar ? 0.055 : 0.04, attack: 0.05, filter: 700, ...at });
      }

      const arp = [...chord.tones.map((n) => n + 12), chord.tones[0] + 24];
      if (s % (bar ? 2 : 4) === 0) {
        bell(hz(arp[(s >> (bar ? 1 : 2)) % 4]), { gain: bar ? 0.03 : 0.025, dur: 0.6, wet: 0.5, ...at });
      }

      if (bar) {
        if (s % 4 === 0) {
          tone({ freq: 170, to: 45, dur: 0.2, type: 'sine', gain: 0.24, ...at });
          noise(0.012, 0.06, 2500, { type: 'highpass', ...at });
        }
        if (s % 4 === 2) noise(0.05, 0.05, 7000, { type: 'highpass', ...at });
        // Snare roll: eighths, then sixteenths, getting louder into the loop.
        if ((s >= 8 && s % 2 === 0) || s >= 12) noise(0.08, 0.03 + (s - 8) * 0.008, 1500, { type: 'bandpass', wet: 0.3, ...at });
        if (s === 15) noise(1.4, 0.07, 6000, { type: 'highpass', wet: 0.6, ...at, delay: delay + stepDur });
      }
    },
  },
};

/** Music intensity per phase index: claps with Citrino, the lead with the shield, then more. */
export const LEVEL_BY_PHASE = [0, 1, 2, 2, 3, 3, 4, 4, 4];

/** Cuts the music: falling glass bells over a deep, slow boom. */
export function loseStinger() {
  [76, 72, 69, 64].forEach((n, i) => bell(hz(n), { gain: 0.09, dur: i === 3 ? 2.2 : 0.9, wet: 0.7, delay: 0.1 + i * 0.14 }));
  tone({ freq: hz(45), to: hz(33), dur: 1.2, type: 'sine', gain: 0.22, delay: 0.1, wet: 0.4 });
}

/** Dying without a single point: a sad "wah wah wah waaah", the last note wobbling. */
export function zeroPointsFx() {
  [55, 54, 53].forEach((n, i) =>
    tone({ freq: hz(n), dur: 0.3, type: 'sawtooth', gain: 0.11, attack: 0.03, filter: 1100, wet: 0.2, delay: 0.35 + i * 0.34 }),
  );
  tone({ freq: hz(52), to: hz(50), dur: 1.1, type: 'sawtooth', gain: 0.11, attack: 0.03, filter: 1100, vibrato: 5, wet: 0.2, delay: 0.35 + 3 * 0.34 });
}
