import React, { useCallback, useId, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ModalField, modalInputClass } from '../ui/ModalForm';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { Api } from '../../services/api';
import {
  parseAttendanceImportAoa,
  readAttendanceImportFile,
  MAX_ATTENDANCE_IMPORT_ROWS,
} from '../../utils/importAttendance';
import type { AttendanceImportBatchResult } from '../../types/attendance';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void | Promise<void>;
};

export const AttendanceImportModal: React.FC<Props> = ({ isOpen, onClose, onImported }) => {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const reasonId = useId();
  const fileId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [parseErrors, setParseErrors] = useState<Array<{ row: number; message: string }>>([]);
  const [previewCount, setPreviewCount] = useState(0);
  const [result, setResult] = useState<AttendanceImportBatchResult | null>(null);

  const resetState = useCallback(() => {
    setFileName('');
    setReason('');
    setParseErrors([]);
    setPreviewCount(0);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleClose = useCallback(() => {
    if (busy) return;
    resetState();
    onClose();
  }, [busy, onClose, resetState]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setResult(null);
    if (!file) {
      setFileName('');
      setParseErrors([]);
      setPreviewCount(0);
      return;
    }

    setFileName(file.name);
    try {
      const aoa = await readAttendanceImportFile(file);
      const parsed = parseAttendanceImportAoa(aoa);
      setParseErrors(parsed.errors);
      setPreviewCount(parsed.rows.length);
      if (parsed.rows.length === 0 && parsed.errors.length === 0) {
        showToast(t('attendance.importNoDataRows'), 'warning');
      }
    } catch (e) {
      setParseErrors([{ row: 0, message: e instanceof Error ? e.message : 'Could not read file' }]);
      setPreviewCount(0);
      showToast(t('attendance.importReadError'), 'error');
    }
  };

  const handleImport = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      showToast(t('attendance.importSelectFile'), 'warning');
      return;
    }

    const importReason = reason.trim() || t('attendance.importDefaultReason');
    if (importReason.length < 3) {
      showToast(t('attendance.importReasonRequired'), 'warning');
      return;
    }

    setBusy(true);
    setResult(null);
    try {
      const aoa = await readAttendanceImportFile(file);
      const parsed = parseAttendanceImportAoa(aoa);
      if (parsed.rows.length === 0) {
        setParseErrors(parsed.errors);
        showToast(
          parsed.errors[0]?.message || t('attendance.importNoDataRows'),
          'warning'
        );
        return;
      }
      if (parsed.rows.length > MAX_ATTENDANCE_IMPORT_ROWS) {
        showToast(
          t('attendance.importTooManyRows', {
            max: MAX_ATTENDANCE_IMPORT_ROWS,
            count: parsed.rows.length,
          }),
          'warning'
        );
        return;
      }

      const batch = await Api.attendance.importRows(
        parsed.rows.map((row) => ({
          rowNumber: row.rowNumber,
          employeeId: row.employeeId,
          date: row.date,
          checkIn: row.checkIn || null,
          checkOut: row.checkOut || null,
          status: row.status || null,
        })),
        importReason
      );

      setResult(batch);
      const failed = batch.errors.length;
      const changed = batch.created + batch.updated;

      if (changed > 0) {
        await onImported();
      }

      if (failed === 0 && changed > 0) {
        showToast(
          t('attendance.importSuccess', {
            created: batch.created,
            updated: batch.updated,
            skipped: batch.skipped,
          }),
          'success'
        );
        handleClose();
      } else if (changed > 0) {
        showToast(
          t('attendance.importPartialSuccess', {
            created: batch.created,
            updated: batch.updated,
            failed,
          }),
          'warning'
        );
      } else {
        showToast(t('attendance.importAllFailed'), 'error');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('attendance.importFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('attendance.importTitle')}
      description={t('attendance.importDescription')}
      size="lg"
      disableClose={busy}
      footer={
        <>
          <Button type="button" variant="ghost" disabled={busy} onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={busy || previewCount === 0}
            onClick={() => void handleImport()}
            isLoading={busy}
            icon={!busy ? <Download className="w-4 h-4" /> : undefined}
          >
            {t('attendance.importAction')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ModalField label={t('attendance.importReasonLabel')} htmlFor={reasonId}>
          <input
            id={reasonId}
            className={modalInputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('attendance.importReasonPlaceholder')}
            disabled={busy}
          />
        </ModalField>

        <ModalField label={t('attendance.importFileLabel')} htmlFor={fileId}>
          <input
            id={fileId}
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="block w-full min-w-0 max-w-full text-base text-slate-600 dark:text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100 dark:file:bg-primary-950/50 dark:file:text-primary-300"
            onChange={(e) => void handleFileChange(e)}
            disabled={busy}
          />
          {fileName ? (
            <p className="hcms-modal-hint">
              {t('attendance.importRowsReady', { count: previewCount, file: fileName })}
            </p>
          ) : null}
        </ModalField>

        {parseErrors.length > 0 ? (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/20 px-3 py-2.5 sm:px-4 sm:py-3">
            <div className="flex gap-2 text-amber-900 dark:text-amber-100">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="min-w-0 text-sm space-y-1">
                <p className="font-medium">{t('attendance.importParseErrors', { count: parseErrors.length })}</p>
                <ul className="text-xs list-disc pl-4 max-h-28 overflow-y-auto">
                  {parseErrors.slice(0, 8).map((err) => (
                    <li key={`${err.row}-${err.message}`} className="break-words">
                      {err.row > 0 ? `Row ${err.row}: ` : ''}
                      {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : null}

        {result ? (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/20 px-3 py-2.5 sm:px-4 sm:py-3">
            <div className="flex gap-2 text-emerald-900 dark:text-emerald-100">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="min-w-0 text-sm space-y-1">
                <p className="font-medium">
                  {t('attendance.importResultSummary', {
                    created: result.created,
                    updated: result.updated,
                    skipped: result.skipped,
                    failed: result.errors.length,
                  })}
                </p>
                {result.errors.length > 0 ? (
                  <ul className="text-xs list-disc pl-4 max-h-28 overflow-y-auto">
                    {result.errors.slice(0, 8).map((err) => (
                      <li key={`${err.rowNumber}-${err.message}`} className="break-words">
                        Row {err.rowNumber}: {err.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
};
