import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useChat } from '../context/ChatContext';
import { ChatMessengerPanel } from '../components/chat/ChatMessengerPanel';
import { Api } from '../services/api';

/** Full-page Telegram-style messenger (split list + thread on lg+). */
export const Chat: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { activeTarget, setActiveTarget } = useChat();
  const groupIdFromUrl = searchParams.get('group');
  const openAnnouncements = searchParams.get('announcements') === '1';

  useEffect(() => {
    if (openAnnouncements) {
      setActiveTarget({ kind: 'announcements' });
    }
  }, [openAnnouncements, setActiveTarget]);

  useEffect(() => {
    document.body.classList.add('chat-page-active');
    return () => document.body.classList.remove('chat-page-active');
  }, []);

  useEffect(() => {
    if (!groupIdFromUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const inbox = (await Api.chat.getInbox()) as {
          groups?: Array<{ groupId: string; name: string; memberCount?: number }>;
        };
        const row = inbox.groups?.find((g) => g.groupId === groupIdFromUrl);
        if (cancelled) return;
        setActiveTarget({
          kind: 'group',
          groupId: groupIdFromUrl,
          name: row?.name || 'Group',
          memberCount: row?.memberCount ?? 0,
        });
      } catch {
        if (!cancelled) {
          setActiveTarget({
            kind: 'group',
            groupId: groupIdFromUrl,
            name: 'Group',
            memberCount: 0,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupIdFromUrl, setActiveTarget]);

  return (
    <div className="tg-chat-page flex flex-col flex-1 min-h-0 h-full w-full max-w-full overflow-hidden bg-white dark:bg-[#17212b]">
      <ChatMessengerPanel
        variant="desktop"
        activeTarget={activeTarget}
        onSelectTarget={setActiveTarget}
        enabled
      />
    </div>
  );
};
