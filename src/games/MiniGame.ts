/** Logical play area (portrait, phone-shaped). It is scaled to fit and centered on screen. */
export const WIDTH = 360;
export const HEIGHT = 640;

/**
 * What the canvas actually covers, in logical units. On screens taller or wider than 9:16 the
 * canvas still fills the whole window, so x0/y0 go negative and w/h exceed WIDTH/HEIGHT: games
 * paint their backdrop over this whole rect and keep gameplay and text inside WIDTH×HEIGHT.
 * Kept up to date by main.ts on every resize.
 */
export const VIEW = {
  x0: 0,
  y0: 0,
  w: WIDTH,
  h: HEIGHT,
  px: 1, // device pixels per logical px (for baking sprites at native sharpness)
  scale: 1, // CSS px per logical px
  ox: 0, // CSS px from the window's left edge to logical x = 0
  oy: 0, // … top edge to logical y = 0
};

/** Window (CSS px) coordinates → logical play-area coordinates. */
export function toGame(clientX: number, clientY: number) {
  return { x: (clientX - VIEW.ox) / VIEW.scale, y: (clientY - VIEW.oy) / VIEW.scale };
}

export interface MiniGame {
  update(dt: number): void;
  render(alpha: number): void;
}
