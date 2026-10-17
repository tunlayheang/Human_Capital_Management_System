import React from 'react';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ExportFormatMenu } from '../ui/ExportFormatMenu';
import { LeaveRequest } from '../../types';
import { calculateLeaveDays, formatLeaveDateRange, formatLeaveDurationLabel } from '../../utils/leaveDays';
import { MY_LEAVE_TYPE_BADGE } from '../../utils/leaveStyles';
import { StatusLabel } from '../ui/StatusLabel';
import {
  formatLeaveRequestedAt,
  formatLeaveStatusLabel,
  leaveApproverTrackingLines,
  type LeaveApproverUserLike,
} from '../../utils/leaveWorkflow';
import { exportLeaveRequestDocument } from '../../utils/exportLeaveRequestPdf';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';
import { useToast } from '../../context/ToastContext';
import { userDisplayEmployeeCode, userDisplayName } from '../../utils/userProfile';
import { useLanguage } from '../../context/LanguageContext';
import {
  localizedLabelUsesKhmerFont,
  resolveStoredLeaveTypeLabel,
} from '../../utils/localizedEntityLabel';
import { cn } from '../../utils';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  leave: LeaveRequest | null;
  usersMap?: Record<string, LeaveApproverUserLike | undefined>;
  departmentNames?: Record<string, string>;
  /** @deprecated Use usersMap — kept for backward compatibility */
  managerName?: string;
  labels: {
    title: string;
    type: string;
    dates: string;
    days: string;
    day: string;
    reason: string;
    status: string;
    manager: string;
    close: string;
    requestAgain?: string;
  };
  onRequestAgain?: (leave: LeaveRequest) => void;
  /** Show Export PDF in the footer (default true for approval review). */
  showExport?: boolean;
};

function ReadOnlyField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
        {label}
      </p>
      <div className="text-sm text-slate-800 dark:text-slate-200">{children}</div>
    </div>
  );
}

export const LeaveRequestViewModal: React.FC<Props> = ({
  isOpen,
  onClose,
  leave,
  usersMap = {},
  departmentNames = {},
  managerName,
  labels,
  onRequestAgain,
  showExport = true,
}) => {
  const { showToast } = useToast();
  const { language } = useLanguage();

  if (!leave) return null;

  const employee = usersMap[leave.userId];
  const employeeName = employee ? userDisplayName(employee, language) : leave.userId;
  const employeeCode = employee ? userDisplayEmployeeCode(employee) : '—';
  const department =
    employee?.departmentId
      ? departmentNames[employee.departmentId] || employee.departmentId
      : '—';
  const approverLines = leaveApproverTrackingLines(leave, usersMap);
  const dayCount = calculateLeaveDays(leave);
  const dateLabel = formatLeaveDateRange(leave);
  const canRequestAgain = !!onRequestAgain;

  const handleExport = async (format: ExportFileExt) => {
    try {
      await exportLeaveRequestDocument(format, leave, usersMap, {
        name: employeeName,
        employeeId: employeeCode !== '—' ? employeeCode : undefined,
        department,
      });
      showToast(`Leave request exported as ${format === 'xlsx' ? 'Excel' : format.toUpperCase()}.`, 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Export failed.', 'error');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={labels.title}
      size="md"
      description="Review the submitted leave request before approving or rejecting."
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {showExport ? (
            <ExportFormatMenu variant="button" onExport={handleExport} />
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {labels.close}
          </Button>
          {canRequestAgain ? (
            <Button type="button" size="sm" onClick={() => onRequestAgain(leave)}>
              {labels.requestAgain}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-900/60">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{employeeName}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {employeeCode !== '—' ? employeeCode : 'Employee'}
              {department !== '—' ? ` · ${department}` : ''}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4">
            <ReadOnlyField label={labels.type}>
              <Badge
                className={cn(
                  MY_LEAVE_TYPE_BADGE,
                  localizedLabelUsesKhmerFont(leave.type, leave.typeKh, language) && 'font-khmer'
                )}
              >
                {resolveStoredLeaveTypeLabel(leave.type, language, { typeKh: leave.typeKh })}
              </Badge>
            </ReadOnlyField>
            <ReadOnlyField label={labels.status}>
              <StatusLabel
                status={leave.status}
                context="leave"
                label={formatLeaveStatusLabel(leave.status)}
              />
            </ReadOnlyField>
            <ReadOnlyField label={labels.dates}>{dateLabel}</ReadOnlyField>
            <ReadOnlyField label={labels.days}>
              {formatLeaveDurationLabel(dayCount, {
                day: labels.day,
                days: labels.days,
                halfDay: '½ day',
              })}
            </ReadOnlyField>
            <ReadOnlyField label="Requested at">{formatLeaveRequestedAt(leave)}</ReadOnlyField>
            {approverLines.length > 0 ? (
              <div className="sm:col-span-2">
                <ReadOnlyField label="Approval">
                  <ul className="space-y-1">
                    {approverLines.map((line) => (
                      <li key={line.key}>
                        <span className="font-medium text-slate-600 dark:text-slate-300">
                          {line.label}:
                        </span>{' '}
                        {line.name}
                      </li>
                    ))}
                  </ul>
                </ReadOnlyField>
              </div>
            ) : managerName ? (
              <ReadOnlyField label={labels.manager}>{managerName}</ReadOnlyField>
            ) : null}
            <div className="sm:col-span-2">
              <ReadOnlyField label={labels.reason}>
                <span className="whitespace-pre-wrap break-words">{leave.reason || '—'}</span>
              </ReadOnlyField>
            </div>
            {leave.rejectionReason ? (
              <div className="sm:col-span-2">
                <ReadOnlyField
                  label={
                    String(leave.status).toUpperCase() === 'RETURNED'
                      ? 'Return comment'
                      : 'Decline reason'
                  }
                >
                  <span
                    className={
                      String(leave.status).toUpperCase() === 'RETURNED'
                        ? 'text-amber-800 dark:text-amber-200'
                        : 'text-red-700 dark:text-red-300'
                    }
                  >
                    {leave.rejectionReason}
                  </span>
                </ReadOnlyField>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
  );
};
