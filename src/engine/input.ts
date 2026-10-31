const down = new Set<string>();
let pointerDown = false;

window.addEventListener('keydown', (e) => down.add(e.code));
window.addEventListener('keyup', (e) => down.delete(e.code));
window.addEventListener('pointerdown', () => (pointerDown = true));
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
