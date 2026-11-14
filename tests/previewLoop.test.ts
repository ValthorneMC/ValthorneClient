import { afterEach, expect, test, vi } from 'vitest';
import { startPreviewLoop } from '../src/lib/skin-rendering/preview-loop';
afterEach(() => vi.unstubAllGlobals());
test('caps idle rendering at 30 fps and interaction at 60 across a 120 Hz display', () => {
  let next: FrameRequestCallback | null = null; let active = false;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { next = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { next = null; });
  const draw = vi.fn(); const stop = startPreviewLoop(draw, () => active);
  for (let n = 0; n < 120; n++) next!(n * 1000 / 120);
  expect(draw.mock.calls.length).toBeGreaterThanOrEqual(30); expect(draw.mock.calls.length).toBeLessThanOrEqual(31);
  draw.mockClear(); active = true;
  for (let n = 120; n < 240; n++) next!(n * 1000 / 120);
  expect(draw.mock.calls.length).toBeGreaterThanOrEqual(59); expect(draw.mock.calls.length).toBeLessThanOrEqual(61);
  expect(draw.mock.calls.every(([delta]) => delta <= 0.1)).toBe(true); stop(); expect(next).toBeNull();
});
