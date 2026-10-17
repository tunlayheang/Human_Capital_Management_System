import React, { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from './Button';
import { getOverlayPortalRoot } from '../../utils/overlayPortal';
import { overlayPanelClass } from '../../utils/overlayPanel';
import { AppOverlay } from './AppOverlay';
import { todayYmdInCompanyTz } from '../../utils/companyCalendar';
import { DatePickerInput } from './shadcn/date-picker-input';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  variant: 'danger' | 'success';
  confirmLabel: string;
  confirmIcon?: React.ReactNode;
  cancelLabel?: string;
  cancelIcon?: React.ReactNode;
  showCancelAction?: boolean;
  /** Optional middle action (e.g. leave without saving). */
  secondaryLabel?: string;
  secondaryIcon?: React.ReactNode;
  onSecondary?: () => void | Promise<void>;
  /** Called after validation (reason required when showReasonInput is true). */
  onConfirm: (payload?: { reason?: string; effectiveFrom?: string }) => void | Promise<void>;
  showReasonInput?: boolean;
  /** When true (default), reason textarea must be non-empty. Set false for optional notes. */
  reasonRequired?: boolean;
  reasonPlaceholder?: string;
  showEffectiveDateInput?: boolean;
  effectiveDateRequired?: boolean;
  effectiveDateLabel?: string;
  defaultEffectiveDate?: string;
  /** Optional custom section rendered above footer actions. */
  extraContent?: React.ReactNode;
  /** Read-only context (e.g. prior termination reason). */
  displayReason?: string;
  loading?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onClose,
  title,
  description,
  variant,
  confirmLabel,
  confirmIcon,
  cancelLabel = 'Cancel',
  cancelIcon,
  showCancelAction = true,
  secondaryLabel,
  secondaryIcon,
  onSecondary,
  onConfirm,
  showReasonInput = false,
  reasonRequired = true,
  reasonPlaceholder,
  showEffectiveDateInput = false,
  effectiveDateRequired = true,
  effectiveDateLabel = 'Effective date',
  defaultEffectiveDate,
  extraContent,
  displayReason,
  loading = false,
}) => {
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [effectiveDateError, setEffectiveDateError] = useState('');
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (open) {
      setReason('');
      setReasonError('');
      setEffectiveDate(defaultEffectiveDate ?? todayYmdInCompanyTz());
      setEffectiveDateError('');
    }
  }, [open, defaultEffectiveDate]);

  if (!open) return null;

  const confirmBtnClass =
    variant === 'danger' ? 'hcms-modal-btn-danger' : 'hcms-modal-btn-primary';

  const handleConfirm = async () => {
    if (showReasonInput) {
      const trimmed = reason.trim();
      if (reasonRequired && trimmed.length < 3) {
        setReasonError(
          trimmed
            ? 'Please enter at least 3 characters.'
            : 'Please enter a reason.'
        );
        return;
      }
      setReasonError('');
      if (showEffectiveDateInput) {
        const date = effectiveDate.trim().slice(0, 10);
        if (effectiveDateRequired && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          setEffectiveDateError('Please select an effective date.');
          return;
        }
        setEffectiveDateError('');
        await onConfirm({ reason: trimmed, effectiveFrom: date });
        return;
      }
      await onConfirm({ reason: trimmed });
      return;
    }
    if (showEffectiveDateInput) {
      const date = effectiveDate.trim().slice(0, 10);
      if (effectiveDateRequired && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        setEffectiveDateError('Please select an effective date.');
        return;
      }
      setEffectiveDateError('');
      await onConfirm({ effectiveFrom: date });
      return;
    }
    await onConfirm();
  };

  const panelSize =
    showReasonInput || showEffectiveDateInput || extraContent || (secondaryLabel && onSecondary)
      ? 'sm'
      : 'confirm';

  const footerActions = (
    <>
      {showCancelAction ? (
        <Button
          type="button"
          variant="secondary"
          className="hcms-modal-btn-cancel w-full sm:w-auto"
          onClick={onClose}
          disabled={loading}
        >
          <span className="inline-flex items-center justify-center gap-2">
            {cancelIcon}
            {cancelLabel}
          </span>
        </Button>
      ) : null}
      {secondaryLabel && onSecondary ? (
        <Button
          type="button"
          variant="secondary"
          className="hcms-modal-btn-cancel w-full sm:w-auto"
          onClick={() => void onSecondary()}
          disabled={loading}
        >
          <span className="inline-flex items-center justify-center gap-2">
            {secondaryIcon}
            {secondaryLabel}
          </span>
        </Button>
      ) : null}
      <Button
        type="button"
        className={`${confirmBtnClass} w-full sm:w-auto`}
        onClick={() => void handleConfirm()}
        disabled={loading}
      >
        {loading ? (
          'Please wait…'
        ) : (
          <span className="inline-flex items-center justify-center gap-2">
            {confirmIcon}
            {confirmLabel}
          </span>
        )}
      </Button>
    </>
  );

  const root = getOverlayPortalRoot();
  return createPortal(
    <AppOverlay open={open} onClose={loading ? undefined : onClose} zIndexClass="z-[220]" backdrop="dim">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className={overlayPanelClass(panelSize)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hcms-modal-header">
          <div className="min-w-0 pr-2">
            <h2 id={titleId}>{title}</h2>
            <p id={descId}>{description}</p>
          </div>
          <button
            type="button"
            onClick={loading ? undefined : onClose}
            className="hcms-modal-close"
            aria-label="Close dialog"
            disabled={loading}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="hcms-modal-body min-h-0 flex-1">
          {displayReason !== undefined && displayReason !== null && (
            <div className="mb-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 px-4 py-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Previous reason</p>
              <p className="text-sm text-slate-800 dark:text-slate-200 mt-1 whitespace-pre-wrap">
                {displayReason || '—'}
              </p>
            </div>
          )}

          {showReasonInput && (
            <div className="pb-2">
              <textarea
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (reasonError) setReasonError('');
                }}
                placeholder={reasonPlaceholder}
                disabled={loading}
                rows={4}
                className="hcms-modal-textarea"
              />
              {reasonError && <p className="mt-1.5 text-xs text-red-600">{reasonError}</p>}
            </div>
          )}

          {showEffectiveDateInput && (
            <div className="pb-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                {effectiveDateLabel}
              </label>
              <DatePickerInput
                value={effectiveDate}
                onChange={(e) => {
                  setEffectiveDate(e.target.value);
                  if (effectiveDateError) setEffectiveDateError('');
                }}
                disabled={loading}
                className="hcms-modal-input w-full"
              />
              {effectiveDateError && (
                <p className="mt-1.5 text-xs text-red-600">{effectiveDateError}</p>
              )}
            </div>
          )}

          {extraContent ? <div className="pb-2">{extraContent}</div> : null}
        </div>

        <div className="hcms-modal-footer">{footerActions}</div>
      </div>
    </AppOverlay>,
    root
  );
};
