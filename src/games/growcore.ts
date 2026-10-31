import { Drone, isMuted, noise, setMuted, tone, vibrate } from '../engine/audio';
import { isHolding, pointer, takePress } from '../engine/input';
import { loadJSON, loadNumber, saveJSON, saveNumber } from '../engine/storage';
import { HEIGHT, WIDTH, type MiniGame } from './MiniGame';

/**
 * GROWCORE — hold to pull everything toward the core.
 * Light gems answer the pull fast, heavy mines slowly. Caught gems are
 * stored in the core, which grows (bigger target for mines, stronger pull).
 * Tap the core to cash out: the bigger the load, the bigger the multiplier.
 * A mine hit loses everything not cashed.
 */

const TITLE = 'GROWCORE';

/** Start-screen copy. Lines wrap automatically to the screen width. */
const START_RULES: { text: string; warn?: boolean }[] = [
  { text: 'Mantené presionado para atraer.' },
  { text: 'Tocá el núcleo para liberar la carga y sumar puntos.' },
  { text: '¡Cuidado con las bombas! Si las atraés, perdés todo lo acumulado.', warn: true },
];
const START_TIPS = [
  'Cuanto más pesa, más tarda en llegar... ¡pero más puntos vale!',
  '¡Cuanta más carga acumules, mayor será el multiplicador!',
];
const CX = WIDTH / 2;
const CY = HEIGHT / 2;

/** Tuning knobs: everything that changes how the game feels lives here. */
const T = {
  fieldRadius: 230,
  fieldGrowth: 70, // extra field radius at max core size
  pullForce: 1500,
  pullGrowth: 0.6, // extra pull (fraction) at max core size
  pullDecay: 2.4, // how fast pulled velocity bleeds off after release (1/s)
  coreRadius: 16,
  coreMax: 56,
  coreGrowth: 1.1, // px of radius per stored load unit
  coreTapMargin: 14, // forgiving tap target around the core
  driftMin: 40,
  driftMax: 70,
  driftRamp: 0.9, // extra drift speed per second played
  driftCap: 120,
  missMin: 70, // passive trajectories never cross the core
  missMax: 190,
  nearMissGap: 22,
  nearMissPoints: 5,
  pointsPerCoin: 5,
  tiltMax: 0.35, // max gem lean while pulled (~20°)
  tiltSpeed: 450, // sideways pull speed (px/s) that reaches tiltMax
};

type ShieldKind = 'shield' | 'pizza';
type Kind = 'cyan' | 'yellow' | 'pink' | 'mine' | ShieldKind;

/**
 * Look: calm night sky (deep indigo, stars, faint nebulae) with flat-shaded
 * pastel shapes floating in it; light ink for text, red for danger.
 */
const C = {
  ink: '#f3ecfa', // main text on the night sky
  inkSoft: '#a99cc8',
  onPastel: '#2a2140', // text drawn on top of pastel shapes (the core)
  danger: '#ff5d5d',
  gold: '#f2c46d',
  white: '#ffffff',
};
const T_MINT = '#8fd8c9'; // "this run" highlight on the results ladder
const font = (weight: number, size: number) => `${weight} ${size}px "Josefin Sans", system-ui, sans-serif`;

interface KindDef {
  r: number;
  mass: number;
  value: number; // points stored on catch
  load: number; // how much a catch grows the core
  color: string; // mid tone: particles, bars
  light: string; // lit facet
  dark: string; // shaded facet
  name: string;
  blurb?: string; // banner line instead of "+value"
}

/**
 * Risk ladder: heavier gems answer the pull slower and pay more. Pink sits
 * just under the mine's mass, so pulling one in means holding long enough
 * to drag a mine too. Shields are about as heavy as a mine for the same reason.
 */
const KINDS: Record<Kind, KindDef> = {
  cyan: { r: 7, mass: 1, value: 1, load: 1, color: '#7fcabc', light: '#b2e6dc', dark: '#4f9e91', name: 'Gema celeste' },
  yellow: { r: 9, mass: 2, value: 5, load: 2, color: '#ecc56a', light: '#f8e1a0', dark: '#c4922f', name: 'Gema amarilla' },
  pink: { r: 11, mass: 3, value: 15, load: 3, color: '#e894a8', light: '#f6bfcb', dark: '#c4637c', name: 'Gema rosa' },
  mine: { r: 11, mass: 3.4, value: 0, load: 0, color: '#f2565c', light: '#ff8a80', dark: '#a52834', name: 'Bomba' },
  shield: {
    r: 11,
    mass: 3.2,
    value: 0,
    load: 0,
    color: '#ffffff',
    light: '#ffffff',
    dark: '#8c7591',
    name: 'Escudo',
    blurb: 'Aguanta 1 bomba',
  },
  pizza: {
    r: 11,
    mass: 3.2,
    value: 0,
    load: 0,
    color: '#c7b3e3',
    light: '#e3d7f2',
    dark: '#8a6fb3',
    name: 'Escudo pizza',
    blurb: 'Cada bomba rompe solo 1 porción',
  },
};

/** How many slices each shield has; a mine breaks only the slice it hits. */
const SHIELD_SLICES: Record<ShieldKind, number> = { shield: 1, pizza: 6 };

const isShield = (k: Kind): k is ShieldKind => k === 'shield' || k === 'pizza';

/**
 * Colors the pizza pickup cycles through (RGB): pink, yellow, green, sky
 * blue, lilac. No white, so it never looks like the plain shield. Ordered so
 * neighbors blend through clean colors (pink → green directly would pass
 * through a muddy gray).
 */
const PIZZA_COLORS: [number, number, number][] = [
  [246, 168, 196],
  [246, 210, 126],
  [159, 224, 180],
  [159, 212, 242],
  [199, 179, 227],
];
const PIZZA_COLOR_SECONDS = 0.55; // per color

/** Order shown on the start screen legend. */
const LEGEND: Kind[] = ['cyan', 'yellow', 'pink', 'mine'];

interface Phase {
  at: number; // seconds into the run
  interval: number; // seconds between spawns
  bag: Partial<Record<Kind, number>>; // spawn mix per 10, dealt shuffled
  title?: string; // banner shown when the phase starts
  intro?: Kind; // new item: spawned first and featured on the banner
  shields?: ShieldKind[]; // shields that may drop at random during the phase
}

/**
 * Pacing: each phase introduces one thing. Spawns are dealt from a shuffled
 * bag so the mix always holds (no droughts, no mine streaks). Shields are
 * rare drops on their own random timer, outside the bag.
 */
const PHASES: Phase[] = [
  { at: 0, interval: 0.8, bag: { cyan: 8, mine: 2 } },
  { at: 15, interval: 0.7, bag: { cyan: 5, yellow: 2, mine: 3 }, title: '¡NUEVA GEMA!', intro: 'yellow' },
  { at: 35, interval: 0.6, bag: { cyan: 4, yellow: 2, pink: 1, mine: 3 }, title: '¡NUEVA GEMA!', intro: 'pink' },
  {
    at: 55,
    interval: 0.5,
    bag: { cyan: 3, yellow: 2, pink: 1, mine: 4 },
    title: '¡NUEVO ESCUDO!',
    intro: 'shield',
    shields: ['shield'],
  },
  {
    at: 80,
    interval: 0.45,
    bag: { cyan: 3, yellow: 2, pink: 1, mine: 4 },
    title: '¡NUEVO ESCUDO!',
    intro: 'pizza',
    shields: ['shield', 'pizza'],
  },
  {
    at: 105,
    interval: 0.36,
    bag: { cyan: 2, yellow: 2, pink: 1, mine: 5 },
    title: '¡CAOS!',
    shields: ['shield', 'pizza'],
  },
];
const SHIELD_DROP_MIN = 10; // seconds between random shield drops
const SHIELD_DROP_MAX = 18;
const MAX_MINE_STREAK = 2;

/** Cash-out multiplier by stored load. Must be steep or cashing early always wins. */
const TIERS = [
  { load: 0, mult: 1, top: '#fffaf3', left: '#efe2d6', right: '#d9c7b8', ink: '#e9e1f2' },
  { load: 5, mult: 2, top: '#e3f3ed', left: '#c2e4d7', right: '#9ccbbb', ink: '#bfe8dc' },
  { load: 10, mult: 3, top: '#bfe6de', left: '#8ecdc0', right: '#62ae9f', ink: '#8fd8c9' },
  { load: 20, mult: 5, top: '#fae4a6', left: '#f0c970', right: '#d6a446', ink: '#f6d27e' },
  { load: 35, mult: 8, top: '#fbc8b4', left: '#f19d82', right: '#d6765c', ink: '#f7a487' },
];

/**
 * Star field, generated once from a fixed seed (not Math.random) so it is the
 * same every run. A few big ones are drawn as four-point sparkles.
 */
const STARS = (() => {
  let s = 20261031;
  const rnd = () => ((s = Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  return Array.from({ length: 110 }, () => ({
    x: rnd() * WIDTH,
    y: rnd() * HEIGHT,
    size: rnd() < 0.05 ? 2.5 + rnd() * 1.2 : 0.6 + rnd() * 1.2,
    phase: rnd() * Math.PI * 2,
    speed: 0.6 + rnd() * 1.8,
  }));
})();

/** Mine reds, lit to deep. Light comes from the upper left, like the gems. */
const MINE_TONES = ['#ff8a80', '#f2565c', '#d23a43', '#a52834'];
const MINE_LIGHT = (-3 * Math.PI) / 4;
const MINE_SPIKES = 8;
const MINE_PERIOD = (Math.PI * 2) / MINE_SPIKES; // the shape repeats every spike
const MINE_FRAMES = 16; // baked rotation steps across one period
const MINE_EXTENT = 20; // logical px from center to sprite edge, halo included

/** 0 = facing the light … 3 = facing away. */
const mineTone = (a: number) => {
  const d = Math.cos(a - MINE_LIGHT);
  return d > 0.5 ? 0 : d > -0.1 ? 1 : d > -0.7 ? 2 : 3;
};

/**
 * Faceted naval mine, flat-shaded: a body cut into facets, pyramid spikes
 * whose lit face is lighter, a round cap, and a faint halo instead of a blur.
 * Shading follows the fixed light while the geometry turns by `rot`.
 */
function drawFacetedMine(g: CanvasRenderingContext2D, rot: number) {
  const r = 11; // matches KINDS.mine.r
  const TAU = Math.PI * 2;
  const poly = (pts: number[][], color: string) => {
    g.fillStyle = color;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
  };

  g.fillStyle = 'rgba(242,86,92,0.14)';
  g.beginPath();
  g.arc(0, 0, r + 8, 0, TAU);
  g.fill();

  for (let i = 0; i < MINE_SPIKES; i++) {
    const a = rot + MINE_PERIOD / 2 + i * MINE_PERIOD;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const base = r - 1;
    const half = 3.4;
    const tip = [c * (base + 6), s * (base + 6)];
    const left = [c * base - s * half, s * base + c * half];
    const right = [c * base + s * half, s * base - c * half];
    const mid = [c * (base - 1), s * (base - 1)];
    const t = mineTone(a);
    poly([mid, left, tip], MINE_TONES[Math.min(3, Math.max(mineTone(a + 0.6), t))]);
    poly([mid, right, tip], MINE_TONES[Math.min(3, Math.max(mineTone(a - 0.6), t))]);
  }

  for (let i = 0; i < MINE_SPIKES; i++) {
    const a0 = rot + i * MINE_PERIOD;
    const a1 = a0 + MINE_PERIOD;
    poly([[0, 0], [Math.cos(a0) * r, Math.sin(a0) * r], [Math.cos(a1) * r, Math.sin(a1) * r]], MINE_TONES[mineTone((a0 + a1) / 2)]);
  }

  // Round cap, split lit / mid along the light.
  const cap = r * 0.42;
  g.fillStyle = MINE_TONES[1];
  g.beginPath();
  g.arc(0, 0, cap, 0, TAU);
  g.fill();
  g.save();
  g.beginPath();
  g.arc(0, 0, cap, 0, TAU);
  g.clip();
  g.rotate(-Math.PI / 4);
  g.fillStyle = MINE_TONES[0];
  g.fillRect(-cap, -cap, cap * 2, cap);
  g.restore();
}

/** Bakes MINE_FRAMES rotation steps of the mine at `px` device pixels per logical px. */
function buildMineSprites(px: number): HTMLCanvasElement[] {
  const size = Math.ceil(MINE_EXTENT * 2 * px);
  return Array.from({ length: MINE_FRAMES }, (_, f) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d')!;
    g.translate(size / 2, size / 2);
    g.scale(px, px);
    drawFacetedMine(g, (f / MINE_FRAMES) * MINE_PERIOD);
    return cv;
  });
}

/** Glow size around a gem, in device px (canvas shadowBlur ignores transforms). */
const gemBlur = (kind: Kind) => 6 + KINDS[kind].load * 3;

/** Half-size of a gem sprite in logical px: the diamond plus room for its glow. */
const gemExtent = (kind: Kind) => Math.ceil(KINDS[kind].r * 1.3 + gemBlur(kind) + 2);

/**
 * Bakes one gem: soft glow from the whole silhouette, then flat facets on top.
 * The blur is paid once here instead of every frame.
 */
function buildGemSprite(kind: Kind, px: number): HTMLCanvasElement {
  const k = KINDS[kind];
  const r = k.r;
  const e = gemExtent(kind);
  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.ceil(e * 2 * px);
  const g = cv.getContext('2d')!;
  g.translate(cv.width / 2, cv.height / 2);
  g.scale(px, px);
  const tri = (pts: number[][], color: string) => {
    g.fillStyle = color;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
  };
  g.shadowColor = k.color;
  g.shadowBlur = gemBlur(kind) * px;
  tri([[0, -r * 1.3], [r, 0], [0, r * 1.3], [-r, 0]], k.color);
  g.shadowBlur = 0;
  tri([[0, -r * 1.3], [-r, 0], [0, 0]], k.light);
  tri([[r, 0], [0, r * 1.3], [0, 0]], k.dark);
  return cv;
}

const CORE_GLOW_R = 64; // baked size; a soft radial glow scales cleanly

/** Radial glow in `color`, fading to nothing at the sprite edge. Drawn scaled behind the core. */
function buildCoreGlow(color: string): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = CORE_GLOW_R * 2;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(CORE_GLOW_R, CORE_GLOW_R, 0, CORE_GLOW_R, CORE_GLOW_R, CORE_GLOW_R);
  grad.addColorStop(0, color);
  grad.addColorStop(0.45, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = 0.55;
  g.fillStyle = grad;
  g.fillRect(0, 0, CORE_GLOW_R * 2, CORE_GLOW_R * 2);
  return cv;
}

/** Particle vortex around the core: cheap (one tiny rect per mote, no blur). */
const VORTEX = {
  count: 48,
  idle: 0.45, // fall cycles per second when not pulling
  pull: 1.2, // … and while the magnet is held
  reach: 58, // px from the core edge where motes appear
  growReach: 30, // extra reach at max core size
  curl: 4.2, // radians a mote turns on its way in
  colors: ['#9b7bff', '#5ad1ff', '#e38bff'],
};

const SKY_MARGIN = 20; // baked past the screen edges so screen shake never shows a seam
const GLOW_R = 128; // baked glow radius; a soft gradient scales up cleanly to the field size

/** Sky gradient + nebulae, painted once at `px` device pixels per logical px. */
function buildSky(px: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = Math.ceil((WIDTH + SKY_MARGIN * 2) * px);
  cv.height = Math.ceil((HEIGHT + SKY_MARGIN * 2) * px);
  const g = cv.getContext('2d')!;
  g.scale(px, px);
  g.translate(SKY_MARGIN, SKY_MARGIN);
  const sky = g.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, '#0c0a1d');
  sky.addColorStop(0.6, '#171233');
  sky.addColorStop(1, '#241a3d');
  g.fillStyle = sky;
  g.fillRect(-SKY_MARGIN, -SKY_MARGIN, WIDTH + SKY_MARGIN * 2, HEIGHT + SKY_MARGIN * 2);
  for (const [x, y, rad, color] of NEBULAE) {
    const n = g.createRadialGradient(x, y, 0, x, y, rad);
    n.addColorStop(0, color);
    n.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = n;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return cv;
}

/** Soft violet glow shown around the core while the magnet is held. */
function buildGlow(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = GLOW_R * 2;
  const g = cv.getContext('2d')!;
  const glow = g.createRadialGradient(GLOW_R, GLOW_R, 0, GLOW_R, GLOW_R, GLOW_R);
  glow.addColorStop(0, 'rgba(170,150,255,0.14)');
  glow.addColorStop(1, 'rgba(170,150,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, GLOW_R * 2, GLOW_R * 2);
  return cv;
}

/** [x, y, radius, inner color]: barely-there haze so the sky isn't flat. */
const NEBULAE: [number, number, number, string][] = [
  [60, 150, 220, 'rgba(90,200,190,0.10)'],
  [310, 520, 260, 'rgba(200,110,200,0.10)'],
];

/** Pentatonic steps so rising notes always sound musical. */
const SCALE = [0, 2, 4, 7, 9];
const note = (step: number) =>
  523.25 * 2 ** ((SCALE[step % SCALE.length] + 12 * Math.floor(step / SCALE.length)) / 12);

/** Mute toggle hit box, top-left corner (only active outside of play). */
const MUTE_BTN = { x: 8, y: 6, w: 40, h: 34 };

interface Body {
  kind: Kind;
  x: number;
  y: number;
  dx: number; // constant drift
  dy: number;
  vx: number; // velocity added by the magnet, decays
  vy: number;
  age: number;
  spin: number;
  danger: boolean; // mine currently inside the near-miss ring
  tilt: number; // gems lean toward where the magnet drags them (radians)
  dead: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  drag: number; // velocity kept per tick; closer to 1 = flies farther
}

interface BurstStyle {
  drag: number;
  life: [number, number]; // seconds, min..max
  size: [number, number];
}

/** Catch sparks stay close to the core; cash-outs fling far so they feel like a payout. */
const SPARKS: BurstStyle = { drag: 0.92, life: [0.3, 0.7], size: [2, 4] };
const PAYOUT: BurstStyle = { drag: 0.965, life: [0.6, 1.1], size: [2.5, 4.5] };

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  life: number;
}

type State = 'ready' | 'playing' | 'over';

/** A finished run on the local board: points, coins, when (ms epoch). */
interface Run {
  p: number;
  m: number;
  t: number;
}

/** Where a run landed: its position, the runs right above and below, and the best before it. */
interface RunResult {
  pos: number;
  total: number;
  above: Run | null;
  below: Run | null;
  prevBest: number;
}

const RUNS_KEY = 'growcore.runs';
const MAX_RUNS = 200; // plenty for a personal board; keeps storage tiny

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Growcore implements MiniGame {
  private state: State = 'ready';
  private bodies: Body[] = [];
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private clock = 0; // seconds since boot, drives animation
  private time = 0; // seconds into the current run
  private spawnTimer = 0;
  private phase = 0;
  private bag: Kind[] = [];
  private sky: HTMLCanvasElement | null = null;
  private glow: HTMLCanvasElement | null = null;
  private skyPx = 0;
  private gemSprites: Partial<Record<Kind, HTMLCanvasElement>> = {};
  private gemSpritePx = 0;
  private coreGlows = new Map<string, HTMLCanvasElement>();
  private mineSprites: HTMLCanvasElement[] = [];
  private mineSpritePx = 0;
  private mineStreak = 0; // consecutive mines dealt so far
  private bannerAt = -99; // clock time the current phase banner appeared
  private shieldTimer = 0; // countdown to the next random shield drop
  private shieldKind: ShieldKind | null = null;
  private slices: boolean[] = []; // which shield slices are still up
  private score = 0;
  private shownScore = 0; // counts up toward score
  private bank = 0; // points stored in the core, not yet cashed
  private load = 0; // what the core is carrying; drives size and tier
  private coreR = T.coreRadius; // drawn/collision radius, eases toward target
  private gems = 0; // gems sitting in the core, not yet cashed
  private lostGems = 0; // what the last death threw away
  private result: RunResult | null = null; // where the last run landed on the local board
  // Every run starts at zero; finished runs go to a local board (see recordRun).
  // Falls back to the pre-rename key so returning players don't see the hint again.
  private cashedOnce = loadNumber('growcore.cashedOnce') === 1 || loadNumber('iman.cashedOnce') === 1;
  private holding = false;
  private holdBlocked = false; // a press that cashed out shouldn't also pull
  private overAt = 0;
  private shake = 0;
  private corePop = 0;
  private holdTime = 0;
  private vortexT = 0; // vortex phase; advances faster while the magnet is held
  private vortexSpeed = VORTEX.idle;
  private hum = new Drone();

  constructor(private ctx: CanvasRenderingContext2D) {
    // Canvas only uses a web font once it has loaded; ask for every weight up front.
    for (const w of [400, 600, 700]) void document.fonts?.load(font(w, 16));
  }

  private get tierIndex() {
    let i = 0;
    while (i + 1 < TIERS.length && this.load >= TIERS[i + 1].load) i++;
    return i;
  }

  /** 0 at base size, 1 at max size. */
  private get growth() {
    return (this.coreR - T.coreRadius) / (T.coreMax - T.coreRadius);
  }

  private get fieldRadius() {
    return T.fieldRadius + T.fieldGrowth * this.growth;
  }

  /** The shield bubble sits just outside the core and grows with it. */
  private get shieldR() {
    return this.coreR + 18;
  }

  /** Which slice covers the direction from the core to (x, y). */
  private sliceAt(x: number, y: number) {
    const n = this.slices.length;
    const a = (Math.atan2(y - CY, x - CX) + Math.PI * 2) % (Math.PI * 2);
    return Math.min(n - 1, Math.floor((a / (Math.PI * 2)) * n));
  }

  /** A mine reached the bubble: true if a standing slice absorbed it. */
  private blockMine(mine: Body) {
    if (!this.shieldKind) return false;
    const i = this.sliceAt(mine.x, mine.y);
    if (!this.slices[i]) return false; // gap: the mine goes through

    this.slices[i] = false;
    const color = '#ffffff';
    this.burst(mine.x, mine.y, C.danger, 18, 200);
    this.burst(mine.x, mine.y, color, 14, 160);
    this.popup(mine.x, mine.y - 14, '¡BLOQUEADA!', C.ink);
    this.shake = 0.15;
    noise(0.25, 0.3, 4000);
    tone({ freq: 1800, to: 600, dur: 0.2, type: 'triangle', gain: 0.12 });
    vibrate(40);
    if (!this.slices.some(Boolean)) this.shieldKind = null;
    return true;
  }

  /** The pizza pickup is one flat color that eases through PIZZA_COLORS in a loop. */
  private pizzaColor(alpha = 1) {
    const t = (this.clock / PIZZA_COLOR_SECONDS) % PIZZA_COLORS.length;
    const i = Math.floor(t);
    const a = PIZZA_COLORS[i];
    const b = PIZZA_COLORS[(i + 1) % PIZZA_COLORS.length];
    const f = t - i;
    const e = f * f * (3 - 2 * f); // smoothstep: linger on each color, glide between
    const mix = (k: number) => Math.round(a[k] + (b[k] - a[k]) * e);
    return `rgba(${mix(0)}, ${mix(1)}, ${mix(2)}, ${alpha})`;
  }

  private targetCoreR() {
    return Math.min(T.coreMax, T.coreRadius + this.load * T.coreGrowth);
  }

  /** Last pointer press, in game coordinates. */
  private pointerInGame() {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((pointer.x - r.left) / r.width) * WIDTH,
      y: ((pointer.y - r.top) / r.height) * HEIGHT,
    };
  }

  private hitMute() {
    const { x, y } = this.pointerInGame();
    const b = MUTE_BTN;
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  }

  private hitCore() {
    const { x, y } = this.pointerInGame();
    return Math.hypot(x - CX, y - CY) <= this.coreR + T.coreTapMargin;
  }

  update(dt: number) {
    this.clock += dt;
    const press = takePress();
    if (!isHolding()) this.holdBlocked = false;

    this.updateFx(dt);
    this.coreR += (this.targetCoreR() - this.coreR) * Math.min(1, dt * 12);
    this.shownScore += (this.score - this.shownScore) * Math.min(1, dt * 8);

    if (this.state === 'playing' && press === 'pointer' && this.load > 0 && this.hitCore()) {
      this.cashOut();
      this.holdBlocked = true;
    }
    this.holding = isHolding() && !this.holdBlocked;

    // Field hum rises in pitch the longer you hold: you hear the greed.
    this.holdTime = this.holding && this.state === 'playing' ? this.holdTime + dt : 0;
    const h = Math.min(this.holdTime, 2.5);
    this.hum.set(this.holdTime > 0 ? 0.05 + h * 0.025 : 0, 65 + h * 45);

    // The vortex speeds up while pulling and eases back on release.
    const vTarget = this.holdTime > 0 ? VORTEX.pull : VORTEX.idle;
    this.vortexSpeed += (vTarget - this.vortexSpeed) * Math.min(1, dt * 4);
    this.vortexT += dt * this.vortexSpeed;

    if (this.state !== 'playing' && press === 'pointer' && this.hitMute()) {
      setMuted(!isMuted());
      return;
    }
    if (this.state === 'ready') {
      if (press) this.start();
      return;
    }
    if (this.state === 'over') {
      // Short lockout so a panicked tap doesn't skip the results.
      if (press && this.clock - this.overAt > 0.6) this.start();
      return;
    }

    this.time += dt;
    const next = PHASES[this.phase + 1];
    if (next && this.time >= next.at) this.enterPhase(this.phase + 1);

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawn(this.nextKind());
      this.spawnTimer = PHASES[this.phase].interval;
    }

    const drops = PHASES[this.phase].shields;
    if (drops) {
      this.shieldTimer -= dt;
      if (this.shieldTimer <= 0) {
        this.spawn(drops[Math.floor(Math.random() * drops.length)]);
        this.shieldTimer = rand(SHIELD_DROP_MIN, SHIELD_DROP_MAX);
      }
    }

    const decay = Math.exp(-T.pullDecay * dt);
    const field = this.fieldRadius;
    const force = T.pullForce * (1 + T.pullGrowth * this.growth);
    for (const b of this.bodies) {
      const k = KINDS[b.kind];
      let ox = CX - b.x;
      let oy = CY - b.y;
      let d = Math.hypot(ox, oy);

      if (this.holding && d < field) {
        // Stronger near the core, so a committed pull finishes the job.
        const a = (force * (1.2 - d / field)) / k.mass;
        b.vx += (ox / d) * a * dt;
        b.vy += (oy / d) * a * dt;
      }
      b.vx *= decay;
      b.vy *= decay;
      b.x += (b.dx + b.vx) * dt;
      b.y += (b.dy + b.vy) * dt;
      b.age += dt;
      b.spin += dt * (b.kind === 'mine' ? 1.2 : 3);
      // Lean into the magnet's sideways pull (drift alone keeps them upright), easing in and out.
      const lean = Math.max(-T.tiltMax, Math.min(T.tiltMax, b.vx / T.tiltSpeed));
      b.tilt += (lean - b.tilt) * Math.min(1, dt * 10);

      ox = CX - b.x;
      oy = CY - b.y;
      d = Math.hypot(ox, oy);

      if (b.kind === 'mine' && d < this.shieldR + k.r && this.blockMine(b)) {
        b.dead = true;
        continue;
      }

      if (d < this.coreR + k.r) {
        b.dead = true;
        if (b.kind === 'mine') return this.gameOver(b);
        this.collect(b);
        continue;
      }

      if (b.kind === 'mine') {
        const inRing = d < this.coreR + k.r + T.nearMissGap;
        if (b.danger && !inRing) {
          this.score += T.nearMissPoints;
          this.popup(b.x, b.y, `¡CERCA! +${T.nearMissPoints}`, C.gold);
          tone({ freq: 900, to: 300, dur: 0.25, type: 'triangle', gain: 0.15 });
          tone({ freq: 1320, dur: 0.15, gain: 0.1, delay: 0.08 });
          vibrate(15);
        }
        b.danger = inRing;
      }

      const out = b.x < -40 || b.x > WIDTH + 40 || b.y < -40 || b.y > HEIGHT + 40;
      if (out && b.age > 2) b.dead = true;
    }
    this.bodies = this.bodies.filter((b) => !b.dead);
  }

  private start() {
    this.state = 'playing';
    this.bodies = [];
    this.time = 0;
    this.spawnTimer = 0.3;
    this.score = 0;
    this.shownScore = 0;
    this.bank = 0;
    this.load = 0;
    this.gems = 0;
    this.lostGems = 0;
    this.result = null;
    this.phase = 0;
    this.bag = [];
    this.mineStreak = 0;
    this.bannerAt = -99;
    this.shieldTimer = rand(SHIELD_DROP_MIN, SHIELD_DROP_MAX);
    this.shieldKind = null;
    this.slices = [];
    tone({ freq: 220, to: 660, dur: 0.18, type: 'triangle', gain: 0.15 });
  }

  private enterPhase(i: number) {
    const p = PHASES[i];
    this.phase = i;
    // New item goes first so it shows up while the banner is on screen.
    this.bag = p.intro ? [p.intro] : [];
    this.spawnTimer = Math.min(this.spawnTimer, 0.4);
    // A shield intro is this phase's first drop; random drops follow after.
    if (p.intro && isShield(p.intro)) this.shieldTimer = rand(SHIELD_DROP_MIN, SHIELD_DROP_MAX);
    this.bannerAt = this.clock;
    [0, 2, 4, 7].forEach((s, j) => tone({ freq: note(s + 3), dur: 0.18, type: 'square', gain: 0.07, delay: j * 0.08 }));
    vibrate(25);
  }

  /** The current phase's mix, shuffled. */
  private freshBag(): Kind[] {
    const bag: Kind[] = [];
    for (const [kind, n] of Object.entries(PHASES[this.phase].bag) as [Kind, number][]) {
      for (let i = 0; i < n; i++) bag.push(kind);
    }
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
  }

  /** Deals the next kind from the bag, never more than MAX_MINE_STREAK mines in a row. */
  private nextKind(): Kind {
    if (this.bag.length === 0) this.bag = this.freshBag();
    if (this.mineStreak >= MAX_MINE_STREAK && this.bag[0] === 'mine') {
      // Swap in the first gem; if the bag is all mines, borrow from the next one.
      let i = this.bag.findIndex((k) => k !== 'mine');
      if (i < 0) {
        this.bag.push(...this.freshBag());
        i = this.bag.findIndex((k) => k !== 'mine');
      }
      [this.bag[0], this.bag[i]] = [this.bag[i], this.bag[0]];
    }
    const kind = this.bag.shift()!;
    this.mineStreak = kind === 'mine' ? this.mineStreak + 1 : 0;
    return kind;
  }

  private spawn(kind: Kind) {
    // Enter from a random edge, just off screen.
    const side = Math.floor(Math.random() * 4);
    const x = side === 0 ? -20 : side === 1 ? WIDTH + 20 : rand(0, WIDTH);
    const y = side === 2 ? -20 : side === 3 ? HEIGHT + 20 : rand(0, HEIGHT);

    // Aim past the core so nothing reaches it without the player's input.
    const toCore = Math.atan2(CY - y, CX - x);
    const dist = Math.hypot(CX - x, CY - y);
    const missMin = Math.max(T.missMin, this.coreR + 45);
    const miss = rand(missMin, Math.max(missMin, T.missMax));
    const ang = toCore + Math.asin(Math.min(1, miss / dist)) * (Math.random() < 0.5 ? -1 : 1);
    const speed = Math.min(T.driftCap, rand(T.driftMin, T.driftMax) + this.time * T.driftRamp);

    this.bodies.push({
      kind,
      x,
      y,
      dx: Math.cos(ang) * speed,
      dy: Math.sin(ang) * speed,
      vx: 0,
      vy: 0,
      age: 0,
      spin: Math.random() * Math.PI * 2,
      danger: false,
      tilt: 0,
      dead: false,
    });
  }

  private collect(b: Body) {
    const k = KINDS[b.kind];
    if (isShield(b.kind)) {
      // A new shield replaces the current one, fully intact.
      this.shieldKind = b.kind;
      this.slices = new Array(SHIELD_SLICES[b.kind]).fill(true);
      this.corePop = 1;
      this.burst(CX, CY, k.color, 30, 180);
      this.popup(CX, CY - this.shieldR - 14, `¡${k.name.toUpperCase()}!`, k.light, 18);
      [0, 4, 7, 12].forEach((s, i) => tone({ freq: note(s), dur: 0.25, type: 'sine', gain: 0.14, delay: i * 0.06 }));
      vibrate(20);
      return;
    }
    const tierBefore = this.tierIndex;
    this.bank += k.value;
    this.gems++;
    this.load += k.load;
    this.corePop = 1;
    this.burst(CX, CY, k.color, 8 * k.load, 140);
    this.popup(CX + rand(-24, 24), CY - this.coreR - 10, `+${k.value}`, k.light, 12 + k.load * 2);

    // Notes climb with the load: the higher the pitch, the more you risk.
    const step = Math.min(this.load, 24);
    if (b.kind === 'pink') {
      tone({ freq: note(step), dur: 0.35, type: 'triangle', gain: 0.18 });
      tone({ freq: note(step + 2), dur: 0.35, type: 'triangle', gain: 0.12, delay: 0.06 });
      tone({ freq: note(step + 4), dur: 0.35, type: 'triangle', gain: 0.1, delay: 0.12 });
      vibrate(15);
    } else if (b.kind === 'yellow') {
      tone({ freq: note(step), dur: 0.22, type: 'triangle', gain: 0.17 });
      tone({ freq: note(step + 2), dur: 0.22, type: 'triangle', gain: 0.1, delay: 0.05 });
    } else {
      tone({ freq: note(step), dur: 0.14, type: 'triangle', gain: 0.16 });
    }

    if (this.tierIndex > tierBefore) {
      const tier = TIERS[this.tierIndex];
      this.popup(CX, CY - this.targetCoreR() - 16, `x${tier.mult}`, tier.ink, 22);
      [0, 2, 4].forEach((s, i) =>
        tone({ freq: note(step + s + 2), dur: 0.12, type: 'square', gain: 0.06, delay: 0.05 + i * 0.05 }),
      );
    }
  }

  private cashOut() {
    const ti = this.tierIndex;
    const tier = TIERS[ti];
    const pts = this.bank * tier.mult;
    this.score += pts;
    this.burst(CX, CY, tier.left, 12 + this.load * 2, 300 + this.load * 10, PAYOUT);
    this.burst(CX, CY, '#ffffff', 10, 200, PAYOUT);
    this.popup(CX, CY - this.coreR - 24, `+${pts}`, tier.ink, 20 + ti * 4);
    this.corePop = 1;
    this.shake = 0.04 * ti;

    // Bigger cash-outs get a longer, higher arpeggio.
    for (let i = 0; i <= ti + 1; i++) {
      tone({ freq: note(i * 2 + ti * 2), dur: 0.2, type: 'triangle', gain: 0.14, delay: i * 0.05 });
    }
    tone({ freq: 110, to: 55, dur: 0.25, type: 'sine', gain: 0.3 });
    vibrate(20 + ti * 15);

    this.bank = 0;
    this.load = 0;
    this.gems = 0;
    if (!this.cashedOnce) {
      this.cashedOnce = true;
      saveNumber('growcore.cashedOnce', 1);
    }
  }

  private gameOver(mine: Body) {
    this.state = 'over';
    this.overAt = this.clock;
    this.shake = 0.5;
    this.lostGems = this.gems;
    this.burst(mine.x, mine.y, C.danger, 40, 260);
    this.burst(CX, CY, '#ffffff', 20 + this.load * 2, 180);
    this.bodies = this.bodies.filter((b) => !b.dead);
    this.bank = 0;
    this.load = 0;
    this.gems = 0;
    this.recordRun();
    noise(0.6, 0.5, 2000);
    tone({ freq: 160, to: 40, dur: 0.5, type: 'sine', gain: 0.4 });
    vibrate([60, 40, 120]);
  }

  /** Saves this run to the local board (kept best-first) and works out where it landed. */
  private recordRun() {
    const runs = loadJSON<Run[]>(RUNS_KEY, []);
    const prevBest = runs.length ? runs[0].p : 0;
    const me: Run = { p: this.score, m: this.runCoins, t: Date.now() };
    // Ties sort below older runs: to pass a score you have to beat it.
    let i = runs.findIndex((r) => r.p < me.p);
    if (i < 0) i = runs.length;
    runs.splice(i, 0, me);
    this.result = {
      pos: i + 1,
      total: runs.length,
      above: runs[i - 1] ?? null,
      below: runs[i + 1] ?? null,
      prevBest,
    };
    saveJSON(RUNS_KEY, runs.slice(0, MAX_RUNS));
  }

  /** Coins earned this run, derived from score. */
  private get runCoins() {
    return Math.floor(this.score / T.pointsPerCoin);
  }

  private burst(x: number, y: number, color: string, n: number, speed: number, style = SPARKS) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(0.3, 1) * speed;
      const max = rand(...style.life);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: max,
        max,
        size: rand(...style.size),
        color,
        drag: style.drag,
      });
    }
  }

  private popup(x: number, y: number, text: string, color: string, size = 16) {
    this.popups.push({ x, y, text, color, size, life: 0.9 });
  }

  private updateFx(dt: number) {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of this.popups) {
      p.y -= 40 * dt;
      p.life -= dt;
    }
    this.popups = this.popups.filter((p) => p.life > 0);
    this.shake = Math.max(0, this.shake - dt);
    this.corePop = Math.max(0, this.corePop - dt * 5);
  }

  render() {
    const { ctx } = this;
    const active = this.holding && this.state === 'playing';

    ctx.save();
    if (this.shake > 0) {
      const s = this.shake * 16;
      ctx.translate(rand(-s, s), rand(-s, s));
    }

    this.drawScenery(active);
    if (this.state !== 'ready') this.drawField(active);

    const field = this.fieldRadius;
    ctx.lineWidth = 1;
    for (const b of this.bodies) {
      if (active && Math.hypot(CX - b.x, CY - b.y) < field) {
        ctx.strokeStyle = b.kind === 'mine' ? 'rgba(255,93,93,0.35)' : 'rgba(200,190,255,0.16)';
        ctx.beginPath();
        ctx.moveTo(CX, CY);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    for (const b of this.bodies) this.drawBody(b);

    for (const p of this.particles) {
      ctx.globalAlpha = p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    if (this.state === 'playing') {
      this.drawVortex();
      this.drawCore(active);
    }

    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    for (const p of this.popups) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.font = font(700, p.size);
      // Dark halo keeps popups legible over stars and glows.
      ctx.strokeStyle = 'rgba(12,10,29,0.75)';
      ctx.lineWidth = 4;
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    this.drawHud();
  }

  /** Night sky: deep indigo gradient, two faint nebulae and twinkling stars. */
  private drawScenery(active: boolean) {
    const { ctx } = this;
    // Full-screen gradients are the priciest thing to paint every frame, so the sky
    // and the magnet glow are baked once per pixel density and just copied.
    const px = ctx.canvas.width / WIDTH;
    if (px !== this.skyPx) {
      this.sky = buildSky(px);
      this.glow = buildGlow();
      this.skyPx = px;
    }
    ctx.drawImage(this.sky!, -SKY_MARGIN, -SKY_MARGIN, WIDTH + SKY_MARGIN * 2, HEIGHT + SKY_MARGIN * 2);

    // Holding the magnet lifts the light around the core a little.
    if (active) {
      const r = this.fieldRadius;
      ctx.drawImage(this.glow!, CX - r, CY - r, r * 2, r * 2);
    }

    ctx.fillStyle = '#ffffff';
    for (const s of STARS) {
      ctx.globalAlpha = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(this.clock * s.speed + s.phase));
      if (s.size < 2.5) {
        ctx.fillRect(s.x, s.y, s.size, s.size);
        continue;
      }
      // Four-point sparkle: two thin diamonds crossed.
      const l = s.size * 2.2;
      const t = s.size * 0.35;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - l);
      ctx.lineTo(s.x + t, s.y);
      ctx.lineTo(s.x, s.y + l);
      ctx.lineTo(s.x - t, s.y);
      ctx.closePath();
      ctx.moveTo(s.x - l, s.y);
      ctx.lineTo(s.x, s.y - t);
      ctx.lineTo(s.x + l, s.y);
      ctx.lineTo(s.x, s.y + t);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Motes of light spiralling into the core (drawn under it, so they vanish as they arrive). */
  private drawVortex() {
    const { ctx } = this;
    const reach = VORTEX.reach + this.growth * VORTEX.growReach;
    for (let i = 0; i < VORTEX.count; i++) {
      const u = (this.vortexT + i / VORTEX.count) % 1; // 0 = outer edge … 1 = swallowed
      const r = this.coreR + 2 + (1 - u) * reach;
      // Golden-angle spread so motes never bunch up, curling tighter as they fall in.
      const a = i * 2.39996 + u * VORTEX.curl + this.vortexT * 0.67;
      ctx.globalAlpha = Math.min(1, u * 4) * Math.min(1, (1 - u) * 5) * 0.9;
      ctx.fillStyle = VORTEX.colors[i % VORTEX.colors.length];
      const s = 1.2 + u * 1.8;
      ctx.fillRect(CX + Math.cos(a) * r - s / 2, CY + Math.sin(a) * r - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  private drawField(active: boolean) {
    const { ctx } = this;
    const field = this.fieldRadius;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 7]);
    ctx.strokeStyle = `rgba(200,190,255,${active ? 0.35 : 0.12})`;
    ctx.beginPath();
    ctx.arc(CX, CY, field, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    if (!active) return;
    // Rings collapsing inward sell the pull.
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const t = (this.clock * 1.6 + i / 3) % 1;
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * t})`;
      ctx.beginPath();
      ctx.arc(CX, CY, (field - this.coreR) * (1 - t) + this.coreR, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawBody(b: Body) {
    this.drawItem(b.kind, b.x, b.y, b.spin, b.tilt);
  }

  /** Round pickups: white bubble, or a pizza bubble tinted with a cycling pastel color. */
  private drawShieldIcon(kind: ShieldKind, x: number, y: number, spin: number) {
    const { ctx } = this;
    const r = KINDS[kind].r;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin);
    // Same translucent bubble for both; the pizza one tints fill and rim with its cycling color.
    const rim = kind === 'shield' ? '#ffffff' : this.pizzaColor();
    ctx.fillStyle = kind === 'shield' ? 'rgba(255,255,255,0.3)' : this.pizzaColor(0.35);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    // Thin rim; a wide faint ring behind it stands in for a glow (no blur).
    ctx.strokeStyle = rim;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.restore();
    // A plain white gem inside, upright like the real gems (unaffected by the bubble's spin).
    const d = r * 0.45;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x, y - d);
    ctx.lineTo(x + d, y);
    ctx.lineTo(x, y + d);
    ctx.lineTo(x - d, y);
    ctx.closePath();
    ctx.fill();
  }

  /** `spin` turns mines and shields; gems ignore it and only lean by `tilt` (radians). */
  private drawItem(kind: Kind, x: number, y: number, spin: number, tilt = 0) {
    if (isShield(kind)) return this.drawShieldIcon(kind, x, y, spin);
    if (kind === 'mine') return this.drawMine(x, y, spin);
    // Gems: baked once per kind (glow included), then just copied, leaning by `tilt`.
    const { ctx } = this;
    const px = ctx.canvas.width / WIDTH;
    if (px !== this.gemSpritePx) {
      this.gemSprites = {};
      this.gemSpritePx = px;
    }
    const sprite = (this.gemSprites[kind] ??= buildGemSprite(kind, px));
    const e = gemExtent(kind);
    if (tilt === 0) {
      ctx.drawImage(sprite, x - e, y - e, e * 2, e * 2);
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.drawImage(sprite, -e, -e, e * 2, e * 2);
    ctx.restore();
  }

  /** Mines: a pre-rendered faceted naval mine, picked by rotation step and copied with a slight pulse. */
  private drawMine(x: number, y: number, spin: number) {
    // Sprites are baked at the canvas's own pixel density, rebuilt only if that changes (resize).
    const px = this.ctx.canvas.width / WIDTH;
    if (px !== this.mineSpritePx) {
      this.mineSprites = buildMineSprites(px);
      this.mineSpritePx = px;
    }
    const t = ((spin % MINE_PERIOD) + MINE_PERIOD) % MINE_PERIOD;
    const sprite = this.mineSprites[Math.floor((t / MINE_PERIOD) * MINE_FRAMES) % MINE_FRAMES];
    const e = MINE_EXTENT * (1 + Math.sin(this.clock * 8 + spin) * 0.05);
    this.ctx.drawImage(sprite, x - e, y - e, e * 2, e * 2);
  }

  /** Active shield: a full bubble, or pizza slices with gaps where mines broke through. */
  private drawShieldBubble() {
    if (!this.shieldKind) return;
    const { ctx } = this;
    const R = this.shieldR + Math.sin(this.clock * 3) * 1.5;
    const n = this.slices.length;
    const gap = n > 1 ? 0.06 : 0;
    ctx.save();
    for (let i = 0; i < n; i++) {
      if (!this.slices[i]) continue;
      // Both bubbles are white on the core; only the pizza pickup cycles colors.
      const a0 = (i / n) * Math.PI * 2 + gap;
      const a1 = ((i + 1) / n) * Math.PI * 2 - gap;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.moveTo(CX, CY);
      ctx.arc(CX, CY, R, a0, a1);
      ctx.closePath();
      ctx.fill();
      // Wide faint stroke behind a crisp one stands in for a glow (no blur).
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.2;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(CX, CY, R, a0, a1);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The core: a pastel orb that glows brighter as it fills, toned by its cash-out tier. */
  private drawCore(active: boolean) {
    const { ctx } = this;
    const ti = this.tierIndex;
    const tier = TIERS[ti];
    const r = this.coreR * (1 + this.corePop * 0.2 + (active ? 0.06 : 0));

    // Glow: a baked radial sprite per color, sized so it reaches past the core (no blur).
    const glowColor = active ? '#b9a8ff' : tier.left;
    let glow = this.coreGlows.get(glowColor);
    if (!glow) this.coreGlows.set(glowColor, (glow = buildCoreGlow(glowColor)));
    const gr = r + 16 + this.growth * 30;
    ctx.drawImage(glow, CX - gr, CY - gr, gr * 2, gr * 2);
    ctx.fillStyle = tier.top;
    ctx.beginPath();
    ctx.arc(CX, CY, r, 0, Math.PI * 2);
    ctx.fill();

    this.drawShieldBubble();
    // Labels under the core clear the shield bubble when there is one.
    const below = this.shieldKind ? 44 : 26;

    // Progress ring toward the next tier; full and pulsing at the top tier.
    const next = TIERS[ti + 1];
    const progress = next ? (this.load - tier.load) / (next.load - tier.load) : 1;
    if (this.load > 0) {
      ctx.strokeStyle = next ? next.ink : tier.ink;
      // Kept translucent: a hint, not something competing with the core.
      ctx.globalAlpha = next ? 0.45 : 0.4 + Math.sin(this.clock * 10) * 0.15;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(CX, CY, r + 6, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.textAlign = 'center';
    if (this.bank > 0) {
      ctx.textBaseline = 'middle';
      ctx.font = font(700, Math.max(11, Math.round(r * 0.72)));
      ctx.fillStyle = C.onPastel;
      ctx.fillText(String(this.bank), CX, CY + 2);
      ctx.textBaseline = 'alphabetic';
      if (tier.mult > 1) {
        ctx.fillStyle = tier.ink;
        ctx.font = font(700, 17);
        ctx.fillText(`x${tier.mult}`, CX, CY + r + below);
      }
    }

    if (!this.cashedOnce && this.load >= TIERS[1].load && this.state === 'playing') {
      ctx.globalAlpha = 0.6 + Math.sin(this.clock * 6) * 0.4;
      ctx.fillStyle = C.gold;
      ctx.font = font(700, 14);
      ctx.fillText('¡TOCÁ EL NÚCLEO!', CX, CY + r + below + 24);
      ctx.globalAlpha = 1;
    }
  }

  /** Speaker drawn with paths (emoji glyphs vary too much across phones). */
  private drawMuteIcon() {
    const { ctx } = this;
    const x = MUTE_BTN.x + 12;
    const y = MUTE_BTN.y + MUTE_BTN.h / 2;
    ctx.save();
    ctx.fillStyle = ctx.strokeStyle = isMuted() ? 'rgba(255,255,255,0.3)' : C.inkSoft;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 4);
    ctx.lineTo(x - 2, y - 4);
    ctx.lineTo(x + 4, y - 9);
    ctx.lineTo(x + 4, y + 9);
    ctx.lineTo(x - 2, y + 4);
    ctx.lineTo(x - 6, y + 4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    if (isMuted()) {
      ctx.moveTo(x + 9, y - 5);
      ctx.lineTo(x + 17, y + 5);
      ctx.moveTo(x + 17, y - 5);
      ctx.lineTo(x + 9, y + 5);
    } else {
      ctx.arc(x + 6, y, 6, -0.9, 0.9);
      ctx.moveTo(x + 6 + 11 * Math.cos(-0.9), y + 11 * Math.sin(-0.9));
      ctx.arc(x + 6, y, 11, -0.9, 0.9);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Wide tracking for headings; quietly ignored where canvas letter-spacing isn't supported. */
  private spaced(px: number) {
    (this.ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px}px`;
  }

  /**
   * Like `greedyWrap`, but evens the lines out: finds the narrowest width that still needs
   * the same number of lines, so no word is left stranded alone on the last line.
   */
  private wrap(text: string, max: number): string[] {
    const lines = this.greedyWrap(text, max);
    if (lines.length < 2) return lines;
    let lo = max / lines.length;
    let hi = max;
    while (hi - lo > 2) {
      const mid = (lo + hi) / 2;
      if (this.greedyWrap(text, mid).length > lines.length) lo = mid;
      else hi = mid;
    }
    return this.greedyWrap(text, hi);
  }

  /** Splits `text` into lines no wider than `max`, using the current ctx font. */
  private greedyWrap(text: string, max: number): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && this.ctx.measureText(next).width > max) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  /** Start screen: rules plus an arcade-style legend that reveals row by row. */
  private drawTitle() {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.fillStyle = C.ink;
    // Shrink the wide-tracked title until it fits, whatever the font metrics on the device.
    let size = 50;
    while (size > 30 && this.measure(TITLE, font(700, size), size * 0.14) > WIDTH - 40) size -= 2;
    ctx.font = font(700, size);
    this.spaced(size * 0.14);
    ctx.fillText(TITLE, CX + size * 0.07, 104);
    this.spaced(0);

    // Rules wrap to the screen width, and the legend starts wherever they end.
    let ry = 142;
    ctx.font = font(400, 15);
    for (const rule of START_RULES) {
      ctx.fillStyle = rule.warn ? C.danger : C.inkSoft;
      for (const line of this.wrap(rule.text, WIDTH - 36)) {
        ctx.fillText(line, CX, ry);
        ry += 21;
      }
    }

    const top = ry + 34;
    const rowH = 46;
    const barX = 196;
    const barW = 64;
    ctx.font = font(600, 11);
    ctx.fillStyle = C.inkSoft;
    this.spaced(2);
    ctx.textAlign = 'left';
    ctx.fillText('PESO', barX, top - 6);
    ctx.textAlign = 'right';
    ctx.fillText('PUNTOS', 332, top - 6);
    this.spaced(0);

    const maxMass = KINDS.mine.mass;
    LEGEND.forEach((kind, i) => {
      const t = this.clock - 0.4 - i * 0.35;
      if (t < 0) return;
      const k = KINDS[kind];
      const y = top + 26 + i * rowH;
      ctx.globalAlpha = Math.min(1, t * 4);

      this.drawItem(kind, 52, y, this.clock * (kind === 'mine' ? 1.2 : 2));

      ctx.textAlign = 'left';
      ctx.fillStyle = C.ink;
      ctx.font = font(600, 16);
      ctx.fillText(k.name, 78, y + 6);

      // Weight bar fills in, so pink visibly lands right next to the mine.
      const fill = (k.mass / maxMass) * Math.min(1, t * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(barX, y - 3, barW, 6);
      ctx.fillStyle = k.color;
      ctx.fillRect(barX, y - 3, barW * fill, 6);

      ctx.textAlign = 'right';
      ctx.font = font(700, kind === 'mine' ? 13 : 19);
      ctx.fillStyle = kind === 'mine' ? C.danger : k.light;
      ctx.fillText(kind === 'mine' ? '¡PERDÉS!' : `+${k.value}`, 332, y + 7);
    });
    ctx.globalAlpha = 1;

    const after = this.clock - 0.4 - LEGEND.length * 0.35;
    if (after > 0) {
      ctx.globalAlpha = Math.min(1, after * 3);
      ctx.textAlign = 'center';
      ctx.fillStyle = C.inkSoft;
      ctx.font = font(400, 14);
      let ty = top + LEGEND.length * rowH + 24;
      for (const tip of START_TIPS) {
        for (const line of this.wrap(tip, WIDTH - 36)) {
          ctx.fillText(line, CX, ty);
          ty += 20;
        }
        ty += 4;
      }
      ctx.globalAlpha = 0.6 + Math.sin(this.clock * 4) * 0.4;
      ctx.fillStyle = C.ink;
      ctx.font = font(700, 18);
      this.spaced(3);
      // Under the tips, but never off the bottom of the screen.
      ctx.fillText('TOCÁ PARA EMPEZAR', CX, Math.min(HEIGHT - 28, Math.max(ty + 30, HEIGHT - 90)));
      this.spaced(0);
      ctx.globalAlpha = 1;
    }
  }

  /** Phase label under the score, plus a banner for ~2.5 s when a phase starts. */
  private drawPhase() {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.fillStyle = C.inkSoft;
    ctx.font = font(600, 12);
    this.spaced(3);
    ctx.fillText(`FASE ${this.phase + 1}`, CX, 96);
    this.spaced(0);

    const p = PHASES[this.phase];
    const t = this.clock - this.bannerAt;
    if (!p.title || t > 2.5) return;
    // Fade in while rising a few px into place, hold, fade out.
    const alpha = Math.min(1, t * 6, (2.5 - t) * 2);
    const rise = Math.max(0, 0.2 - t) * 50;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(CX, 146 + rise);
    this.drawBannerTag(p);
    ctx.restore();
  }

  /** Rounded label with a dark translucent fill, drawn around the banner text. */
  private drawLabel(x: number, y: number, w: number, h: number) {
    const { ctx } = this;
    const r = Math.min(16, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fillStyle = 'rgba(12,10,29,0.62)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** Text pieces shared by every banner style. Shields have no points, so they get a how-it-works line. */
  private bannerText(p: Phase) {
    const k = p.intro ? KINDS[p.intro] : null;
    return {
      k,
      color: k ? k.light : C.danger,
      label: k ? (k.blurb ? k.name : `${k.name}  +${k.value}`) : '',
      blurb: k?.blurb ?? '',
    };
  }

  /** Width of `text` in `f`, honoring letter spacing. */
  private measure(text: string, f: string, spacing = 0) {
    this.ctx.font = f;
    this.spaced(spacing);
    const w = this.ctx.measureText(text).width;
    this.spaced(0);
    return w;
  }

  private drawIcon(kind: Kind, x: number, y: number, scale: number) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    this.drawItem(kind, 0, 0, this.clock * 2);
    ctx.restore();
  }

  /** Phase banner: rounded dark label, small spaced title on top, icon + name + points under it. */
  private drawBannerTag(p: Phase) {
    const { ctx } = this;
    const { k, color, label, blurb } = this.bannerText(p);
    const tf = font(700, 14);
    const lf = font(600, 15);
    const bf = font(400, 12);
    const tw = this.measure(p.title!, tf, 3);
    const lw = k ? this.measure(label, lf) + 26 : 0;
    const bw = blurb ? this.measure(blurb, bf) : 0;
    const w = Math.max(tw, lw, bw) + 36;
    const h = k ? (blurb ? 80 : 60) : 36;
    this.drawLabel(-w / 2, -22, w, h);

    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.font = tf;
    this.spaced(3);
    ctx.fillText(p.title!, 0, k ? 0 : 1);
    this.spaced(0);
    if (!k) return;
    this.drawIcon(p.intro!, -lw / 2 + 8, 19, 0.8);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.ink;
    ctx.font = lf;
    ctx.fillText(label, -lw / 2 + 24, 25);
    if (blurb) {
      ctx.textAlign = 'center';
      ctx.fillStyle = C.inkSoft;
      ctx.font = bf;
      ctx.fillText(blurb, 0, 46);
    }
  }

  private drawHud() {
    const { ctx } = this;
    if (this.state === 'playing') {
      ctx.textAlign = 'right';
      ctx.font = font(700, 15);
      ctx.fillStyle = C.gold;
      ctx.fillText(`● ${this.runCoins}`, WIDTH - 14, 28);
    }
    ctx.textAlign = 'center';

    if (this.state !== 'playing') this.drawMuteIcon();

    if (this.state === 'ready') {
      this.drawTitle();
      return;
    }

    if (this.state === 'playing') {
      ctx.fillStyle = C.ink;
      ctx.font = font(700, 44);
      ctx.fillText(String(Math.round(this.shownScore)), CX, 72);
      this.drawPhase();
    }

    if (this.state === 'over') this.drawResults();
  }

  /**
   * Results: score and coins, then a "ladder" with the run just above, this run and the one
   * just below on the local board, plus how far the next spot was. The near miss is the hook.
   */
  private drawResults() {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(12,10,29,0.72)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.textAlign = 'center';

    if (this.lostGems > 0) {
      ctx.fillStyle = C.danger;
      ctx.font = font(600, 15);
      ctx.fillText(`Perdiste ${this.lostGems} ${this.lostGems === 1 ? 'gema' : 'gemas'}`, CX, 104);
    }
    ctx.fillStyle = C.ink;
    ctx.font = font(700, 72);
    ctx.fillText(String(this.score), CX, 180);
    ctx.fillStyle = C.gold;
    ctx.font = font(700, 18);
    ctx.fillText(`+${this.runCoins} ●`, CX, 214);

    const res = this.result;
    if (res) {
      const rows: { pos: number; run: Run; me: boolean }[] = [];
      if (res.above) rows.push({ pos: res.pos - 1, run: res.above, me: false });
      rows.push({ pos: res.pos, run: { p: this.score, m: this.runCoins, t: 0 }, me: true });
      if (res.below) rows.push({ pos: res.pos + 1, run: res.below, me: false });
      // Keep "this run" in the middle slot even when there's nothing above it.
      let y = res.above ? 262 : 320;
      for (const row of rows) {
        const w = row.me ? 280 : 244;
        const h = row.me ? 50 : 42;
        const x = CX - w / 2;
        this.drawPanel(x, y, w, h, row.me);
        const cy = y + h / 2 + 6;
        ctx.textAlign = 'left';
        ctx.fillStyle = row.me ? T_MINT : C.inkSoft;
        ctx.font = font(700, row.me ? 18 : 14);
        ctx.fillText(`${row.pos}º`, x + 18, cy);
        ctx.fillStyle = row.me ? C.ink : '#d8cfe8';
        ctx.font = font(700, row.me ? 22 : 16);
        ctx.fillText(String(row.run.p), x + 62, cy);
        ctx.textAlign = 'right';
        if (row.me) {
          ctx.fillStyle = T_MINT;
          ctx.font = font(700, 11);
          this.spaced(2);
          ctx.fillText('ESTA PARTIDA', x + w - 16, cy - 1);
          this.spaced(0);
        } else {
          ctx.fillStyle = C.gold;
          ctx.font = font(600, 13);
          ctx.fillText(`${row.run.m} ●`, x + w - 16, cy);
        }
        y += h + 16;
      }

      ctx.textAlign = 'center';
      ctx.font = font(600, 14);
      if (res.total === 1) {
        ctx.fillStyle = C.inkSoft;
        ctx.fillText('Tu primera partida', CX, 460);
      } else if (res.pos === 1) {
        ctx.fillStyle = C.gold;
        ctx.font = font(700, 16);
        this.spaced(2);
        ctx.fillText('¡NUEVO RÉCORD!', CX, 460);
        this.spaced(0);
        if (res.prevBest > 0) {
          ctx.fillStyle = C.inkSoft;
          ctx.font = font(400, 13);
          ctx.fillText(`Superaste tu récord por ${this.score - res.prevBest}`, CX, 488);
        }
      } else {
        const gap = res.above!.p - this.score + 1;
        ctx.fillStyle = C.gold;
        ctx.fillText(`Te faltaron ${gap} ${gap === 1 ? 'punto' : 'puntos'} para el ${res.pos - 1}º`, CX, 460);
        ctx.fillStyle = C.inkSoft;
        ctx.font = font(400, 13);
        ctx.fillText(`Tu récord: ${res.prevBest}`, CX, 488);
      }
    }

    if (this.clock - this.overAt > 0.6) {
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.6 + Math.sin(this.clock * 4) * 0.4;
      ctx.fillStyle = C.ink;
      ctx.font = font(700, 16);
      this.spaced(3);
      ctx.fillText('TOCÁ PARA REINTENTAR', CX, HEIGHT - 40);
      this.spaced(0);
      ctx.globalAlpha = 1;
    }
  }

  /** Rounded row for the results ladder; this run's row is tinted mint. */
  private drawPanel(x: number, y: number, w: number, h: number, highlight: boolean) {
    const { ctx } = this;
    const r = 14;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fillStyle = highlight ? 'rgba(143,216,201,0.18)' : 'rgba(12,10,29,0.62)';
    ctx.fill();
    ctx.strokeStyle = highlight ? 'rgba(143,216,201,0.6)' : 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
