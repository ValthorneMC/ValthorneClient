import { invoke } from '@tauri-apps/api/core';
import { locale as osLocale } from '@tauri-apps/plugin-os';
import {
  AUTO_LANGUAGE,
  FALLBACK_LANGUAGE,
  isLanguagePreference,
  normalizeLocale,
  type LanguageCode,
  type LanguagePreference,
} from './config';

/** Reads the persisted preference from the launcher config file. */
export async function loadLanguagePreference(): Promise<LanguagePreference> {
  try {
    const stored = await invoke<string>('load_language');
    return isLanguagePreference(stored) ? stored : AUTO_LANGUAGE;
  } catch {
    return AUTO_LANGUAGE;
  }
}

export async function saveLanguagePreference(preference: LanguagePreference): Promise<void> {
  await invoke('save_language', { language: preference });
}

/** Detects the language from the OS locale, falling back to the webview locale. */
export async function detectSystemLanguage(): Promise<LanguageCode> {
  try {
    const detected = normalizeLocale(await osLocale());
    if (detected) return detected;
  } catch {
    // The OS plugin is unavailable (e.g. running outside Tauri): use the webview
  }

  return normalizeLocale(navigator.language) ?? FALLBACK_LANGUAGE;
}

/** Resolves a preference into the concrete language the UI should render in. */
export async function resolveLanguage(preference: LanguagePreference): Promise<LanguageCode> {
  return preference === AUTO_LANGUAGE ? detectSystemLanguage() : preference;
}
