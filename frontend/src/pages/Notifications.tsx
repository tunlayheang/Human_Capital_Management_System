import React from 'react';
import { NotificationsPanel } from '../components/ui/NotificationsPanel';

export const Notifications: React.FC = () => (
  <div className="h-[calc(100dvh-5rem)] max-w-3xl mx-auto overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
    <NotificationsPanel />
  </div>
);
