import { Drone, isMuted, noise, setMuted, tone, vibrate } from '../engine/audio';
import { isHolding, pointer, takePress } from '../engine/input';
import { loadNumber, saveNumber } from '../engine/storage';
import { HEIGHT, WIDTH, type MiniGame } from './MiniGame';

/**
 * IMÁN — hold to pull everything toward the core.
 * Light crystals answer the pull fast, heavy mines slowly. Caught crystals
 * are stored in the core, which grows (bigger target for mines, stronger
 * pull). Tap the core to cash out: the bigger the load, the bigger the
 * multiplier. A mine hit loses everything not cashed.
 */

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
};

type ShieldKind = 'shield' | 'pizza';
type Kind = 'cyan' | 'yellow' | 'pink' | 'mine' | ShieldKind;

interface KindDef {
  r: number;
  mass: number;
  value: number; // points stored on catch
  load: number; // how much a catch grows the core
  color: string;
  name: string;
  blurb?: string; // banner line instead of "+value"
}

/**
 * Risk ladder: heavier gems answer the pull slower and pay more. Pink sits
 * just under the mine's mass, so pulling one in means holding long enough
 * to drag a mine too. Shields are about as heavy as a mine for the same reason.
 */
const KINDS: Record<Kind, KindDef> = {
  cyan: { r: 7, mass: 1, value: 1, load: 1, color: '#29e7ff', name: 'Gema celeste' },
  yellow: { r: 9, mass: 2, value: 5, load: 2, color: '#ffe14a', name: 'Gema amarilla' },
  pink: { r: 11, mass: 3, value: 15, load: 3, color: '#ff4fd8', name: 'Gema rosa' },
  mine: { r: 11, mass: 3.4, value: 0, load: 0, color: '#ff3b3b', name: 'Mina' },
  shield: { r: 11, mass: 3.2, value: 0, load: 0, color: '#ffffff', name: 'Escudo', blurb: 'Aguanta 1 mina' },
  pizza: {
    r: 11,
    mass: 3.2,
    value: 0,
    load: 0,
    color: '#b48cff',
    name: 'Escudo pizza',
    blurb: 'Cada mina rompe solo 1 porción',
  },
};

/** How many slices each shield has; a mine breaks only the slice it hits. */
const SHIELD_SLICES: Record<ShieldKind, number> = { shield: 1, pizza: 6 };

const isShield = (k: Kind): k is ShieldKind => k === 'shield' || k === 'pizza';

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
  { load: 0, mult: 1, color: '#ffffff' },
  { load: 5, mult: 2, color: '#9ff6ff' },
  { load: 10, mult: 3, color: '#29e7ff' },
  { load: 20, mult: 5, color: '#ffd23f' },
  { load: 35, mult: 8, color: '#ff9f1c' },
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
}

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  life: number;
}

type State = 'ready' | 'playing' | 'over';

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Iman implements MiniGame {
  private state: State = 'ready';
  private bodies: Body[] = [];
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private clock = 0; // seconds since boot, drives animation
  private time = 0; // seconds into the current run
  private spawnTimer = 0;
  private phase = 0;
  private bag: Kind[] = [];
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
  private lost = 0; // what the last death threw away
  // No best score or coin wallet across runs until they have something to buy/beat.
  private cashedOnce = loadNumber('iman.cashedOnce') === 1;
  private holding = false;
  private holdBlocked = false; // a press that cashed out shouldn't also pull
  private overAt = 0;
  private shake = 0;
  private corePop = 0;
  private holdTime = 0;
  private hum = new Drone();

  constructor(private ctx: CanvasRenderingContext2D) {}

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
    this.burst(mine.x, mine.y, '#ff3b3b', 18, 200);
    this.burst(mine.x, mine.y, color, 14, 160);
    this.popup(mine.x, mine.y - 14, '¡BLOQUEADA!', color);
    this.shake = 0.15;
    noise(0.25, 0.3, 4000);
    tone({ freq: 1800, to: 600, dur: 0.2, type: 'triangle', gain: 0.12 });
    vibrate(40);
    if (!this.slices.some(Boolean)) this.shieldKind = null;
    return true;
  }

  private sliceColor(i: number) {
    return `hsl(${(this.clock * 90 + i * 60) % 360}, 100%, 70%)`;
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
          this.popup(b.x, b.y, `¡CERCA! +${T.nearMissPoints}`, '#ffd23f');
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
    this.lost = 0;
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
      this.popup(CX, CY - this.shieldR - 14, `¡${k.name.toUpperCase()}!`, k.color, 18);
      [0, 4, 7, 12].forEach((s, i) => tone({ freq: note(s), dur: 0.25, type: 'sine', gain: 0.14, delay: i * 0.06 }));
      vibrate(20);
      return;
    }
    const tierBefore = this.tierIndex;
    this.bank += k.value;
    this.load += k.load;
    this.corePop = 1;
    this.burst(CX, CY, k.color, 8 * k.load, 140);
    this.popup(CX + rand(-24, 24), CY - this.coreR - 10, `+${k.value}`, k.color, 12 + k.load * 2);

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
      this.popup(CX, CY - this.targetCoreR() - 16, `x${tier.mult}`, tier.color, 22);
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
    this.burst(CX, CY, tier.color, 12 + this.load * 2, 160 + this.load * 6);
    this.burst(CX, CY, '#ffffff', 10, 120);
    this.popup(CX, CY - this.coreR - 24, `+${pts}`, tier.color, 20 + ti * 4);
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
    if (!this.cashedOnce) {
      this.cashedOnce = true;
      saveNumber('iman.cashedOnce', 1);
    }
  }

  private gameOver(mine: Body) {
    this.state = 'over';
    this.overAt = this.clock;
    this.shake = 0.5;
    this.lost = this.bank * TIERS[this.tierIndex].mult;
    this.burst(mine.x, mine.y, '#ff3b3b', 40, 260);
    this.burst(CX, CY, '#ffffff', 20 + this.load * 2, 180);
    this.bodies = this.bodies.filter((b) => !b.dead);
    this.bank = 0;
    this.load = 0;
    noise(0.6, 0.5, 2000);
    tone({ freq: 160, to: 40, dur: 0.5, type: 'sine', gain: 0.4 });
    vibrate([60, 40, 120]);
  }

  /** Coins earned this run, derived from score (not saved anywhere yet). */
  private get runCoins() {
    return Math.floor(this.score / T.pointsPerCoin);
  }

  private burst(x: number, y: number, color: string, n: number, speed: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(0.3, 1) * speed;
      const max = rand(0.3, 0.7);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: max, max, size: rand(2, 4), color });
    }
  }

  private popup(x: number, y: number, text: string, color: string, size = 16) {
    this.popups.push({ x, y, text, color, size, life: 0.9 });
  }

  private updateFx(dt: number) {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
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

    const bg = ctx.createRadialGradient(CX, CY, 0, CX, CY, HEIGHT * 0.7);
    bg.addColorStop(0, active ? '#1c1640' : '#15112e');
    bg.addColorStop(1, '#05040b');
    ctx.fillStyle = bg;
    ctx.fillRect(-20, -20, WIDTH + 40, HEIGHT + 40);

    if (this.state !== 'ready') this.drawField(active);

    const field = this.fieldRadius;
    for (const b of this.bodies) {
      if (active && Math.hypot(CX - b.x, CY - b.y) < field) {
        ctx.strokeStyle = b.kind === 'mine' ? 'rgba(255,59,59,0.25)' : 'rgba(41,231,255,0.18)';
        ctx.lineWidth = 1;
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

    if (this.state === 'playing') this.drawCore(active);

    ctx.textAlign = 'center';
    for (const p of this.popups) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.font = `900 ${p.size}px system-ui, sans-serif`;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    this.drawHud();
  }

  private drawField(active: boolean) {
    const { ctx } = this;
    const field = this.fieldRadius;
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(41,231,255,${active ? 0.35 : 0.08})`;
    ctx.beginPath();
    ctx.arc(CX, CY, field, 0, Math.PI * 2);
    ctx.stroke();
    if (!active) return;
    // Rings collapsing inward sell the pull.
    for (let i = 0; i < 3; i++) {
      const t = (this.clock * 1.6 + i / 3) % 1;
      ctx.strokeStyle = `rgba(41,231,255,${0.25 * t})`;
      ctx.beginPath();
      ctx.arc(CX, CY, (field - this.coreR) * (1 - t) + this.coreR, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawBody(b: Body) {
    this.drawItem(b.kind, b.x, b.y, b.spin);
  }

  /** Round pickups: plain white bubble, or a pizza whose slices cycle colors. */
  private drawShieldIcon(kind: ShieldKind, x: number, y: number, spin: number) {
    const { ctx } = this;
    const r = KINDS[kind].r;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin);
    if (kind === 'shield') {
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 16;
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Glint so it reads as a bubble, not a coin.
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-r * 0.35, -r * 0.35, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const n = SHIELD_SLICES.pizza;
      ctx.shadowColor = this.sliceColor(0);
      ctx.shadowBlur = 16;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        ctx.fillStyle = this.sliceColor(i);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r, a0, a1);
        ctx.closePath();
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#05040b';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawItem(kind: Kind, x: number, y: number, spin: number) {
    if (isShield(kind)) return this.drawShieldIcon(kind, x, y, spin);
    const { ctx } = this;
    const k = KINDS[kind];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin);
    ctx.shadowColor = k.color;
    ctx.shadowBlur = 6 + k.load * 4;
    ctx.fillStyle = k.color;
    ctx.beginPath();
    if (kind === 'mine') {
      const spikes = 8;
      const pulse = 1 + Math.sin(this.clock * 8 + spin) * 0.08;
      for (let i = 0; i < spikes * 2; i++) {
        const r = (i % 2 === 0 ? k.r + 5 : k.r - 1) * pulse;
        const a = (i / (spikes * 2)) * Math.PI * 2;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
    } else {
      const r = k.r;
      ctx.moveTo(0, -r * 1.3);
      ctx.lineTo(r, 0);
      ctx.lineTo(0, r * 1.3);
      ctx.lineTo(-r, 0);
    }
    ctx.closePath();
    ctx.fill();
    if (kind === 'mine') {
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#2a0000';
      ctx.beginPath();
      ctx.arc(0, 0, k.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Active shield: a full bubble, or pizza slices with gaps where mines broke through. */
  private drawShieldBubble() {
    if (!this.shieldKind) return;
    const { ctx } = this;
    const R = this.shieldR + Math.sin(this.clock * 3) * 1.5;
    const n = this.slices.length;
    const gap = n > 1 ? 0.06 : 0;
    ctx.save();
    ctx.lineWidth = 3;
    for (let i = 0; i < n; i++) {
      if (!this.slices[i]) continue;
      const a0 = (i / n) * Math.PI * 2 + gap;
      const a1 = ((i + 1) / n) * Math.PI * 2 - gap;
      // Both bubbles are white on the core; only the pizza pickup cycles colors.
      const color = '#ffffff';
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(CX, CY);
      ctx.arc(CX, CY, R, a0, a1);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(CX, CY, R, a0, a1);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  private drawCore(active: boolean) {
    const { ctx } = this;
    const ti = this.tierIndex;
    const tier = TIERS[ti];
    const r = this.coreR * (1 + this.corePop * 0.2 + (active ? 0.06 : 0));

    ctx.save();
    ctx.shadowColor = active ? '#29e7ff' : tier.color;
    ctx.shadowBlur = 14 + this.growth * 30;
    ctx.fillStyle = tier.color;
    ctx.beginPath();
    ctx.arc(CX, CY, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    this.drawShieldBubble();
    // Labels under the core clear the shield bubble when there is one.
    const below = this.shieldKind ? 44 : 26;

    // Progress ring toward the next tier; full and pulsing at the top tier.
    const next = TIERS[ti + 1];
    const progress = next ? (this.load - tier.load) / (next.load - tier.load) : 1;
    if (this.load > 0) {
      ctx.strokeStyle = next ? next.color : tier.color;
      // Kept translucent: a hint, not something competing with the core.
      ctx.globalAlpha = next ? 0.45 : 0.4 + Math.sin(this.clock * 10) * 0.15;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(CX, CY, r + 6, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (this.bank > 0) {
      ctx.fillStyle = '#05040b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 ${Math.max(11, Math.round(r * 0.75))}px system-ui, sans-serif`;
      ctx.fillText(String(this.bank), CX, CY + 1);
      ctx.textBaseline = 'alphabetic';
      if (tier.mult > 1) {
        ctx.fillStyle = tier.color;
        ctx.font = '900 16px system-ui, sans-serif';
        ctx.fillText(`x${tier.mult}`, CX, CY + r + below);
      }
    }

    if (!this.cashedOnce && this.load >= TIERS[1].load && this.state === 'playing') {
      ctx.fillStyle = `rgba(255,210,63,${0.6 + Math.sin(this.clock * 6) * 0.4})`;
      ctx.textAlign = 'center';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText('TOCÁ EL NÚCLEO PARA COBRAR', CX, CY + r + below + 24);
    }
  }

  /** Speaker drawn with paths (emoji glyphs vary too much across phones). */
  private drawMuteIcon() {
    const { ctx } = this;
    const x = MUTE_BTN.x + 12;
    const y = MUTE_BTN.y + MUTE_BTN.h / 2;
    ctx.save();
    ctx.fillStyle = ctx.strokeStyle = isMuted() ? '#6b6596' : '#c9c4ff';
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

  /** Start screen: rules plus an arcade-style legend that reveals row by row. */
  private drawTitle() {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 56px system-ui, sans-serif';
    ctx.fillText('IMÁN', CX, 104);
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillStyle = '#c9c4ff';
    ctx.fillText('Mantené presionado para atraer.', CX, 142);
    ctx.fillText('Tocá el núcleo para cobrar lo guardado.', CX, 164);
    ctx.fillStyle = '#ff8a8a';
    ctx.fillText('Si te toca una mina, perdés lo que no cobraste.', CX, 186);

    const top = 236;
    const rowH = 50;
    const barX = 196;
    const barW = 64;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillStyle = '#6b6596';
    ctx.textAlign = 'left';
    ctx.fillText('PESO', barX, top - 6);
    ctx.textAlign = 'right';
    ctx.fillText('PUNTOS', 330, top - 6);

    const maxMass = KINDS.mine.mass;
    LEGEND.forEach((kind, i) => {
      const t = this.clock - 0.4 - i * 0.35;
      if (t < 0) return;
      const k = KINDS[kind];
      const y = top + 26 + i * rowH;
      ctx.globalAlpha = Math.min(1, t * 4);

      this.drawItem(kind, 52, y, this.clock * (kind === 'mine' ? 1.2 : 2));

      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.fillText(k.name, 78, y + 5);

      // Weight bar fills in, so pink visibly lands right next to the mine.
      const fill = (k.mass / maxMass) * Math.min(1, t * 2);
      ctx.fillStyle = '#2a2550';
      ctx.fillRect(barX, y - 3, barW, 6);
      ctx.fillStyle = k.color;
      ctx.fillRect(barX, y - 3, barW * fill, 6);

      ctx.textAlign = 'right';
      ctx.font = `900 ${kind === 'mine' ? 13 : 18}px system-ui, sans-serif`;
      ctx.fillStyle = kind === 'mine' ? '#ff8a8a' : k.color;
      ctx.fillText(kind === 'mine' ? '¡PERDÉS!' : `+${k.value}`, 330, y + 6);
    });
    ctx.globalAlpha = 1;

    const after = this.clock - 0.4 - LEGEND.length * 0.35;
    if (after > 0) {
      ctx.globalAlpha = Math.min(1, after * 3);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#c9c4ff';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText('Más pesada, más tarda en llegar... y más paga.', CX, top + LEGEND.length * rowH + 30);
      ctx.fillText('Más carga en el núcleo = más multiplicador.', CX, top + LEGEND.length * rowH + 52);
      ctx.globalAlpha = 1;
      ctx.fillStyle = `rgba(255,255,255,${0.6 + Math.sin(this.clock * 4) * 0.4})`;
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillText('TOCÁ PARA EMPEZAR', CX, HEIGHT - 90);
    }
  }

  /** Phase label under the score, plus a banner for ~2.5 s when a phase starts. */
  private drawPhase() {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8f88c9';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText(`FASE ${this.phase + 1}`, CX, 94);

    const p = PHASES[this.phase];
    const t = this.clock - this.bannerAt;
    if (!p.title || t > 2.5) return;
    // Pop in, hold, fade out.
    const alpha = Math.min(1, t * 6, (2.5 - t) * 2);
    const scale = 1 + Math.max(0, 0.25 - t) * 1.6;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(CX, 150);
    ctx.scale(scale, scale);
    ctx.fillStyle = p.intro ? KINDS[p.intro].color : '#ff8a8a';
    ctx.font = '900 28px system-ui, sans-serif';
    ctx.fillText(p.title, 0, 0);
    if (p.intro) {
      const k = KINDS[p.intro];
      ctx.font = 'bold 16px system-ui, sans-serif';
      // Shields have no points to show, so they get a name line plus a how-it-works line.
      const label = k.blurb ? k.name : `${k.name}  +${k.value}`;
      const w = ctx.measureText(label).width;
      this.drawItem(p.intro, -w / 2 - 6, 26, this.clock * 2);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(label, -w / 2 + 12, 32);
      if (k.blurb) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#c9c4ff';
        ctx.font = '14px system-ui, sans-serif';
        ctx.fillText(k.blurb, 0, 54);
      }
    }
    ctx.restore();
  }

  private drawHud() {
    const { ctx } = this;
    if (this.state === 'playing') {
      ctx.textAlign = 'right';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(`● ${this.runCoins}`, WIDTH - 14, 26);
    }
    ctx.textAlign = 'center';

    if (this.state !== 'playing') this.drawMuteIcon();

    if (this.state === 'ready') {
      this.drawTitle();
      return;
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 44px system-ui, sans-serif';
    ctx.fillText(String(Math.round(this.shownScore)), CX, 70);
    if (this.state === 'playing') this.drawPhase();

    if (this.state === 'over') {
      ctx.fillStyle = 'rgba(5,4,11,0.6)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 64px system-ui, sans-serif';
      ctx.fillText(String(this.score), CX, 250);
      if (this.lost > 0) {
        ctx.fillStyle = '#ff8a8a';
        ctx.font = 'bold 15px system-ui, sans-serif';
        ctx.fillText(`Perdiste ${this.lost} sin cobrar`, CX, 284);
      }
      ctx.fillStyle = '#ffd23f';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.fillText(`+${this.runCoins} ●`, CX, 330);
      if (this.clock - this.overAt > 0.6) {
        ctx.fillStyle = `rgba(255,255,255,${0.6 + Math.sin(this.clock * 4) * 0.4})`;
        ctx.font = 'bold 18px system-ui, sans-serif';
        ctx.fillText('TOCÁ PARA REINTENTAR', CX, HEIGHT - 120);
      }
    }
  }
}
