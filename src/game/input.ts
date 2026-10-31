const down = new Set<string>();

window.addEventListener('keydown', (e) => down.add(e.code));
window.addEventListener('keyup', (e) => down.delete(e.code));
window.addEventListener('blur', () => down.clear());

export const isDown = (code: string) => down.has(code);

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
