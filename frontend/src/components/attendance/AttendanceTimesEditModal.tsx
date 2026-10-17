import React, { useEffect, useId, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import {
  ModalField,
  ModalFieldGrid,
  modalInputClass,
  modalTextareaClass,
} from '../ui/ModalForm';
import { AttendanceRecord } from '../../types';
import { Api } from '../../services/api';
import {
  attendanceTimeHmFromIso,
  detectAttendanceTimeChanges,
  formatAttendanceClockDisplay,
} from '../../utils/attendanceRecordApi';
import { formatDateOnlyDisplay, formatDateTimeDisplay } from '../../utils/formatDisplayDate';

export type AttendanceTimesEditModalProps = {
  isOpen: boolean;
  onClose: () => void;
  record: AttendanceRecord | null;
  employeeName: string;
  correctorName?: string;
  onSaved: (updated: AttendanceRecord) => void;
};

export const AttendanceTimesEditModal: React.FC<AttendanceTimesEditModalProps> = ({
  isOpen,
  onClose,
  record,
  employeeName,
  correctorName,
  onSaved,
}) => {
  const clockInId = useId();
  const clockOutId = useId();
  const reasonId = useId();
  const [clockInTime, setClockInTime] = useState('');
  const [clockOutTime, setClockOutTime] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!record) return;
    setClockInTime(attendanceTimeHmFromIso(record.clockIn));
    setClockOutTime(attendanceTimeHmFromIso(record.clockOut));
    setReason('');
    setError(null);
  }, [record, isOpen]);

  const pendingChange = useMemo(() => {
    if (!record) {
      return {
        lines: [] as string[],
        summary: '',
        hasChange: false,
        changeClockIn: false,
        changeClockOut: false,
        clearClockIn: false,
        clearClockOut: false,
      };
    }
    return detectAttendanceTimeChanges(record, {
      clockInTime,
      clockOutTime,
      clearClockIn: false,
      clearClockOut: false,
    });
  }, [record, clockInTime, clockOutTime]);

  const lastCorrection = useMemo(() => {
    if (!record?.correctionAt) return null;
    const when = formatDateTimeDisplay(record.correctionAt, record.correctionAt);
    return {
      when,
      by: correctorName || record.correctionBy || '—',
      reason: record.correctionReason?.trim() || null,
      summary: record.correctionSummary?.trim() || null,
    };
  }, [record, correctorName]);

  const handleSave = async () => {
    if (!record) return;
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) {
      setError('Please enter a reason for this correction (at least 3 characters).');
      return;
    }
    if (!pendingChange.hasChange) {
      setError('Adjust check-in or check-out before saving.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const updated = await Api.attendance.updateTimes(record.id, {
        userId: record.userId,
        date: record.date,
        changeClockIn: pendingChange.changeClockIn,
        changeClockOut: pendingChange.changeClockOut,
        clockInTime: pendingChange.clockInTime ?? null,
        clockOutTime: pendingChange.clockOutTime ?? null,
        clearClockIn: pendingChange.clearClockIn,
        clearClockOut: pendingChange.clearClockOut,
        reason: trimmedReason,
      });
      onSaved(updated);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save times';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen && !!record}
      onClose={onClose}
      title="Edit check-in / check-out"
      size="md"
      description="Corrections are stored with full audit detail."
      disableClose={saving}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={saving || reason.trim().length < 3 || !pendingChange.hasChange}
            isLoading={saving}
          >
            Save correction
          </Button>
        </>
      }
    >
      {!record ? null : (
        <div className="space-y-4 sm:space-y-5">
          <p className="text-sm text-slate-700 dark:text-slate-300 leading-snug">
            <span className="font-semibold text-slate-900 dark:text-white">{employeeName}</span>
            <span className="text-slate-400 dark:text-slate-500"> · </span>
            <span className="tabular-nums">{formatDateOnlyDisplay(record.date, record.date)}</span>
          </p>

          {lastCorrection ? (
            <div className="rounded-xl border border-amber-200/90 bg-amber-50/80 dark:border-amber-800/70 dark:bg-amber-900/20 px-3 py-2.5 sm:px-3.5 sm:py-3 text-xs text-amber-950 dark:text-amber-100 space-y-1.5">
              <p className="font-semibold text-amber-900 dark:text-amber-50">Previous correction</p>
              <p className="leading-relaxed break-words">
                {lastCorrection.when} · {lastCorrection.by}
              </p>
              {lastCorrection.summary ? (
                <div className="font-mono text-[11px] leading-relaxed bg-amber-100/70 dark:bg-amber-950/40 rounded-lg px-2.5 py-2 space-y-0.5 break-words">
                  {lastCorrection.summary.split(' | ').map((part) => (
                    <p key={part}>{part}</p>
                  ))}
                </div>
              ) : null}
              {lastCorrection.reason ? (
                <p className="leading-relaxed break-words">Why: {lastCorrection.reason}</p>
              ) : null}
            </div>
          ) : null}

          <ModalFieldGrid columns={2}>
            <ModalField label="Check in (24h, ICT)" htmlFor={clockInId}>
              <input
                id={clockInId}
                type="time"
                value={clockInTime}
                disabled={saving}
                onChange={(e) => setClockInTime(e.target.value)}
                className={`${modalInputClass} font-mono tabular-nums`}
              />
              <p className="hcms-modal-hint">
                Current in DB: {formatAttendanceClockDisplay(record.clockIn)}
              </p>
            </ModalField>

            <ModalField label="Check out (24h, ICT)" htmlFor={clockOutId}>
              <input
                id={clockOutId}
                type="time"
                value={clockOutTime}
                disabled={saving}
                onChange={(e) => setClockOutTime(e.target.value)}
                className={`${modalInputClass} font-mono tabular-nums`}
              />
              <p className="hcms-modal-hint">
                Current in DB: {formatAttendanceClockDisplay(record.clockOut)}
              </p>
            </ModalField>
          </ModalFieldGrid>

          <ModalField label="Why are you making this change?" htmlFor={reasonId} required>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              disabled={saving}
              placeholder="e.g. Employee forgot to clock out after client visit"
              className={`${modalTextareaClass} min-h-[4.5rem] resize-y`}
            />
            <p className="hcms-modal-hint tabular-nums">{reason.length}/500</p>
          </ModalField>

          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
};
