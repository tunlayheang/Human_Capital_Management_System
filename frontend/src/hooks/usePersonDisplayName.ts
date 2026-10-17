import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { resolvePersonDisplayName } from '../utils/personDisplayName';
import type { EnrichedUserLike } from '../utils/userProfile';

/** Full localized person name (Khmer or English) for the current UI language. */
export function usePersonDisplayName(u?: EnrichedUserLike | null): string {
  const { user } = useAuth();
  const { language } = useLanguage();
  const subject = u ?? user;
  return useMemo(
    () => resolvePersonDisplayName(subject, language),
    [subject, language]
  );
}
