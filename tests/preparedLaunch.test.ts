import { beforeEach, expect, test, vi } from 'vitest';
const m = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: m.listen }));
import { prepareAndLaunch } from '../src/services/preparedLaunch';
beforeEach(() => { vi.clearAllMocks(); });
test('subscribes before one combined preparation and launch, then releases both listeners', async () => {
  const release = vi.fn(), complete = vi.fn(), progress = vi.fn(); const handlers = new Map<string, any>();
  m.listen.mockImplementation(async (name, handler) => { handlers.set(name, handler); return release; });
  m.invoke.mockImplementation(async () => {
    expect(handlers.size).toBe(2); handlers.get('asset-download-progress')({payload:{percentage:50}});
    handlers.get('asset-download-completed')({payload:{phase:'mods'}}); expect(complete).not.toHaveBeenCalled();
    handlers.get('asset-download-completed')({payload:{phase:'complete'}}); return 'ok';
  });
  expect(await prepareAndLaunch({instanceId:'test'},progress,complete)).toBe('ok');
  expect(m.invoke).toHaveBeenCalledExactlyOnceWith('prepare_and_launch_minecraft',{instanceId:'test'});
  expect(progress).toHaveBeenCalledWith({percentage:50}); expect(complete).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledTimes(2);
});
test('releases partial subscriptions and failed launches', async () => {
  const release = vi.fn(); m.listen.mockResolvedValueOnce(release).mockRejectedValueOnce(new Error('subscribe'));
  await expect(prepareAndLaunch({},vi.fn(),vi.fn())).rejects.toThrow('subscribe'); expect(release).toHaveBeenCalledTimes(1); expect(m.invoke).not.toHaveBeenCalled();
  m.listen.mockResolvedValue(release); m.invoke.mockRejectedValue(new Error('prepare'));
  await expect(prepareAndLaunch({},vi.fn(),vi.fn())).rejects.toThrow('prepare'); expect(release).toHaveBeenCalledTimes(3);
});
