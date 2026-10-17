import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Api } from '../../services/api';
import { Card } from '../ui/Card';
import { ExportFormatMenu } from '../ui/ExportFormatMenu';
import { Badge } from '../ui/Badge';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { useConfirmDialog, asPromptReason } from '../../hooks/useConfirmDialog';
import type { EmployeeMovementRow } from '../../types/employeeMovement';
import { MovementListCard } from './employeeMovementDisplay';
import { navigateToMovementView } from '../../employeeMovement/movementNavigation';
import {
  approveReviewPrompt,
  rejectReviewPrompt,
  returnReviewPrompt,
} from '../workflow/workflowReviewPrompts';
import { ApprovalQueueCardActions } from '../workflow/ApprovalQueueCardActions';
import { ListSearchFilterBar } from '../ui/page';
import { FilterMenuSelect, PageFilterMenu } from '../ui/PageFilterMenu';
import { countActiveFilters } from '../../utils/filterActiveCount';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';
import { exportListTable } from '../../utils/export/exportListTable';
import { canActorResubmitReturnedMovement } from '../../utils/movementResubmitAccess';

function movementNeedsAction(row: EmployeeMovementRow): boolean {
  if (typeof row.canApproverReview === 'boolean') return row.canApproverReview;
  const status = String(row.status ?? '').toLowerCase();
  return status === 'pending_approval' || status === 'pending';
}

function movementStatusLabel(row: EmployeeMovementRow): string {
  const status = String(row.canonicalStatus ?? row.status ?? '').toLowerCase();
  if (status === 'pending' || status === 'pending_approval') return 'Pending';
  if (status === 'approved' || status === 'scheduled') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  if (status === 'returned') return 'Returned';
  if (status === 'applied' || status === 'completed') return 'Applied';
  return status || 'Unknown';
}

export const MovementPendingApprovalsPanel: React.FC<{
  onChanged?: () => void;
  /** Approvals modal only. Embedded kept for compatibility. */
  variant?: 'embedded' | 'page';
}> = ({ onChanged, variant = 'page' }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { prompt, ConfirmDialogHost } = useConfirmDialog();
  const [searchParams] = useSearchParams();
  const deepLinkMovementId = searchParams.get('movementId')?.trim() || null;
  const deepLinkHandledRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<EmployeeMovementRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
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
      const data = await Api.employeeMovements.listPendingMyApproval();
      setRows(Array.isArray(data) ? (data as EmployeeMovementRow[]) : []);
    } catch {
      showToast('Could not load movement approvals assigned to you.', 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [showToast, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!deepLinkMovementId || loading) return;
    if (deepLinkHandledRef.current === deepLinkMovementId) return;
    const row = rows.find((r) => String(r.id) === deepLinkMovementId);
    if (!row) return;
    deepLinkHandledRef.current = deepLinkMovementId;
    // Only the original submitter is sent to edit/resubmit; approvers stay in this queue.
    if (canActorResubmitReturnedMovement(row, user)) {
      navigateToMovementView(navigate, row, 1);
    }
  }, [deepLinkMovementId, loading, navigate, rows, user]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const needsAction = movementNeedsAction(row);
      if (queueFilter === 'action' && !needsAction) return false;
      if (queueFilter === 'history' && needsAction) return false;
      if (!q) return true;
      return (
        String(row.employeeName ?? '').toLowerCase().includes(q) ||
        String(row.employeeId ?? '').toLowerCase().includes(q) ||
        String(row.movementType ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, search, queueFilter]);

  const actionRows = useMemo(
    () => visibleRows.filter((row) => movementNeedsAction(row)),
    [visibleRows]
  );
  const historyRows = useMemo(
    () => visibleRows.filter((row) => !movementNeedsAction(row)),
    [visibleRows]
  );

  const approve = async (id: string) => {
    const notes = asPromptReason(await prompt(approveReviewPrompt('movement')));
    if (notes === null) return;
    setBusyId(id);
    try {
      await Api.employeeMovements.approve(id, notes.trim());
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
    const notes = asPromptReason(await prompt(rejectReviewPrompt('movement')));
    if (notes === null) return;
    setBusyId(id);
    try {
      await Api.employeeMovements.reject(id, notes.trim());
      showToast('Movement rejected.', 'success');
      await load();
      onChanged?.();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Rejection failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const returnMovement = async (id: string) => {
    const notes = asPromptReason(await prompt(returnReviewPrompt('movement')));
    if (notes === null) return;
    setBusyId(id);
    try {
      await Api.employeeMovements.return(id, notes.trim());
      showToast('Movement returned to submitter.', 'success');
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
      module: 'Movement_Approval_Queue',
      reportTitle: 'Movement Approval Queue',
      sheetName: 'Movement Queue',
      rows: visibleRows,
      metadata: [
        { label: 'Rows', value: visibleRows.length },
        { label: 'Search', value: search || 'All items' },
        { label: 'Queue', value: queueFilter || 'All items' },
      ],
      columns: [
        { header: 'ID', value: (row) => row.id, width: 16 },
        { header: 'Employee ID', value: (row) => row.employeeId ?? '', width: 14 },
        { header: 'Employee Name', value: (row) => row.employeeName ?? '', width: 24 },
        { header: 'Movement Type', value: (row) => row.movementType ?? '', width: 18 },
        { header: 'Effective Date', value: (row) => row.effectiveDate ?? '', width: 14 },
        { header: 'From Department', value: (row) => row.fromDepartmentName ?? '', width: 20 },
        { header: 'To Department', value: (row) => row.toDepartmentName ?? '', width: 20 },
        { header: 'From Position', value: (row) => row.fromPositionTitle ?? '', width: 20 },
        { header: 'To Position', value: (row) => row.toPositionTitle ?? '', width: 20 },
        { header: 'From Base Salary', value: (row) => row.fromBaseSalary ?? '', width: 16 },
        { header: 'To Base Salary', value: (row) => row.toBaseSalary ?? '', width: 16 },
        { header: 'Status', value: (row) => movementStatusLabel(row), width: 16 },
        { header: 'Needs Action', value: (row) => (movementNeedsAction(row) ? 'Yes' : 'No'), width: 14 },
        { header: 'Created By', value: (row) => row.createdByName ?? '', width: 20 },
        { header: 'Created At', value: (row) => row.createdAt ?? '', width: 18 },
      ],
    });
  };

  if (loading && variant === 'embedded') {
    return (
      <Card className="border-none shadow-sm p-5 text-sm text-slate-500 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading movement approvals…
      </Card>
    );
  }

  if (!rows.length && !loading && variant === 'embedded') return null;

  if (loading && variant === 'page') {
    return (
      <Card className="border-slate-200/80 dark:border-slate-700 p-5 text-sm text-slate-500 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading movement approvals…
      </Card>
    );
  }

  const renderRow = (row: EmployeeMovementRow) => {
    const canAct = movementNeedsAction(row);
    const busy = busyId === row.id;
    return (
      <MovementListCard
        key={row.id}
        row={row}
        density="compact"
        showContact={false}
        salaryDeltaFormat="percent"
        actions={
          <ApprovalQueueCardActions
            busy={busy}
            canAct={canAct}
            onApprove={() => void approve(row.id)}
            onReturn={() => void returnMovement(row.id)}
            onReject={() => void reject(row.id)}
          />
        }
      />
    );
  };

  return (
    <>
      <ConfirmDialogHost />
      <Card className="border-none shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200/70 dark:border-amber-900/40">
          <ShieldAlert className="w-4 h-4 text-amber-700 dark:text-amber-300 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              Movements awaiting your approval
            </p>
            <p className="text-xs text-slate-500">
              Approve, return, or reject here. Only the original submitter can edit & resubmit from
              Employees → Movements.
            </p>
          </div>
          {actionRows.length > 0 ? (
            <Badge variant="warning">{actionRows.length} action</Badge>
          ) : null}
          {historyRows.length > 0 ? (
            <Badge variant="neutral">{historyRows.length} history</Badge>
          ) : null}
        </div>

        {rows.length > 0 ? (
          <div className="px-4 sm:px-5 pt-4">
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
              searchPlaceholder="Search employee or movement type..."
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
                      { value: 'history', label: 'Completed / returned' },
                    ]}
                  />
                </PageFilterMenu>
              }
            />
          </div>
        ) : null}

        <div className="p-4 sm:p-5 space-y-4">
          {!rows.length ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 py-2 text-center">
              No employee movements in your approval queue.
            </p>
          ) : visibleRows.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 py-2 text-center">
              No movements match your search or filters.
            </p>
          ) : (
            <div className="space-y-4">
              {actionRows.length > 0 ? (
                <section className="space-y-3">
                  {historyRows.length > 0 ? (
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                      Pending
                    </p>
                  ) : null}
                  {actionRows.map(renderRow)}
                </section>
              ) : null}
              {historyRows.length > 0 ? (
                <section className="space-y-3">
                  {actionRows.length > 0 ? (
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Completed / returned
                    </p>
                  ) : null}
                  {historyRows.map(renderRow)}
                </section>
              ) : null}
            </div>
          )}
        </div>
      </Card>
    </>
  );
};

export default MovementPendingApprovalsPanel;
