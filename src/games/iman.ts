import { isHolding } from '../engine/input';
import { loadNumber, saveNumber } from '../engine/storage';
import { HEIGHT, WIDTH, type MiniGame } from './MiniGame';

/**
 * IMÁN — hold to pull everything toward the core.
 * Light crystals answer the pull fast, heavy mines slowly: short taps farm
 * crystals, long holds drag in a mine. That mass gap is the whole game.
 */

const CX = WIDTH / 2;
const CY = HEIGHT / 2;

/** Tuning knobs: everything that changes how the game feels lives here. */
const T = {
  fieldRadius: 230,
  pullForce: 1500,
  pullDecay: 2.4, // how fast pulled velocity bleeds off after release (1/s)
  coreRadius: 16,
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
  comboWindow: 1.3,
  comboPerLevel: 4, // catches per multiplier step
  multMax: 8,
  nearMissGap: 22,
  nearMissPoints: 5,
  pointsPerCoin: 5,
};

type Kind = 'shard' | 'gem' | 'mine';

const KINDS: Record<Kind, { r: number; mass: number; value: number; color: string }> = {
  shard: { r: 7, mass: 1, value: 1, color: '#29e7ff' },
  gem: { r: 11, mass: 1.8, value: 10, color: '#ff4fd8' },
  mine: { r: 11, mass: 3.4, value: 0, color: '#ff3b3b' },
};

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
  private combo = 0;
  private comboTimer = 0;
  private best = loadNumber('iman.best');
  private coins = loadNumber('coins');
  private runCoins = 0;
  private newBest = false;
  private holding = false;
  private overAt = 0;
  private shake = 0;
  private corePop = 0;

  constructor(private ctx: CanvasRenderingContext2D) {}

  private get mult() {
    return Math.min(T.multMax, 1 + Math.floor(this.combo / T.comboPerLevel));
  }

  update(dt: number) {
    this.clock += dt;
    const wasHolding = this.holding;
    this.holding = isHolding();
    const pressed = this.holding && !wasHolding;

    this.updateFx(dt);

    if (this.state === 'ready') {
      if (pressed) this.start();
      return;
    }
    if (this.state === 'over') {
      // Short lockout so a panicked tap doesn't skip the results.
      if (pressed && this.clock - this.overAt > 0.6) this.start();
      return;
    }

    this.time += dt;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawn();
      this.spawnTimer = Math.max(T.spawnMin, T.spawnStart - this.time * T.spawnRamp);
    }

    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 0;

    const decay = Math.exp(-T.pullDecay * dt);
    for (const b of this.bodies) {
      const k = KINDS[b.kind];
      let ox = CX - b.x;
      let oy = CY - b.y;
      let d = Math.hypot(ox, oy);

      if (this.holding && d < T.fieldRadius) {
        // Stronger near the core, so a committed pull finishes the job.
        const a = (T.pullForce * (1.2 - d / T.fieldRadius)) / k.mass;
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

      if (d < T.coreRadius + k.r) {
        b.dead = true;
        if (b.kind === 'mine') return this.gameOver(b);
        this.collect(b);
        continue;
      }

      if (b.kind === 'mine') {
        const inRing = d < T.coreRadius + k.r + T.nearMissGap;
        if (b.danger && !inRing) {
          this.score += T.nearMissPoints * this.mult;
          this.popup(b.x, b.y, `¡CERCA! +${T.nearMissPoints * this.mult}`, '#ffd23f');
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
    this.combo = 0;
    this.comboTimer = 0;
    this.newBest = false;
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
    const miss = rand(T.missMin, T.missMax);
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
    this.combo++;
    this.comboTimer = T.comboWindow;
    const pts = k.value * this.mult;
    this.score += pts;
    this.corePop = 1;
    this.burst(CX, CY, k.color, b.kind === 'gem' ? 24 : 8, 140);
    this.popup(CX + rand(-30, 30), CY - 34, `+${pts}`, k.color);
    if (this.combo > 0 && this.combo % T.comboPerLevel === 0 && this.mult > 1) {
      this.popup(CX, CY + 44, `x${this.mult}!`, '#ffd23f');
    }
  }

  private gameOver(mine: Body) {
    this.state = 'over';
    this.overAt = this.clock;
    this.shake = 0.5;
    this.burst(mine.x, mine.y, '#ff3b3b', 40, 260);
    this.burst(CX, CY, '#ffffff', 20, 180);
    this.bodies = this.bodies.filter((b) => !b.dead);

    this.runCoins = Math.floor(this.score / T.pointsPerCoin);
    this.coins += this.runCoins;
    saveNumber('coins', this.coins);
    if (this.score > this.best) {
      this.best = this.score;
      this.newBest = true;
      saveNumber('iman.best', this.best);
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

  private popup(x: number, y: number, text: string, color: string) {
    this.popups.push({ x, y, text, color, life: 0.8 });
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

    for (const b of this.bodies) {
      if (active && Math.hypot(CX - b.x, CY - b.y) < T.fieldRadius) {
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
    ctx.font = 'bold 16px system-ui, sans-serif';
    for (const p of this.popups) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    this.drawHud();
  }

  private drawField(active: boolean) {
    const { ctx } = this;
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(41,231,255,${active ? 0.35 : 0.08})`;
    ctx.beginPath();
    ctx.arc(CX, CY, T.fieldRadius, 0, Math.PI * 2);
    ctx.stroke();
    if (!active) return;
    // Rings collapsing inward sell the pull.
    for (let i = 0; i < 3; i++) {
      const t = (this.clock * 1.6 + i / 3) % 1;
      ctx.strokeStyle = `rgba(41,231,255,${0.25 * t})`;
      ctx.beginPath();
      ctx.arc(CX, CY, T.fieldRadius * (1 - t) + T.coreRadius, 0, Math.PI * 2);
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
    const r = T.coreRadius * (1 + this.corePop * 0.35 + (active ? 0.1 : 0));
    ctx.save();
    ctx.shadowColor = active ? '#29e7ff' : '#ffffff';
    ctx.shadowBlur = active ? 30 : 14;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(CX, CY, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawHud() {
    const { ctx } = this;
    ctx.textAlign = 'right';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(`● ${this.coins}`, WIDTH - 14, 26);
    ctx.textAlign = 'center';

    if (this.state === 'ready') {
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 56px system-ui, sans-serif';
      ctx.fillText('IMÁN', CX, 140);
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillStyle = '#c9c4ff';
      ctx.fillText('Mantené presionado para atraer.', CX, 180);
      ctx.fillText('Los cristales llegan rápido. Las minas, lento.', CX, 202);
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
    ctx.fillText(String(this.score), CX, 70);
    if (this.state === 'playing' && this.mult > 1) {
      ctx.fillStyle = '#ffd23f';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.fillText(`x${this.mult}`, CX, 96);
      // Combo timer bar: keep catching before it empties.
      const w = 60 * Math.max(0, this.comboTimer / T.comboWindow);
      ctx.fillRect(CX - w / 2, 104, w, 3);
    }

    if (this.state === 'over') {
      ctx.fillStyle = 'rgba(5,4,11,0.6)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 64px system-ui, sans-serif';
      ctx.fillText(String(this.score), CX, 250);
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.fillStyle = this.newBest ? '#ffd23f' : '#8f88c9';
      ctx.fillText(this.newBest ? '¡NUEVO RÉCORD!' : `Récord: ${this.best}`, CX, 284);
      ctx.fillStyle = '#ffd23f';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.fillText(`+${this.runCoins} ●`, CX, 340);
      if (this.clock - this.overAt > 0.6) {
        ctx.fillStyle = `rgba(255,255,255,${0.6 + Math.sin(this.clock * 4) * 0.4})`;
        ctx.font = 'bold 18px system-ui, sans-serif';
        ctx.fillText('TOCÁ PARA REINTENTAR', CX, HEIGHT - 120);
      }
    }
  }
}
