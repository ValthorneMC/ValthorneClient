import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, test, vi } from 'vitest';
import { listen } from '@tauri-apps/api/event';
import PlayTimeStats from '../src/components/PlayTimeStats';
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, args: { count: number }) => `${args.count} hours` }) }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { vi.mocked(listen).mockReset(); localStorage.clear(); });
test('leaves no native listeners after repeated mounting and StrictMode replay', async () => {
  const native = new Set();
  vi.mocked(listen).mockImplementation(async (_name, handler) => { native.add(handler); return () => { native.delete(handler); }; });
  for (let n = 0; n < 30; n++) {
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<StrictMode><PlayTimeStats instanceId="test" /></StrictMode>));
    expect(native.size).toBe(1);
    await act(async () => root.unmount());
    expect(native.size).toBe(0);
  }
});
test('updates the correct instance and removes a listener registered after unmount', async () => {
  const container = document.createElement('div'), root = createRoot(container);
  let handler: any, complete!: (fn: () => void) => void;
  const unlisten = vi.fn();
  vi.mocked(listen).mockImplementation((_name, callback) => { handler = callback; return new Promise(resolve => complete = resolve); });
  localStorage.setItem('playtime_test', '1');
  await act(async () => root.render(<PlayTimeStats instanceId="test" />));
  expect(container.textContent).toBe('1 hours');
  localStorage.setItem('playtime_test', '2');
  await act(async () => handler({ payload: { instance_id: 'other' } }));
  expect(container.textContent).toBe('1 hours');
  await act(async () => handler({ payload: { instance_id: 'test' } }));
  expect(container.textContent).toBe('2 hours');
  await act(async () => root.unmount());
  await act(async () => complete(unlisten));
  expect(unlisten).toHaveBeenCalledTimes(1);
});
