import React, { useEffect, useState } from 'react';
import { X, Mail, Phone, Briefcase, BadgeCheck } from 'lucide-react';
import { User } from '../../types';
import { Api } from '../../services/api';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import {
  chatAvatarFallbackUrl,
  formatPresenceLabel,
  isUserOnline,
  resolveDisplayEmployeeId,
} from './chatUtils';
import { useLanguage } from '../../context/LanguageContext';
import { AppOverlay } from '../ui/AppOverlay';
import { overlayPanelClass } from '../../utils/overlayPanel';
import { ContentSkeleton } from '../common/ContentSkeleton';

type Props = {
  userId: string;
  fallback?: User;
  onClose: () => void;
  overlayHostRef?: React.RefObject<HTMLElement | null>;
};

function ProfileRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-xl px-3 py-2.5 bg-slate-50/90 dark:bg-slate-800/60 transition-colors">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white dark:bg-slate-700 shadow-sm">
        <Icon className="w-4 h-4 text-primary" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 text-left">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{value}</p>
      </div>
    </li>
  );
}

export const ChatContactProfileModal: React.FC<Props> = ({
  userId,
  fallback,
  onClose,
  overlayHostRef,
}) => {
  const { t } = useLanguage();
  const [profile, setProfile] = useState<User | null>(fallback ?? null);
  const [loading, setLoading] = useState(!fallback);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Api.chat
      .getContactProfile(userId)
      .then((data) => {
        if (!cancelled) setProfile(data as User);
      })
      .catch(() => {
        if (!cancelled && fallback) setProfile(fallback);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, fallback]);

  const online = isUserOnline(profile ?? undefined);
  const presence = formatPresenceLabel(profile ?? undefined, t);
  const displayId = resolveDisplayEmployeeId(profile ?? undefined);

  return (
    <AppOverlay
      open
      onClose={onClose}
      zIndexClass={overlayHostRef ? 'z-[60]' : 'z-[280]'}
      hostRef={overlayHostRef}
      lockScroll={!overlayHostRef}
    >
      <div
        className={overlayPanelClass(
          'md',
          'rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200/80 dark:border-slate-700 overflow-hidden animate-in zoom-in-95 duration-200'
        )}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hcms-modal-header bg-white/95 dark:bg-slate-900/95">
          <h3 className="font-semibold text-slate-900 dark:text-white">
            {t('chat.contactProfile') || 'Contact info'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {loading ? (
          <div className="p-5">
            <ContentSkeleton layout="form" rows={1} label={t('chat.loading') || 'Loading…'} />
          </div>
        ) : profile ? (
          <div className="p-5 flex flex-col items-center">
            <div className="relative">
              <img
                src={
                  resolveMediaUrl(profile.avatarUrl) || chatAvatarFallbackUrl(profile.name)
                }
                alt=""
                className="w-24 h-24 rounded-full object-cover ring-4 ring-primary/15 border-2 border-white dark:border-slate-800 shadow-md"
              />
              {online && (
                <span
                  className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900"
                  aria-hidden
                />
              )}
            </div>
            <h4 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">{profile.name}</h4>
            <p
              className={`text-sm mt-1 ${online ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-slate-500'}`}
            >
              {presence}
            </p>
            <ul className="mt-5 w-full space-y-2">
              {profile.position && (
                <ProfileRow
                  icon={Briefcase}
                  label={t('chat.fieldRole') || 'Role'}
                  value={profile.position}
                />
              )}
              {profile.email && (
                <ProfileRow icon={Mail} label={t('chat.fieldEmail') || 'Email'} value={profile.email} />
              )}
              {profile.phone && (
                <ProfileRow icon={Phone} label={t('chat.fieldPhone') || 'Phone'} value={profile.phone} />
              )}
              {displayId && (
                <ProfileRow
                  icon={BadgeCheck}
                  label={t('chat.displayId') || 'Display ID'}
                  value={displayId}
                />
              )}
            </ul>
          </div>
        ) : (
          <p className="p-8 text-center text-sm text-slate-400">
            {t('chat.contactNotFound') || 'Could not load profile.'}
          </p>
        )}
      </div>
    </AppOverlay>
  );
};
