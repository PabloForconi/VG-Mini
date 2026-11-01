import { getAudio } from './audio';

/** What a track gets for each 16th-note step it plays. */
export interface StepContext {
  delay: number; // seconds from now until this step sounds
  out: AudioNode; // the track's own fader; pass it as `dest`
  level: number; // intensity set by the game (tracks add layers as it rises)
  stepDur: number; // seconds per 16th note
}

/** A synthesized loop: no samples, every note is scheduled as it comes around. */
export interface Track {
  bpm: number;
  steps: number; // loop length in 16th notes
  gain: number; // fader level relative to the sound effects
  step(i: number, ctx: StepContext): void;
}

const TICK_MS = 30;
const LOOKAHEAD = 0.15; // seconds of notes scheduled ahead of the clock

/**
 * Plays one track at a time. A timer schedules notes slightly ahead of the audio clock (the
 * usual WebAudio pattern), so timing stays tight even if a frame hitches. Each track plays
 * through its own gain node, which is how switching tracks fades or cuts cleanly.
 */
class Music {
  level = 0;
  private track: Track | null = null;
  private fader: GainNode | null = null;
  private pending: { delay: number; fade: number } | null = null; // start waiting for audio
  private stepIndex = 0;
  private nextAt = 0;

  constructor() {
    setInterval(() => this.tick(), TICK_MS);
  }

  /** Switch to `track` (no-op if it is already playing), fading in after `delay` seconds. */
  play(track: Track, { delay = 0, fade = 0.4 } = {}) {
    if (this.track === track) return;
    this.release(0.3);
    this.track = track;
    this.stepIndex = 0;
    this.pending = { delay, fade };
  }

  /** Fade the current track out over `fade` seconds (a tiny value works as a hard cut). */
  stop(fade = 0.3) {
    this.release(fade);
    this.track = null;
    this.pending = null;
  }

  private release(fade: number) {
    const a = getAudio();
    const g = this.fader;
    this.fader = null;
    if (!a || !g) return;
    const now = a.ac.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(0, now + fade);
    setTimeout(() => g.disconnect(), (fade + LOOKAHEAD + 0.5) * 1000);
  }

  private tick() {
    const a = getAudio();
    const track = this.track;
    // Before the first tap there is no audio yet; a pending start simply waits for it.
    if (!a || !track || a.ac.state !== 'running') return;
    const now = a.ac.currentTime;

    if (this.pending) {
      const { delay, fade } = this.pending;
      this.pending = null;
      const g = a.ac.createGain();
      g.gain.setValueAtTime(0, now + delay);
      g.gain.linearRampToValueAtTime(track.gain, now + delay + fade);
      g.connect(a.master);
      this.fader = g;
      this.nextAt = now + delay + 0.05;
    }
    if (!this.fader) return;

    // Timers stall in background tabs; skip the missed notes instead of firing them all at once.
    if (this.nextAt < now - 0.05) this.nextAt = now + 0.02;
    const stepDur = 60 / track.bpm / 4;
    while (this.nextAt < now + LOOKAHEAD) {
      track.step(this.stepIndex % track.steps, {
        delay: Math.max(0, this.nextAt - now),
        out: this.fader,
        level: this.level,
        stepDur,
      });
      this.nextAt += stepDur;
      this.stepIndex++;
    }
  }
}

export const music = new Music();

/** MIDI note number → Hz (69 = A4 = 440 Hz). */
export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
