import { afterEach, beforeEach, expect, test, vi } from 'vitest';
let load: typeof import('../src/services/avatarService').loadAvatarWithFallback;
beforeEach(async () => { vi.resetModules(); localStorage.clear(); vi.useFakeTimers(); load = (await import('../src/services/avatarService')).loadAvatarWithFallback; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
test('deduplicates concurrent avatars and never probes an unused fallback', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', fetch);
  const urls = await Promise.all(Array.from({ length: 100 }, () => load('same', 'player')));
  expect(new Set(urls).size).toBe(1); expect(fetch).toHaveBeenCalledTimes(1);
  await load('same', 'player'); expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
test('falls back on rejection, cleans timers and handles an actual image failure', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', fetch);
  const first = await load('same', 'player'); expect(first).toContain('mc-heads'); expect(fetch).toHaveBeenCalledTimes(2);
  const second = await load('same', 'player', 64, true, first); expect(second).toContain('minotar'); expect(fetch).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});
test('expires results and isolates size and overlay', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', fetch);
  await load('id', 'player'); await load('id', 'player', 128); await load('id', 'player', 64, false);
  expect(fetch).toHaveBeenCalledTimes(3); vi.advanceTimersByTime(300001); await load('id', 'player'); expect(fetch).toHaveBeenCalledTimes(4);
});
test('returns each callers placeholder after both providers fail and permits retry', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('offline')); vi.stubGlobal('fetch', fetch);
  const [a,b] = await Promise.all([load('id','Alice'),load('id','Bob')]); expect(a).not.toBe(b); expect(fetch).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  fetch.mockResolvedValue({ ok: true }); expect(await load('id','Alice')).toContain('minotar');
});

test('aborts a stalled preferred provider and clears the timeout before using its fallback', async () => {
  const fetch = vi.fn().mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))))
    .mockResolvedValue({ok:true}); vi.stubGlobal('fetch',fetch);
  const result=load('timeout','player'); await vi.advanceTimersByTimeAsync(3000);
  expect(await result).toContain('mc-heads'); expect(fetch).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
});
