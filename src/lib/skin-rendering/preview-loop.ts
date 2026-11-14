export function startPreviewLoop(draw: (delta: number) => void, interacting: () => boolean): () => void {
  let frame = 0;
  let disposed = false;
  let deadline: number | undefined;
  let lastDraw: number | undefined;
  const loop = (now: number) => {
    if (disposed) return;
    frame = requestAnimationFrame(loop);
    const interval = 1000 / (interacting() ? 60 : 30);
    if (deadline !== undefined && now - deadline < interval - 0.5) return;
    const elapsed = deadline === undefined ? interval : now - deadline;
    deadline = now - Math.max(0, elapsed - interval) % interval;
    const delta = lastDraw === undefined ? 0 : Math.min((now - lastDraw) / 1000, 0.1);
    lastDraw = now;
    draw(delta);
  };
  frame = requestAnimationFrame(loop);
  return () => { disposed = true; cancelAnimationFrame(frame); };
}
