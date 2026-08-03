/**
 * Single source of truth for the supported languages.
 * Adding a language: create `locales/<code>/` with the same namespace files as
 * `locales/en/`, register it in `resources.ts`, add an entry here and map its
 * flag in `components/LanguageFlag.tsx`.
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

/** `auto` follows the operating system locale. */
export type LanguagePreference = 'auto' | LanguageCode;

export const FALLBACK_LANGUAGE: LanguageCode = 'en';

export const AUTO_LANGUAGE = 'auto';

export const NAMESPACES = [
  'common',
  'home',
  'instance',
  'settings',
  'updater',
  'skins',
  'auth',
  'errors',
  'notifications',
] as const;

export const DEFAULT_NAMESPACE = 'common';

const languageCodes = SUPPORTED_LANGUAGES.map((language) => language.code) as readonly string[];

export function isLanguageCode(value: string | null | undefined): value is LanguageCode {
  return typeof value === 'string' && languageCodes.includes(value);
}

export function isLanguagePreference(value: string | null | undefined): value is LanguagePreference {
  return value === AUTO_LANGUAGE || isLanguageCode(value);
}

/**
 * Maps an OS/browser locale (`es-ES`, `es-419`, `en_US`) to a supported code.
 * Returns null when there is no match so callers can decide the fallback.
 */
export function normalizeLocale(locale: string | null | undefined): LanguageCode | null {
  if (!locale) return null;

  const normalized = locale.replace('_', '-').toLowerCase();

  const exact = languageCodes.find((code) => code === normalized);
  if (exact) return exact as LanguageCode;

  const base = normalized.split('-')[0];
  const partial = languageCodes.find((code) => code.split('-')[0] === base);

  return (partial as LanguageCode) ?? null;
}
