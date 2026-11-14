import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { useAnimatedBackgrounds, setAnimatedBackgrounds } from '../src/hooks/useAnimatedBackgrounds';
import { useBackgroundVideoPlayback } from '../src/hooks/useBackgroundVideoPlayback';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
test('uses a static default and propagates persisted animation preferences to mounted views', async () => {
  localStorage.clear(); const host=document.createElement('div'),root=createRoot(host);
  function Probe(){const enabled=useAnimatedBackgrounds();return <span>{String(enabled)}</span>;}
  try {
    await act(async()=>root.render(<Probe/>)); expect(host.textContent).toBe('false');
    await act(async()=>setAnimatedBackgrounds(true)); expect(host.textContent).toBe('true'); expect(localStorage.getItem('valthorne_animated_backgrounds')).toBe('true');
    await act(async()=>setAnimatedBackgrounds(false)); expect(host.textContent).toBe('false');
  } finally {await act(async()=>root.unmount()); localStorage.clear();}
});
test('pauses unfocused and hidden videos and removes playback listeners on unmount', async () => {
  let focused=true,hidden=false;
  vi.spyOn(document,'hasFocus').mockImplementation(()=>focused); vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
  const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue(); const pause=vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
  function Probe(){const ref=useRef<HTMLVideoElement>(null);useBackgroundVideoPlayback(ref,'video');return <video ref={ref}/>;}
  const root=createRoot(document.createElement('div'));
  try {
    await act(async()=>root.render(<Probe/>)); expect(play).toHaveBeenCalledTimes(1);
    focused=false; window.dispatchEvent(new Event('blur')); expect(pause).toHaveBeenCalledTimes(1);
    focused=true; window.dispatchEvent(new Event('focus')); expect(play).toHaveBeenCalledTimes(2);
    hidden=true; document.dispatchEvent(new Event('visibilitychange')); expect(pause).toHaveBeenCalledTimes(2);
    await act(async()=>root.unmount()); const calls=pause.mock.calls.length; window.dispatchEvent(new Event('blur')); expect(pause).toHaveBeenCalledTimes(calls);
  } finally {await act(async()=>root.unmount()); vi.restoreAllMocks();}
});

test('keeps the preference usable when persistence fails', async () => {
  localStorage.clear(); const host=document.createElement('div'),root=createRoot(host);
  function Probe(){return <span>{String(useAnimatedBackgrounds())}</span>;}
  const save=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
  try {
    await act(async()=>root.render(<Probe/>)); await act(async()=>setAnimatedBackgrounds(true)); expect(host.textContent).toBe('true');
  } finally {save.mockRestore(); await act(async()=>setAnimatedBackgrounds(false)); await act(async()=>root.unmount()); localStorage.clear();}
});
