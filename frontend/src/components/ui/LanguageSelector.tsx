import React, { useCallback } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { Globe } from 'lucide-react';

const LANG_META = {
  en: { flag: '🇺🇸' },
  km: { flag: '🇰🇭' },
} as const;

export const LanguageSelector: React.FC = () => {
  const { language, setLanguage, t } = useLanguage();

  const toggleLanguage = useCallback(() => {
    setLanguage(language === 'en' ? 'km' : 'en');
  }, [language, setLanguage]);

  const current = LANG_META[language];

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      className="p-2 sm:px-2.5 sm:py-2 rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all hover:scale-105 active:scale-95 flex items-center gap-1.5 group shrink-0"
      aria-label={
        language === 'en' ? t('language.switchToKhmer') : t('language.switchToEnglish')
      }
      title={language === 'en' ? t('language.switchToKhmer') : t('language.switchToEnglish')}
    >
      <Globe className="w-5 h-5 group-hover:text-primary-500 transition-colors shrink-0" />
      <span className="text-sm leading-none" aria-hidden>
        {current.flag}
      </span>
      <span className="sr-only">
        {language === 'en' ? t('language.english') : t('language.khmer')}
      </span>
    </button>
  );
};
