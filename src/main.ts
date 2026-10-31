import { Game, HEIGHT, WIDTH } from './game/Game';
import { startLoop } from './game/loop';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
canvas.width = WIDTH;
canvas.height = HEIGHT;

const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

const game = new Game(ctx);
startLoop(
  (dt) => game.update(dt),
  (alpha) => game.render(alpha),
);
