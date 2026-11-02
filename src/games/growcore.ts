import { isMuted, setMuted, Shimmer, vibrate } from '../engine/audio';
import { isHolding, pointer, takePress } from '../engine/input';
import { ambient, music } from '../engine/music';
import { loadJSON, loadNumber, saveJSON, saveNumber } from '../engine/storage';
import { AMBIENT, DRIVE, LEVEL_BY_PHASE, loseStinger, zeroPointsFx } from './growcore-music';
import * as sfx from './growcore-sfx';
import { HEIGHT, VIEW, WIDTH, toGame, type MiniGame } from './MiniGame';

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
  { text: 'Mantené para atraer.' },
  { text: 'Tocá el núcleo para liberar la carga.' },
  { text: '¡Cuidado con las bombas!', warn: true },
];
/** Coins are still earned and saved, just not shown until there is something to spend them on. */
const SHOW_COINS = false;
const START_TIPS =['Más pesado, más puntos.', 'Más carga, más multiplicador.'];
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
  // Cash-out shockwave: a ring leaves the core edge and shoves everything it passes outward.
  waveReach: 50, // how far past the core edge it pushes, smallest core
  waveReachGrowth: 250, // extra reach at max core size
  waveImpulse: 100, // px/s given to a mass-1 item touching the core edge, smallest core
  waveImpulseGrowth: 1250, // extra px/s at max core size
  waveCurve: 2, // impulse grows with size^this: a gentle nudge until the core gets big
  waveSpeed: 700, // px/s the ring travels
};

type ShieldKind = 'shield' | 'pizza';
type FakeKind = 'fakeCyan' | 'fakeYellow' | 'fakePink';
type StarKind = 'starCyan';
type Kind = 'cyan' | 'yellow' | 'pink' | 'mine' | ShieldKind | FakeKind | StarKind;

/**
 * Extra mass of a fake gem over the real gem it imitates. 0 = arrives exactly as fast as the
 * real one, so only its red look gives it away; raise it toward the bomb (3.4) to let speed
 * betray fakes too.
 */
const FAKE_MASS_EXTRA = 0;

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
  hue?: string; // color word shown after the name on the phase banner
  blurb?: string; // banner line instead of "+value"
}

/** Shared look of the fake gems: the bomb's reds on a jagged crystal shape. */
const FAKE_LOOK = {
  value: 0,
  load: 0,
  color: '#f2565c',
  light: '#ff8a80',
  dark: '#a52834',
  name: 'Cristal falso',
  blurb: 'Rojos: son bombas disfrazadas',
};

/**
 * Risk ladder: heavier gems answer the pull slower and pay more. Pink sits
 * just under the mine's mass, so pulling one in means holding long enough
 * to drag a mine too. Shields are lighter so they are worth chasing: the plain one sits between
 * citrine and rhodonite, the super one a bit heavier.
 */
const KINDS: Record<Kind, KindDef> = {
  cyan: { r: 7, mass: 1, value: 1, load: 1, color: '#7fcabc', light: '#b2e6dc', dark: '#4f9e91', name: 'Celestina', hue: 'Celeste' },
  yellow: { r: 9, mass: 2, value: 5, load: 2, color: '#ecc56a', light: '#f8e1a0', dark: '#c4922f', name: 'Citrino', hue: 'Amarillo' },
  pink: { r: 11, mass: 3, value: 15, load: 3, color: '#e894a8', light: '#f6bfcb', dark: '#c4637c', name: 'Rodonita', hue: 'Rosa' },
  mine: { r: 11, mass: 3.4, value: 0, load: 0, color: '#f2565c', light: '#ff8a80', dark: '#a52834', name: 'Bomba' },
  shield: {
    r: 11,
    mass: 2.2,
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
    mass: 2.7,
    value: 0,
    load: 0,
    color: '#c7b3e3',
    light: '#e3d7f2',
    dark: '#8a6fb3',
    name: 'Super Escudo',
    blurb: 'Cada bomba rompe solo 1 porción',
  },
  // Fake gems: bombs in disguise, each the size (and by default the weight) of a real gem.
  fakeCyan: { ...FAKE_LOOK, r: 7, mass: 1 + FAKE_MASS_EXTRA },
  fakeYellow: { ...FAKE_LOOK, r: 9, mass: 2 + FAKE_MASS_EXTRA },
  fakePink: { ...FAKE_LOOK, r: 11, mass: 3 + FAKE_MASS_EXTRA },
  // Bonus stars: a star of the gem's color in a bubble, as heavy as the plain shield.
  starCyan: {
    r: 11,
    mass: 2.2,
    value: 0,
    load: 0,
    color: '#7fcabc',
    light: '#b2e6dc',
    dark: '#4f9e91',
    name: 'Estrella',
    hue: 'Celeste',
    blurb: 'Las bombas se vuelven cristales',
  },
};

/** What each bonus star turns the deadly items into, and what pours in during its frenzy. */
const STAR_GEM: Record<StarKind, Kind> = { starCyan: 'cyan' };
/** After a star: this long with only its gems coming in, faster than normal spawns. */
const FRENZY = { time: 5, interval: 0.18 };

/** How many slices each shield has; a mine breaks only the slice it hits. */
const SHIELD_SLICES: Record<ShieldKind, number> = { shield: 1, pizza: 6 };

const isShield = (k: Kind): k is ShieldKind => k === 'shield' || k === 'pizza';
const isFake = (k: Kind): k is FakeKind => k === 'fakeCyan' || k === 'fakeYellow' || k === 'fakePink';
const isStar = (k: Kind): k is StarKind => k in STAR_GEM;
/** Touching the core with one of these ends the run (shields block them all the same). */
const isDeadly = (k: Kind) => k === 'mine' || isFake(k);

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
  stars?: StarKind[]; // bonus stars that may drop at random during the phase
}

/**
 * Pacing: each phase introduces one thing. Spawns are dealt from a shuffled
 * bag so the mix always holds (no droughts, no mine streaks). Shields and
 * bonus stars are rare drops on their own random timers, outside the bag.
 */
const PHASES: Phase[] = [
  { at: 0, interval: 0.8, bag: { cyan: 8, mine: 2 } },
  { at: 15, interval: 0.7, bag: { cyan: 5, yellow: 2, mine: 3 }, title: '¡NUEVO CRISTAL!', intro: 'yellow' },
  // The first bonus: an easy, early reward that teaches the frenzy before the pressure builds.
  {
    at: 25,
    interval: 0.7,
    bag: { cyan: 5, yellow: 2, mine: 3 },
    title: '¡NUEVO BONUS!',
    intro: 'starCyan',
    stars: ['starCyan'],
  },
  // The plain shield comes before rhodonite: it weighs between citrine and rhodonite, and the
  // first protection lands just before the riskiest catch shows up.
  {
    at: 35,
    interval: 0.6,
    bag: { cyan: 4, yellow: 2, mine: 4 },
    title: '¡NUEVO ESCUDO!',
    intro: 'shield',
    shields: ['shield'],
    stars: ['starCyan'],
  },
  {
    at: 55,
    interval: 0.5,
    bag: { cyan: 3, yellow: 2, pink: 1, mine: 4 },
    title: '¡NUEVO CRISTAL!',
    intro: 'pink',
    shields: ['shield'],
    stars: ['starCyan'],
  },
  {
    at: 80,
    interval: 0.45,
    bag: { cyan: 3, yellow: 2, pink: 1, mine: 4 },
    title: '¡NUEVO ESCUDO!',
    intro: 'pizza',
    shields: ['shield', 'pizza'],
    stars: ['starCyan'],
  },
  {
    at: 105,
    interval: 0.36,
    bag: { cyan: 2, yellow: 2, pink: 1, mine: 5 },
    title: '¡CAOS!',
    shields: ['shield', 'pizza'],
    stars: ['starCyan'],
  },
  // Fake gems, one size per phase, heaviest first. Only the first one gets a banner (it has to
  // explain the idea); after that the phase number just ticks up and the new fake leads in.
  // Bombs give way to fakes so the deadly share stays at 5 in 10.
  {
    at: 135,
    interval: 0.36,
    bag: { cyan: 2, yellow: 2, pink: 1, mine: 4, fakePink: 1 },
    title: '¡CRISTALES FALSOS!',
    intro: 'fakePink',
    shields: ['shield', 'pizza'],
    stars: ['starCyan'],
  },
  {
    at: 160,
    interval: 0.36,
    bag: { cyan: 2, yellow: 2, pink: 1, mine: 3, fakePink: 1, fakeYellow: 1 },
    intro: 'fakeYellow',
    shields: ['shield', 'pizza'],
    stars: ['starCyan'],
  },
  {
    at: 185,
    interval: 0.36,
    bag: { cyan: 2, yellow: 2, pink: 1, mine: 2, fakePink: 1, fakeYellow: 1, fakeCyan: 1 },
    intro: 'fakeCyan',
    shields: ['shield', 'pizza'],
    stars: ['starCyan'],
  },
];
const SHIELD_DROP_MIN = 10; // seconds between random shield drops
const SHIELD_DROP_MAX = 18;
const STAR_DROP_MIN = 20; // seconds between random bonus star drops
const STAR_DROP_MAX = 30;
const DROP_GAP = 3; // a star and a shield never drop closer together than this (s)
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
 * Star field, generated once from a fixed seed (not Math.random) so it is the same every run.
 * Stars sit on a disc around the core (x, y relative to it) because the whole field slowly turns:
 * a disc keeps the screen corners covered at any angle. A few big ones are four-point sparkles.
 */
const STAR_FIELD_R = 720; // covers the corners of tall phones and wide desktop windows alike
const STAR_SPIN = (Math.PI * 2) / 240; // rad/s: one full turn every 4 minutes
const STAR_SPIN_PULL = 40; // holding the magnet spins the sky up to this many times faster...
const STAR_SPIN_RAMP = 4; // ...reached after holding this long (s): the longer the hold, the faster
const STAR_SPIN_UP = 3; // how closely the spin follows that ramp while holding (1/s)
const STAR_SPIN_DOWN = 0.8; // and coasts back down after release, slower, like a heavy wheel
const STARS = (() => {
  let s = 20261031;
  const rnd = () => ((s = Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  // Same density as the original 110 stars over the 360×640 play area.
  const count = Math.round((110 / (WIDTH * HEIGHT)) * Math.PI * STAR_FIELD_R ** 2);
  return Array.from({ length: count }, () => {
    const r = STAR_FIELD_R * Math.sqrt(rnd()); // sqrt: uniform over the disc, not bunched in the middle
    const a = rnd() * Math.PI * 2;
    return {
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      size: rnd() < 0.05 ? 2.5 + rnd() * 1.2 : 0.6 + rnd() * 1.2,
      phase: rnd() * Math.PI * 2,
      speed: 0.6 + rnd() * 1.8,
    };
  });
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

/**
 * Glow size around a gem, in device px (canvas shadowBlur ignores transforms). Fakes carry no
 * load, so they glow by size instead (r 7/9/11 → like a load of 1/2/3).
 */
const gemBlur = (kind: Kind) => 6 + (isFake(kind) ? (KINDS[kind].r - 5) / 2 : KINDS[kind].load) * 3;

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
  if (isFake(kind)) {
    // Jagged crystal (the "cursed gem"): 8 points of alternating length, as tall as a real gem,
    // flat-shaded facet by facet with the light from the upper left.
    const reach = [1.3, 0.76, 1.07, 0.69];
    const pts = Array.from({ length: 8 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 4;
      const rr = reach[i % 4] * r;
      return [Math.cos(a) * rr, Math.sin(a) * rr];
    });
    tri(pts, k.color);
    g.shadowBlur = 0;
    for (let i = 0; i < 8; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % 8];
      const facing = Math.cos(Math.atan2(p[1] + q[1], p[0] + q[0]) + (3 * Math.PI) / 4);
      tri([[0, 0], p, q], facing > 0.4 ? k.light : facing < -0.4 ? k.dark : k.color);
    }
    return cv;
  }
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
  fallIdle: 0.12, // fall cycles per second when not touching
  fallPull: 1.4, // … at a full hold
  openTime: 2.5, // seconds of holding to open all the way (same as the hum's peak)
  reachIdle: 20, // px from the core edge where motes appear when closed: well past the progress ring (+6)
  reachOpen: 64, // … when fully open
  growReach: 24, // extra open reach at max core size
  curl: 2.2, // extra radians a mote turns as it falls in (keeps a spiral shape)
  // Spin has inertia: it spins up with effort and coasts down slowly, like a top.
  spinIdle: 0.6, // rad/s at the core's edge when idle
  spinMax: 6.5, // … at a full hold
  spinUp: 3.6, // how quickly spin catches up when speeding up (1/s)
  spinDown: 0.6, // … when slowing down: lower = longer coast
  // Inner motes orbit faster than outer ones (like water down a drain): ω ∝ (edge / r)^shear.
  shear: 1.3,
};

const SKY_MARGIN = 20; // baked past the screen edges so screen shake never shows a seam
const SPAWN_REACH = 90; // farthest outside the play area that gems and bombs enter from
const GLOW_R = 128; // baked glow radius; a soft gradient scales up cleanly to the field size

/**
 * Sky gradient + nebulae for the whole visible screen (VIEW, plus a margin for screen shake),
 * painted once and rebuilt only when the window or pixel density changes.
 */
function buildSky(): HTMLCanvasElement {
  const { x0, y0, w, h, px } = VIEW;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil((w + SKY_MARGIN * 2) * px);
  cv.height = Math.ceil((h + SKY_MARGIN * 2) * px);
  const g = cv.getContext('2d')!;
  g.scale(px, px);
  g.translate(SKY_MARGIN - x0, SKY_MARGIN - y0);
  // The gradient spans the full screen height, so tall phones get the whole dusk-to-night fade.
  const sky = g.createLinearGradient(0, y0, 0, y0 + h);
  sky.addColorStop(0, '#0c0a1d');
  sky.addColorStop(0.6, '#171233');
  sky.addColorStop(1, '#241a3d');
  g.fillStyle = sky;
  g.fillRect(x0 - SKY_MARGIN, y0 - SKY_MARGIN, w + SKY_MARGIN * 2, h + SKY_MARGIN * 2);
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

/** Mute toggle hit box, top-left corner (only active outside of play); y is from hudTop. */
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
  wave: number; // id of the last shockwave that pushed it, so each wave hits it once
  dead: boolean;
}

/** A cash-out shockwave: starts at the core edge (r0) and pushes out to r0 + reach. */
interface Wave {
  id: number;
  at: number; // clock time it left the core
  r0: number;
  reach: number;
  impulse: number;
  color: string;
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
  fall?: number; // downward acceleration (px/s²), for confetti
}

interface BurstStyle {
  drag: number;
  life: [number, number]; // seconds, min..max
  size: [number, number];
}

/**
 * Results screen timeline, in seconds after death. Short on purpose: the whole screen
 * settles in ~1.3 s, and a tap retries from 0.6 s on even mid-animation.
 */
const RES = {
  veil: 0.3, // dark veil fades in over this long
  lost: 0.12, // "Perdiste N cristales" drops in
  countStart: 0.2, // score counts up …
  countEnd: 0.75, // … and pops
  coinsStart: 0.55,
  coinsEnd: 0.9,
  rows: 0.85, // ladder rows start sliding in
  rowStep: 0.09, // stagger between rows
  rowDur: 0.28,
  msg: 1.12, // "Te faltaron…" / record stamp
  retry: 1.25, // retry prompt fades in
};

/** Start screen timeline, in seconds after the font is ready. Same feel as RES, ~1.6 s total. */
const INTRO = {
  letters: 0.05, // title letters start dropping in …
  letterStep: 0.05, // … one after another …
  letterDur: 0.35, // … each landing with a small overshoot
  rules: 0.55, // rule lines rise in
  ruleStep: 0.1,
  ruleDur: 0.3,
  legend: 0.85, // legend rows slide in (header fades just before)
  rowStep: 0.09,
  rowDur: 0.28,
  tips: 1.35,
  prompt: 1.5, // "TOCÁ PARA EMPEZAR" fades in, then pulses
};

/**
 * The core powers on at the start of a run like an old TV switching off, played backwards into
 * a bang (seconds after the start tap): the screen goes white and squashes from top and bottom
 * into a thin line across the middle, the line shrinks from the sides into a point, the point
 * holds a beat, and then it bursts open into the core like a small big bang, springing past its
 * size and settling, while the vortex motes fly out of it to their orbits.
 */
const BOOT = {
  squash: 0.12, // white screen → a line across the middle
  shrink: 0.18, // line → a point
  hold: 0.1, // the point waits a beat
  lineWidth: 2, // thickness of the line, and the point's diameter is 3 times it
  grow: 0.6, // the bang: the point bursts into the core, wobbling to rest
  motesStagger: 0.12, // the last mote leaves the center this long after the first
  ring: 1, // the bang's ring of light runs out to the field line, thinning and braking softly
  fuse: 0.25, // then melts into the dotted line, which only appears now
};
const BOOT_BANG = BOOT.squash + BOOT.shrink + BOOT.hold;
const BOOT_END = BOOT_BANG + BOOT.grow;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/**
 * A damped spring released from 0 toward 1, `t` seconds in: overshoots and wobbles to rest.
 * `w` is its stiffness (angular frequency), `z` its damping (lower = bouncier).
 */
const spring = (t: number, w = 16, z = 0.3) => {
  if (t <= 0) return 0;
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
};
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
/** Overshoots a little before settling: things "land". */
const easeOutBack = (x: number) => 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2;
/** Brief scale kick after an event: 0.18 at the moment, fading to 0 over 0.3 s. */
const pop = (since: number) => (since >= 0 && since < 0.3 ? 0.18 * (1 - since / 0.3) : 0);

/** Catch sparks stay close to the core; cash-outs fling far so they feel like a payout. */
const SPARKS: BurstStyle = { drag: 0.92, life: [0.3, 0.7], size: [2, 4] };
const PAYOUT: BurstStyle = { drag: 0.965, life: [0.6, 1.1], size: [2.5, 4.5] };

/** Floating texts ("+5", "¡CERCA!", "¡ESCUDO!"…) draw at this fraction of their given size. */
const POPUP_SCALE = 0.85;

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  life: number;
}

/** 'splash' waits for the first tap, which is what lets the browser play sound (see enter). */
type State = 'splash' | 'ready' | 'playing' | 'over';

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
/** Bump to wipe every device's local board (points and coins) once, on its next load. */
const BOARD_VERSION = 1;
const BOARD_VERSION_KEY = 'growcore.boardVersion';

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Growcore implements MiniGame {
  // Muted players get nothing from the splash, so they skip straight to the title.
  private state: State = isMuted() ? 'ready' : 'splash';
  private bodies: Body[] = [];
  private particles: Particle[] = [];
  private uiParticles: Particle[] = []; // results-screen sparks/confetti, drawn above the veil
  private resultsFx = { lastTick: 0, score: false, coins: false, msg: false }; // beats already fired
  private popups: Popup[] = [];
  private clock = 0; // seconds since boot, drives animation
  private time = 0; // seconds into the current run
  private spawnTimer = 0;
  private phase = 0;
  private bag: Kind[] = [];
  private sky: HTMLCanvasElement | null = null;
  private glow: HTMLCanvasElement | null = null;
  private skyKey = ''; // px and size the baked sky was built for
  private gemSprites: Partial<Record<Kind, HTMLCanvasElement>> = {};
  private gemSpritePx = 0;
  private coreGlows = new Map<string, HTMLCanvasElement>();
  private mineSprites: HTMLCanvasElement[] = [];
  private mineSpritePx = 0;
  private mineStreak = 0; // consecutive deadly items (bombs, fakes) dealt so far
  private introNext: Kind | null = null; // a phase's new item, dealt before anything else
  private bannerAt = -99; // clock time the current phase banner appeared
  private shieldTimer = 0; // countdown to the next random shield drop
  private starTimer = 0; // countdown to the next random bonus star drop
  private frenzyAt = -99; // when the last bonus star was caught (clock)
  private frenzyGem: Kind = 'cyan'; // what pours in during that frenzy
  private shieldKind: ShieldKind | null = null;
  private slices: boolean[] = []; // which shield slices are still up
  private wave: Wave = { id: 0, at: -99, r0: 0, reach: 0, impulse: 0, color: '' };
  private score = 0;
  private shownScore = 0; // counts up toward score
  private bank = 0; // points stored in the core, not yet cashed
  private load = 0; // what the core is carrying; drives size and tier
  private coreR = T.coreRadius; // drawn/collision radius, eases toward target
  private gems = 0; // gems sitting in the core, not yet cashed
  private lostGems = 0; // what the last death threw away
  private bestBefore = 0; // best score on the board when this run started (0 = no runs yet)
  private recordAt = -1; // clock time this run passed bestBefore, or -1
  private result: RunResult | null = null; // where the last run landed on the local board
  // Every run starts at zero; finished runs go to a local board (see recordRun).
  // Falls back to the pre-rename key so returning players don't see the hint again.
  private cashedOnce = loadNumber('growcore.cashedOnce') === 1 || loadNumber('iman.cashedOnce') === 1;
  private holding = false;
  private holdBlocked = false; // a press that cashed out (or started the run) shouldn't also pull
  private overAt = 0;
  private startAt = -99; // clock time of the start tap; the core boots up from here (see BOOT)
  private introAt = Infinity; // clock time the start-screen animation began (set once fonts load)
  private fontsReady = false;
  private titleFx = 0; // title letters whose sound already played
  private bedBack = true; // the ambient bed came back up after the last death
  private shake = 0;
  private corePop = 0;
  private holdTime = 0;
  private vortexT = 0; // infall phase; advances faster while the magnet is held
  private vortexOpen = 0; // 0 = snug and slow (idle) … 1 = wide and fast (long hold)
  private vortexSpin = VORTEX.spinIdle; // current spin (rad/s at the core edge), with inertia
  private skyAngle = 0; // the star field's turn
  private skyPull = 0; // 0 → 1: how wound up the sky's spin is by the magnet
  // Each mote's own orbit angle, integrated every tick so inner motes really do lap outer ones.
  private moteAngles = Float32Array.from({ length: VORTEX.count }, (_, i) => i * 2.39996);
  private hum = new Shimmer(sfx.PULL_VOICES);

  constructor(private ctx: CanvasRenderingContext2D) {
    // Canvas only uses a web font once it has loaded; ask for every weight up front, and hold
    // the intro until then (or 1 s at most) so it never plays in a fallback font and then jumps.
    const fonts = Promise.all([400, 600, 700].map((w) => document.fonts?.load(font(w, 16))));
    const ready = () => (this.fontsReady = true);
    void fonts.then(ready, ready);
    setTimeout(ready, 1000);
    if (loadNumber(BOARD_VERSION_KEY) < BOARD_VERSION) {
      saveJSON(RUNS_KEY, []);
      saveNumber(BOARD_VERSION_KEY, BOARD_VERSION);
    }
    // Waits for the first tap to unlock audio (the splash tap, unless muted).
    ambient.play(AMBIENT, { fade: 3 });
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
    sfx.blockSfx();
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
    return toGame(pointer.x, pointer.y);
  }

  /**
   * Where the top HUD row starts. On screens taller than the play area (a phone in full-screen
   * mode) it climbs into the extra space, up to just under the status bar, so the score and
   * buttons sit as close to the top as they do in a browser tab.
   */
  private get hudTop() {
    return Math.min(0, VIEW.y0 + VIEW.safeTop / VIEW.scale);
  }

  private hitMute() {
    const { x, y } = this.pointerInGame();
    const b = MUTE_BTN;
    const top = this.hudTop + b.y;
    return x >= b.x && x <= b.x + b.w && y >= top && y <= top + b.h;
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
    // Passing your best mid-run gets called out once (not on the very first run: nothing to beat).
    if (this.state === 'playing' && this.recordAt < 0 && this.bestBefore > 0 && this.score > this.bestBefore) {
      this.recordAt = this.clock;
      sfx.recordSfx();
      vibrate(25);
    }

    if (this.state === 'playing' && press === 'pointer' && this.load > 0 && this.hitCore()) {
      this.cashOut();
      this.holdBlocked = true;
    }
    this.holding = isHolding() && !this.holdBlocked;
    this.holdTime = this.holding && this.state === 'playing' ? this.holdTime + dt : 0;

    // The sky winds up the longer the magnet pulls and coasts back to its lazy turn after
    // release. Only the speed eases; the angle is integrated, so the stars never jump.
    const pull = Math.min(1, this.holdTime / STAR_SPIN_RAMP);
    this.skyPull += (pull - this.skyPull) * Math.min(1, dt * (pull > this.skyPull ? STAR_SPIN_UP : STAR_SPIN_DOWN));
    this.skyAngle += dt * STAR_SPIN * (1 + (STAR_SPIN_PULL - 1) * this.skyPull);

    // The pull's choir brightens and climbs the longer you hold: you hear the greed.
    const h = Math.min(this.holdTime, 2.5);
    this.hum.set(this.holdTime > 0 ? 0.08 + h * 0.024 : 0, h / 2.5);

    // The vortex opens up and spins faster the longer you hold; on release it closes back
    // in snug against the core and slows to a lazy turn.
    const openTarget = Math.min(1, this.holdTime / VORTEX.openTime);
    const rate = openTarget > this.vortexOpen ? 6 : 2.5; // follow the hold closely, settle gently
    this.vortexOpen += (openTarget - this.vortexOpen) * Math.min(1, dt * rate);
    this.vortexT += dt * (VORTEX.fallIdle + (VORTEX.fallPull - VORTEX.fallIdle) * this.vortexOpen);
    // sqrt: most of the spin-up lands early in the hold, so it answers the finger right away.
    const spinTarget = VORTEX.spinIdle + (VORTEX.spinMax - VORTEX.spinIdle) * Math.sqrt(this.vortexOpen);
    const k = spinTarget > this.vortexSpin ? VORTEX.spinUp : VORTEX.spinDown;
    this.vortexSpin += (spinTarget - this.vortexSpin) * Math.min(1, dt * k);
    const edge = this.coreR + 4;
    for (let i = 0; i < VORTEX.count; i++) {
      const w = this.vortexSpin * (edge / this.moteRadius(i)) ** VORTEX.shear;
      this.moteAngles[i] = (this.moteAngles[i] + w * dt) % (Math.PI * 2);
    }

    if (this.state !== 'playing' && press === 'pointer' && this.hitMute()) {
      setMuted(!isMuted());
      return;
    }
    if (this.state === 'splash') {
      if (press) this.enter();
      return;
    }
    if (this.state === 'ready') {
      if (this.introAt === Infinity && this.fontsReady) this.introAt = this.clock;
      this.updateTitleFx();
      if (press) this.start();
      return;
    }
    if (this.state === 'over') {
      this.updateResultsFx();
      // The bed swells back once the stinger (or the sad trombone, which runs longer) is done.
      if (!this.bedBack && this.clock - this.overAt > (this.score === 0 ? 2.4 : 1.8)) {
        this.bedBack = true;
        ambient.setVolume(1, 2.5);
      }
      // Short lockout so a panicked tap doesn't skip the results; after it, retry is instant
      // even if the results animation is still playing.
      if (press && this.clock - this.overAt > 0.6) this.start();
      return;
    }

    this.time += dt;
    const next = PHASES[this.phase + 1];
    if (next && this.time >= next.at) this.enterPhase(this.phase + 1);

    // During a bonus frenzy only its gems pour in, faster; the bag waits where it was.
    const frenzy = this.frenzyLeft > 0;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawn(frenzy ? this.frenzyGem : this.nextKind());
      this.spawnTimer = frenzy ? FRENZY.interval : PHASES[this.phase].interval;
    }

    const drops = PHASES[this.phase].shields;
    if (drops) {
      this.shieldTimer -= dt;
      if (this.shieldTimer <= 0) {
        this.spawn(drops[Math.floor(Math.random() * drops.length)]);
        this.shieldTimer = rand(SHIELD_DROP_MIN, SHIELD_DROP_MAX);
        this.starTimer = Math.max(this.starTimer, DROP_GAP);
      }
    }
    const stars = PHASES[this.phase].stars;
    if (stars && !frenzy) {
      this.starTimer -= dt;
      if (this.starTimer <= 0) {
        this.spawn(stars[Math.floor(Math.random() * stars.length)]);
        this.starTimer = rand(STAR_DROP_MIN, STAR_DROP_MAX);
        this.shieldTimer = Math.max(this.shieldTimer, DROP_GAP);
      }
    }

    const decay = Math.exp(-T.pullDecay * dt);
    const field = this.fieldRadius;
    const force = T.pullForce * (1 + T.pullGrowth * this.growth);
    const wave = this.wave;
    const front = wave.r0 + (this.clock - wave.at) * T.waveSpeed;
    const waving = front < wave.r0 + wave.reach;
    for (const b of this.bodies) {
      const k = KINDS[b.kind];
      let ox = CX - b.x;
      let oy = CY - b.y;
      let d = Math.hypot(ox, oy);

      // The ring's front reaches the item's edge: a one-off outward kick, the same impulse for
      // everyone, so light gems fly and heavy bombs just budge. It fades out across the reach.
      if (waving && b.wave !== wave.id && d - k.r <= front) {
        b.wave = wave.id;
        const kick = (wave.impulse * Math.max(0, 1 - (d - k.r - wave.r0) / wave.reach)) / k.mass;
        b.vx -= (ox / d) * kick;
        b.vy -= (oy / d) * kick;
      }

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

      if (isDeadly(b.kind) && d < this.shieldR + k.r && this.blockMine(b)) {
        b.dead = true;
        continue;
      }

      if (d < this.coreR + k.r) {
        b.dead = true;
        if (isDeadly(b.kind)) return this.gameOver(b);
        this.collect(b);
        continue;
      }

      if (isDeadly(b.kind)) {
        const inRing = d < this.coreR + k.r + T.nearMissGap;
        if (b.danger && !inRing) {
          this.score += T.nearMissPoints;
          this.popup(b.x, b.y, `¡CERCA! +${T.nearMissPoints}`, C.gold);
          sfx.nearMissSfx();
          vibrate(15);
        }
        b.danger = inRing;
      }

      const v = VIEW;
      const out = b.x < v.x0 - 40 || b.x > v.x0 + v.w + 40 || b.y < v.y0 - 40 || b.y > v.y0 + v.h + 40;
      if (out && b.age > 2) b.dead = true;
    }
    this.bodies = this.bodies.filter((b) => !b.dead);
  }

  /** The splash tap: audio is unlocked by now, so the title can play with sound. */
  private enter() {
    this.state = 'ready';
    sfx.enterSfx();
  }

  /** Each title letter rings as it lands (see INTRO). */
  private updateTitleFx() {
    const t = this.clock - this.introAt;
    while (this.titleFx < TITLE.length && t >= INTRO.letters + this.titleFx * INTRO.letterStep + INTRO.letterDur * 0.4) {
      sfx.titleLetterSfx(this.titleFx++);
    }
  }

  private start() {
    this.state = 'playing';
    this.startAt = this.clock;
    // The tap that starts the run is not a pull: the field waits until the finger lifts.
    this.holdBlocked = true;
    this.holding = false;
    music.level = LEVEL_BY_PHASE[0];
    // The music comes in with the core's big bang (the player starts ~0.05 s late), easing in
    // so the beat doesn't slam in cold.
    music.play(DRIVE, { delay: BOOT_BANG - 0.05, fade: 1.2 });
    // The bed stays, ducked and stripped to a drone, under the in-game loop.
    ambient.level = 1;
    ambient.setVolume(0.35, 1.2);
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
    this.introNext = null;
    this.bannerAt = -99;
    this.shieldTimer = rand(SHIELD_DROP_MIN, SHIELD_DROP_MAX);
    this.starTimer = rand(STAR_DROP_MIN, STAR_DROP_MAX);
    this.frenzyAt = -99;
    this.shieldKind = null;
    this.slices = [];
    this.bestBefore = loadJSON<Run[]>(RUNS_KEY, [])[0]?.p ?? 0;
    this.recordAt = -1;
    sfx.startSfx(BOOT_BANG);
  }

  private enterPhase(i: number) {
    const p = PHASES[i];
    this.phase = i;
    music.level = LEVEL_BY_PHASE[Math.min(i, LEVEL_BY_PHASE.length - 1)];
    // New item goes first so it shows up right away (see nextKind).
    this.introNext = p.intro ?? null;
    this.bag = [];
    this.spawnTimer = Math.min(this.spawnTimer, 0.4);
    // A shield intro is this phase's first drop; random drops follow after.
    if (p.intro && isShield(p.intro)) this.shieldTimer = rand(SHIELD_DROP_MIN, SHIELD_DROP_MAX);
    if (p.intro && isStar(p.intro)) this.starTimer = rand(STAR_DROP_MIN, STAR_DROP_MAX);
    this.bannerAt = this.clock;
    // Fanfare only with a banner: quiet phases just tick the counter up.
    if (p.title) {
      sfx.phaseSfx();
      vibrate(25);
    }
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
    // A phase's new item leads, unless it's deadly right after a full streak: then one safe
    // item goes first and the new one follows on the next spawn.
    const intro = this.introNext;
    if (intro && !(isDeadly(intro) && this.mineStreak >= MAX_MINE_STREAK)) {
      this.introNext = null;
      this.mineStreak = isDeadly(intro) ? this.mineStreak + 1 : 0;
      return intro;
    }
    if (this.bag.length === 0) this.bag = this.freshBag();
    if (this.mineStreak >= MAX_MINE_STREAK && isDeadly(this.bag[0])) {
      // Swap in the first gem; if the bag is all mines, borrow from the next one.
      let i = this.bag.findIndex((k) => !isDeadly(k));
      if (i < 0) {
        this.bag.push(...this.freshBag());
        i = this.bag.findIndex((k) => !isDeadly(k));
      }
      [this.bag[0], this.bag[i]] = [this.bag[i], this.bag[0]];
    }
    const kind = this.bag.shift()!;
    this.mineStreak = isDeadly(kind) ? this.mineStreak + 1 : 0;
    return kind;
  }

  private spawn(kind: Kind) {
    // Enter from a random edge, just off the visible screen; on very wide/tall screens no
    // farther than SPAWN_REACH from the play area (they fade in, so that never pops).
    const v = VIEW;
    const left = Math.max(v.x0, -SPAWN_REACH) - 20;
    const right = Math.min(v.x0 + v.w, WIDTH + SPAWN_REACH) + 20;
    const top = Math.max(v.y0, -SPAWN_REACH) - 20;
    const bottom = Math.min(v.y0 + v.h, HEIGHT + SPAWN_REACH) + 20;
    const side = Math.floor(Math.random() * 4);
    const x = side === 0 ? left : side === 1 ? right : rand(0, WIDTH);
    const y = side === 2 ? top : side === 3 ? bottom : rand(0, HEIGHT);

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
      wave: 0,
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
      sfx.shieldSfx();
      vibrate(20);
      return;
    }
    if (isStar(b.kind)) return this.catchStar(b.kind);
    const tierBefore = this.tierIndex;
    this.bank += k.value;
    this.gems++;
    this.load += k.load;
    this.corePop = 1;
    this.burst(CX, CY, k.color, 8 * k.load, 140);
    this.popup(CX + rand(-24, 24), CY - this.coreR - 10, `+${k.value}`, k.light, 12 + k.load * 2);

    // Notes climb with the load: the higher the pitch, the more you risk. The climb flattens out
    // around 2 kHz; a straight step per load point went past 8 kHz, inaudible on phone speakers.
    const step = Math.round(10 * (1 - Math.exp(-this.load / 14)));
    sfx.catchSfx(b.kind, step);
    if (b.kind === 'pink') vibrate(15);

    if (this.tierIndex > tierBefore) {
      const tier = TIERS[this.tierIndex];
      this.popup(CX, CY - this.targetCoreR() - 16, `x${tier.mult}`, tier.ink, 22);
      sfx.tierUpSfx(step);
    }
  }

  /**
   * A bonus star: every bomb and fake on screen turns into the star's gem where it is, and for
   * FRENZY.time only those gems pour in. Nothing deadly is left, so the player can pull freely.
   */
  private catchStar(kind: StarKind) {
    const gem = STAR_GEM[kind];
    const k = KINDS[gem];
    for (const b of this.bodies) {
      if (b.dead || !isDeadly(b.kind)) continue;
      b.kind = gem;
      b.danger = false;
      this.burst(b.x, b.y, k.light, 6, 90);
    }
    this.frenzyAt = this.clock;
    this.frenzyGem = gem;
    this.spawnTimer = Math.min(this.spawnTimer, FRENZY.interval);
    this.corePop = 1;
    this.burst(CX, CY, k.light, 30, 220);
    this.popup(CX, CY - this.coreR - 18, '¡ESTRELLA!', k.light, 18);
    sfx.starSfx();
    vibrate([20, 30, 20]);
  }

  /** Seconds left of the bonus frenzy (0 when there is none). */
  private get frenzyLeft() {
    return Math.max(0, this.frenzyAt + FRENZY.time - this.clock);
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
    // The blast scales with the core: a big core pushes harder and farther, so it can clear a
    // bomb that was about to hit.
    const g = this.growth;
    this.wave = {
      id: this.wave.id + 1,
      at: this.clock,
      r0: this.coreR,
      reach: T.waveReach + T.waveReachGrowth * g,
      impulse: T.waveImpulse + T.waveImpulseGrowth * g ** T.waveCurve,
      color: tier.left,
    };

    // Bigger cash-outs get a longer, higher cascade.
    sfx.cashOutSfx(ti, g);
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
    this.resultsFx = { lastTick: 0, score: false, coins: false, msg: false };
    this.uiParticles = [];
    sfx.deathSfx();
    vibrate([60, 40, 120]);
    // The music cuts dead; a run with no points at all gets the sad trombone instead of the stinger.
    // The bed drops out too, and swells back with its chords once the results have settled.
    music.stop(0.04);
    if (this.score === 0) zeroPointsFx();
    else loseStinger();
    ambient.level = 0;
    ambient.setVolume(0, 0.1);
    this.bedBack = false;
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
    for (const list of [this.particles, this.uiParticles]) {
      for (const p of list) {
        p.vy += (p.fall ?? 0) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= p.drag;
        p.vy *= p.drag;
        p.life -= dt;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    this.uiParticles = this.uiParticles.filter((p) => p.life > 0);
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
    if (this.state === 'playing' || this.state === 'over') this.drawField(active);
    if (this.state === 'playing') {
      this.drawWave();
      this.drawBootRing();
    }

    const field = this.fieldRadius;
    ctx.lineWidth = 1;
    for (const b of this.bodies) {
      if (active && Math.hypot(CX - b.x, CY - b.y) < field) {
        ctx.strokeStyle = isDeadly(b.kind) ? 'rgba(255,93,93,0.35)' : 'rgba(200,190,255,0.16)';
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
      if (this.clock - this.startAt < BOOT_END) this.drawBoot();
      else {
        this.drawVortex();
        this.drawCore(active);
      }
    }

    ctx.textAlign = 'center';
    for (const p of this.popups) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.font = font(700, Math.round(p.size * POPUP_SCALE));
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    this.drawHud();

    if (this.state === 'playing' && this.clock - this.startAt < BOOT_BANG) this.drawPowerOn();
  }

  /**
   * The old-TV part of the boot, over everything (HUD included): a white screen squashing into
   * a line, the line shrinking into a point, the point holding (see BOOT). Each move speeds up
   * as it goes, like the picture is being sucked in.
   */
  private drawPowerOn() {
    const { ctx } = this;
    const t = this.clock - this.startAt;
    const v = VIEW;
    const line = BOOT.lineWidth;
    ctx.fillStyle = C.white;
    if (t < BOOT.squash) {
      const u = t / BOOT.squash;
      const h = line + (v.h - line) * (1 - u * u);
      ctx.fillRect(v.x0, CY - h / 2, v.w, h);
      return;
    }
    if (t < BOOT.squash + BOOT.shrink) {
      const u = (t - BOOT.squash) / BOOT.shrink;
      const w = v.w * (1 - u * u);
      ctx.fillRect(CX - w / 2, CY - line / 2, w, line);
    }
    ctx.beginPath();
    ctx.arc(CX, CY, line * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Night sky: deep indigo gradient, two faint nebulae and twinkling stars. */
  private drawScenery(active: boolean) {
    const { ctx } = this;
    // Full-screen gradients are the priciest thing to paint every frame, so the sky
    // and the magnet glow are baked once per pixel density and just copied.
    const v = VIEW;
    const key = `${v.px}|${v.w}|${v.h}`;
    if (key !== this.skyKey) {
      this.sky = buildSky();
      this.glow ??= buildGlow();
      this.skyKey = key;
    }
    ctx.drawImage(this.sky!, v.x0 - SKY_MARGIN, v.y0 - SKY_MARGIN, v.w + SKY_MARGIN * 2, v.h + SKY_MARGIN * 2);

    // A bonus frenzy tints the whole sky its gem's color, easing in and fading over its last second.
    const frenzy = this.state === 'playing' ? Math.min(1, (this.clock - this.frenzyAt) / 0.3, this.frenzyLeft) : 0;
    if (frenzy > 0) {
      ctx.globalAlpha = frenzy * 0.12;
      ctx.fillStyle = KINDS[this.frenzyGem].color;
      ctx.fillRect(v.x0, v.y0, v.w, v.h);
      ctx.globalAlpha = 1;
    }

    // Holding the magnet lifts the light around the core a little.
    if (active) {
      const r = this.fieldRadius;
      ctx.drawImage(this.glow!, CX - r, CY - r, r * 2, r * 2);
    }

    // The star field turns slowly around the core. Positions are rotated by hand (two multiplies
    // per star) so off-screen stars can be skipped and sparkles stay upright.
    ctx.fillStyle = '#ffffff';
    const x1 = v.x0 + v.w;
    const y1 = v.y0 + v.h;
    const cos = Math.cos(this.skyAngle);
    const sin = Math.sin(this.skyAngle);
    for (const s of STARS) {
      const x = CX + s.x * cos - s.y * sin;
      const y = CY + s.x * sin + s.y * cos;
      if (x < v.x0 - 8 || x > x1 + 8 || y < v.y0 - 8 || y > y1 + 8) continue; // off-screen
      ctx.globalAlpha = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(this.clock * s.speed + s.phase));
      if (s.size < 2.5) {
        ctx.fillRect(x, y, s.size, s.size);
        continue;
      }
      // Four-point sparkle: two thin diamonds crossed.
      const l = s.size * 2.2;
      const t = s.size * 0.35;
      ctx.beginPath();
      ctx.moveTo(x, y - l);
      ctx.lineTo(x + t, y);
      ctx.lineTo(x, y + l);
      ctx.lineTo(x - t, y);
      ctx.closePath();
      ctx.moveTo(x - l, y);
      ctx.lineTo(x, y - t);
      ctx.lineTo(x + l, y);
      ctx.lineTo(x, y + t);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Motes of light spiralling into the core (drawn under it, so they vanish as they arrive). */
  /** How far through its fall mote `i` is: 0 = just appeared at the outer edge … 1 = swallowed. */
  private moteFall(i: number) {
    return (this.vortexT + i / VORTEX.count) % 1;
  }

  /** Distance of mote `i` from the core's center. */
  private moteRadius(i: number) {
    const reach = VORTEX.reachIdle + (VORTEX.reachOpen + this.growth * VORTEX.growReach - VORTEX.reachIdle) * this.vortexOpen;
    return this.coreR + 2 + (1 - this.moteFall(i)) * reach;
  }

  /** `booting`: seconds since the core started growing; motes spring out of its center. */
  private drawVortex(booting = Infinity) {
    const { ctx } = this;
    // Motes wear the core's own tier colors (its fill, glow and shade), so they read as part of it.
    const tier = TIERS[this.tierIndex];
    const colors = [tier.top, tier.left, tier.top, tier.right];
    for (let i = 0; i < VORTEX.count; i++) {
      const u = this.moteFall(i);
      const out = booting < BOOT_END ? spring(booting - (i / VORTEX.count) * BOOT.motesStagger, 22, 0.35) : 1;
      const r = this.moteRadius(i) * out;
      // Orbit angle comes from the physics; the curl term keeps a spiral as motes fall in.
      const a = this.moteAngles[i] + u * VORTEX.curl;
      ctx.globalAlpha = Math.min(1, u * 4) * Math.min(1, (1 - u) * 5) * 0.9;
      ctx.fillStyle = colors[i % colors.length];
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
    // At the start, the line only shows up once the bang's ring has reached it (see drawBoot).
    const born = clamp01((this.clock - this.startAt - BOOT_BANG - BOOT.ring) / BOOT.fuse);
    if (this.state === 'playing' && born === 0) {
      ctx.restore();
      return;
    }
    ctx.strokeStyle = `rgba(200,190,255,${(active ? 0.35 : 0.12) * (this.state === 'playing' ? born : 1)})`;
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

  /** The cash-out shockwave: a bright ring that thins and fades as it runs out of reach. */
  private drawWave() {
    const { ctx } = this;
    const w = this.wave;
    const t = ((this.clock - w.at) * T.waveSpeed) / w.reach;
    if (t >= 1) return;
    const r = w.r0 + t * w.reach;
    const fade = 1 - t * t;
    ctx.strokeStyle = w.color;
    // A wide faint band trailing the front stands in for a glow (no blur).
    ctx.globalAlpha = fade * 0.3;
    ctx.lineWidth = 16 * (1 - t) + 3;
    ctx.beginPath();
    ctx.arc(CX, CY, Math.max(w.r0, r - 7), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = fade;
    ctx.lineWidth = 5 * (1 - t) + 1.5;
    ctx.beginPath();
    ctx.arc(CX, CY, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawBody(b: Body) {
    // Quick fade-in, so items entering inside a wide screen's visible margin don't pop.
    if (b.age < 0.25) this.ctx.globalAlpha = b.age / 0.25;
    this.drawItem(b.kind, b.x, b.y, b.spin, b.tilt);
    this.ctx.globalAlpha = 1;
  }

  /** Round pickups: white bubble, or a pizza bubble tinted with a cycling pastel color. */
  private drawShieldIcon(kind: ShieldKind, x: number, y: number) {
    const { ctx } = this;
    const r = KINDS[kind].r;
    // Same translucent bubble for both; the pizza one tints fill and rim with its cycling color.
    if (kind === 'shield') this.drawBubble(x, y, r, 'rgba(255,255,255,0.3)', '#ffffff');
    else this.drawBubble(x, y, r, this.pizzaColor(0.35), this.pizzaColor());
    // A plain white gem inside, upright like the real gems.
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

  /** The pickups' bubble: translucent fill and a thin rim, with a wide faint ring behind it for glow (no blur). */
  private drawBubble(x: number, y: number, r: number, fill: string, rim: string) {
    const { ctx } = this;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    const alpha = ctx.globalAlpha;
    ctx.strokeStyle = rim;
    ctx.globalAlpha = alpha * 0.18;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }

  /** Bonus star pickup: a bubble in the gem's color with a slowly turning five-point star inside. */
  private drawStarIcon(kind: StarKind, x: number, y: number, spin: number) {
    const { ctx } = this;
    const k = KINDS[kind];
    this.drawBubble(x, y, k.r, `${k.color}55`, k.light);
    const outer = k.r * 0.62;
    const inner = outer * 0.45;
    ctx.fillStyle = k.light;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = spin * 0.4 - Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? inner : outer;
      if (i) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  /** `spin` turns mines and stars; gems ignore it and only lean by `tilt` (radians). */
  private drawItem(kind: Kind, x: number, y: number, spin: number, tilt = 0) {
    if (isShield(kind)) return this.drawShieldIcon(kind, x, y);
    if (isStar(kind)) return this.drawStarIcon(kind, x, y, spin);
    if (kind === 'mine') return this.drawMine(x, y, spin);
    // Gems: baked once per kind (glow included), then just copied, leaning by `tilt`.
    const { ctx } = this;
    const px = VIEW.px;
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
    const px = VIEW.px;
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
      // Same thin rim as the pickup bubbles, with a wide faint stroke behind it for glow (no blur).
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(CX, CY, R, a0, a1);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.3;
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

  /**
   * The bang (see BOOT): the point bursts open into the core, white-hot at first and cooling
   * to its own color, and the vortex motes fly out of its center to their orbits. Stiff
   * springs, so it opens all at once and then wobbles. Before it, drawPowerOn shows the point.
   */
  private drawBoot() {
    const { ctx } = this;
    const tg = this.clock - this.startAt - BOOT_BANG;
    if (tg < 0) return;
    const s = Math.max((BOOT.lineWidth * 1.5) / this.coreR, spring(tg, 30, 0.3));
    this.drawVortex(tg);
    ctx.save();
    ctx.translate(CX, CY);
    ctx.scale(s, s);
    ctx.translate(-CX, -CY);
    this.drawCore(false);
    ctx.restore();
    ctx.globalAlpha = clamp01(1 - tg / 0.3) ** 2;
    ctx.fillStyle = C.white;
    ctx.beginPath();
    ctx.arc(CX, CY, this.coreR * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /**
   * A ring of light flung out by the bang. It slows into the field line, thinning and dimming
   * down to that line's look, then melts into it as the dotted line appears (see drawField).
   * Outlives the rest of the boot, so it has time for a long, soft brake.
   */
  private drawBootRing() {
    const tg = this.clock - this.startAt - BOOT_BANG;
    if (tg < 0 || tg > BOOT.ring + BOOT.fuse) return;
    const { ctx } = this;
    const ring = clamp01(tg / BOOT.ring);
    const fuse = clamp01((tg - BOOT.ring) / BOOT.fuse);
    ctx.globalAlpha = (0.12 + 0.68 * (1 - ring) ** 2) * (1 - fuse);
    ctx.strokeStyle = ring < 1 ? C.white : 'rgb(200,190,255)';
    ctx.lineWidth = 3.5 * (1 - ring) + 1.5;
    ctx.beginPath();
    // Quartic ease-out: quick off the core, then it glides in slower and slower.
    ctx.arc(CX, CY, this.coreR + (1 - (1 - ring) ** 4) * (this.fieldRadius - this.coreR), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Speaker drawn with paths (emoji glyphs vary too much across phones). */
  private drawMuteIcon() {
    const { ctx } = this;
    const x = MUTE_BTN.x + 12;
    const y = this.hudTop + MUTE_BTN.y + MUTE_BTN.h / 2;
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

  /**
   * Start screen, animated in the same language as the results screen (see INTRO): title
   * letters drop in, rules rise in, legend rows slide in from alternating
   * sides and pop their points, then the tips and the pulsing prompt. Tapping starts at any time.
   */
  private drawTitle() {
    const { ctx } = this;
    const t = this.clock - this.introAt;
    const beat = (start: number, dur: number) => clamp01((t - start) / dur);

    // Title: letters drop in one by one with a small overshoot (no extra pop at the end).
    // Shrink the wide-tracked title until it fits, whatever the font metrics on the device.
    let size = 50;
    while (size > 30 && this.measure(TITLE, font(700, size), size * 0.14) > WIDTH - 40) size -= 2;
    const titleFont = font(700, size);
    const spacing = size * 0.14;
    const titleW = this.measure(TITLE, titleFont, spacing);
    ctx.save();
    ctx.translate(CX, 90);
    ctx.font = titleFont;
    ctx.fillStyle = C.ink;
    ctx.textAlign = 'left';
    for (let i = 0; i < TITLE.length; i++) {
      const p = beat(INTRO.letters + i * INTRO.letterStep, INTRO.letterDur);
      if (p <= 0) continue;
      const x = -titleW / 2 + spacing / 2 + this.measure(TITLE.slice(0, i), titleFont, spacing);
      ctx.globalAlpha = Math.min(1, p * 2);
      ctx.font = titleFont;
      ctx.fillText(TITLE[i], x, 14 - (1 - easeOutBack(p)) * 26);
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // Rules rise in, one line after another. They wrap, and the legend starts where they end.
    let ry = 160;
    let line = 0;
    ctx.textAlign = 'center';
    ctx.font = font(400, 16);
    for (const rule of START_RULES) {
      for (const text of this.wrap(rule.text, WIDTH - 36)) {
        const p = beat(INTRO.rules + line * INTRO.ruleStep, INTRO.ruleDur);
        if (p > 0) {
          ctx.globalAlpha = p;
          ctx.fillStyle = rule.warn ? C.danger : C.inkSoft;
          ctx.fillText(text, CX, ry + (1 - easeOutCubic(p)) * 10);
        }
        ry += 26;
        line++;
      }
    }
    ctx.globalAlpha = 1;

    // Legend block sized to its content (icon · name · weight bar · points) and centered.
    const pointsLabel = (kind: Kind) => (kind === 'mine' ? '¡PERDÉS!' : `+${KINDS[kind].value}`);
    const pointsFont = (kind: Kind) => font(700, kind === 'mine' ? 13 : 19);
    const nameW = Math.max(...LEGEND.map((kind) => this.measure(KINDS[kind].name, font(600, 16))));
    const pointsW = Math.max(...LEGEND.map((kind) => this.measure(pointsLabel(kind), pointsFont(kind))));
    const iconCol = 32;
    const barW = 64;
    const blockW = iconCol + 8 + nameW + 18 + barW + 16 + pointsW;
    // Center what the eye sees: the icons' solid bodies (~12 px radius; the bomb's faint halo
    // doesn't read as an edge) on the left, the end of the points text on the right.
    const iconHalf = 12;
    const inset = iconCol / 2 - iconHalf; // blank space inside the icon column, left of the bodies
    const left = CX - (blockW - inset) / 2 - inset;
    const nameOff = iconCol + 8;
    const barOff = nameOff + nameW + 18;

    const top = ry + 40;
    const rowH = 50;
    ctx.globalAlpha = beat(INTRO.legend - 0.12, 0.2);
    ctx.font = font(600, 11);
    ctx.fillStyle = C.inkSoft;
    this.spaced(2);
    ctx.textAlign = 'left';
    ctx.fillText('PESO', left + barOff, top - 6);
    ctx.textAlign = 'right';
    ctx.fillText('PUNTOS', left + blockW, top - 6);
    this.spaced(0);
    ctx.globalAlpha = 1;

    const maxMass = KINDS.mine.mass;
    LEGEND.forEach((kind, i) => {
      // Rows slide in from alternating sides, like the results ladder.
      const start = INTRO.legend + i * INTRO.rowStep;
      const p = beat(start, INTRO.rowDur);
      if (p <= 0) return;
      const k = KINDS[kind];
      const y = top + 24 + i * rowH;
      const x0 = left + (1 - easeOutBack(p)) * (i % 2 ? 70 : -70);
      ctx.globalAlpha = p;

      this.drawItem(kind, x0 + iconCol / 2, y, this.clock * (kind === 'mine' ? 1.2 : 2));

      ctx.textAlign = 'left';
      ctx.fillStyle = C.ink;
      ctx.font = font(600, 16);
      ctx.fillText(k.name, x0 + nameOff, y + 6);

      // Weight bar fills once the row has landed, so pink visibly ends up right next to the bomb.
      const fill = (k.mass / maxMass) * easeOutCubic(beat(start + INTRO.rowDur * 0.6, 0.35));
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x0 + barOff, y - 3, barW, 6);
      ctx.fillStyle = k.color;
      ctx.fillRect(x0 + barOff, y - 3, barW * fill, 6);

      // Points pop as the row lands.
      const s = 1 + pop(t - start - INTRO.rowDur);
      ctx.save();
      ctx.translate(x0 + blockW, y);
      ctx.scale(s, s);
      ctx.textAlign = 'right';
      ctx.font = pointsFont(kind);
      ctx.fillStyle = kind === 'mine' ? C.danger : k.light;
      ctx.fillText(pointsLabel(kind), 0, 7);
      ctx.restore();
    });
    ctx.globalAlpha = 1;

    // Tips rise in, then the prompt fades in and keeps pulsing.
    ctx.textAlign = 'center';
    ctx.font = font(400, 14);
    let ty = top + LEGEND.length * rowH + 30;
    let tip = 0;
    for (const text of START_TIPS) {
      for (const l of this.wrap(text, WIDTH - 36)) {
        const p = beat(INTRO.tips + tip * 0.08, 0.3);
        if (p > 0) {
          ctx.globalAlpha = p;
          ctx.fillStyle = C.inkSoft;
          ctx.fillText(l, CX, ty + (1 - easeOutCubic(p)) * 8);
        }
        ty += 22;
        tip++;
      }
    }
    const prompt = beat(INTRO.prompt, 0.3);
    if (prompt > 0) {
      ctx.globalAlpha = prompt * (0.6 + Math.sin(this.clock * 4) * 0.4);
      ctx.fillStyle = C.ink;
      ctx.font = font(700, 18);
      this.spaced(3);
      // Under the tips, but never off the bottom of the screen.
      ctx.fillText('TOCÁ PARA EMPEZAR', CX, Math.min(HEIGHT - 28, Math.max(ty + 30, HEIGHT - 90)));
      this.spaced(0);
    }
    ctx.globalAlpha = 1;
  }


  /** Phase label under the score, plus a banner for ~2.5 s when a phase starts. */
  private drawPhase() {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.fillStyle = C.inkSoft;
    ctx.font = font(600, 12);
    this.spaced(3);
    ctx.fillText(`FASE ${this.phase + 1}`, CX, this.hudTop + 86);
    this.spaced(0);

    const p = PHASES[this.phase];
    const t = this.clock - this.bannerAt;
    if (!p.title || t > 2.5) return;
    // Fade in while rising a few px into place, hold, fade out.
    const alpha = Math.min(1, t * 6, (2.5 - t) * 2);
    const rise = Math.max(0, 0.2 - t) * 50;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(CX, this.hudTop + 126 + rise);
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

  /**
   * Text pieces shared by every banner style: name, then the crystal's color word (tinted) and
   * points. Shields and fakes have no points, so they get a how-it-works line instead.
   */
  private bannerText(p: Phase) {
    const k = p.intro ? KINDS[p.intro] : null;
    return {
      k,
      color: k ? k.light : C.danger,
      name: k ? (k.hue ? `${k.name} ` : k.name) : '',
      hue: k?.hue ? `${k.hue}  ` : '',
      points: k && !k.blurb ? `+${k.value}` : '',
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
    const { k, color, name, hue, points, blurb } = this.bannerText(p);
    const tf = font(700, 12);
    const lf = font(600, 15);
    const bf = font(400, 12);
    const tw = this.measure(p.title!, tf, 3);
    const nameW = this.measure(name, lf);
    const hueW = this.measure(hue, lf);
    const lw = k ? nameW + hueW + this.measure(points, lf) + 26 : 0;
    const bw = blurb ? this.measure(blurb, bf) : 0;
    const w = Math.max(tw, lw, bw) + 36;
    const h = k ? (blurb ? 80 : 60) : 36;
    this.drawLabel(-w / 2, -22, w, h);

    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.font = tf;
    this.spaced(3);
    ctx.fillText(p.title!, 0, k ? -1 : 1);
    this.spaced(0);
    if (!k) return;
    this.drawIcon(p.intro!, -lw / 2 + 8, 19, 0.8);
    ctx.textAlign = 'left';
    ctx.font = lf;
    const x = -lw / 2 + 24;
    ctx.fillStyle = C.ink;
    ctx.fillText(name, x, 25);
    ctx.fillStyle = color;
    ctx.fillText(hue, x + nameW, 25);
    ctx.fillStyle = C.ink;
    ctx.fillText(points, x + nameW + hueW, 25);
    if (blurb) {
      ctx.textAlign = 'center';
      ctx.fillStyle = C.inkSoft;
      ctx.font = bf;
      ctx.fillText(blurb, 0, 46);
    }
  }

  private drawHud() {
    const { ctx } = this;
    const top = this.hudTop;
    ctx.textAlign = 'center';
    if (this.state === 'splash') this.drawSplash();
    if (this.state === 'ready') this.drawTitle();
    if (this.state === 'playing') {
      if (SHOW_COINS) {
        ctx.textAlign = 'right';
        ctx.font = font(700, 15);
        ctx.fillStyle = C.gold;
        ctx.fillText(`● ${this.runCoins}`, WIDTH - 14, top + 26);
        ctx.textAlign = 'center';
      }
      ctx.fillStyle = C.ink;
      ctx.font = font(700, 44);
      ctx.fillText(String(Math.round(this.shownScore)), CX, top + 62);
      if (this.recordAt >= 0) this.drawRecordTag();
      this.drawPhase();
    }
    if (this.state === 'over') this.drawResults();
    // Last, so the results veil never dims it.
    if (this.state !== 'playing') this.drawMuteIcon();
  }

  /** First screen: just the sky and a pulsing prompt. Its tap is what turns the sound on. */
  private drawSplash() {
    const { ctx } = this;
    ctx.globalAlpha = Math.min(1, this.clock * 2) * (0.6 + Math.sin(this.clock * 3) * 0.4);
    ctx.fillStyle = C.ink;
    ctx.font = font(700, 18);
    this.spaced(3);
    ctx.fillText('TOCÁ PARA ENTRAR', CX, CY + 6);
    this.spaced(0);
    ctx.globalAlpha = 1;
  }

  /** "RÉCORD ALCANZADO" above the score: pops in when the run passes the best, then stays. */
  private drawRecordTag() {
    const { ctx } = this;
    const t = this.clock - this.recordAt;
    const s = 1 + pop(t) * 2;
    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 5);
    ctx.translate(CX, this.hudTop + 19);
    ctx.scale(s, s);
    ctx.textAlign = 'center';
    ctx.fillStyle = C.gold;
    ctx.font = font(700, 11);
    this.spaced(2.5);
    ctx.fillText('RÉCORD ALCANZADO', 0, 0);
    this.spaced(0);
    ctx.restore();
  }

  /**
   * Results: score and coins, then a "ladder" with the run just above, this run and the one
   * just below on the local board, plus how far the next spot was. The near miss is the hook.
   */
  private drawResults() {
    const { ctx } = this;
    const t = this.clock - this.overAt;
    // Each beat eases in on its own slot of the timeline (see RES); everything settles in ~1.3 s.
    const beat = (start: number, dur: number) => clamp01((t - start) / dur);

    ctx.fillStyle = `rgba(12,10,29,${0.72 * easeOutCubic(beat(0, RES.veil))})`;
    ctx.fillRect(VIEW.x0, VIEW.y0, VIEW.w, VIEW.h);
    ctx.textAlign = 'center';

    if (this.lostGems > 0) {
      const a = beat(RES.lost, 0.2);
      ctx.globalAlpha = a;
      ctx.fillStyle = C.danger;
      ctx.font = font(600, 15);
      const drop = (1 - easeOutCubic(a)) * -12;
      ctx.fillText(`Perdiste ${this.lostGems} ${this.lostGems === 1 ? 'cristal' : 'cristales'}`, CX, 104 + drop);
      ctx.globalAlpha = 1;
    }

    // Score counts up fast, then pops; coins follow the same way.
    const shownScore = Math.round(this.score * easeOutCubic(beat(RES.countStart, RES.countEnd - RES.countStart)));
    ctx.globalAlpha = beat(RES.lost, 0.15);
    this.drawPopped(String(shownScore), font(700, 72), C.ink, 180, 26, pop(t - RES.countEnd));
    if (SHOW_COINS) {
      const shownCoins = Math.round(this.runCoins * easeOutCubic(beat(RES.coinsStart, RES.coinsEnd - RES.coinsStart)));
      ctx.globalAlpha = beat(RES.coinsStart, 0.12);
      this.drawPopped(`+${shownCoins} ●`, font(700, 18), C.gold, 214, 6, pop(t - RES.coinsEnd));
    }
    ctx.globalAlpha = 1;

    const res = this.result;
    if (res) {
      const rows: { pos: number; run: Run; me: boolean }[] = [];
      if (res.above) rows.push({ pos: res.pos - 1, run: res.above, me: false });
      rows.push({ pos: res.pos, run: { p: this.score, m: this.runCoins, t: 0 }, me: true });
      if (res.below) rows.push({ pos: res.pos + 1, run: res.below, me: false });
      // Keep "this run" in the middle slot even when there's nothing above it.
      let y = res.above ? 262 : 320;
      for (const [j, row] of rows.entries()) {
        const w = row.me ? 280 : 244;
        const h = row.me ? 50 : 42;
        // Rows slide in one after another, alternating sides; this run's row lands with a bounce.
        const p = beat(RES.rows + j * RES.rowStep, RES.rowDur);
        if (p <= 0) {
          y += h + 16;
          continue;
        }
        const slide = (1 - easeOutBack(p)) * (j % 2 ? 70 : -70);
        const x = CX - w / 2 + slide;
        ctx.save();
        ctx.globalAlpha = p;
        if (row.me) {
          const s = 1 + pop(t - RES.rows - j * RES.rowStep - RES.rowDur) * 0.5;
          ctx.translate(CX, y + h / 2);
          ctx.scale(s, s);
          ctx.translate(-CX, -(y + h / 2));
        }
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
        } else if (SHOW_COINS) {
          ctx.fillStyle = C.gold;
          ctx.font = font(600, 13);
          ctx.fillText(`${row.run.m} ●`, x + w - 16, cy);
        }
        ctx.restore();
        y += h + 16;
      }

      const m = beat(RES.msg, 0.25);
      if (m > 0) {
        ctx.textAlign = 'center';
        ctx.globalAlpha = m;
        const rise = (1 - easeOutCubic(m)) * 10;
        ctx.font = font(600, 14);
        if (res.total === 1) {
          ctx.fillStyle = C.inkSoft;
          ctx.fillText('Tu primera partida', CX, 460 + rise);
        } else if (res.pos === 1) {
          // Record: the line drops in like a stamp.
          const s = 1 + (1 - easeOutBack(m)) * 0.9;
          ctx.save();
          ctx.translate(CX, 454);
          ctx.scale(s, s);
          ctx.fillStyle = C.gold;
          ctx.font = font(700, 18);
          this.spaced(2);
          ctx.fillText('¡NUEVO RÉCORD!', 0, 6);
          this.spaced(0);
          ctx.restore();
          if (res.prevBest > 0) {
            ctx.fillStyle = C.inkSoft;
            ctx.font = font(400, 13);
            ctx.fillText(`Superaste tu récord por ${this.score - res.prevBest}`, CX, 488 + rise);
          }
        } else {
          const gap = res.above!.p - this.score + 1;
          ctx.fillStyle = C.gold;
          ctx.fillText(`Te faltaron ${gap} ${gap === 1 ? 'punto' : 'puntos'} para el ${res.pos - 1}º`, CX, 460 + rise);
          ctx.fillStyle = C.inkSoft;
          ctx.font = font(400, 13);
          ctx.fillText(`Tu récord: ${res.prevBest}`, CX, 488 + rise);
        }
        ctx.globalAlpha = 1;
      }
    }

    // Sparks and confetti from the results beats, above the veil.
    for (const p of this.uiParticles) {
      ctx.globalAlpha = p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // Tapping already works after the lockout; the prompt shows once the screen has settled.
    const r = beat(RES.retry, 0.3);
    if (r > 0) {
      ctx.textAlign = 'center';
      ctx.globalAlpha = r * (0.6 + Math.sin(this.clock * 4) * 0.4);
      ctx.fillStyle = C.ink;
      ctx.font = font(700, 16);
      this.spaced(3);
      ctx.fillText('TOCÁ PARA REINTENTAR', CX, HEIGHT - 40);
      this.spaced(0);
      ctx.globalAlpha = 1;
    }
  }

  /** Centered text scaled about its middle by 1 + `popAmount` (`lift` ≈ half its cap height). */
  private drawPopped(text: string, f: string, color: string, baseline: number, lift: number, popAmount: number) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(CX, baseline - lift);
    ctx.scale(1 + popAmount, 1 + popAmount);
    ctx.textAlign = 'center';
    ctx.font = f;
    ctx.fillStyle = color;
    ctx.fillText(text, 0, lift);
    ctx.restore();
  }

  /** Sound and sparks for the results beats, each fired once per results screen. */
  private updateResultsFx() {
    const t = this.clock - this.overAt;
    const fx = this.resultsFx;
    // Quick rising ticks while the score counts up.
    if (t >= RES.countStart && t < RES.countEnd && this.clock - fx.lastTick > 0.055) {
      fx.lastTick = this.clock;
      const k = (t - RES.countStart) / (RES.countEnd - RES.countStart);
      sfx.countTickSfx(k);
    }
    if (!fx.score && t >= RES.countEnd) {
      fx.score = true;
      sfx.scoreLandSfx();
    }
    if (SHOW_COINS && !fx.coins && t >= RES.coinsEnd && this.runCoins > 0) {
      fx.coins = true;
      this.uiBurst(CX + 30, 207, [C.gold, '#fff2c4'], 10, 140);
      sfx.coinsSfx();
    }
    if (!fx.msg && t >= RES.msg) {
      fx.msg = true;
      const res = this.result;
      if (res && res.pos === 1 && res.total > 1) {
        // New record: the stamp plus a fanfare (no confetti, kept clean on purpose).
        sfx.newBestSfx();
        vibrate([30, 40, 30]);
      } else {
        sfx.notBestSfx();
      }
    }
  }

  /** Particle burst drawn above the results veil; `fall` adds gravity (confetti). */
  private uiBurst(x: number, y: number, colors: string[], n: number, speed: number, fall = 0) {
    for (let i = 0; i < n; i++) {
      const a = fall ? -Math.PI / 2 + rand(-1.1, 1.1) : Math.random() * Math.PI * 2;
      const s = rand(0.35, 1) * speed;
      const max = rand(0.6, fall ? 1.6 : 0.9);
      this.uiParticles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: max,
        max,
        size: rand(2.5, fall ? 6 : 4.5),
        color: colors[i % colors.length],
        drag: 0.96,
        fall,
      });
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
