/** Logical resolution (portrait, phone-shaped); the canvas is scaled to fit. */
export const WIDTH = 360;
export const HEIGHT = 640;

export interface MiniGame {
  update(dt: number): void;
  render(alpha: number): void;
}
