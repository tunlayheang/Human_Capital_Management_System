import React from 'react';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ExportFormatMenu } from '../ui/ExportFormatMenu';
import type { OvertimeRequest, User } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { StatusLabel } from '../ui/StatusLabel';
import {
  formatOvertimeRequestedAt,
  formatOvertimeStatusLabel,
  overtimeRateLabel,
} from '../../utils/overtimeLabels';
import { userDisplayEmployeeCode, userDisplayName } from '../../utils/userProfile';
import { exportOvertimeRequestDocument } from '../../utils/exportOvertimeRequestPdf';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';
import { useToast } from '../../context/ToastContext';
import { formatDateOnlyDisplay, formatDateTimeDisplay } from '../../utils/formatDisplayDate';
import {
  localizedLabelUsesKhmerFont,
  resolveOvertimeRequestTypeLabel,
} from '../../utils/localizedEntityLabel';
import { cn } from '../../utils';
import { parseAttendanceTimestamp, HCMS_ATTENDANCE_TZ } from '../../utils/attendanceRecordApi';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  request: OvertimeRequest | null;
  usersMap?: Record<string, User>;
  /** Show Export PDF in the footer (default true). */
  showExport?: boolean;
  /** When set, show Edit & resubmit for returned (or pending) requests. */
  onEdit?: (request: OvertimeRequest) => void;
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

/** HH:mm or short time strings for scheduled start/end. */
function formatOptionalTime(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  return raw || '—';
}

/** Attendance punch timestamps → dd/MM/yyyy HH:mm (Cambodia office time). */
function formatClockPunchDisplay(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) return raw.slice(0, 5);

  const d = parseAttendanceTimestamp(raw);
  if (!d) return formatDateTimeDisplay(raw);

  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: HCMS_ATTENDANCE_TZ,
  }).formatToParts(d);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const day = get('day');
  const month = get('month');
  const year = get('year');
  const hour = get('hour');
  const minute = get('minute');
  if (!day || !month || !year) return formatDateTimeDisplay(raw);
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

export const OvertimeRequestViewModal: React.FC<Props> = ({
  isOpen,
  onClose,
  request,
  usersMap = {},
  showExport = true,
  onEdit,
}) => {
  const { t, language } = useLanguage();
  const { showToast } = useToast();

  if (!request) return null;

  const employee = usersMap[request.userId];
  const employeeName = employee ? userDisplayName(employee, language) : request.userId;
  const employeeCode = employee ? userDisplayEmployeeCode(employee) : '—';
  const approver =
    request.approvedBy && usersMap[request.approvedBy]
      ? userDisplayName(usersMap[request.approvedBy], language)
      : request.approvedBy
        ? request.approvedBy
        : null;
  const canEdit =
    !!onEdit && (request.status === 'RETURNED' || request.status === 'PENDING');

  const handleExport = async (format: ExportFileExt) => {
    try {
      await exportOvertimeRequestDocument(format, request, usersMap, language, {
        name: employeeName,
        employeeId: employeeCode !== '—' ? employeeCode : undefined,
      });
      showToast(`Overtime request exported as ${format === 'xlsx' ? 'Excel' : format.toUpperCase()}.`, 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Export failed.', 'error');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('overtime.viewTitle') || 'Overtime request details'}
      size="md"
      description={
        t('overtime.viewDescription') ||
        'Review the submitted overtime request before approving or rejecting.'
      }
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {showExport ? <ExportFormatMenu variant="button" onExport={handleExport} /> : null}
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t('common.close') || 'Close'}
          </Button>
          {canEdit ? (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onClose();
                onEdit(request);
              }}
            >
              {request.status === 'RETURNED'
                ? t('common.edit') || 'Edit & resubmit'
                : t('common.edit') || 'Edit'}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-900/60">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{employeeName}</p>
            {employeeCode !== '—' ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                {employeeCode}
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4">
            <ReadOnlyField label={t('overtime.fieldDate') || 'Work date'}>
              {formatDateOnlyDisplay(request.workDate)}
            </ReadOnlyField>
            <ReadOnlyField label={t('overtime.fieldType') || 'Type'}>
              <span
                className={cn(
                  localizedLabelUsesKhmerFont(
                    request.otTypeName,
                    request.otTypeNameKh,
                    language
                  ) && 'font-khmer'
                )}
              >
                {resolveOvertimeRequestTypeLabel(request, language)}
              </span>
            </ReadOnlyField>
            <ReadOnlyField label={t('overtime.fieldHours') || 'Hours'}>
              {request.hours}h
            </ReadOnlyField>
            <ReadOnlyField label={t('overtime.fieldRate') || 'Rate'}>
              <Badge variant="neutral">{overtimeRateLabel(request.rateTier)}</Badge>
            </ReadOnlyField>
            <ReadOnlyField label={t('overtime.fieldStatus') || 'Status'}>
              <StatusLabel
                status={request.status}
                context="overtime"
                label={formatOvertimeStatusLabel(request.status, request)}
              />
            </ReadOnlyField>
            <ReadOnlyField label={t('overtime.fieldSubmitted') || 'Submitted'}>
              {formatOvertimeRequestedAt(request)}
            </ReadOnlyField>
            {(request.startTime || request.endTime) && (
              <>
                <ReadOnlyField label={t('overtime.fieldStartTime') || 'Start time'}>
                  {formatOptionalTime(request.startTime)}
                </ReadOnlyField>
                <ReadOnlyField label={t('overtime.fieldEndTime') || 'End time'}>
                  {formatOptionalTime(request.endTime)}
                </ReadOnlyField>
              </>
            )}
            {(request.clockIn || request.clockOut) && (
              <>
                <ReadOnlyField label={t('overtime.fieldClockIn') || 'Clock in'}>
                  {formatClockPunchDisplay(request.clockIn)}
                </ReadOnlyField>
                <ReadOnlyField label={t('overtime.fieldClockOut') || 'Clock out'}>
                  {formatClockPunchDisplay(request.clockOut)}
                </ReadOnlyField>
              </>
            )}
            <div className="sm:col-span-2">
              <ReadOnlyField label={t('overtime.fieldReason') || 'Reason'}>
                <p className="whitespace-pre-wrap break-words">{request.reason || '—'}</p>
              </ReadOnlyField>
            </div>
            {(request.status === 'REJECTED' || request.status === 'RETURNED') &&
            request.rejectionReason ? (
              <div className="sm:col-span-2">
                <ReadOnlyField
                  label={
                    request.status === 'RETURNED'
                      ? t('overtime.fieldReturnReason') || 'Return comment'
                      : t('overtime.fieldRejectionReason') || 'Rejection reason'
                  }
                >
                  <p
                    className={
                      request.status === 'RETURNED'
                        ? 'whitespace-pre-wrap text-amber-800 dark:text-amber-200'
                        : 'whitespace-pre-wrap text-rose-700 dark:text-rose-300'
                    }
                  >
                    {request.rejectionReason}
                  </p>
                </ReadOnlyField>
              </div>
            ) : null}
            {request.status === 'APPROVED' && (approver || request.approvedAt) ? (
              <div className="sm:col-span-2">
                <ReadOnlyField label={t('overtime.fieldApprovedBy') || 'Approved by'}>
                  {[approver, request.approvedAt ? formatOvertimeRequestedAt({ createdAt: request.approvedAt }) : null]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </ReadOnlyField>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default OvertimeRequestViewModal;
