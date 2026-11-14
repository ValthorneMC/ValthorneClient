import { useEffect, useRef, useState } from 'react';
import { releaseTexture } from '@/lib/skin-rendering/skin-rendering';

class SkinObjectUrls extends Map<string, string> {
  private closed = false;
  open() { this.closed = false; }
  close() { this.closed = true; this.clear(); }
  private dispose(url: string) { releaseTexture(url); URL.revokeObjectURL(url); }
  override set(key: string, url: string): this {
    if (this.closed) { this.dispose(url); return this; }
    const previous = this.get(key);
    if (previous && previous !== url) this.dispose(previous);
    return super.set(key, url);
  }
  override delete(key: string): boolean {
    const previous = this.get(key);
    if (previous) this.dispose(previous);
    return super.delete(key);
  }
  override clear() {
    for (const url of this.values()) this.dispose(url);
    super.clear();
  }
}

export function useSkinObjectUrls() {
  const [urls] = useState(() => new SkinObjectUrls());
  const ref = useRef(urls);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    urls.open();
    return () => {
      mounted.current = false;
      // A StrictMode effect replay reuses the same live component and its URLs.
      queueMicrotask(() => { if (!mounted.current) urls.close(); });
    };
  }, [urls]);
  return ref;
}
