import React, { useCallback, useRef, useState } from 'react';
import { PayrollCurrencyToggle } from '../components/payroll/PayrollCurrencyToggle';
import { EmployeePayslipDocument } from '../components/payroll/EmployeePayslipDocument';
import { usePreferredCurrency } from '../context/PreferredCurrencyContext';
import { formatPayrollMoney } from '../utils/payrollCurrencyDisplay';
import {
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../hooks/useWorkspaceTabCache';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { usePersonDisplayName } from '../hooks/usePersonDisplayName';
import { Api } from '../services/api';
import { Payslip } from '../types';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { StatusLabel } from '../components/ui/StatusLabel';
import { ExportFormatMenu } from '../components/ui/ExportFormatMenu';
import { exportFilename, type ExportFileExt } from '../utils/export/exportDocumentStandard';
import { exportKeyValueDocument } from '../utils/export/exportDocumentFormats';
import { downloadHtmlElementAsPdf } from '../utils/export/htmlElementToA4Pdf';
import { CreditCard, Calendar, DollarSign, FileText } from 'lucide-react';
import { ContentSkeleton } from '../components/common/ContentSkeleton';
import { PageShell } from '../components/ui/page';
import { resolveExchangeRateKhrPerUsd } from '../utils/payrollExchangeRateCache';
import { userDisplayEmployeeCode, userDisplayPosition } from '../utils/userProfile';
import { useDocumentBranding } from '../hooks/useDocumentBranding';
import { resolvePayslipFooterText } from '../utils/documentBranding';
import { formatDateOnlyDisplay } from '../utils/formatDisplayDate';
export const MyPayroll: React.FC = () => {
  const { user } = useAuth();
  const { language } = useLanguage();
  const documentBranding = useDocumentBranding();
  const payslipFooter = resolvePayslipFooterText(documentBranding);
  const employeeName = usePersonDisplayName();
  const payslipDocRef = useRef<HTMLDivElement>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Payslip | null>(null);
  const { currency: displayCurrency } = usePreferredCurrency();

  const money = (usd: number, khr?: number | null, rate?: number) =>
    formatPayrollMoney(usd, { currency: displayCurrency, khr, exchangeRate: rate });

  const tabCache = useWorkspaceTabCache<{ payslips: Payslip[] }>({
    slot: 'my-payroll-v1',
    cacheKey: user?.id ?? '',
    getSnapshot: () => ({ payslips }),
    applySnapshot: (cached) => {
      setPayslips(cached.payslips);
      setLoading(false);
    },
    shouldPersist: (cached) => cached.payslips.length > 0,
    persistDeps: [payslips, user?.id],
  });

  const loadPayslips = useCallback(
    async (opts?: WorkspaceLoadOptions) => {
      if (!user?.id) return;
      if (!opts?.background) setLoading(true);
      try {
        const list = await Api.payroll.getPayslipsForUser(user.id);
        setPayslips(Array.isArray(list) ? list : []);
        setError(null);
      } catch {
        if (!opts?.background) setError('Could not load your payslips.');
      } finally {
        if (!opts?.background) setLoading(false);
      }
    },
    [user?.id]
  );

  useWorkspaceTabMountLoad(loadPayslips, [loadPayslips, user?.id], tabCache, Boolean(user?.id));

  const downloadPayslipPdf = async () => {
    if (!payslipDocRef.current || !selected) return;
    const safeName = employeeName.replace(/\s+/g, '_') || 'Employee';
    const safePeriod = (selected.month || 'period').replace(/\s+/g, '_');
    await downloadHtmlElementAsPdf(payslipDocRef.current, {
      filename: exportFilename('Payslip', [safeName, safePeriod], 'pdf'),
      paper: 'receipt',
      marginMm: 3,
      scale: 2,
    });
  };

  const handlePayslipExport = async (format: ExportFileExt) => {
    if (!selected?.breakdown) return;
    const b = selected.breakdown;
    const rate = resolveExchangeRateKhrPerUsd(b.exchangeRate, 'active');
    const netKhr = b.netSalaryKHR ?? Math.round((b.netSalary ?? selected.netPay ?? 0) * rate);
    await exportKeyValueDocument(format, {
      module: 'Payslip',
      filenameParts: [employeeName.replace(/\s+/g, '_') || 'Employee', selected.month ?? 'period'],
      reportTitle: 'Payslip',
      sections: [
        {
          title: 'Summary',
          rows: [
            { label: 'Employee', value: employeeName },
            { label: 'Employee ID', value: selected.employeeId ?? userDisplayEmployeeCode(user) ?? '—' },
            { label: 'Pay period', value: selected.month ?? '—' },
            { label: 'Status', value: selected.status },
            { label: 'Base salary (USD)', value: String(b.baseSalary ?? selected.basicSalary ?? 0) },
            { label: 'Gross (USD)', value: String(b.grossSalary ?? 0) },
            { label: 'Total deductions (USD)', value: String(b.deductions?.total ?? 0) },
            { label: 'Net pay (USD)', value: String(b.netSalary ?? selected.netPay ?? 0) },
            { label: 'Net pay (KHR)', value: String(netKhr) },
            { label: 'Exchange rate', value: String(rate) },
          ],
        },
      ],
      exportPdf: () => downloadPayslipPdf(),
      sheetName: 'Payslip',
    });
  };

  const approved = payslips.filter((p) => p.disbursementStatus === 'PAID');
  const onHold = payslips.filter((p) => p.disbursementStatus === 'HOLDING');

  return (
    <PageShell className="max-w-4xl mx-auto w-full">
      <div className="rounded-2xl bg-gradient-to-br from-primary-600 to-primary-800 text-white p-5 sm:p-8 shadow-lg shadow-primary-900/20">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <div className="p-3 rounded-2xl bg-white/15 backdrop-blur shrink-0">
              <CreditCard className="w-8 h-8" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold">Payslip</h1>
              <p className="text-emerald-100 mt-1 text-sm max-w-md">
                Salary records released by HR after payroll approval. Paid slips are available in full;
                held slips show a notice from HR.
              </p>
            </div>
          </div>
          <PayrollCurrencyToggle className="bg-white/10 border-white/20 self-start shrink-0" />
        </div>
        <div className="responsive-stat-grid mt-6">
          <div className="rounded-xl bg-white/10 px-4 py-3">
            <p className="text-xs text-emerald-100">Total slips</p>
            <p className="text-2xl font-bold">{loading ? '—' : payslips.length}</p>
          </div>
          <div className="rounded-xl bg-white/10 px-4 py-3">
            <p className="text-xs text-emerald-100">Published</p>
            <p className="text-2xl font-bold">{loading ? '—' : approved.length}</p>
          </div>
          <div className="rounded-xl bg-white/10 px-4 py-3">
            <p className="text-xs text-emerald-100">On hold</p>
            <p className="text-2xl font-bold">{loading ? '—' : onHold.length}</p>
          </div>
        </div>
      </div>

      {loading && <ContentSkeleton layout="list" rows={3} />}

      {!loading && error && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && payslips.length === 0 && (
        <Card>
          <div className="py-16 text-center text-slate-500">
            <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No payslips yet</p>
            <p className="text-sm mt-1">HR will release your payslip here after payroll is approved and paid out.</p>
          </div>
        </Card>
      )}

      <div className="space-y-3">
        {(loading ? [] : payslips).map((p) => {
          const net = p.breakdown?.netSalary ?? p.netPay ?? 0;
          const gross = p.breakdown?.grossSalary ?? p.breakdown?.baseSalary ?? 0;
          const isPaid = p.disbursementStatus === 'PAID';
          const isHolding = p.disbursementStatus === 'HOLDING';
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelected(p)}
              className="w-full text-left"
            >
              <Card className="!p-0 overflow-hidden hover:ring-2 hover:ring-primary-500/30 transition-all">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-bold text-slate-900 dark:text-white">{p.month || 'Pay period'}</p>
                      <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                        <Calendar className="w-3.5 h-3.5" />
                        {p.generatedAt ? formatDateOnlyDisplay(p.generatedAt) : '—'}
                      </p>
                      {gross > 0 && (
                        <p className="text-xs text-slate-400 mt-1">
                          Gross{' '}
                          {money(
                            gross,
                            p.breakdown?.nssfSalaryKhr != null
                              ? Math.round(
                                  gross *
                                    resolveExchangeRateKhrPerUsd(
                                      p.breakdown.exchangeRateUsed ?? p.breakdown.exchangeRate,
                                      'active'
                                    )
                                )
                              : undefined,
                            p.breakdown?.exchangeRateUsed ?? p.breakdown?.exchangeRate
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">
                      {money(
                        Number(net),
                        p.breakdown?.netSalaryKHR,
                        p.breakdown?.exchangeRateUsed ?? p.breakdown?.exchangeRate
                      )}
                    </p>
                    <StatusLabel
                      status={isPaid ? 'PAID' : isHolding ? 'HOLDING' : 'PENDING'}
                      context="payroll"
                      label={isPaid ? 'Paid' : isHolding ? 'On hold' : 'Pending'}
                      size="sm"
                      className="mt-1"
                    />
                  </div>
                </div>
              </Card>
            </button>
          );
        })}
      </div>

      <Modal
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        hideHeader
        size="2xl"
        contentClassName="!p-0 bg-slate-100/90 dark:bg-slate-950/90"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setSelected(null)}>
              Close
            </Button>
            <ExportFormatMenu
              variant="button"
              buttonLabel="Export"
              disabled={!selected?.breakdown}
              onExport={handlePayslipExport}
            />
          </div>
        }
      >
        {selected?.breakdown ? (
          <div className="max-h-[min(78vh,920px)] overflow-y-auto px-3 py-4 sm:px-5 sm:py-6">
            <EmployeePayslipDocument
              ref={payslipDocRef}
              payslip={selected}
              employeeName={employeeName}
              employeeCode={
                selected.employeeId?.trim() ||
                userDisplayEmployeeCode(user) ||
                '—'
              }
              position={userDisplayPosition(user, language)}
              displayCurrency={displayCurrency}
              money={money}
              payslipFooter={payslipFooter}
            />
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-slate-500">
            Payslip details are not available for this record.
          </div>
        )}
      </Modal>
    </PageShell>
  );
};

export default MyPayroll;
