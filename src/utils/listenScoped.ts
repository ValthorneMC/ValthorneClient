import { listen } from '@tauri-apps/api/event';
import type { EventCallback, EventName, UnlistenFn } from '@tauri-apps/api/event';

/** Returns a cleanup immediately, including when native registration completes later. */
export function listenScoped<T>(name: EventName, callback: EventCallback<T>, onError?: (error: unknown) => void): UnlistenFn {
  let closed = false;
  let unlisten: UnlistenFn | undefined;
  const release = (fn: UnlistenFn) => { try { fn(); } catch {} };
  void listen<T>(name, event => { if (!closed) callback(event); }).then(fn => {
    if (closed) release(fn);
    else unlisten = fn;
  }).catch(error => { if (!closed) onError?.(error); });
  return () => {
    closed = true;
    const previous = unlisten;
    unlisten = undefined;
    if (previous) release(previous);
  };
}
