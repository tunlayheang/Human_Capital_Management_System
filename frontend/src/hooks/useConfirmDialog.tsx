import { useCallback, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

type DialogVariant = 'danger' | 'success';

type BaseDialogOptions = {
  title: string;
  description: string;
  variant?: DialogVariant;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type ConfirmDialogOptions = BaseDialogOptions;

export type PromptDialogOptions = BaseDialogOptions & {
  reasonPlaceholder?: string;
  reasonRequired?: boolean;
  showEffectiveDateInput?: boolean;
  effectiveDateLabel?: string;
  defaultEffectiveDate?: string;
};

export type ConfirmEffectiveDateOptions = BaseDialogOptions & {
  effectiveDateLabel?: string;
  defaultEffectiveDate?: string;
};

export type PayrollChangePromptResult = {
  reason: string;
  effectiveFrom: string;
};

/** Normalize prompt() results — reason-only prompts return string; payroll prompts return an object. */
export function asPromptReason(
  value: string | PayrollChangePromptResult | null
): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value : value.reason;
}

export type AlertDialogOptions = BaseDialogOptions;

type PendingDialog =
  | {
      kind: 'confirm';
      options: ConfirmDialogOptions;
      resolve: (value: boolean) => void;
    }
  | {
      kind: 'confirmEffectiveDate';
      options: ConfirmEffectiveDateOptions;
      resolve: (value: string | null) => void;
    }
  | {
      kind: 'prompt';
      options: PromptDialogOptions;
      resolve: (value: string | PayrollChangePromptResult | null) => void;
    }
  | {
      kind: 'alert';
      options: AlertDialogOptions;
      resolve: () => void;
    };

export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingDialog | null>(null);
  const pendingRef = useRef<PendingDialog | null>(null);

  const setPendingDialog = useCallback((next: PendingDialog | null) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  const confirm = useCallback((options: ConfirmDialogOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setPendingDialog({ kind: 'confirm', options, resolve });
    });
  }, [setPendingDialog]);

  /** Confirm a status / policy change and require an effective date. Returns the date or null if cancelled. */
  const confirmEffectiveDate = useCallback(
    (options: ConfirmEffectiveDateOptions): Promise<string | null> => {
      return new Promise((resolve) => {
        setPendingDialog({ kind: 'confirmEffectiveDate', options, resolve });
      });
    },
    [setPendingDialog]
  );

  const prompt = useCallback((options: PromptDialogOptions): Promise<string | PayrollChangePromptResult | null> => {
    return new Promise((resolve) => {
      setPendingDialog({ kind: 'prompt', options, resolve });
    });
  }, [setPendingDialog]);

  const alert = useCallback((options: AlertDialogOptions): Promise<void> => {
    return new Promise((resolve) => {
      setPendingDialog({ kind: 'alert', options, resolve });
    });
  }, [setPendingDialog]);

  const closePending = useCallback(() => {
    const current = pendingRef.current;
    if (!current) return;
    setPendingDialog(null);
    if (current.kind === 'confirm') current.resolve(false);
    else if (current.kind === 'confirmEffectiveDate') current.resolve(null);
    else if (current.kind === 'prompt') current.resolve(null);
    else current.resolve();
  }, [setPendingDialog]);

  const ConfirmDialogHost = useCallback(() => {
    if (!pending) return null;

    const variant =
      pending.options.variant ??
      (pending.kind === 'confirm' || pending.kind === 'confirmEffectiveDate' ? 'danger' : 'success');
    const confirmLabel =
      pending.options.confirmLabel ??
      (pending.kind === 'alert'
        ? 'OK'
        : pending.kind === 'prompt'
          ? 'Submit'
          : pending.kind === 'confirmEffectiveDate'
            ? 'Confirm'
            : 'Confirm');

    return (
      <ConfirmDialog
        open
        onClose={closePending}
        title={pending.options.title}
        description={pending.options.description}
        variant={variant}
        confirmLabel={confirmLabel}
        cancelLabel={pending.options.cancelLabel ?? 'Cancel'}
        showCancelAction={pending.kind !== 'alert'}
        showReasonInput={pending.kind === 'prompt'}
        reasonRequired={
          pending.kind === 'prompt' ? pending.options.reasonRequired !== false : undefined
        }
        reasonPlaceholder={
          pending.kind === 'prompt' ? pending.options.reasonPlaceholder : undefined
        }
        showEffectiveDateInput={
          pending.kind === 'confirmEffectiveDate' ||
          (pending.kind === 'prompt' && pending.options.showEffectiveDateInput === true)
        }
        effectiveDateLabel={
          pending.kind === 'confirmEffectiveDate' || pending.kind === 'prompt'
            ? pending.options.effectiveDateLabel
            : undefined
        }
        defaultEffectiveDate={
          pending.kind === 'confirmEffectiveDate' || pending.kind === 'prompt'
            ? pending.options.defaultEffectiveDate
            : undefined
        }
        onConfirm={async (payload) => {
          const current = pendingRef.current;
          if (!current) return;
          setPendingDialog(null);
          if (current.kind === 'confirm') {
            current.resolve(true);
            return;
          }
          if (current.kind === 'confirmEffectiveDate') {
            current.resolve(payload?.effectiveFrom ?? null);
            return;
          }
          if (current.kind === 'prompt') {
            if (current.options.showEffectiveDateInput) {
              current.resolve({
                reason: payload?.reason ?? '',
                effectiveFrom: payload?.effectiveFrom ?? '',
              });
              return;
            }
            current.resolve(payload?.reason ?? '');
            return;
          }
          current.resolve();
        }}
      />
    );
  }, [closePending, pending, setPendingDialog]);

  return { confirm, confirmEffectiveDate, prompt, alert, ConfirmDialogHost };
}
