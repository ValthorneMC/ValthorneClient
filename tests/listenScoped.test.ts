import { beforeEach, expect, test, vi } from 'vitest';
import { listen } from '@tauri-apps/api/event';
import { listenScoped } from '../src/utils/listenScoped';
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
beforeEach(() => { vi.mocked(listen).mockReset(); });
test('removes an established listener exactly once and ignores events after cleanup', async () => {
  const unlisten = vi.fn(), callback = vi.fn(); let received: any;
  vi.mocked(listen).mockImplementation(async (_name, handler) => { received = handler; return unlisten; });
  const stop = listenScoped('test-event', callback);
  await Promise.resolve(); received({ payload: 1 }); expect(callback).toHaveBeenCalledTimes(1);
  stop(); stop(); received({ payload: 2 });
  expect(unlisten).toHaveBeenCalledTimes(1); expect(callback).toHaveBeenCalledTimes(1);
});
test('removes registrations resolving after cleanup without firing stale callbacks', async () => {
  let complete!: (fn: () => void) => void, received: any;
  vi.mocked(listen).mockImplementation((_name, handler) => { received = handler; return new Promise(resolve => complete = resolve); });
  const callback = vi.fn(), unlisten = vi.fn(); const stop = listenScoped('test-event', callback);
  stop(); received({ payload: 1 }); complete(unlisten); await Promise.resolve();
  expect(callback).not.toHaveBeenCalled(); expect(unlisten).toHaveBeenCalledTimes(1);
});
test('handles rejected registrations without leaving a rejected cleanup promise', async () => {
  const error = new Error('closed'), onError = vi.fn();
  vi.mocked(listen).mockRejectedValue(error);
  const stop = listenScoped('test-event', vi.fn(), onError);
  await Promise.resolve(); await Promise.resolve();
  expect(onError).toHaveBeenCalledWith(error); expect(() => stop()).not.toThrow();
});
