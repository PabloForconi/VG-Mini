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
  spawnStart: 0.8,
  spawnMin: 0.28,
  spawnRamp: 0.011, // seconds of spawn interval lost per second played
  mineStart: 0.2,
  mineMax: 0.5,
  mineRamp: 0.006,
  gemChance: 0.06,
  nearMissGap: 22,
  nearMissPoints: 5,
  pointsPerCoin: 5,
};

type Kind = 'shard' | 'gem' | 'mine';

/** `load` is how much a catch grows the core; `value` is points stored. */
const KINDS: Record<Kind, { r: number; mass: number; value: number; load: number; color: string }> = {
  shard: { r: 7, mass: 1, value: 1, load: 1, color: '#29e7ff' },
  gem: { r: 11, mass: 1.8, value: 10, load: 3, color: '#ff4fd8' },
  mine: { r: 11, mass: 3.4, value: 0, load: 0, color: '#ff3b3b' },
};

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
  private score = 0;
  private shownScore = 0; // counts up toward score
  private bank = 0; // points stored in the core, not yet cashed
  private load = 0; // what the core is carrying; drives size and tier
  private coreR = T.coreRadius; // drawn/collision radius, eases toward target
  private lost = 0; // what the last death threw away
  private best = loadNumber('iman.best');
  private coins = loadNumber('coins');
  private cashedOnce = loadNumber('iman.cashedOnce') === 1;
  private runCoins = 0;
  private newBest = false;
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
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawn();
      this.spawnTimer = Math.max(T.spawnMin, T.spawnStart - this.time * T.spawnRamp);
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
    this.newBest = false;
    tone({ freq: 220, to: 660, dur: 0.18, type: 'triangle', gain: 0.15 });
  }

  private spawn() {
    const mineP = Math.min(T.mineMax, T.mineStart + this.time * T.mineRamp);
    const roll = Math.random();
    const kind: Kind = roll < mineP ? 'mine' : roll < mineP + T.gemChance ? 'gem' : 'shard';

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
    const tierBefore = this.tierIndex;
    this.bank += k.value;
    this.load += k.load;
    this.corePop = 1;
    this.burst(CX, CY, k.color, b.kind === 'gem' ? 24 : 8, 140);

    // Notes climb with the load: the higher the pitch, the more you risk.
    const step = Math.min(this.load, 24);
    if (b.kind === 'gem') {
      tone({ freq: note(step), dur: 0.35, type: 'triangle', gain: 0.18 });
      tone({ freq: note(step + 2), dur: 0.35, type: 'triangle', gain: 0.12, delay: 0.06 });
      vibrate(10);
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

    this.runCoins = Math.floor(this.score / T.pointsPerCoin);
    this.coins += this.runCoins;
    saveNumber('coins', this.coins);
    if (this.score > this.best) {
      this.best = this.score;
      this.newBest = true;
      saveNumber('iman.best', this.best);
      [0, 2, 4, 5].forEach((s, i) => tone({ freq: note(s + 5), dur: 0.25, type: 'triangle', gain: 0.15, delay: 0.5 + i * 0.1 }));
    }
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

    this.drawField(active);

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

    if (this.state !== 'over') this.drawCore(active);

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
    const { ctx } = this;
    const k = KINDS[b.kind];
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.spin);
    ctx.shadowColor = k.color;
    ctx.shadowBlur = b.kind === 'shard' ? 8 : 16;
    ctx.fillStyle = k.color;
    ctx.beginPath();
    if (b.kind === 'mine') {
      const spikes = 8;
      const pulse = 1 + Math.sin(this.clock * 8 + b.spin) * 0.08;
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
    if (b.kind === 'mine') {
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#2a0000';
      ctx.beginPath();
      ctx.arc(0, 0, k.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
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

    // Progress ring toward the next tier; full and pulsing at the top tier.
    const next = TIERS[ti + 1];
    const progress = next ? (this.load - tier.load) / (next.load - tier.load) : 1;
    if (this.load > 0) {
      ctx.strokeStyle = next ? next.color : tier.color;
      ctx.globalAlpha = next ? 0.9 : 0.6 + Math.sin(this.clock * 10) * 0.4;
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
        ctx.fillText(`x${tier.mult}`, CX, CY + r + 26);
      }
    }

    if (!this.cashedOnce && this.load >= TIERS[1].load && this.state === 'playing') {
      ctx.fillStyle = `rgba(255,210,63,${0.6 + Math.sin(this.clock * 6) * 0.4})`;
      ctx.textAlign = 'center';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText('TOCÁ EL NÚCLEO PARA COBRAR', CX, CY + r + 50);
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

  private drawHud() {
    const { ctx } = this;
    ctx.textAlign = 'right';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(`● ${this.coins}`, WIDTH - 14, 26);
    ctx.textAlign = 'center';

    if (this.state !== 'playing') this.drawMuteIcon();

    if (this.state === 'ready') {
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 56px system-ui, sans-serif';
      ctx.fillText('IMÁN', CX, 130);
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillStyle = '#c9c4ff';
      ctx.fillText('Mantené presionado para atraer.', CX, 170);
      ctx.fillText('Tocá el núcleo para cobrar lo que juntaste.', CX, 192);
      ctx.fillText('Más carga = más multiplicador... y más grande.', CX, 214);
      ctx.fillStyle = '#ff8a8a';
      ctx.fillText('Si te toca una mina, perdés lo que no cobraste.', CX, 236);
      ctx.fillStyle = `rgba(255,255,255,${0.6 + Math.sin(this.clock * 4) * 0.4})`;
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillText('TOCÁ PARA EMPEZAR', CX, HEIGHT - 120);
      if (this.best > 0) {
        ctx.fillStyle = '#8f88c9';
        ctx.font = '14px system-ui, sans-serif';
        ctx.fillText(`Récord: ${this.best}`, CX, HEIGHT - 90);
      }
      return;
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 44px system-ui, sans-serif';
    ctx.fillText(String(Math.round(this.shownScore)), CX, 70);

    if (this.state === 'over') {
      ctx.fillStyle = 'rgba(5,4,11,0.6)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 64px system-ui, sans-serif';
      ctx.fillText(String(this.score), CX, 250);
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.fillStyle = this.newBest ? '#ffd23f' : '#8f88c9';
      ctx.fillText(this.newBest ? '¡NUEVO RÉCORD!' : `Récord: ${this.best}`, CX, 284);
      if (this.lost > 0) {
        ctx.fillStyle = '#ff8a8a';
        ctx.font = 'bold 15px system-ui, sans-serif';
        ctx.fillText(`Perdiste ${this.lost} sin cobrar`, CX, 312);
      }
      ctx.fillStyle = '#ffd23f';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.fillText(`+${this.runCoins} ●`, CX, 356);
      if (this.clock - this.overAt > 0.6) {
        ctx.fillStyle = `rgba(255,255,255,${0.6 + Math.sin(this.clock * 4) * 0.4})`;
        ctx.font = 'bold 18px system-ui, sans-serif';
        ctx.fillText('TOCÁ PARA REINTENTAR', CX, HEIGHT - 120);
      }
    }
  }
}
