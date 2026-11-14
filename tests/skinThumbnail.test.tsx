import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { SkinThumbnail } from '../src/components/skin/SkinThumbnail';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
test('draws one static front view without WebGL and releases pending images on source changes', async () => {
  const images:any[]=[]; const draw=vi.fn(), getContext=vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({clearRect:vi.fn(),drawImage:draw,imageSmoothingEnabled:true} as any);
  vi.stubGlobal('Image',class {onload:any;onerror:any;src='';naturalWidth=64;naturalHeight=64;constructor(){images.push(this);}});
  const host=document.createElement('div'),root=createRoot(host);
  try {
    await act(async()=>root.render(<SkinThumbnail src="http://textures.minecraft.net/skin" label="first"/>)); expect(images[0].src).toBe('https://textures.minecraft.net/skin');
    await act(async()=>images[0].onload()); expect(draw).toHaveBeenCalledTimes(12); expect(getContext).toHaveBeenCalledWith('2d');
    await act(async()=>root.render(<SkinThumbnail src="next" slim label="next"/>)); expect(images[0].onload).toBeNull(); expect(images[0].src).toBe('');
    await act(async()=>images[1].onerror()); expect(host.textContent).toBe('next');
  } finally {await act(async()=>root.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks();}
});
