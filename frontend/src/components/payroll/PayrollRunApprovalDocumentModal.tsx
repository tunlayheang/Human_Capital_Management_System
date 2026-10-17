import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { ContentSkeleton } from '../common/ContentSkeleton';
import { Link } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import type { PayrollPendingApprovalItem } from '../../types';
import { PayrollApprovalTracker } from './payrollApprovalDisplay';
import { formatRunStatusLabel } from '../../pages/payroll/payrollUtils';
import { StatusLabel } from '../ui/StatusLabel';
import { exportPayrollApprovalDocument } from '../../utils/exportPayrollApprovalPdf';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';
import { ExportFormatMenu } from '../ui/ExportFormatMenu';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  row: PayrollPendingApprovalItem | null;
};

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value || 0);
}

export const PayrollRunApprovalDocumentModal: React.FC<Props> = ({ isOpen, onClose, row }) => {
  const { showToast } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<PayrollPendingApprovalItem | null>(null);

  const load = useCallback(async () => {
    if (!row?.runId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    try {
      await Api.payroll.getRun(row.runId);
      setDetail(row);
    } catch (e) {
      setDetail(row);
      showToast(
        (e as Error)?.message || 'Could not refresh payroll run — showing summary from queue.',
        'warning'
      );
    } finally {
      setLoading(false);
    }
  }, [row, showToast]);

  useEffect(() => {
    if (!isOpen || !row) {
      setDetail(null);
      return;
    }
    void load();
  }, [isOpen, row, load]);

  const handleExport = async (format: ExportFileExt) => {
    const payload = detail ?? row;
    if (!payload) return;
    try {
      await exportPayrollApprovalDocument(format, payload);
      showToast(`Payroll approval exported as ${format === 'xlsx' ? 'Excel' : format.toUpperCase()}.`, 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Export failed.', 'error');
    }
  };

  const data = detail ?? row;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Payroll run detail"
      description={data ? `${data.monthLabel} — review before approval` : 'Payroll approval document'}
      size="2xl"
      contentClassName="!p-0 bg-slate-100/90 dark:bg-slate-950/60"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 w-full">
          {data ? (
            <Link to={data.href}>
              <Button type="button" variant="outline" size="sm">
                <ExternalLink className="w-4 h-4 mr-1" />
                Open full run
              </Button>
            </Link>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <ExportFormatMenu variant="button" disabled={!data || loading} onExport={handleExport} />
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      }
    >
      <div className="p-4 sm:p-6 max-h-[min(72vh,42rem)] overflow-y-auto overscroll-contain">
        {loading ? (
          <ContentSkeleton layout="form" rows={1} label="Loading payroll document…" />
        ) : data ? (
          <div className="mx-auto max-w-3xl surface-card shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-700 to-emerald-900 px-5 py-4 text-white">
              <p className="text-xs uppercase tracking-[0.18em] text-emerald-100/90">Payroll approval</p>
              <h3 className="text-xl font-semibold mt-1">{data.monthLabel}</h3>
              <p className="text-sm text-emerald-100/90 mt-1">
                {data.totalEmployees} employees · Net pay {formatMoney(data.totalNetPay)}
              </p>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex flex-wrap gap-2">
                <StatusLabel
                  status={data.status}
                  context="payroll"
                  label={formatRunStatusLabel(data.status)}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Prepared by</p>
                  <p className="text-slate-800 dark:text-slate-200">
                    {data.calculatedByName ?? data.calculatedBy ?? '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Calculated at</p>
                  <p className="text-slate-800 dark:text-slate-200">{data.calculatedAt ?? '—'}</p>
                </div>
              </div>
              <PayrollApprovalTracker row={data} compact viewerUserId={user?.id} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-center text-slate-500 py-12">No payroll data to display.</p>
        )}
      </div>
    </Modal>
  );
};

export default PayrollRunApprovalDocumentModal;
