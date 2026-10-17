// @refresh reset
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { en } from '../i18n/en';
import { km } from '../i18n/km';
import type { Language, Translations } from '../i18n/types';
import { COMPANY_LOCALE_CHANGED_EVENT, type CompanyLanguage } from '../utils/companyLocaleSettings';

export type { Language } from '../i18n/types';

const TRANSLATIONS: Record<Language, Translations> = { en, km };

function parseStoredLanguage(): Language {
  const stored = localStorage.getItem('hcms_lang');
  return stored === 'km' ? 'km' : 'en';
}

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (path: string, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

function readTranslation(table: Translations, path: string): string | undefined {
  const keys = path.split('.');
  let current: string | Translations | undefined = table;

  for (const key of keys) {
    if (current === undefined || typeof current === 'string') return undefined;
    current = current[key];
  }

  return typeof current === 'string' ? current : undefined;
}

function humanizeKey(path: string): string {
  const lastKey = path.split('.').pop() || path;
  return lastKey
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (char) => char.toUpperCase());
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`));
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(parseStoredLanguage);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang === 'km' ? 'km' : 'en');
  }, []);

  useEffect(() => {
    localStorage.setItem('hcms_lang', language);
    document.documentElement.lang = language === 'km' ? 'km' : 'en';
  }, [language]);

  useEffect(() => {
    const onLocaleChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { language?: CompanyLanguage } | undefined;
      const next = detail?.language;
      if (next !== 'en' && next !== 'km') return;
      if (next === language) return;
      setLanguageState(next);
    };
    window.addEventListener(COMPANY_LOCALE_CHANGED_EVENT, onLocaleChanged);
    return () => window.removeEventListener(COMPANY_LOCALE_CHANGED_EVENT, onLocaleChanged);
  }, [language]);

  const t = useCallback(
    (path: string, vars?: Record<string, string | number>): string => {
      if (!path?.trim()) {
        return '';
      }
      const primary = TRANSLATIONS[language];
      const translated =
        readTranslation(primary, path) ||
        (language !== 'en' ? readTranslation(TRANSLATIONS.en, path) : undefined);
      if (!translated) {
        if (import.meta.env.DEV) {
          console.warn(`Translation missing for key: ${path} in language: ${language}`);
        }
        return interpolate(humanizeKey(path), vars);
      }
      return interpolate(translated, vars);
    },
    [language]
  );

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within a LanguageProvider');
  return context;
};
