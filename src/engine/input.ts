const down = new Set<string>();
let pointerDown = false;

/** Last press position, in client (CSS pixel) coordinates. */
export const pointer = { x: 0, y: 0 };

// Counted from events, not polled, so a tap shorter than one frame still lands.
let presses = 0;

window.addEventListener('keydown', (e) => {
  down.add(e.code);
  if (e.code === 'Space' && !e.repeat) presses++;
});
window.addEventListener('keyup', (e) => down.delete(e.code));
window.addEventListener('pointerdown', (e) => {
  presses++;
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

/** True if a press started since the last call. */
export function takePress(): boolean {
  const had = presses > 0;
  presses = 0;
  return had;
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
