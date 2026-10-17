import React from 'react';
import { Archive, FileText, Calendar, Banknote, Clock, ArrowRightLeft, History, X } from 'lucide-react';
import { Card } from '../ui/Card';
import type { EmployeeArchiveDetail } from '../../types';

type Props = {
  detail: EmployeeArchiveDetail | null;
  loading?: boolean;
  onClose?: () => void;
  closeLabel?: string;
};

const RETENTION_ROWS: Array<{
  key: keyof EmployeeArchiveDetail['retention'];
  label: string;
  icon: React.ElementType;
}> = [
  { key: 'attendanceRecords', label: 'Attendance records', icon: Calendar },
  { key: 'leaveRequests', label: 'Leave requests', icon: FileText },
  { key: 'payslips', label: 'Payslips', icon: Banknote },
  { key: 'overtimeRequests', label: 'Overtime requests', icon: Clock },
  { key: 'documents', label: 'Documents', icon: FileText },
  { key: 'movements', label: 'Movements', icon: ArrowRightLeft },
  { key: 'statusHistory', label: 'Status history', icon: History },
];

export const EmployeeArchiveRetentionCard: React.FC<Props> = ({
  detail,
  loading,
  onClose,
  closeLabel = 'Close',
}) => {
  if (loading) {
    return (
      <Card className="border-none shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700">
          <p className="text-sm text-slate-500 italic">Loading retained records…</p>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/80 dark:hover:bg-slate-700 dark:hover:text-slate-200 transition-colors"
              aria-label={closeLabel}
            >
              <X className="w-4 h-4" aria-hidden />
            </button>
          ) : null}
        </div>
      </Card>
    );
  }
  if (!detail) return null;

  const totalRetained = Object.values(detail.retention).reduce((sum, n) => sum + Number(n || 0), 0);

  return (
    <Card className="border-none shadow-sm overflow-hidden">
      <div className="flex items-start gap-2 px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700">
        <Archive className="w-4 h-4 text-primary-600 dark:text-primary-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Historical data retained</p>
          <p className="text-xs text-slate-500">{detail.retentionNote}</p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/80 dark:hover:bg-slate-700 dark:hover:text-slate-200 transition-colors"
            aria-label={closeLabel}
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {RETENTION_ROWS.map(({ key, label, icon: Icon }) => (
          <div
            key={key}
            className="rounded-lg border border-slate-100 dark:border-slate-700/80 bg-white dark:bg-slate-900/30 px-3 py-2.5"
          >
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
              <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
              <span>{label}</span>
            </div>
            <p className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">
              {detail.retention[key]?.toLocaleString() ?? 0}
            </p>
          </div>
        ))}
      </div>
      <p className="px-4 pb-4 text-xs text-slate-400">
        {totalRetained.toLocaleString()} linked records preserved · Archive entries:{' '}
        {detail.archives.length}
      </p>
    </Card>
  );
};
