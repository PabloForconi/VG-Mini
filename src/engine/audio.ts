import { loadNumber, saveNumber } from './storage';

/**
 * Tiny synth: every sound is generated with WebAudio, no asset files.
 * Browsers only allow audio after a user gesture, so the context is created
 * (or resumed) on the first pointer/key press.
 */

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let reverb: ConvolverNode | null = null; // shared hall; sounds opt in with `wet`
let muted = loadNumber('muted') === 1;

function unlock() {
  if (!ac) {
    ac = new AudioContext();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.7;
    master.connect(ac.destination);
    reverb = ac.createConvolver();
    reverb.buffer = hallImpulse(ac, 2.8);
    reverb.connect(master);
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

/**
 * A synthetic hall: stereo noise with an exponential tail that also darkens as it decays,
 * like real rooms where highs die first. Made once; one convolver serves every sound.
 */
function hallImpulse(ctx: AudioContext, seconds: number) {
  const len = Math.round(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      lp += (Math.random() * 2 - 1 - lp) * (0.6 - 0.5 * x); // one-pole lowpass, closing over time
      data[i] = lp * (1 - x) ** 3 * Math.min(1, i / (ctx.sampleRate * 0.01));
    }
  }
  return buf;
}

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
  wet?: number; // how much goes to the hall reverb
  wetDest?: AudioNode; // where the wet share goes (music passes its own reverb send)
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
  wet = 0,
  wetDest,
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
  if (wet > 0) send(env, wet, wetDest);
  osc.start(t);
  osc.stop(end);
}

/** Routes a share of `node` into the reverb (or into `to`, a track's own reverb send). */
function send(node: AudioNode, amount: number, to?: AudioNode) {
  const target = to ?? reverb;
  if (!ac || !target) return;
  const g = ac.createGain();
  g.gain.value = amount;
  node.connect(g).connect(target);
}

/** The hall's input, for music faders that send to it. */
export const reverbInput = () => reverb;

interface BellOptions {
  gain?: number;
  dur?: number;
  delay?: number;
  wet?: number;
  dest?: AudioNode;
  wetDest?: AudioNode;
}

/**
 * Glassy bell: a sine plus a slightly sharp octave that fades first, so it shimmers as it rings.
 * Mostly heard through the hall: soft, airy, never a click.
 */
export function bell(freq: number, { gain = 0.1, dur = 1.2, delay = 0, wet = 0.5, dest, wetDest }: BellOptions = {}) {
  tone({ freq, dur, type: 'sine', gain, delay, attack: 0.006, wet, dest, wetDest });
  tone({ freq: freq * 2.004, dur: dur * 0.4, type: 'sine', gain: gain * 0.3, delay, attack: 0.004, wet, dest, wetDest });
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
  to?: number; // filter sweep target, for any type (whooshes)
  attack?: number; // fade in instead of starting at full volume
  dest?: AudioNode;
  wet?: number;
  wetDest?: AudioNode;
}

/** Filtered white-noise burst (explosions, impacts, whooshes, and the music's hats and claps). */
export function noise(
  dur = 0.4,
  gain = 0.4,
  cutoff = 1200,
  { delay = 0, type = 'lowpass', to, attack = 0, dest, wet = 0, wetDest }: NoiseOptions = {},
) {
  if (!ac || !master) return;
  const t = ac.currentTime + delay;
  const len = Math.min(dur, 0.99);
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  const filter = ac.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(cutoff, t);
  if (to) filter.frequency.exponentialRampToValueAtTime(to, t + len);
  else if (type === 'lowpass') filter.frequency.exponentialRampToValueAtTime(80, t + len);
  const env = ac.createGain();
  if (attack > 0) {
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
  } else {
    env.gain.setValueAtTime(gain, t);
  }
  env.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(filter).connect(env).connect(dest ?? master);
  if (wet > 0) send(env, wet, wetDest);
  src.start(t, Math.random() * (1 - len), len);
}

/**
 * A sustained, choir-like chord that can be steered every frame: detuned sine/triangle pairs
 * through a lowpass, a slow tremolo and a breath of band-passed air, all bathed in the hall.
 * `bright` (0..1) opens the filter, lifts the pitch a little and quickens the shimmer.
 */
export class Shimmer {
  private env: GainNode | null = null;
  private lp: BiquadFilterNode | null = null;
  private air: BiquadFilterNode | null = null;
  private airGain: GainNode | null = null;
  private lfo: OscillatorNode | null = null;
  private oscs: OscillatorNode[] = [];
  private last = { level: -1, bright: -1 };

  /** `voices`: [Hz, gain] for each chord tone. */
  constructor(private voices: [number, number][]) {}

  set(level: number, bright: number) {
    if (!ac || !master) return;
    // Called every frame; only touch the automation when something actually moved.
    if (Math.abs(level - this.last.level) < 0.002 && Math.abs(bright - this.last.bright) < 0.005) return;
    this.last = { level, bright };
    if (!this.env) this.build(ac, master);
    const t = ac.currentTime;
    this.env!.gain.setTargetAtTime(level, t, level > 0 ? 0.06 : 0.18);
    this.lp!.frequency.setTargetAtTime(700 + bright * 3300, t, 0.08);
    this.air!.frequency.setTargetAtTime(1500 + bright * 3500, t, 0.08);
    this.airGain!.gain.setTargetAtTime(0.05 + bright * 0.1, t, 0.08);
    this.lfo!.frequency.setTargetAtTime(2.5 + bright * 5, t, 0.1);
    for (const o of this.oscs) o.detune.setTargetAtTime(bright * 240, t, 0.1);
  }

  private build(ctx: AudioContext, out: GainNode) {
    const env = (this.env = ctx.createGain());
    env.gain.value = 0;
    const lp = (this.lp = ctx.createBiquadFilter());
    lp.type = 'lowpass';
    lp.Q.value = 0.7;
    // Tremolo: the gain wobbles between 0.6 and 1.
    const trem = ctx.createGain();
    trem.gain.value = 0.8;
    const lfo = (this.lfo = ctx.createOscillator());
    const depth = ctx.createGain();
    depth.gain.value = 0.2;
    lfo.connect(depth).connect(trem.gain);
    lp.connect(trem).connect(env);

    for (const [hz, g] of this.voices) {
      for (const [type, cents] of [['sine', -6], ['triangle', 7]] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = hz * 2 ** (cents / 1200);
        const vg = ctx.createGain();
        vg.gain.value = g / 2;
        o.connect(vg).connect(lp);
        this.oscs.push(o);
      }
    }

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    const air = (this.air = ctx.createBiquadFilter());
    air.type = 'bandpass';
    air.Q.value = 3;
    const airGain = (this.airGain = ctx.createGain());
    src.connect(air).connect(airGain).connect(env);

    env.connect(out);
    send(env, 0.7);
    for (const o of this.oscs) o.start();
    lfo.start();
    src.start();
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
