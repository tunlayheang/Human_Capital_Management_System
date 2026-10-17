import React, { useCallback, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, Loader2, Upload } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { Api } from '../../services/api';
import {
  buildEmployeeImportCreatePayload,
  downloadEmployeeImportTemplate,
  MAX_EMPLOYEE_IMPORT_ROWS,
  parseEmployeeImportAoa,
  readEmployeeImportFile,
} from '../../utils/importEmployees';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void | Promise<void>;
};

type ImportBatchResult = {
  total: number;
  created: number;
  skipped: number;
  errors: Array<{ row: number; employeeId?: string; message: string }>;
};

export const EmployeeImportModal: React.FC<Props> = ({ isOpen, onClose, onImported }) => {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [parseErrors, setParseErrors] = useState<Array<{ row: number; message: string }>>([]);
  const [previewCount, setPreviewCount] = useState(0);
  const [result, setResult] = useState<ImportBatchResult | null>(null);

  const resetState = useCallback(() => {
    setFileName('');
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
      const aoa = await readEmployeeImportFile(file);
      const parsed = parseEmployeeImportAoa(aoa);
      setParseErrors(parsed.errors);
      setPreviewCount(parsed.rows.length);
      if (parsed.rows.length === 0 && parsed.errors.length === 0) {
        showToast(t('employees.importNoDataRows'), 'warning');
      }
    } catch (e) {
      setParseErrors([{ row: 0, message: e instanceof Error ? e.message : 'Could not read file' }]);
      setPreviewCount(0);
      showToast(t('employees.importReadError'), 'error');
    }
  };

  const handleDownloadTemplate = (format: 'csv' | 'xlsx') => {
    downloadEmployeeImportTemplate(format);
    showToast(t('employees.importTemplateDownloaded'), 'success');
  };

  const handleImport = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      showToast(t('employees.importSelectFile'), 'warning');
      return;
    }

    setBusy(true);
    setResult(null);
    try {
      const aoa = await readEmployeeImportFile(file);
      const parsed = parseEmployeeImportAoa(aoa);
      if (parsed.rows.length === 0) {
        setParseErrors(parsed.errors);
        showToast(parsed.errors[0]?.message || t('employees.importNoDataRows'), 'warning');
        return;
      }
      if (parsed.rows.length > MAX_EMPLOYEE_IMPORT_ROWS) {
        showToast(
          t('employees.importTooManyRows', {
            max: MAX_EMPLOYEE_IMPORT_ROWS,
            count: parsed.rows.length,
          }),
          'warning'
        );
        return;
      }

      const batch: ImportBatchResult = {
        total: parsed.rows.length,
        created: 0,
        skipped: parsed.errors.length,
        errors: parsed.errors.map((err) => ({ row: err.row, message: err.message })),
      };

      for (const row of parsed.rows) {
        let employeeId = row.employeeId.trim();
        try {
          if (!employeeId) {
            const generated = await Api.employees.generateNextId();
            employeeId = String(
              (generated as { next_id?: string })?.next_id || (generated as { nextId?: string })?.nextId || ''
            ).trim();
          }
          if (!employeeId) {
            batch.errors.push({
              row: row.rowNumber,
              message: 'Could not allocate Employee ID',
            });
            continue;
          }

          const payload = buildEmployeeImportCreatePayload(row, employeeId);
          await Api.employees.create(payload);
          batch.created += 1;
        } catch (e) {
          const message =
            e && typeof e === 'object' && 'message' in e
              ? String((e as { message?: unknown }).message || 'Create failed')
              : e instanceof Error
                ? e.message
                : 'Create failed';
          batch.errors.push({
            row: row.rowNumber,
            employeeId: employeeId || undefined,
            message,
          });
        }
      }

      setResult(batch);
      const failed = batch.errors.length;

      if (batch.created > 0) {
        await onImported();
      }

      if (failed === 0 && batch.created > 0) {
        showToast(
          t('employees.importSuccess', {
            created: batch.created,
            skipped: batch.skipped,
          }),
          'success'
        );
        handleClose();
      } else if (batch.created > 0) {
        showToast(
          t('employees.importPartialSuccess', {
            created: batch.created,
            failed,
          }),
          'warning'
        );
      } else {
        showToast(t('employees.importAllFailed'), 'error');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('employees.importFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('employees.importTitle')}
      description={t('employees.importDescription')}
      size="lg"
      disableClose={busy}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" disabled={busy || previewCount === 0} onClick={() => void handleImport()}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}
            {t('employees.importAction')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40 px-4 py-3 space-y-2">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
            {t('employees.importTemplateTitle')}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">{t('employees.importTemplateHint')}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => handleDownloadTemplate('xlsx')}
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              {t('employees.importTemplateXlsx')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => handleDownloadTemplate('csv')}
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              {t('employees.importTemplateCsv')}
            </Button>
          </div>
        </div>

        <label className="block text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-200">
            {t('employees.importFileLabel')}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="mt-1.5 block w-full text-base text-slate-600 dark:text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100 dark:file:bg-primary-950/50 dark:file:text-primary-300"
            onChange={(e) => void handleFileChange(e)}
            disabled={busy}
          />
          {fileName ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {t('employees.importRowsReady', { count: previewCount, file: fileName })}
            </p>
          ) : null}
        </label>

        {parseErrors.length > 0 ? (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/20 px-4 py-3">
            <div className="flex gap-2 text-amber-900 dark:text-amber-100">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="text-sm space-y-1">
                <p className="font-medium">
                  {t('employees.importParseErrors', { count: parseErrors.length })}
                </p>
                <ul className="text-xs list-disc pl-4 max-h-28 overflow-y-auto">
                  {parseErrors.slice(0, 8).map((err) => (
                    <li key={`${err.row}-${err.message}`}>
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
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              {t('employees.importResultTitle')}
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t('employees.importResultSummary', {
                created: result.created,
                skipped: result.skipped,
                failed: result.errors.length,
              })}
            </p>
            {result.errors.length > 0 ? (
              <ul className="text-xs text-rose-700 dark:text-rose-300 list-disc pl-4 max-h-32 overflow-y-auto">
                {result.errors.slice(0, 12).map((err) => (
                  <li key={`${err.row}-${err.message}`}>
                    Row {err.row}
                    {err.employeeId ? ` (${err.employeeId})` : ''}: {err.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
};
