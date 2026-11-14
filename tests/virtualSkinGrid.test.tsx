import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { VirtualSkinGrid } from '../src/components/skin/VirtualSkinGrid';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
test('keeps only visible rows mounted across scrolling and resizing a 500-skin library', async () => {
  const host=document.createElement('div'); document.body.append(host); const root=createRoot(host);
  let width=680; let pending: FrameRequestCallback | null = null; let resized!:()=>void; const disconnect=vi.fn();
  vi.stubGlobal('ResizeObserver',class { constructor(callback:()=>void){resized=callback;} observe(){} disconnect=disconnect; });
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{pending=callback;return 1;}); vi.stubGlobal('cancelAnimationFrame',vi.fn());
  vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockImplementation(()=>width);
  vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){return {top:this.classList.contains('grid')?40-(host.querySelector<HTMLElement>('[data-skin-scroll]')?.scrollTop??0):0} as DOMRect;});
  try {
    await act(async()=>root.render(<div data-skin-scroll><VirtualSkinGrid>{Array.from({length:500},(_,n)=><span key={n}>{n}</span>)}</VirtualSkinGrid></div>));
    const grid=host.querySelector<HTMLElement>('.grid')!; expect(grid.children.length).toBeLessThanOrEqual(24); expect(grid.textContent).toContain('0');
    const scroll=host.querySelector<HTMLElement>('[data-skin-scroll]')!;
    await act(async()=>{scroll.scrollTop=10000;scroll.dispatchEvent(new Event('scroll')); pending!(0);});
    expect(grid.children.length).toBeLessThanOrEqual(24); expect(grid.firstElementChild?.textContent).not.toBe('0'); expect(parseFloat(grid.style.paddingTop)).toBeGreaterThan(0);
    await act(async()=>{width=340;resized();pending!(0);}); expect(grid.style.gridTemplateColumns).toContain('repeat(2'); expect(grid.children.length).toBeLessThanOrEqual(14);
  } finally {await act(async()=>root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();}
  expect(disconnect).toHaveBeenCalledTimes(1);
});
