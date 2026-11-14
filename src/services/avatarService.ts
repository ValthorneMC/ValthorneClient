export type AvatarProvider = 'minotar' | 'mcheads';

const PROVIDER_CACHE_KEY = 'avatar_provider_cache';
const CACHE_DURATION = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 128;
const resolvedAvatars = new Map<string, { url: string; expires: number }>();
const pendingAvatars = new Map<string, Promise<string | null>>();

interface ProviderCache {
  [uuid: string]: {
    provider: AvatarProvider;
    timestamp: number;
  };
}

function getCachedProvider(uuid: string): AvatarProvider | null {
  try {
    const cached = localStorage.getItem(PROVIDER_CACHE_KEY);
    if (!cached) return null;
    
    const cache: ProviderCache = JSON.parse(cached);
    const entry = cache[uuid];
    
    if (entry && Date.now() - entry.timestamp < CACHE_DURATION) {
      return entry.provider;
    }
    
    return null;
  } catch {
    return null;
  }
}

function setCachedProvider(uuid: string, provider: AvatarProvider): void {
  try {
    const cached = localStorage.getItem(PROVIDER_CACHE_KEY);
    const cache: ProviderCache = cached ? JSON.parse(cached) : {};
    
    cache[uuid] = {
      provider,
      timestamp: Date.now()
    };
    
    const entries = Object.entries(cache).filter(([, entry]) => Date.now() - entry.timestamp < CACHE_DURATION)
      .sort((a, b) => b[1].timestamp - a[1].timestamp).slice(0, MAX_CACHE_ENTRIES);
    localStorage.setItem(PROVIDER_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {}
}

function getAvatarUrl(provider: AvatarProvider, uuid: string, size: number, overlay: boolean = true): string {
  const uuidClean = uuid.replace(/-/g, '');
  
  switch (provider) {
    case 'minotar':
      const endpoint = overlay ? 'helm' : 'avatar';
      return `https://minotar.net/${endpoint}/${uuidClean}/${size}`;
    case 'mcheads':
      return `https://mc-heads.net/avatar/${uuidClean}/${size}`;
    default:
      return '';
  }
}

function createPlaceholderSvg(username: string, size: number): string {
  const initial = username.charAt(0).toUpperCase();
  const colors = [
    { bg: '#4A90E2', text: '#FFFFFF' },
    { bg: '#50C878', text: '#FFFFFF' },
    { bg: '#FF6B6B', text: '#FFFFFF' },
    { bg: '#FFA500', text: '#FFFFFF' },
    { bg: '#9B59B6', text: '#FFFFFF' },
    { bg: '#1ABC9C', text: '#FFFFFF' },
  ];
  const colorIndex = initial.charCodeAt(0) % colors.length;
  const color = colors[colorIndex];
  
  return `data:image/svg+xml;base64,${btoa(`
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${color.bg};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${color.bg}dd;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="url(#grad)"/>
      <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="${size * 0.4}" font-weight="bold" text-anchor="middle" dominant-baseline="central" fill="${color.text}">
        ${initial}
      </text>
    </svg>
  `)}`;
}

async function testProvider(provider: AvatarProvider, uuid: string, size: number, overlay: boolean): Promise<string | null> {
  const url = getAvatarUrl(provider, uuid, size, overlay);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(url, { method: 'HEAD', signal: controller.signal });
    return response.ok ? url : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function loadAvatarWithFallback(
  uuid: string,
  username: string,
  size = 64,
  overlay = true,
  failedUrl?: string,
): Promise<string> {
  const key = `${uuid.replace(/-/g, '')}:${size}:${overlay}`;
  if (failedUrl) resolvedAvatars.delete(key);
  const cached = resolvedAvatars.get(key);
  if (cached && cached.expires > Date.now()) {
    resolvedAvatars.delete(key);
    resolvedAvatars.set(key, cached);
    return cached.url;
  }
  resolvedAvatars.delete(key);
  const requestKey = `${key}:${failedUrl ?? ''}`;
  let pending = pendingAvatars.get(requestKey);
  if (!pending) {
    pending = (async () => {
      const preferred = getCachedProvider(uuid) ?? 'minotar';
      const providers: AvatarProvider[] = [preferred, preferred === 'minotar' ? 'mcheads' : 'minotar'];
      for (const provider of providers) {
        if (getAvatarUrl(provider, uuid, size, overlay) === failedUrl) continue;
        const url = await testProvider(provider, uuid, size, overlay);
        if (!url) continue;
        setCachedProvider(uuid, provider);
        resolvedAvatars.set(key, { url, expires: Date.now() + 5 * 60 * 1000 });
        while (resolvedAvatars.size > MAX_CACHE_ENTRIES) resolvedAvatars.delete(resolvedAvatars.keys().next().value!);
        return url;
      }
      return null;
    })().finally(() => pendingAvatars.delete(requestKey));
    pendingAvatars.set(requestKey, pending);
  }
  return (await pending) ?? createPlaceholderSvg(username, size);
}

function getSkinTextureUrl(provider: AvatarProvider, uuid: string): string {
  const uuidClean = uuid.replace(/-/g, '');

  switch (provider) {
    case 'minotar':
      return `https://minotar.net/skin/${uuidClean}`;
    case 'mcheads':
      return `https://mc-heads.net/skin/${uuidClean}`;
    default:
      return '';
  }
}

// Synchronous best-effort skin texture URL: reuses whichever provider last
// worked for this UUID's avatar (cached by loadAvatarWithFallback), or falls
// back to minotar if nothing is cached yet.
export function getBestSkinTextureUrl(uuid: string): string {
  const provider = getCachedProvider(uuid) ?? 'minotar';
  return getSkinTextureUrl(provider, uuid);
}

export function createAvatarPlaceholder(username: string, size: number = 64): string {
  return createPlaceholderSvg(username, size);
}
