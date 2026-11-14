import { useSyncExternalStore } from 'react';

const KEY = 'valthorne_animated_backgrounds';
const EVENT = 'valthorne-background-preference';
let override: boolean | undefined;
function snapshot() {
  if (override !== undefined) return override;
  try { return localStorage.getItem(KEY) === 'true'; } catch { return false; }
}
function subscribe(changed: () => void) {
  window.addEventListener(EVENT, changed);
  const storage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) { override = undefined; changed(); } };
  window.addEventListener('storage', storage);
  return () => { window.removeEventListener(EVENT, changed); window.removeEventListener('storage', storage); };
}
export function setAnimatedBackgrounds(enabled: boolean) {
  override = enabled;
  try { localStorage.setItem(KEY, String(enabled)); override = undefined; } catch {}
  window.dispatchEvent(new Event(EVENT));
}
export function useAnimatedBackgrounds() { return useSyncExternalStore(subscribe, snapshot, () => false); }
