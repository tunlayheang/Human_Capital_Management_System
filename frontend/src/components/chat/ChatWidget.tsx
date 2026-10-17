import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { useChat } from '../../context/ChatContext';
import { ChatMessengerPanel } from './ChatMessengerPanel';
import { usePinLock } from '../../context/PinLockContext';
import { CHAT_WIDGET_ROOT_ID, Z_CHAT_WIDGET } from '../../utils/overlayPortal';

function getChatWidgetRoot(): HTMLElement {
  return document.getElementById(CHAT_WIDGET_ROOT_ID) ?? document.body;
}

/** Desktop floating chat FAB + dock. Compact layouts use More / `/chat` instead (see Layout). */
export const ChatWidget: React.FC = () => {
  const location = useLocation();
  const isChatPage = location.pathname === '/chat';
  const {
    isOpen,
    activeTarget,
    unreadCount,
    closeChat,
    setActiveTarget,
    openChat,
    openFullPageChat,
  } = useChat();

  const dockRef = useRef<HTMLDivElement>(null);
  const [, setDockMounted] = useState(false);
  const { showPinOverlay } = usePinLock();

  if (isChatPage || showPinOverlay) return null;

  const zStyle = { zIndex: Z_CHAT_WIDGET } as const;

  const content = (
    <>
      {!isOpen && (
        <button
          type="button"
          onClick={() => openChat()}
          style={zStyle}
          className="hcms-chat-fab fixed bottom-6 right-6 w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/35 hover:scale-105 active:scale-95 transition-transform duration-200 grid place-items-center"
          aria-label="Open messages"
        >
          <MessageSquare className="w-5 h-5 sm:w-6 sm:h-6" />
          {unreadCount > 0 && (
            <span className="pointer-events-none absolute top-0 right-0 min-w-[1.25rem] h-5 px-1 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center ring-2 ring-white dark:ring-slate-900 translate-x-1/4 -translate-y-1/4">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      )}
      {isOpen && (
        <div
          ref={(el) => {
            dockRef.current = el;
            setDockMounted(Boolean(el));
          }}
          style={zStyle}
          className="tg-chat-widget-dock fixed flex flex-col overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-700 bg-white dark:bg-[#17212b] shadow-2xl shadow-slate-900/25 animate-in fade-in slide-in-from-bottom-2 duration-200 bottom-6 right-6 w-[min(400px,calc(100vw-1.5rem))] h-[min(540px,calc(100dvh-6rem))]"
          role="dialog"
          aria-modal="false"
          aria-label="Messages"
        >
          <ChatMessengerPanel
            variant="widget"
            dockLayout="single"
            overlayHostRef={dockRef}
            activeTarget={activeTarget}
            onSelectTarget={setActiveTarget}
            onClose={closeChat}
            onOpenFullPage={openFullPageChat}
            enabled={isOpen}
          />
        </div>
      )}
    </>
  );

  return createPortal(content, getChatWidgetRoot());
};
