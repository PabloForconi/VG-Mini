import './style.css';
import { startLoop } from './engine/loop';
import { Growcore } from './games/growcore';
import { HEIGHT, WIDTH, type MiniGame } from './games/MiniGame';

interface GameEntry {
  title: string; // browser tab title
  make: (ctx: CanvasRenderingContext2D) => MiniGame;
}

const growcore: GameEntry = { title: 'Growcore', make: (ctx) => new Growcore(ctx) };

/** Each minigame is picked by URL hash, e.g. localhost:5173/#growcore. */
const games: Record<string, GameEntry> = {
  growcore,
  iman: growcore, // pre-rename links keep working
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

const entry = games[location.hash.slice(1)] ?? growcore;
document.title = entry.title;
const game = entry.make(ctx);
// Handy for poking at state from the console; stripped from production builds.
if (import.meta.env.DEV) Object.assign(window, { game });
startLoop(
  (dt) => game.update(dt),
  (alpha) => game.render(alpha),
);
