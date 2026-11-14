import { useEffect, useRef, useState } from 'react';
import { normalizeTextureUrl } from '@/lib/skin-rendering/skin-rendering';

// Front-facing texture regions; each overlay is drawn after its base region.
const REGIONS = [
  [8,8,8,8,4,0], [40,8,8,8,4,0],
  [20,20,8,12,4,8], [20,36,8,12,4,8],
  [44,20,4,12,0,8], [44,36,4,12,0,8],
  [36,52,4,12,12,8], [52,52,4,12,12,8],
  [4,20,4,12,4,20], [4,36,4,12,4,20],
  [20,52,4,12,8,20], [4,52,4,12,8,20],
];
export function SkinThumbnail({ src, slim = false, label }: { src: string; slim?: boolean; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    setFailed(false);
    if (canvas.current) { canvas.current.width = 64; canvas.current.height = 128; }
    image.onload = () => {
      if (cancelled) return;
      if (image.naturalWidth !== 64 || ![32,64].includes(image.naturalHeight)) { setFailed(true); return; }
      const context = canvas.current?.getContext('2d');
      if (!context) return;
      context.clearRect(0,0,64,128);
      context.imageSmoothingEnabled = false;
      const legacy = image.naturalHeight === 32;
      for (let index = 0; index < REGIONS.length; index++) {
        let [sx,sy,width,height,x,y] = REGIONS[index];
        if (legacy && sy >= 32) {
          if (index === 6) { sx = 44; sy = 20; }
          else if (index === 10) { sx = 4; sy = 20; }
          else continue;
        }
        if (slim && (index >= 4 && index <= 7)) { width = 3; if (x === 0) x = 1; }
        context.drawImage(image,sx,sy,width,height,x*4,y*4,width*4,height*4);
      }
    };
    image.onerror = () => { if (!cancelled) setFailed(true); };
    image.src = normalizeTextureUrl(src);
    return () => { cancelled = true; image.onload = image.onerror = null; image.src = ''; if (canvas.current) canvas.current.width = 0; };
  }, [src, slim]);
  return <div className="w-full h-full flex items-center justify-center p-4" role="img" aria-label={label}>
    {failed ? <span className="text-white/40 text-xs text-center">{label}</span> : null}
    <canvas ref={canvas} width={64} height={128} className={failed ? 'hidden' : 'max-w-full h-full max-h-full object-contain'} style={{imageRendering:'pixelated'}} />
  </div>;
}
