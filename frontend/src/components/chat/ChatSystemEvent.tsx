import React from 'react';
import { Message } from '../../types';
import { formatSystemChatText } from './chatSystemMessage';

type Props = {
  msg: Message;
  currentUserId?: string;
  t: (key: string) => string | undefined;
};

export const ChatSystemEvent: React.FC<Props> = ({ msg, currentUserId, t }) => {
  const text = formatSystemChatText(msg, t, currentUserId);

  return (
    <div className="flex justify-center py-2 px-4">
      <p className="text-center text-xs text-slate-500 dark:text-slate-400 max-w-md leading-relaxed">
        {text}
      </p>
    </div>
  );
};
