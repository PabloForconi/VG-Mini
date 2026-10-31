import { axis } from './input';

/** Logical resolution; the canvas is scaled to fit the window. */
export const WIDTH = 320;
export const HEIGHT = 180;

const SPEED = 90; // px/s
const SIZE = 10;

export class Game {
  private x = WIDTH / 2;
  private y = HEIGHT / 2;
  private prevX = this.x;
  private prevY = this.y;

  constructor(private ctx: CanvasRenderingContext2D) {}

  update(dt: number) {
    this.prevX = this.x;
    this.prevY = this.y;

    const { x, y } = axis();
    const len = Math.hypot(x, y) || 1;
    this.x += (x / len) * SPEED * dt;
    this.y += (y / len) * SPEED * dt;

    this.x = Math.max(SIZE / 2, Math.min(WIDTH - SIZE / 2, this.x));
    this.y = Math.max(SIZE / 2, Math.min(HEIGHT - SIZE / 2, this.y));
  }

  render(alpha: number) {
    const { ctx } = this;
    ctx.fillStyle = '#1d2b53';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const x = this.prevX + (this.x - this.prevX) * alpha;
    const y = this.prevY + (this.y - this.prevY) * alpha;
    ctx.fillStyle = '#ffec27';
    ctx.fillRect(Math.round(x - SIZE / 2), Math.round(y - SIZE / 2), SIZE, SIZE);

    ctx.fillStyle = '#fff1e8';
    ctx.font = '8px monospace';
    ctx.fillText('VG-Mini - WASD / flechas', 4, 10);
  }
}
