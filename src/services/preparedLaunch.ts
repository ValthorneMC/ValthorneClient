import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export async function prepareAndLaunch(
  args: Record<string, unknown>,
  onProgress: (payload: any) => void,
  onComplete: () => void,
): Promise<string> {
  const cleanups: (() => void)[] = [];
  try {
    cleanups.push(await listen('asset-download-progress', event => onProgress(event.payload)));
    cleanups.push(await listen<{ phase?: string }>('asset-download-completed', event => {
      if (!event.payload?.phase || event.payload.phase === 'complete') onComplete();
    }));
    return await invoke<string>('prepare_and_launch_minecraft', args);
  } finally {
    cleanups.forEach(cleanup => cleanup());
  }
}
