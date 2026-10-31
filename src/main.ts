import './style.css';
import { startLoop } from './engine/loop';
import { Iman } from './games/iman';
import { HEIGHT, WIDTH, type MiniGame } from './games/MiniGame';

/** Each minigame is picked by URL hash, e.g. localhost:5173/#iman. */
const games: Record<string, (ctx: CanvasRenderingContext2D) => MiniGame> = {
  iman: (ctx) => new Iman(ctx),
};

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;

function fit() {
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.min(innerWidth / WIDTH, innerHeight / HEIGHT);
  canvas.style.width = `${WIDTH * scale}px`;
  canvas.style.height = `${HEIGHT * scale}px`;
  canvas.width = Math.round(WIDTH * scale * dpr);
  canvas.height = Math.round(HEIGHT * scale * dpr);
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
}
fit();
window.addEventListener('resize', fit);

const game = (games[location.hash.slice(1)] ?? games.iman)(ctx);
// Handy for poking at state from the console; stripped from production builds.
if (import.meta.env.DEV) Object.assign(window, { game });
startLoop(
  (dt) => game.update(dt),
  (alpha) => game.render(alpha),
);
