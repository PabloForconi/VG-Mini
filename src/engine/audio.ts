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

/** The live context and master bus, or null until the first gesture unlocks audio. */
export function getAudio() {
  return ac && master ? { ac, master } : null;
}

interface ToneOptions {
  freq: number;
  to?: number; // pitch slide target
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  attack?: number; // seconds to reach full volume (soft pads want more than a click)
  filter?: number; // lowpass cutoff in Hz, to tame bright waves
  vibrato?: number; // depth in Hz of a 6 Hz wobble
  dest?: AudioNode; // defaults to the master bus (music passes its own)
}

/** One-shot oscillator with a quick attack and exponential release. */
export function tone({
  freq,
  to,
  dur = 0.12,
  type = 'sine',
  gain = 0.2,
  delay = 0,
  attack = 0.005,
  filter,
  vibrato,
  dest,
}: ToneOptions) {
  if (!ac || !master) return;
  const t = ac.currentTime + delay;
  const end = t + dur + 0.02;
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let out: AudioNode = osc;
  if (filter) {
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = filter;
    out = out.connect(lp);
  }
  if (vibrato) {
    const lfo = ac.createOscillator();
    const depth = ac.createGain();
    lfo.frequency.value = 6;
    depth.gain.value = vibrato;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(end);
  }
  out.connect(env).connect(dest ?? master);
  osc.start(t);
  osc.stop(end);
}

/** One second of white noise, made once and shared by every burst (hats fire many times a second). */
let noiseBuf: AudioBuffer | null = null;
function noiseBuffer(ctx: AudioContext) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

interface NoiseOptions {
  delay?: number;
  type?: BiquadFilterType; // lowpass sweeps down (impacts); highpass/bandpass stay put (hats, claps)
  dest?: AudioNode;
}

/** Filtered white-noise burst (explosions, impacts, and the music's hats and claps). */
export function noise(dur = 0.4, gain = 0.4, cutoff = 1200, { delay = 0, type = 'lowpass', dest }: NoiseOptions = {}) {
  if (!ac || !master) return;
  const t = ac.currentTime + delay;
  const len = Math.min(dur, 0.99);
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  const filter = ac.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(cutoff, t);
  if (type === 'lowpass') filter.frequency.exponentialRampToValueAtTime(80, t + len);
  const env = ac.createGain();
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(filter).connect(env).connect(dest ?? master);
  src.start(t, Math.random() * (1 - len), len);
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
