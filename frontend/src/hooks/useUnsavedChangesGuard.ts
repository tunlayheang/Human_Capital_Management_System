import { useCallback, useEffect, useId, useRef } from 'react';
import { useConfirmDialog } from './useConfirmDialog';
import { registerUnsavedChangesGuard } from '../utils/unsavedChangesGuard';

type ConfirmFn = (options: {
  title: string;
  description: string;
  variant?: 'danger' | 'success';
  confirmLabel?: string;
  cancelLabel?: string;
}) => Promise<boolean>;

type Options = {
  /** When true, navigation / tab close / refresh should prompt. */
  isDirty: boolean;
  /** Browser refresh / tab close warning (default true when dirty). */
  enableBeforeUnload?: boolean;
  /**
   * Reuse a parent `useConfirmDialog().confirm` so only one ConfirmDialogHost is needed.
   * If omitted, this hook creates its own dialog host (render {@link ConfirmDialogHost}).
   */
  confirm?: ConfirmFn;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

/**
 * Registers an unsaved-changes leave guard (same pattern as Employee onboarding).
 * Also use {@link confirmDiscardIfDirty} before closing modals / canceling edits.
 */
export function useUnsavedChangesGuard(options: Options) {
  const {
    isDirty,
    enableBeforeUnload = true,
    confirm: confirmExternal,
    title = 'Leave without saving?',
    description =
      'You have unsaved changes. If you leave now, those changes will be lost.',
    confirmLabel = 'Leave without saving',
    cancelLabel = 'Stay on page',
  } = options;

  const internal = useConfirmDialog();
  const confirm = confirmExternal ?? internal.confirm;
  const ConfirmDialogHost = confirmExternal ? () => null : internal.ConfirmDialogHost;

  const reactId = useId();
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  const promptOptionsRef = useRef({ title, description, confirmLabel, cancelLabel });
  promptOptionsRef.current = { title, description, confirmLabel, cancelLabel };

  const confirmDiscardIfDirty = useCallback(async (): Promise<boolean> => {
    if (!dirtyRef.current) return true;
    const opts = promptOptionsRef.current;
    const ok = await confirm({
      title: opts.title,
      description: opts.description,
      confirmLabel: opts.confirmLabel,
      cancelLabel: opts.cancelLabel,
      variant: 'danger',
    });
    return Boolean(ok);
  }, [confirm]);

  const requestLeave = useCallback(
    (exit: () => void) => {
      void (async () => {
        const ok = await confirmDiscardIfDirty();
        if (!ok) return;
        dirtyRef.current = false;
        exit();
      })();
    },
    [confirmDiscardIfDirty]
  );

  useEffect(() => {
    return registerUnsavedChangesGuard({
      id: `unsaved-${reactId}`,
      hasUnsavedEdits: () => dirtyRef.current,
      requestLeave,
    });
  }, [reactId, requestLeave]);

  useEffect(() => {
    if (!enableBeforeUnload || !isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [enableBeforeUnload, isDirty]);

  return {
    ConfirmDialogHost,
    confirmDiscardIfDirty,
    requestLeave,
  };
}
