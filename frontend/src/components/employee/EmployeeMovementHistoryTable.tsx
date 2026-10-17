import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { ExportFormatMenu } from '../ui/ExportFormatMenu';
import { ContentSkeleton } from '../common/ContentSkeleton';
import type { EmployeeMovementRow } from '../../types/employeeMovement';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';
import { exportListTable } from '../../utils/export/exportListTable';
import {
  MovementFromToCell,
  MovementListCard,
  MovementRecordedMeta,
  MovementTypeIcon,
  formatMovementDate,
  movementStatusBadge,
  movementTypeIconWrapClass,
  movementTypeLabel,
} from './employeeMovementDisplay';
import { navigateToMovementView } from '../../employeeMovement/movementNavigation';
import {
  sortRowsByColumn,
  SortableTableHeader,
  useListColumnSort,
} from '../../utils/listColumnSort';

type Props = {
  employeeId: string;
  /** Read-only subtable (no cancel). */
  readOnly?: boolean;
  canCancelScheduled?: boolean;
  limit?: number;
  onCancelled?: () => void;
  className?: string;
  emptyMessage?: string;
  /** `table` for classic profile rows; `compact` for embedded lists; `default` for rich admin cards. */
  variant?: 'default' | 'compact' | 'table';
  /** Flush panel inside employee list row expansion (no side indent). */
  embedded?: boolean;
};

function canCancelRow(r: EmployeeMovementRow): boolean {
  return r.status === 'scheduled' || r.status === 'approved' || r.canonicalStatus === 'approved';
}

export const EmployeeMovementHistoryTable: React.FC<Props> = ({
  employeeId,
  readOnly = false,
  canCancelScheduled = false,
  limit = 50,
  onCancelled,
  className = '',
  emptyMessage = 'No movement history for this employee yet.',
  variant = 'compact',
  embedded = false,
}) => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { confirm, ConfirmDialogHost } = useConfirmDialog();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<EmployeeMovementRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!employeeId) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const data = await Api.employeeMovements.list({
        employee_id: employeeId,
        limit,
      });
      setRows(Array.isArray(data) ? (data as EmployeeMovementRow[]) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load movement history');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [employeeId, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCancel = async (id: string) => {
    const ok = await confirm({
      title: 'Cancel movement?',
      description: 'Cancel this scheduled movement?',
      variant: 'danger',
      confirmLabel: 'Cancel movement',
    });
    if (!ok) return;
    try {
      await Api.employeeMovements.cancel(id);
      onCancelled?.();
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not cancel', 'error');
    }
  };

  if (loading) {
    return (
      <>
        <ConfirmDialogHost />
        <ContentSkeleton layout="list" rows={3} className={className} label="Loading…" />
      </>
    );
  }

  if (error) {
    return (
      <>
        <ConfirmDialogHost />
        <div
          className={`rounded-xl border border-red-200/80 dark:border-red-900/40 bg-red-50/90 dark:bg-red-950/25 px-4 py-3 text-sm text-red-700 dark:text-red-300 ${className}`}
        >
          {error}
        </div>
      </>
    );
  }

  if (!rows.length) {
    return (
      <>
        <ConfirmDialogHost />
        <p
          className={`text-sm text-slate-500 dark:text-slate-400 py-5 text-center ${className}`}
        >
          {emptyMessage}
        </p>
      </>
    );
  }

  const showCancel = !readOnly && canCancelScheduled;
  const handleExport = async (format: ExportFileExt) => {
    await exportListTable(format, {
      module: 'Employee_Movement_History',
      reportTitle: 'Employee Movement History',
      sheetName: 'Movement History',
      rows,
      metadata: [
        { label: 'Employee ID', value: employeeId },
        { label: 'Rows', value: rows.length },
      ],
      columns: [
        { header: 'ID', value: (row) => row.id, width: 16 },
        { header: 'Type', value: (row) => movementTypeLabel(row.movementType), width: 18 },
        { header: 'Effective Date', value: (row) => formatMovementDate(row.effectiveDate), width: 14 },
        { header: 'From Department', value: (row) => row.fromDepartmentName ?? '', width: 20 },
        { header: 'To Department', value: (row) => row.toDepartmentName ?? '', width: 20 },
        { header: 'From Position', value: (row) => row.fromPositionTitle ?? '', width: 20 },
        { header: 'To Position', value: (row) => row.toPositionTitle ?? '', width: 20 },
        { header: 'From Base Salary', value: (row) => row.fromBaseSalary ?? '', width: 16 },
        { header: 'To Base Salary', value: (row) => row.toBaseSalary ?? '', width: 16 },
        { header: 'Status', value: (row) => row.status ?? '', width: 16 },
        { header: 'Created By', value: (row) => row.createdByName ?? '', width: 20 },
        { header: 'Created At', value: (row) => row.createdAt ?? '', width: 18 },
        { header: 'Approved By', value: (row) => row.approvedByName ?? '', width: 20 },
        { header: 'Approved At', value: (row) => row.approvedAt ?? '', width: 18 },
        { header: 'Applied At', value: (row) => row.appliedAt ?? '', width: 18 },
      ],
    });
  };
  const exportControl = (
    <div className="flex justify-end mb-2">
      <ExportFormatMenu formats={['csv', 'xlsx']} disabled={rows.length === 0} onExport={handleExport} />
    </div>
  );

  if (variant === 'table') {
    return (
      <EmployeeMovementHistoryTableView
        rows={rows}
        showCancel={showCancel}
        className={className}
        exportControl={exportControl}
        onCancel={handleCancel}
        ConfirmDialogHost={ConfirmDialogHost}
      />
    );
  }

  const density = variant === 'compact' ? 'compact' : 'default';

  const list = rows.map((r) => (
    <MovementListCard
      key={r.id}
      row={r}
      showEmployee={false}
      density={density}
      embedded={embedded}
      onOpenDetail={() => navigateToMovementView(navigate, r)}
      actions={
        showCancel && canCancelRow(r) ? (
          <button
            type="button"
            onClick={() => void handleCancel(r.id)}
            className="font-medium text-red-600 hover:text-red-700 dark:text-red-400"
          >
            Cancel
          </button>
        ) : undefined
      }
    />
  ));

  if (embedded) {
    return (
      <>
        <ConfirmDialogHost />
        {exportControl}
        <div
          className={`rounded-lg border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900/50 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800 ${className}`}
        >
          {list}
        </div>
      </>
    );
  }

  return (
    <>
      <ConfirmDialogHost />
      {exportControl}
      <div className={`space-y-2 ${className}`}>{list}</div>
    </>
  );
};

type MovementTableSortCol = 'type' | 'change' | 'effective' | 'recordedBy' | 'status';

const movementTableThClass =
  'px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400';

function movementChangeSortValue(row: EmployeeMovementRow): string {
  return [
    row.fromDepartmentName,
    row.fromPositionTitle,
    row.toDepartmentName,
    row.toPositionTitle,
  ]
    .filter(Boolean)
    .join(' ');
}

const EmployeeMovementHistoryTableView: React.FC<{
  rows: EmployeeMovementRow[];
  showCancel: boolean;
  className: string;
  exportControl: React.ReactNode;
  onCancel: (id: string) => void;
  ConfirmDialogHost: React.FC;
}> = ({ rows, showCancel, className, exportControl, onCancel, ConfirmDialogHost }) => {
  const { sortBy, sortOrder, toggleSort } = useListColumnSort<MovementTableSortCol>();
  const sortedRows = useMemo(() => {
    const getSortValue = (row: EmployeeMovementRow, col: MovementTableSortCol): string | number => {
      switch (col) {
        case 'type':
          return movementTypeLabel(row.movementType);
        case 'change':
          return movementChangeSortValue(row);
        case 'effective':
          return row.effectiveDate ?? '';
        case 'recordedBy':
          return row.createdByName ?? row.createdAt ?? '';
        case 'status':
          return row.canonicalStatus ?? row.status ?? '';
        default:
          return '';
      }
    };
    return sortRowsByColumn(rows, sortBy, sortOrder, getSortValue);
  }, [rows, sortBy, sortOrder]);

  return (
    <>
      <ConfirmDialogHost />
      {exportControl}
      <div className={`overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-600/60 ${className}`}>
        <table className="w-full text-sm text-left min-w-[640px]">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-700/80">
              <SortableTableHeader
                label="Type"
                column="type"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={movementTableThClass}
              />
              <SortableTableHeader
                label="Change"
                column="change"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={movementTableThClass}
              />
              <SortableTableHeader
                label="Effective"
                column="effective"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={movementTableThClass}
              />
              <SortableTableHeader
                label="Recorded by"
                column="recordedBy"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={movementTableThClass}
              />
              <SortableTableHeader
                label="Status"
                column="status"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={movementTableThClass}
              />
              {showCancel ? <th className={`${movementTableThClass} w-16`} /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {sortedRows.map((r) => (
              <tr
                key={r.id}
                className="bg-white dark:bg-slate-800/40 hover:bg-slate-50/80 dark:hover:bg-slate-800/70 transition-colors"
              >
                <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={`inline-flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg ${movementTypeIconWrapClass(r.movementType)}`}
                    >
                      <MovementTypeIcon type={r.movementType} />
                    </span>
                    <span className="font-medium text-xs sm:text-sm text-slate-800 dark:text-slate-100">
                      {movementTypeLabel(r.movementType)}
                    </span>
                  </span>
                </td>
                <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm">
                  <MovementFromToCell row={r} />
                </td>
                <td className="px-2 py-1.5 sm:px-3 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-slate-600 dark:text-slate-300 tabular-nums">
                  {formatMovementDate(r.effectiveDate)}
                </td>
                <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm">
                  <MovementRecordedMeta row={r} />
                </td>
                <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                  {movementStatusBadge(r.status, r.canonicalStatus)}
                </td>
                {showCancel ? (
                  <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                    {canCancelRow(r) ? (
                      <button
                        type="button"
                        onClick={() => void onCancel(r.id)}
                        className="text-xs sm:text-sm font-medium text-red-600 hover:text-red-700 dark:text-red-400 rounded-lg px-2 py-1 hover:bg-red-50 dark:hover:bg-red-950/40"
                      >
                        Cancel
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};
