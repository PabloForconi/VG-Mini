import { loadNumber, saveNumber } from './storage';

/**
 * Tiny synth: every sound is generated with WebAudio, no asset files.
 * Browsers only allow audio after a user gesture, so the context is created
 * (or resumed) on the first pointer/key press.
 */

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let muted = loadNumber('muted') === 1;

function unlock() {
  if (!ac) {
    ac = new AudioContext();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.7;
    master.connect(ac.destination);
  }
  if (ac.state === 'suspended') void ac.resume();
}
window.addEventListener('pointerdown', unlock);
// Older iOS only grants audio on touchend; input.ts cancels its default, but it still bubbles here.
window.addEventListener('touchend', unlock);
window.addEventListener('keydown', (e) => {
  unlock();
  if (e.code === 'KeyM') setMuted(!muted);
});

export function setMuted(value: boolean) {
  muted = value;
  saveNumber('muted', value ? 1 : 0);
  if (ac && master) master.gain.setTargetAtTime(value ? 0 : 0.7, ac.currentTime, 0.02);
}

export const isMuted = () => muted;

interface ToneOptions {
  freq: number;
  to?: number; // pitch slide target
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
}

/** One-shot oscillator with a quick attack and exponential release. */
export function tone({ freq, to, dur = 0.12, type = 'sine', gain = 0.2, delay = 0 }: ToneOptions) {
  if (!ac || !master) return;
  const t = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain, t + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(env).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Filtered white-noise burst (explosions, impacts). */
export function noise(dur = 0.4, gain = 0.4, cutoff = 1200) {
  if (!ac || !master) return;
  const t = ac.currentTime;
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(cutoff, t);
  filter.frequency.exponentialRampToValueAtTime(80, t + dur);
  const env = ac.createGain();
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(env).connect(master);
  src.start(t);
}

/** A sustained voice whose pitch and volume can be steered every frame. */
export class Drone {
  private osc: OscillatorNode | null = null;
  private sub: OscillatorNode | null = null;
  private env: GainNode | null = null;

  set(level: number, freq: number) {
    if (!ac || !master) return;
    if (!this.osc) {
      this.env = ac.createGain();
      this.env.gain.value = 0;
      this.osc = ac.createOscillator();
      this.osc.type = 'sawtooth';
      this.sub = ac.createOscillator();
      this.sub.type = 'sine';
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      this.osc.connect(filter).connect(this.env);
      this.sub.connect(this.env);
      this.env.connect(master);
      this.osc.start();
      this.sub.start();
    }
    const t = ac.currentTime;
    this.env!.gain.setTargetAtTime(level, t, 0.04);
    this.osc.frequency.setTargetAtTime(freq, t, 0.05);
    this.sub!.frequency.setTargetAtTime(freq / 2, t, 0.05);
  }
}

/** Haptics where supported (Android Chrome); silently ignored elsewhere (iOS). */
export function vibrate(pattern: number | number[]) {
  if (muted) return;
  // Before the first real tap the browser refuses (and logs an error), so don't ask.
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (activation && !activation.hasBeenActive) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not allowed (no user gesture yet, iframe policy, etc.).
  }
}
