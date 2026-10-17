import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Api } from '../../services/api';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { LoadingState } from '../common/LoadingState';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { useConfirmDialog, asPromptReason } from '../../hooks/useConfirmDialog';
import type { ProbationPendingApprovalItem } from '../../types';
import {
  ProbationApprovalTracker,
  probationRecommendationLabel,
  viewerProbationApproverStep,
} from './probationApprovalDisplay';
import {
  approveReviewPrompt,
  rejectReviewPrompt,
  returnReviewPrompt,
} from '../workflow/workflowReviewPrompts';
import { ApprovalQueueCardActions } from '../workflow/ApprovalQueueCardActions';
import { ProbationReviewDocumentModal } from './ProbationReviewDocumentModal';

function approverStatusLine(
  row: ProbationPendingApprovalItem,
  viewerUserId: string | undefined,
  canAct: boolean
): string | null {
  const step = viewerProbationApproverStep(row, viewerUserId);
  if (!step) return null;
  const { stepNumber, total, phase } = step;
  if (total <= 1) return canAct ? 'Your approval is required' : null;
  if (canAct) return `Your turn — step ${stepNumber} of ${total} in the approval chain`;
  if (phase === 'approved') {
    return `You approved — step ${stepNumber} of ${total} complete, waiting for remaining sign-offs`;
  }
  if (phase === 'queued') {
    return `Your step is ${stepNumber} of ${total} — waiting for earlier approvers in the chain`;
  }
  return null;
}

function ProbationApprovalCard({
  row,
  viewerUserId,
  busy,
  onApprove,
  onReturn,
  onReject,
}: {
  row: ProbationPendingApprovalItem;
  viewerUserId?: string;
  busy: boolean;
  onApprove: (id: string) => void;
  onReturn: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const canAct = Boolean(row.canApproverReview);
  const statusLine = approverStatusLine(row, viewerUserId, canAct);
  const pendingRec =
    (row.pendingDecision?.recommendation as string | undefined) ?? row.recommendation;
  const status = String(row.status ?? '').toUpperCase();
  const statusBadge =
    status === 'PASSED'
      ? 'Passed'
      : status === 'EXTENDED'
        ? 'Extended'
        : status === 'FAILED'
          ? 'Failed'
          : status === 'REJECTED'
            ? 'Rejected'
            : status === 'PENDING_HR'
              ? 'Returned to HR'
              : status === 'PENDING_FINAL_APPROVAL'
                ? canAct
                  ? 'Your turn'
                  : 'In approval'
                : status || null;

  return (
    <li className="rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900/50 p-3 sm:p-3.5 space-y-2.5">
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1 min-w-0">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-white break-words">
            {row.employeeName}
            {row.employeeId ? (
              <span className="ml-2 text-xs font-medium text-slate-500 tabular-nums">
                {row.employeeId}
              </span>
            ) : null}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 break-words">
            {row.departmentName ?? 'Department'}
            {pendingRec ? ` · Outcome: ${probationRecommendationLabel(pendingRec)}` : ''}
            {row.probationEnd ? ` · Period end ${row.probationEnd}` : ''}
          </p>
        </div>
        {statusBadge ? (
          <Badge
            variant={canAct ? 'warning' : status === 'REJECTED' || status === 'FAILED' ? 'danger' : 'neutral'}
            className="max-w-full whitespace-normal text-left shrink-0"
          >
            {statusBadge}
          </Badge>
        ) : null}
      </div>
      {statusLine ? (
        <p
          className={`text-[11px] font-medium ${
            canAct ? 'text-amber-700 dark:text-amber-300' : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          {statusLine}
        </p>
      ) : null}
      {row.hrNotes ? (
        <p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-words">
          HR notes: {row.hrNotes}
        </p>
      ) : null}
      <ProbationApprovalTracker row={row} compact viewerUserId={viewerUserId} />
      <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
        <ApprovalQueueCardActions
          busy={busy}
          canAct={canAct}
          onApprove={() => void onApprove(row.reviewId)}
          onReturn={() => void onReturn(row.reviewId)}
          onReject={() => void onReject(row.reviewId)}
        />
      </div>
    </li>
  );
}

export const ProbationPendingApprovalsPanel: React.FC<{
  onChanged?: () => void;
  variant?: 'embedded' | 'page';
}> = ({ onChanged, variant = 'embedded' }) => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { prompt, ConfirmDialogHost } = useConfirmDialog();
  const [searchParams] = useSearchParams();
  const deepLinkReviewId = searchParams.get('reviewId')?.trim() || null;
  const deepLinkUserId = searchParams.get('userId')?.trim() || null;
  const deepLinkHandledRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ProbationPendingApprovalItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewDetailId, setViewDetailId] = useState<string | null>(null);
  const [viewDetailSummary, setViewDetailSummary] = useState<ProbationPendingApprovalItem | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await Api.reviews.listPendingProbationMyApproval();
      setRows(Array.isArray(data) ? (data as ProbationPendingApprovalItem[]) : []);
    } catch {
      showToast('Could not load probation approvals assigned to you.', 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [showToast, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const key = deepLinkReviewId || deepLinkUserId;
    if (!key || loading) return;
    if (deepLinkHandledRef.current === key) return;
    const row = rows.find(
      (r) =>
        (deepLinkReviewId && String(r.reviewId) === deepLinkReviewId) ||
        (deepLinkUserId && String(r.userId ?? '') === deepLinkUserId)
    );
    if (!row) return;
    deepLinkHandledRef.current = key;
    setViewDetailId(row.reviewId);
    setViewDetailSummary(row);
  }, [deepLinkReviewId, deepLinkUserId, loading, rows]);

  const actionRows = useMemo(() => rows.filter((row) => row.canApproverReview), [rows]);
  const trackingRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          !row.canApproverReview && String(row.status ?? '').toUpperCase() === 'PENDING_FINAL_APPROVAL'
      ),
    [rows]
  );
  const historyRows = useMemo(
    () =>
      rows.filter(
        (row) => String(row.status ?? '').toUpperCase() !== 'PENDING_FINAL_APPROVAL'
      ),
    [rows]
  );

  const approve = async (id: string) => {
    const notes = asPromptReason(await prompt(approveReviewPrompt('probation')));
    if (notes === null) return;
    if (notes.trim().length < 3) {
      showToast('Approval comment must be at least 3 characters.', 'warning');
      return;
    }
    setBusyId(id);
    try {
      await Api.reviews.probationWorkflow(id, 'approve_final', { notes: notes.trim() });
      showToast(
        'Your approval was recorded. The next approver will be notified if more sign-offs are required.',
        'success'
      );
      await load();
      onChanged?.();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Approval failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id: string) => {
    const notes = asPromptReason(await prompt(rejectReviewPrompt('probation')));
    if (notes === null) return;
    setBusyId(id);
    try {
      await Api.reviews.probationWorkflow(id, 'reject_final', { notes: notes.trim() });
      showToast('Probation approval rejected.', 'success');
      await load();
      onChanged?.();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Rejection failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const returnToHr = async (id: string) => {
    const notes = asPromptReason(await prompt(returnReviewPrompt('probation')));
    if (notes === null) return;
    setBusyId(id);
    try {
      await Api.reviews.probationWorkflow(id, 'return_final', { notes: notes.trim() });
      showToast('Probation review returned to HR.', 'success');
      await load();
      onChanged?.();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Return failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const openDetail = (row: ProbationPendingApprovalItem) => {
    setViewDetailSummary(row);
    setViewDetailId(row.reviewId);
  };

  const closeDetail = () => {
    setViewDetailId(null);
    setViewDetailSummary(null);
  };

  if (!loading && rows.length === 0 && variant === 'embedded') return null;

  const headerTitle =
    actionRows.length > 0
      ? 'Probation approvals assigned to you'
      : historyRows.length > 0
        ? 'Probation reviews in your approval history'
        : 'Probation reviews in your approval queue';

  return (
    <>
      <ConfirmDialogHost />
      <ProbationReviewDocumentModal
        isOpen={Boolean(viewDetailId)}
        reviewId={viewDetailId}
        summary={viewDetailSummary}
        onClose={closeDetail}
      />
      <Card className="border-teal-200/80 dark:border-teal-900/50 bg-teal-50/30 dark:bg-teal-950/15">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{headerTitle}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Approved, rejected, and returned reviews stay listed here — same as leave approvals.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {actionRows.length > 0 ? (
              <Badge variant="warning" className="tabular-nums">
                {loading ? '…' : actionRows.length} action
              </Badge>
            ) : null}
            {trackingRows.length > 0 ? (
              <Badge variant="neutral" className="tabular-nums">
                {loading ? '…' : trackingRows.length} tracking
              </Badge>
            ) : null}
            {historyRows.length > 0 ? (
              <Badge variant="neutral" className="tabular-nums">
                {loading ? '…' : historyRows.length} history
              </Badge>
            ) : null}
          </div>
        </div>

        {loading ? (
          <LoadingState variant="section" layout="cards" rows={2} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">
            No probation approvals in your queue yet.
          </p>
        ) : (
          <div className="space-y-4">
            {actionRows.length > 0 ? (
              <section>
                {trackingRows.length > 0 || historyRows.length > 0 ? (
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-800 dark:text-teal-300 mb-2">
                    Your action required
                  </p>
                ) : null}
                <ul className="space-y-3">
                  {actionRows.map((row) => (
                    <ProbationApprovalCard
                      key={row.reviewId}
                      row={row}
                      viewerUserId={user?.id}
                      busy={busyId === row.reviewId}
                      onApprove={approve}
                      onReturn={returnToHr}
                      onReject={reject}
                    />
                  ))}
                </ul>
              </section>
            ) : null}

            {trackingRows.length > 0 ? (
              <section>
                {actionRows.length > 0 || historyRows.length > 0 ? (
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                    Tracking your assigned steps
                  </p>
                ) : null}
                <ul className="space-y-3">
                  {trackingRows.map((row) => (
                    <ProbationApprovalCard
                      key={row.reviewId}
                      row={row}
                      viewerUserId={user?.id}
                      busy={busyId === row.reviewId}
                      onApprove={approve}
                      onReturn={returnToHr}
                      onReject={reject}
                    />
                  ))}
                </ul>
              </section>
            ) : null}

            {historyRows.length > 0 ? (
              <section>
                {actionRows.length > 0 || trackingRows.length > 0 ? (
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                    Completed / returned
                  </p>
                ) : null}
                <ul className="space-y-3">
                  {historyRows.map((row) => (
                    <ProbationApprovalCard
                      key={row.reviewId}
                      row={row}
                      viewerUserId={user?.id}
                      busy={busyId === row.reviewId}
                      onApprove={approve}
                      onReturn={returnToHr}
                      onReject={reject}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </Card>
    </>
  );
};

export default ProbationPendingApprovalsPanel;
