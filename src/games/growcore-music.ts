import { noise, tone } from '../engine/audio';
import { hz, type Track } from '../engine/music';

/**
 * Growcore's music: two synthesized loops on the same Am – F – C – G progression, in A minor so
 * they share notes with the C-pentatonic catch sounds and never clash with them.
 */
const PROG = [
  { root: 45, tones: [57, 60, 64] }, // Am
  { root: 41, tones: [53, 57, 60] }, // F
  { root: 48, tones: [55, 60, 64] }, // C
  { root: 43, tones: [55, 59, 62] }, // G
];

/**
 * Title and results: slow, spacey. A soft pad per bar, a low sine bass and a music-box arpeggio
 * on eighth notes with a quiet dotted-eighth echo. Eight bars, the second four varying the arp.
 */
export const CALM: Track = {
  bpm: 72,
  steps: 128,
  gain: 0.75,
  step(i, { delay, out, stepDur }) {
    const bar = i >> 4;
    const s = i & 15;
    const chord = PROG[bar % 4];
    const barDur = stepDur * 16;
    if (s === 0) {
      for (const n of chord.tones) {
        tone({ freq: hz(n), dur: barDur * 1.1, type: 'triangle', gain: 0.03, attack: 0.8, filter: 900, delay, dest: out });
      }
      tone({ freq: hz(chord.root + 12), dur: barDur, type: 'sine', gain: 0.06, attack: 0.3, delay, dest: out });
    }
    if (s % 2) return;
    const arp = [...chord.tones.map((n) => n + 12), chord.tones[0] + 24];
    const pattern = bar < 4 ? [0, 1, 2, 3, 2, 1, 2, 1] : [3, 2, 1, 2, 0, 1, 2, 3];
    // Leave a breath at the end of every other bar.
    if (bar % 2 && s >= 12) return;
    const freq = hz(arp[pattern[s / 2]]);
    tone({ freq, dur: 0.6, type: 'sine', gain: 0.04, delay, dest: out });
    tone({ freq, dur: 0.5, type: 'sine', gain: 0.014, delay: delay + stepDur * 3, dest: out });
  },
};

/**
 * In game: driving four-on-the-floor. Layers stack with the music level (see LEVEL_BY_PHASE):
 * 0 kick + octave bass + pad, 1 adds off-beat hats, 2 adds a sixteenth-note lead, 3 adds
 * claps and rolling hats for the chaos phases.
 */
export const DRIVE: Track = {
  bpm: 124,
  steps: 64,
  gain: 0.7,
  step(i, { delay, out, level, stepDur }) {
    const bar = i >> 4;
    const s = i & 15;
    const chord = PROG[bar];

    if (s % 4 === 0) tone({ freq: 150, to: 45, dur: 0.16, type: 'sine', gain: 0.3, delay, dest: out });
    if (s % 2 === 0) {
      const n = chord.root + (s % 4 === 0 ? 12 : 24);
      tone({ freq: hz(n), dur: stepDur * 1.6, type: 'triangle', gain: 0.09, filter: 900, delay, dest: out });
    }
    if (s === 0) {
      for (const n of chord.tones) {
        tone({ freq: hz(n), dur: stepDur * 16, type: 'triangle', gain: 0.018, attack: 0.2, filter: 1200, delay, dest: out });
      }
    }

    if (level >= 1 && s % 4 === 2) noise(0.05, 0.07, 7000, { type: 'highpass', delay, dest: out });

    if (level >= 2) {
      const lead = [...chord.tones.map((n) => n + 12), chord.tones[1] + 24];
      const pattern = bar % 2 ? [3, 2, 1, 0] : [0, 1, 2, 3];
      const n = lead[pattern[s % 4]];
      tone({ freq: hz(n), dur: 0.12, type: 'triangle', gain: 0.03, filter: 3000, delay, dest: out });
    }

    if (level >= 3) {
      if (s === 4 || s === 12) noise(0.12, 0.11, 1500, { type: 'bandpass', delay, dest: out });
      if (s % 2) noise(0.03, 0.03, 9000, { type: 'highpass', delay, dest: out });
    }
  },
};

/** Music intensity per phase index: hats once shields arrive, lead with the super shield, all-in for chaos. */
export const LEVEL_BY_PHASE = [0, 0, 1, 1, 2, 3, 3, 3, 3];

/** Cuts the music: a falling minor triad over a low thud. */
export function loseStinger() {
  [76, 72, 69].forEach((n, i) =>
    tone({ freq: hz(n), dur: i === 2 ? 0.7 : 0.16, type: 'square', gain: 0.07, filter: 1400, delay: 0.08 + i * 0.12 }),
  );
  tone({ freq: hz(45), to: hz(33), dur: 0.8, type: 'triangle', gain: 0.18, delay: 0.32 });
}

/** Dying without a single point: a sad "wah wah wah waaah", the last note wobbling. */
export function zeroPointsFx() {
  [55, 54, 53].forEach((n, i) =>
    tone({ freq: hz(n), dur: 0.3, type: 'sawtooth', gain: 0.11, attack: 0.03, filter: 1100, delay: 0.35 + i * 0.34 }),
  );
  tone({ freq: hz(52), to: hz(50), dur: 1.1, type: 'sawtooth', gain: 0.11, attack: 0.03, filter: 1100, vibrato: 5, delay: 0.35 + 3 * 0.34 });
}
