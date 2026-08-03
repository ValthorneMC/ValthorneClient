import React from 'react';
import { Globe } from 'lucide-react';
import { ES, US } from 'country-flag-icons/react/3x2';
import { AUTO_LANGUAGE, type LanguagePreference } from '@/i18n';

type FlagComponent = React.ComponentType<{ className?: string; title?: string }>;

/**
 * Flag artwork per language. Windows has no flag emoji, so these come from
 * `country-flag-icons` (MIT) instead. `auto` uses a globe.
 */
const FLAGS: Record<string, FlagComponent> = {
  en: US,
  es: ES,
};

interface LanguageFlagProps {
  language: LanguagePreference;
  title?: string;
  className?: string;
}

export const LanguageFlag: React.FC<LanguageFlagProps> = ({
  language,
  title,
  className = 'w-5 h-auto rounded-[2px]',
}) => {
  if (language === AUTO_LANGUAGE) {
    return <Globe className={className} aria-label={title} />;
  }

  const Flag = FLAGS[language];
  if (!Flag) {
    return <Globe className={className} aria-label={title} />;
  }

  return <Flag className={className} title={title} />;
};

export default LanguageFlag;
