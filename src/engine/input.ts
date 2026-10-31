const down = new Set<string>();
let pointerDown = false;

/** Last press position, in client (CSS pixel) coordinates. */
export const pointer = { x: 0, y: 0 };

export type PressSource = 'pointer' | 'key';

// Latched from events, not polled, so a tap shorter than one frame still lands.
let press: PressSource | null = null;

window.addEventListener('keydown', (e) => {
  down.add(e.code);
  if (e.code === 'Space' && !e.repeat) press = 'key';
});
window.addEventListener('keyup', (e) => down.delete(e.code));
window.addEventListener('pointerdown', (e) => {
  press = 'pointer';
  pointerDown = true;
  pointer.x = e.clientX;
  pointer.y = e.clientY;
});
window.addEventListener('pointerup', () => (pointerDown = false));
window.addEventListener('pointercancel', () => (pointerDown = false));
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('blur', () => {
  down.clear();
  pointerDown = false;
});

export const isDown = (code: string) => down.has(code);

/** One-button games: mouse, touch or space all count as "holding". */
export const isHolding = () => pointerDown || isDown('Space');

/** What started a press since the last call (null if none). Pointer presses set `pointer`. */
export function takePress(): PressSource | null {
  const p = press;
  press = null;
  return p;
}

/** Horizontal/vertical axis from arrows + WASD, each in [-1, 1]. */
export function axis(): { x: number; y: number } {
  const x =
    (isDown('ArrowRight') || isDown('KeyD') ? 1 : 0) -
    (isDown('ArrowLeft') || isDown('KeyA') ? 1 : 0);
  const y =
    (isDown('ArrowDown') || isDown('KeyS') ? 1 : 0) -
    (isDown('ArrowUp') || isDown('KeyW') ? 1 : 0);
  return { x, y };
}
