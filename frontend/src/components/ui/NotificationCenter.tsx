import React, { useEffect } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/shadcn/sheet';
import { NotificationsPanel } from './NotificationsPanel';
import { useNotification } from '../../context/NotificationContext';
import { useLanguage } from '../../context/LanguageContext';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Right-side notification center (all viewports). */
export const NotificationCenter: React.FC<Props> = ({ open, onOpenChange }) => {
  const { refresh } = useNotification();
  const { t } = useLanguage();

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md p-0 flex flex-col gap-0 overflow-hidden [&>button]:hidden"
        aria-describedby={undefined}
      >
        <SheetTitle className="sr-only">{t('header.notifications') || 'Notifications'}</SheetTitle>
        <NotificationsPanel onClose={() => onOpenChange(false)} variant="sheet" />
      </SheetContent>
    </Sheet>
  );
};
