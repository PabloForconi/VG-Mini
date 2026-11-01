import { getAudio, reverbInput } from './audio';

/** What a track gets for each 16th-note step it plays. */
export interface StepContext {
  delay: number; // seconds from now until this step sounds
  out: AudioNode; // the track's own fader; pass it as `dest`
  space: AudioNode; // the track's own reverb send; pass it as `wetDest`
  level: number; // intensity set by the game (tracks add layers as it rises)
  stepDur: number; // seconds per 16th note
}

/** A synthesized loop: no samples, every note is scheduled as it comes around. */
export interface Track {
  bpm: number;
  bpmPerLevel?: number; // tempo added per intensity level, so the loop speeds up as it builds
  steps: number; // loop length in 16th notes
  gain: number; // fader level relative to the sound effects
  step(i: number, ctx: StepContext): void;
}

const TICK_MS = 30;
const LOOKAHEAD = 0.15; // seconds of notes scheduled ahead of the clock

/**
 * Plays one track at a time. A timer schedules notes slightly ahead of the audio clock (the
 * usual WebAudio pattern), so timing stays tight even if a frame hitches. Each track plays
 * through its own pair of gain nodes (dry, and a send to the reverb), which is how switching
 * tracks fades or cuts cleanly. Several players can run at once (a bed under the main music).
 */
export class Music {
  level = 0;
  private track: Track | null = null;
  private faders: GainNode[] | null = null; // [dry, reverb send]
  private pending: { delay: number; fade: number } | null = null; // start waiting for audio
  private volume = 1; // multiplies the track's own gain (ducking)
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

  /** Glide the volume to `v` (1 = the track's own level) over `fade` seconds, starting now. */
  setVolume(v: number, fade = 0.5) {
    this.volume = v;
    const a = getAudio();
    if (!a || !this.faders || !this.track) return;
    const now = a.ac.currentTime;
    for (const g of this.faders) {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(this.track.gain * v, now + fade);
    }
  }

  private release(fade: number) {
    const a = getAudio();
    const faders = this.faders;
    this.faders = null;
    if (!a || !faders) return;
    const now = a.ac.currentTime;
    for (const g of faders) {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0, now + fade);
      setTimeout(() => g.disconnect(), (fade + LOOKAHEAD + 0.5) * 1000);
    }
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
      const targets = [a.master, reverbInput() ?? a.master];
      this.faders = targets.map((to) => {
        const g = a.ac.createGain();
        g.gain.setValueAtTime(0, now + delay);
        g.gain.linearRampToValueAtTime(track.gain * this.volume, now + delay + fade);
        g.connect(to);
        return g;
      });
      this.nextAt = now + delay + 0.05;
    }
    if (!this.faders) return;

    // Timers stall in background tabs; skip the missed notes instead of firing them all at once.
    if (this.nextAt < now - 0.05) this.nextAt = now + 0.02;
    const bpm = track.bpm + (track.bpmPerLevel ?? 0) * this.level;
    const stepDur = 60 / bpm / 4;
    while (this.nextAt < now + LOOKAHEAD) {
      track.step(this.stepIndex % track.steps, {
        delay: Math.max(0, this.nextAt - now),
        out: this.faders[0],
        space: this.faders[1],
        level: this.level,
        stepDur,
      });
      this.nextAt += stepDur;
      this.stepIndex++;
    }
  }
}

/** The main music: title/results ambience is on `ambient`, the in-game loop here. */
export const music = new Music();
/** A bed that never stops: full on the menus, ducked under the in-game loop. */
export const ambient = new Music();

/** MIDI note number → Hz (69 = A4 = 440 Hz). */
export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
