import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Api } from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';
import { useNotification } from '../../context/NotificationContext';
import { useChat } from '../../context/ChatContext';
import { ChatAnnouncement } from '../../types';

type TickerSegment = {
  id: string;
  text: string;
  announcer: string;
};

function formatTickerLine(ann: ChatAnnouncement): string {
  const title = String(ann.title ?? '').trim();
  const body = String(ann.content ?? '').trim().replace(/\s+/g, ' ');
  if (title && body) return `${title}: ${body}`;
  return title || body;
}

function formatAnnouncer(ann: ChatAnnouncement, fallback: string): string {
  const name = String(ann.senderName ?? '').trim();
  return name || fallback;
}

function buildSegments(items: ChatAnnouncement[], announcerFallback: string): TickerSegment[] {
  return items
    .map((ann) => ({
      id: ann.id,
      text: formatTickerLine(ann),
      announcer: formatAnnouncer(ann, announcerFallback),
    }))
    .filter((s) => Boolean(s.text));
}

function segmentsTickerLength(segments: TickerSegment[]): number {
  return segments.reduce((sum, s) => sum + s.text.length + s.announcer.length, 0);
}

type Props = {
  /** Pin above fixed bottom nav on phones/tablets (< lg). */
  pinAboveMobileNav?: boolean;
};

export const DashboardAnnouncementTicker: React.FC<Props> = ({ pinAboveMobileNav = false }) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh: refreshNotifications } = useNotification();
  const { refreshUnread: refreshChatUnread } = useChat();
  const [items, setItems] = useState<ChatAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissing, setDismissing] = useState(false);

  const announcerFallback =
    t('dashboard.announcementTicker.unknownAnnouncer') || 'Management';

  const load = useCallback(async () => {
    try {
      const rows = await Api.chat.getAnnouncements('dashboard');
      const list = Array.isArray(rows) ? (rows as ChatAnnouncement[]) : [];
      const unread = list.filter((a) => !a.read && Boolean(formatTickerLine(a)));
      // Show only the most recent announcement on the dashboard.
      const latest = unread
        .slice()
        .sort(
          (a, b) =>
            new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
        )
        .slice(0, 1);
      setItems(latest);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, [load, location.pathname]);

  const handleOpen = useCallback(async () => {
    if (dismissing) return;
    setDismissing(true);
    // Hide the ticker immediately; mark-all-read clears every queued announcement for this user.
    setItems([]);
    try {
      await Api.chat.markAnnouncementsRead();
      void refreshNotifications();
      void refreshChatUnread();
    } catch {
      /* still navigate — chat view will retry mark-read */
    } finally {
      setDismissing(false);
    }
    navigate('/chat?announcements=1');
  }, [dismissing, navigate, refreshNotifications, refreshChatUnread]);

  const segments = useMemo(
    () => buildSegments(items, announcerFallback),
    [items, announcerFallback]
  );

  const durationSec = useMemo(() => {
    const len = segmentsTickerLength(segments);
    return Math.min(120, Math.max(32, len * 0.14));
  }, [segments]);

  if (loading || segments.length === 0) return null;

  const ariaSummary = segments
    .map((s) => `${s.text}. ${s.announcer}`)
    .join(' ');

  const label = t('dashboard.announcementTicker.label') || 'Announcements';

  return (
    <div
      className={[
        'hcms-announcement-ticker w-full max-w-[100vw] border-t border-amber-600/30 dark:border-amber-500/25',
        'bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800 text-white',
        'shadow-[0_-4px_24px_rgba(0,0,0,0.12)]',
        pinAboveMobileNav
          ? 'hcms-announcement-ticker--pinned shrink-0'
          : 'relative shrink-0',
      ].join(' ')}
      role="region"
      aria-label={`${label}. ${ariaSummary}`}
    >
      <button
        type="button"
        onClick={() => void handleOpen()}
        disabled={dismissing}
        className="w-full flex items-stretch min-h-[3.25rem] sm:min-h-[3.5rem] text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400 touch-manipulation disabled:opacity-70"
        title={t('dashboard.announcementTicker.openChat') || 'Open announcements in Chat'}
      >
        <div className="shrink-0 flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 bg-amber-600 text-white font-bold text-[10px] sm:text-xs uppercase tracking-wider border-r border-amber-500/50 min-w-[3.25rem] sm:min-w-0 self-stretch">
          <Megaphone className="w-4 h-4 shrink-0" aria-hidden />
          <span className="whitespace-nowrap max-[380px]:sr-only">{label}</span>
        </div>
        <div className="relative flex-1 min-w-0 overflow-hidden flex items-center">
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 sm:w-12 z-10 bg-gradient-to-r from-slate-900 to-transparent" />
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 sm:w-12 z-10 bg-gradient-to-l from-slate-800 to-transparent" />
          <div
            className="hcms-news-ticker-track py-1.5 sm:py-2"
            style={{ animationDuration: `${durationSec}s` }}
          >
            <TickerChunk segments={segments} />
            <TickerChunk segments={segments} ariaHidden />
          </div>
        </div>
      </button>
    </div>
  );
};

function TickerChunk({
  segments,
  ariaHidden,
}: {
  segments: TickerSegment[];
  ariaHidden?: boolean;
}) {
  return (
    <div
      className="hcms-news-ticker-chunk inline-flex items-center"
      aria-hidden={ariaHidden || undefined}
    >
      {segments.map((seg, index) => (
        <React.Fragment key={`${seg.id}-${index}`}>
          {index > 0 ? (
            <span className="hcms-news-ticker-sep text-amber-400/90 px-4 sm:px-6" aria-hidden>
              ◆
            </span>
          ) : null}
          <span className="hcms-news-ticker-segment">
            <span className="hcms-news-ticker-line block text-xs sm:text-sm font-medium text-white/95 leading-snug">
              {seg.text}
            </span>
            <span className="hcms-news-ticker-byline block text-[10px] sm:text-xs text-white/65 leading-tight mt-0.5">
              {seg.announcer}
            </span>
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}
