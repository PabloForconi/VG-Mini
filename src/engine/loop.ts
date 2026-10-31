/** Fixed-timestep loop: update runs at a constant rate, render once per frame. */
export function startLoop(
  update: (dt: number) => void,
  render: (alpha: number) => void,
  stepMs = 1000 / 60,
): () => void {
  let last = performance.now();
  let acc = 0;
  let rafId = 0;

  const frame = (now: number) => {
    // Clamp to avoid a spiral of death after the tab was in the background.
    acc += Math.min(now - last, 250);
    last = now;
    while (acc >= stepMs) {
      update(stepMs / 1000);
      acc -= stepMs;
    }
    render(acc / stepMs);
    rafId = requestAnimationFrame(frame);
  };

  rafId = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(rafId);
}
