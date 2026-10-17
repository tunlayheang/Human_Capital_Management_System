import React, { useEffect, useId, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ModalField, modalInputClass } from '../ui/ModalForm';
import { DatePickerInput } from '../ui/shadcn/date-picker-input';
import { todayYmdInCompanyTz } from '../../utils/companyCalendar';

type Props = {
  open: boolean;
  title: string;
  content: string;
  sending: boolean;
  onClose: () => void;
  onConfirm: (dashboardExpiresAt: string) => void;
  t: (key: string) => string;
};

export const ChatAnnouncementSendModal: React.FC<Props> = ({
  open,
  title,
  content,
  sending,
  onClose,
  onConfirm,
  t,
}) => {
  const expiryId = useId();
  const [dateValue, setDateValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDateValue('');
    setError(null);
  }, [open]);

  const handleConfirm = () => {
    const today = todayYmdInCompanyTz();
    if (!dateValue) {
      setError(
        t('chat.announcements.sendExpiryRequired') ||
          'Choose the last day this announcement shows on the dashboard.'
      );
      return;
    }
    if (dateValue < today) {
      setError(
        t('chat.announcements.sendExpiryPast') || 'The end date cannot be in the past.'
      );
      return;
    }
    setError(null);
    onConfirm(dateValue);
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      size="sm"
      title={t('chat.announcements.sendModalTitle') || 'Set display end date'}
      description={
        t('chat.announcements.sendModalDesc') ||
        'Announcements need an end date. Pick the last day it stays on everyone’s dashboard, then send.'
      }
      disableClose={sending}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={sending}>
            {t('common.cancel') || 'Cancel'}
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={sending} isLoading={sending}>
            {t('chat.announcements.sendConfirm') || 'Send announcement'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-primary/20 bg-primary/5 dark:bg-primary/10 px-3 py-3">
          <div className="flex items-center gap-2 mb-1.5 min-w-0">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0">
              <Megaphone className="h-3.5 w-3.5" aria-hidden />
            </span>
            <p className="text-sm font-bold text-[#004874] dark:text-blue-200 truncate min-w-0">
              {title.trim() || t('chat.announcements.defaultTitle') || 'Company announcement'}
            </p>
          </div>
          <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words line-clamp-4">
            {content}
          </p>
        </div>

        <ModalField
          label={t('chat.announcements.expiryDateLabel') || 'Last day on dashboard'}
          htmlFor={expiryId}
          required
        >
          <DatePickerInput
            id={expiryId}
            value={dateValue}
            disablePast
            onChange={(e) => {
              setDateValue(e.target.value);
              setError(null);
            }}
            className={`${modalInputClass} hcms-modal-date-input`}
          />
          <p className="hcms-modal-hint">
            {t('chat.announcements.expiryDateHint') ||
              'Hidden from the dashboard after the end of this day for all users. Still visible in Chat.'}
          </p>
        </ModalField>

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      </div>
    </Modal>
  );
};
