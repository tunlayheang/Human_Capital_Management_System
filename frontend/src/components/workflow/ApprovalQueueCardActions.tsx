import React from 'react';
import { Check, Loader2, RotateCcw, X } from 'lucide-react';
import { Button } from '../ui/Button';

export type ApprovalQueueCardActionsProps = {
  busy?: boolean;
  canAct?: boolean;
  onApprove?: () => void;
  onReturn?: () => void;
  onReject?: () => void;
  /** Extra controls (e.g. Edit & resubmit) rendered before the review buttons. */
  leading?: React.ReactNode;
  className?: string;
};

/** Always-visible approve / return / reject row for inbox approval cards. */
export function ApprovalQueueCardActions({
  busy = false,
  canAct = false,
  onApprove,
  onReturn,
  onReject,
  leading,
  className = '',
}: ApprovalQueueCardActionsProps) {
  if (!canAct && !leading) return null;

  return (
    <div
      data-no-card-nav
      className={`flex flex-wrap items-center justify-end gap-1.5 sm:gap-2 ${className}`.trim()}
    >
      {leading}
      {canAct ? (
        <>
          {onReturn ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onReturn}
              className="min-w-0"
            >
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" aria-hidden />
              ) : (
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" aria-hidden />
              )}
              Return
            </Button>
          ) : null}
          {onReject ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onReject}
              className="min-w-0 border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-900/50 dark:text-rose-300 dark:hover:bg-rose-950/40"
            >
              <X className="w-3.5 h-3.5 mr-1.5" aria-hidden />
              Reject
            </Button>
          ) : null}
          {onApprove ? (
            <Button type="button" size="sm" variant="primary" disabled={busy} onClick={onApprove}>
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" aria-hidden />
              ) : (
                <Check className="w-3.5 h-3.5 mr-1.5" aria-hidden />
              )}
              Approve
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default ApprovalQueueCardActions;
