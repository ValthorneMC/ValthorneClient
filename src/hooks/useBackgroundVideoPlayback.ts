import { useEffect } from 'react';
import type { RefObject } from 'react';

export function useBackgroundVideoPlayback(ref: RefObject<HTMLVideoElement | null>, source: string | null) {
  useEffect(() => {
    const video = ref.current;
    if (!video || !source) return;
    const update = () => {
      if (document.hidden || !document.hasFocus()) video.pause();
      else void video.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    update();
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      video.pause();
    };
  }, [ref, source]);
}
