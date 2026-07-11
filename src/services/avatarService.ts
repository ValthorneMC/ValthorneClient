export type AvatarProvider = 'crafatar' | 'minotar' | 'mcheads';

const PROVIDER_CACHE_KEY = 'avatar_provider_cache';
const CACHE_DURATION = 24 * 60 * 60 * 1000;

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
    
    localStorage.setItem(PROVIDER_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function getAvatarUrl(provider: AvatarProvider, uuid: string, size: number, overlay: boolean = true): string {
  const uuidClean = uuid.replace(/-/g, '');
  
  switch (provider) {
    case 'crafatar':
      return `https://crafatar.com/avatars/${uuid}?size=${size}${overlay ? '&overlay=true' : ''}`;
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
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-cache'
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      return url;
    }
  } catch {}
  
  return null;
}

export async function loadAvatarWithFallback(
  uuid: string,
  username: string,
  size: number = 64,
  overlay: boolean = true
): Promise<string> {
  const cachedProvider = getCachedProvider(uuid);
  const allProviders: AvatarProvider[] = ['crafatar', 'minotar', 'mcheads'];
  const providers: AvatarProvider[] = cachedProvider 
    ? [cachedProvider, ...allProviders].filter((p, i, arr) => arr.indexOf(p) === i) as AvatarProvider[]
    : allProviders;

  const promises = providers.map(provider => 
    testProvider(provider, uuid, size, overlay).then(url => ({ provider, url }))
  );

  try {
    const results = await Promise.allSettled(promises);
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.url) {
        setCachedProvider(uuid, result.value.provider);
        return result.value.url;
      }
    }
  } catch {}

  return createPlaceholderSvg(username, size);
}

export function getAvatarUrlFromProvider(
  provider: AvatarProvider,
  uuid: string,
  size: number = 64,
  overlay: boolean = true
): string {
  return getAvatarUrl(provider, uuid, size, overlay);
}

export function createAvatarPlaceholder(username: string, size: number = 64): string {
  return createPlaceholderSvg(username, size);
}
