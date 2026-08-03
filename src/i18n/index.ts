import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  DEFAULT_NAMESPACE,
  FALLBACK_LANGUAGE,
  NAMESPACES,
  type LanguageCode,
  type LanguagePreference,
} from './config';
import { loadLanguagePreference, resolveLanguage, saveLanguagePreference } from './language';
import { resources } from './resources';

/**
 * Initializes i18next before the first render so the UI never flashes
 * untranslated content. Resolves the persisted preference, falling back to the
 * operating system locale when it is set to `auto`.
 */
export async function bootstrapI18n(): Promise<LanguageCode> {
  const preference = await loadLanguagePreference();
  const language = await resolveLanguage(preference);

  await i18n.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: FALLBACK_LANGUAGE,
    ns: [...NAMESPACES],
    defaultNS: DEFAULT_NAMESPACE,
    interpolation: { escapeValue: false },
  });

  return language;
}

/** Persists the preference and applies it immediately, without a restart. */
export async function changeLanguage(preference: LanguagePreference): Promise<LanguageCode> {
  const language = await resolveLanguage(preference);
  await i18n.changeLanguage(language);
  await saveLanguagePreference(preference);
  return language;
}

/**
 * Translates an error coming from the Rust backend. Backend errors are stable
 * codes (`error.auth.timeout`), optionally followed by positional parameters
 * (`error.skin.invalid_size|64x32`). Anything that is not a known code is shown
 * as-is, so unmigrated messages still reach the user.
 */
export function translateBackendError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const [code, ...params] = raw.split('|');

  if (!code.startsWith('error.')) {
    return raw;
  }

  const values = Object.fromEntries(params.map((value, index) => [index, value]));

  // Backend codes are dynamic, so the typed `t()` signature does not apply here
  const translate = i18n.t as unknown as (key: string, options: object) => string;

  return translate(code, { ns: 'errors', defaultValue: raw, ...values });
}

export { i18n };
export * from './config';
export { loadLanguagePreference, saveLanguagePreference } from './language';
