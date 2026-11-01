import './style.css';
import { startLoop } from './engine/loop';
import { Growcore } from './games/growcore';
import { HEIGHT, VIEW, WIDTH, type MiniGame } from './games/MiniGame';

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

// env() is only readable from CSS: a hidden probe reports the top safe-area inset.
const safeProbe = document.createElement('div');
safeProbe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top,0px);visibility:hidden';
document.body.appendChild(safeProbe);
const ctx = canvas.getContext('2d')!;

/** Launched from the home screen (no browser bars): the whole physical screen is ours. */
const fullScreenApp = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/**
 * The screen's height in the current orientation. Needed because iOS full-screen web apps that
 * draw under the translucent status bar report innerHeight short by that bar, which left an
 * empty strip at the bottom.
 */
const screenHeight = () =>
  innerWidth < innerHeight ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);

/**
 * The canvas fills the whole window (no letterbox bars on tall phones); the logical play area
 * is scaled to fit and centered inside it. VIEW tells games how much extra backdrop shows.
 */
function fit() {
  const dpr = window.devicePixelRatio || 1;
  const w = innerWidth;
  const h = fullScreenApp() ? Math.max(innerHeight, screenHeight()) : innerHeight;
  const scale = Math.min(w / WIDTH, h / HEIGHT);
  const ox = (w - WIDTH * scale) / 2;
  const oy = (h - HEIGHT * scale) / 2;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);
  const safeTop = safeProbe.offsetHeight;
  Object.assign(VIEW, { x0: -ox / scale, y0: -oy / scale, w: w / scale, h: h / scale, px: scale * dpr, scale, ox, oy, safeTop });
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
