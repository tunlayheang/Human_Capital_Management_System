import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Api } from '../../services/api';
import { Card } from '../ui/Card';
import { ExportFormatMenu } from '../ui/ExportFormatMenu';
import { Badge } from '../ui/Badge';
import { LoadingState } from '../common/LoadingState';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { useConfirmDialog, asPromptReason } from '../../hooks/useConfirmDialog';
import type { EmployeeAppraisal } from '../../types/appraisal';
import { formatAppraisalScore } from '../../types/appraisal';
import {
  AppraisalApprovalTracker,
  viewerAppraisalApproverStep,
} from './appraisalApprovalDisplay';
import {
  approveReviewPrompt,
  rejectReviewPrompt,
  returnReviewPrompt,
} from '../workflow/workflowReviewPrompts';
import { ApprovalQueueCardActions } from '../workflow/ApprovalQueueCardActions';
import { AppraisalReviewDocumentModal } from './AppraisalReviewDocumentModal';
import { ListSearchFilterBar } from '../ui/page';
import { FilterMenuSelect, PageFilterMenu } from '../ui/PageFilterMenu';
import { countActiveFilters } from '../../utils/filterActiveCount';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';
import { exportListTable } from '../../utils/export/exportListTable';

function approverStatusLine(
  row: EmployeeAppraisal,
  viewerUserId: string | undefined,
  canAct: boolean
): string | null {
  const step = viewerAppraisalApproverStep(row, viewerUserId);
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

function AppraisalApprovalCard({
  row,
  viewerUserId,
  busy,
  onApprove,
  onReturn,
  onReject,
}: {
  row: EmployeeAppraisal;
  viewerUserId?: string;
  busy: boolean;
  onApprove: (id: string) => void;
  onReturn: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const canAct = Boolean(row.canFinalApproverReview);
  const statusLine = approverStatusLine(row, viewerUserId, canAct);
  const workflowStatus = String(row.workflow_status ?? '').toUpperCase();
  const statusBadge =
    workflowStatus === 'APPROVED'
      ? 'Approved'
      : workflowStatus === 'REJECTED'
        ? 'Rejected'
        : workflowStatus === 'PENDING_HR'
          ? 'Returned to HR'
          : workflowStatus === 'CLOSED'
            ? 'Closed'
            : workflowStatus === 'PENDING_FINAL_APPROVAL'
              ? canAct
                ? 'Your turn'
                : 'In approval'
              : workflowStatus || null;

  return (
    <li className="rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900/50 p-3 sm:p-3.5 space-y-2.5">
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1 min-w-0">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-white break-words">
            {row.employeeName ?? 'Employee'}
            {row.employeeCode ? (
              <span className="ml-2 text-xs font-medium text-slate-500 tabular-nums">
                {row.employeeCode}
              </span>
            ) : null}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 break-words">
            {row.periodName ?? 'Appraisal period'}
            {row.weighted_score != null ? ` · Score ${formatAppraisalScore(row.weighted_score)}` : ''}
            {row.final_grade ? ` · Grade ${row.final_grade}` : ''}
          </p>
        </div>
        {statusBadge ? (
          <Badge
            variant={canAct ? 'warning' : workflowStatus === 'REJECTED' ? 'danger' : 'neutral'}
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
      <AppraisalApprovalTracker appraisal={row} compact viewerUserId={viewerUserId} />
      <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
        <ApprovalQueueCardActions
          busy={busy}
          canAct={canAct}
          onApprove={() => void onApprove(row.id)}
          onReturn={() => void onReturn(row.id)}
          onReject={() => void onReject(row.id)}
        />
      </div>
    </li>
  );
}

export const AppraisalPendingApprovalsPanel: React.FC<{
  onChanged?: () => void;
  /** embedded: hide when empty (dashboard). page: always show section with empty state. */
  variant?: 'embedded' | 'page';
}> = ({ onChanged, variant = 'embedded' }) => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { prompt, ConfirmDialogHost } = useConfirmDialog();
  const [searchParams] = useSearchParams();
  const deepLinkAppraisalId = searchParams.get('appraisalId')?.trim() || null;
  const deepLinkHandledRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<EmployeeAppraisal[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewDetailId, setViewDetailId] = useState<string | null>(null);
  const [viewDetailSummary, setViewDetailSummary] = useState<EmployeeAppraisal | null>(null);
  const [search, setSearch] = useState('');
  const [queueFilter, setQueueFilter] = useState('');
  const filterActiveCount = useMemo(
    () => countActiveFilters([{ value: queueFilter, defaultValue: '' }]),
    [queueFilter]
  );

  const load = useCallback(async () => {
    if (!user?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await Api.appraisal.listPendingMyApproval();
      setRows(Array.isArray(data) ? (data as EmployeeAppraisal[]) : []);
    } catch {
      showToast('Could not load appraisal approvals assigned to you.', 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [showToast, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!deepLinkAppraisalId || loading) return;
    if (deepLinkHandledRef.current === deepLinkAppraisalId) return;
    const row = rows.find((r) => String(r.id) === deepLinkAppraisalId);
    if (!row) return;
    deepLinkHandledRef.current = deepLinkAppraisalId;
    setViewDetailId(row.id);
    setViewDetailSummary(row);
  }, [deepLinkAppraisalId, loading, rows]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const status = String(row.workflow_status ?? '').toUpperCase();
      const isOpen = status === 'PENDING_FINAL_APPROVAL';
      if (queueFilter === 'action' && !row.canFinalApproverReview) return false;
      if (queueFilter === 'tracking' && (!isOpen || row.canFinalApproverReview)) return false;
      if (queueFilter === 'history' && isOpen) return false;
      if (!q) return true;
      return (
        String(row.employeeName ?? '')
          .toLowerCase()
          .includes(q) ||
        String(row.employeeCode ?? '')
          .toLowerCase()
          .includes(q) ||
        String(row.periodName ?? '')
          .toLowerCase()
          .includes(q)
      );
    });
  }, [rows, search, queueFilter]);

  const actionRows = useMemo(
    () => visibleRows.filter((row) => row.canFinalApproverReview),
    [visibleRows]
  );
  const trackingRows = useMemo(
    () =>
      visibleRows.filter((row) => {
        const status = String(row.workflow_status ?? '').toUpperCase();
        return !row.canFinalApproverReview && status === 'PENDING_FINAL_APPROVAL';
      }),
    [visibleRows]
  );
  const historyRows = useMemo(
    () =>
      visibleRows.filter((row) => {
        const status = String(row.workflow_status ?? '').toUpperCase();
        return status !== 'PENDING_FINAL_APPROVAL';
      }),
    [visibleRows]
  );

  const approve = async (id: string) => {
    const notes = asPromptReason(await prompt(approveReviewPrompt('appraisal')));
    if (notes === null) return;
    setBusyId(id);
    try {
      await Api.appraisal.workflow(id, 'approve_final', { notes: notes.trim() });
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
    const notes = asPromptReason(await prompt(rejectReviewPrompt('appraisal')));
    if (notes === null) return;
    setBusyId(id);
    try {
      await Api.appraisal.workflow(id, 'reject_final', {
        notes: notes.trim(),
      });
      showToast('Appraisal rejected.', 'success');
      await load();
      onChanged?.();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Rejection failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const returnToHr = async (id: string) => {
    const notes = asPromptReason(await prompt(returnReviewPrompt('appraisal')));
    if (notes === null) return;
    setBusyId(id);
    try {
      await Api.appraisal.workflow(id, 'return_final', { notes: notes.trim() });
      showToast('Appraisal returned to HR.', 'success');
      await load();
      onChanged?.();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Return failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleExport = async (format: ExportFileExt) => {
    await exportListTable(format, {
      module: 'Appraisal_Approval_Queue',
      reportTitle: 'Appraisal Approval Queue',
      sheetName: 'Appraisal Queue',
      rows: visibleRows,
      metadata: [
        { label: 'Rows', value: visibleRows.length },
        { label: 'Search', value: search || 'All items' },
        { label: 'Queue', value: queueFilter || 'All items' },
      ],
      columns: [
        { header: 'ID', value: (row) => row.id, width: 16 },
        { header: 'Employee Code', value: (row) => row.employeeCode ?? '', width: 16 },
        { header: 'Employee Name', value: (row) => row.employeeName ?? '', width: 24 },
        { header: 'Period', value: (row) => row.periodName ?? '', width: 20 },
        { header: 'Workflow Status', value: (row) => row.workflow_status ?? '', width: 18 },
        { header: 'Weighted Score', value: (row) => row.weighted_score != null ? formatAppraisalScore(row.weighted_score) : '', width: 14 },
        { header: 'Final Grade', value: (row) => row.final_grade ?? '', width: 14 },
        { header: 'Needs Final Approval', value: (row) => (row.canFinalApproverReview ? 'Yes' : 'No'), width: 16 },
        { header: 'Current Approver', value: (row) => row.currentApproverName ?? '', width: 20 },
        { header: 'Final Approved At', value: (row) => row.final_approved_at ?? '', width: 18 },
        { header: 'Rejected At', value: (row) => row.rejected_at ?? '', width: 18 },
        { header: 'Returned At', value: (row) => row.returned_at ?? '', width: 18 },
      ],
    });
  };

  const openDetail = (row: EmployeeAppraisal) => {
    setViewDetailSummary(row);
    setViewDetailId(row.id);
  };

  const closeDetail = () => {
    setViewDetailId(null);
    setViewDetailSummary(null);
  };

  if (!loading && rows.length === 0 && variant === 'embedded') return null;

  const headerTitle =
    actionRows.length > 0
      ? 'Appraisal approvals assigned to you'
      : historyRows.length > 0
        ? 'Appraisals in your approval history'
        : 'Appraisals in your approval queue';

  const headerSubtitle =
    actionRows.length > 0
      ? 'Review items that need your sign-off now. Approved, rejected, and returned items stay listed below.'
      : 'Approved, rejected, and returned appraisals stay visible here — same as leave approvals.';

  return (
    <>
      <ConfirmDialogHost />
      <AppraisalReviewDocumentModal
        isOpen={Boolean(viewDetailId)}
        appraisalId={viewDetailId}
        summary={viewDetailSummary}
        onClose={closeDetail}
      />
      <Card className="border-amber-200/80 dark:border-amber-900/50 bg-amber-50/30 dark:bg-amber-950/15">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{headerTitle}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">{headerSubtitle}</p>
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

        {!loading && rows.length > 0 ? (
          <div className="mb-3">
            <ListSearchFilterBar
              leading={
                <ExportFormatMenu
                  formats={['csv', 'xlsx']}
                  disabled={visibleRows.length === 0}
                  onExport={handleExport}
                />
              }
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search employee or period..."
              filter={
                <PageFilterMenu
                  activeCount={filterActiveCount}
                  onClear={() => setQueueFilter('')}
                >
                  <FilterMenuSelect
                    label="Queue"
                    value={queueFilter}
                    onChange={setQueueFilter}
                    options={[
                      { value: '', label: 'All items' },
                      { value: 'action', label: 'Action required' },
                      { value: 'tracking', label: 'Waiting in chain' },
                      { value: 'history', label: 'Approved / rejected / returned' },
                    ]}
                  />
                </PageFilterMenu>
              }
            />
          </div>
        ) : null}

        {loading ? (
          <LoadingState variant="section" layout="cards" rows={2} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">
            No appraisal approvals in your queue yet.
          </p>
        ) : visibleRows.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">
            No approvals match your search or filters.
          </p>
        ) : (
          <div className="space-y-4">
            {actionRows.length > 0 ? (
              <section>
                {trackingRows.length > 0 ? (
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300 mb-2">
                    Your action required
                  </p>
                ) : null}
                <ul className="space-y-3">
                  {actionRows.map((row) => (
                    <AppraisalApprovalCard
                      key={row.id}
                      row={row}
                      viewerUserId={user?.id}
                      busy={busyId === row.id}
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
                    <AppraisalApprovalCard
                      key={row.id}
                      row={row}
                      viewerUserId={user?.id}
                      busy={busyId === row.id}
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
                    <AppraisalApprovalCard
                      key={row.id}
                      row={row}
                      viewerUserId={user?.id}
                      busy={busyId === row.id}
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

export default AppraisalPendingApprovalsPanel;
