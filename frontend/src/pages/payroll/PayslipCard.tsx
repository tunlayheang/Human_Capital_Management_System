import React, { useRef, useState } from 'react';
import { AlertTriangle, Building2, Loader2, Upload } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ExportFormatMenu } from '../../components/ui/ExportFormatMenu';
import { normalizeEmployeeDisplayId } from '../../utils';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';
import { exportKeyValueDocument } from '../../utils/export/exportDocumentFormats';
import { downloadHtmlElementAsPdf } from '../../utils/export/htmlElementToA4Pdf';
export interface RunItem {
  id: string;
  employeeId: string;
  baseSalary: number;
  proratedBase: number;
  workedDays: number;
  /** Total scheduled working days in the pay period (calendar engine). */
  standardWorkingDays?: number;
  regularOtPay: number;
  nightOtPay: number;
  sundayOtPay: number;
  publicHolidayPay: number;
  seniorityIndemnity: number;
  allowances: {
    transport: number;
    meal: number;
    housing: number;
    other: number;
    total: number;
  };
  grossPay: number;
  nssfHealth: number;
  nssfPension: number;
  taxOnSalary: number;
  taxableBase: number;
  otherDeductions: {
    advance: number;
    absence: number;
    other: number;
    total: number;
  };
  netPay: number;
  netPayKHR: number;
  exchangeRate: number;
  minimumWageCompliant: boolean;
  periodStart?: string;
  periodEnd?: string;
}

type Props = {
  item: RunItem;
  employeeName?: string;
  position?: string;
  periodLabel?: string;
};

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const PayslipCard: React.FC<Props> = ({
  item,
  employeeName = 'Employee',
  position = '—',
  periodLabel,
}) => {
  const printRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);

  const nssfEmployeeDeduction =
    item.nssfPension > 0 ? item.nssfPension : item.nssfHealth + item.nssfPension;
  const totalDeductions =
    nssfEmployeeDeduction + item.taxOnSalary + item.otherDeductions.total;

  const period =
    periodLabel ??
    (item.periodStart && item.periodEnd
      ? `${item.periodStart} → ${item.periodEnd}`
      : '—');

  const handlePDF = async () => {
    if (!printRef.current) return;
    setIsLoading(true);
    try {
      const safeName = employeeName.replace(/\s+/g, '_');
      const safePeriod = (item.periodStart ?? 'period').replace(/\s+/g, '_');
      await downloadHtmlElementAsPdf(printRef.current, {
        filename: `Payslip_${safeName}_${safePeriod}.pdf`,
        paper: 'receipt',
        marginMm: 3,
        scale: 2,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async (format: ExportFileExt) => {
    await exportKeyValueDocument(format, {
      module: 'Payslip',
      filenameParts: [employeeName, item.periodStart ?? 'period'],
      reportTitle: 'Payslip',
      exportPdf: handlePDF,
      sections: [
        {
          title: 'Employee',
          rows: [
            { label: 'Employee ID', value: normalizeEmployeeDisplayId(item.employeeId) },
            { label: 'Employee Name', value: employeeName },
            { label: 'Position', value: position },
            { label: 'Period', value: period },
          ],
        },
        {
          title: 'Earnings',
          rows: [
            { label: 'Base Salary', value: fmt(item.baseSalary) },
            { label: 'Prorated Base', value: fmt(item.proratedBase) },
            { label: 'Worked Days', value: String(item.workedDays) },
            { label: 'Regular OT', value: fmt(item.regularOtPay) },
            { label: 'Night OT', value: fmt(item.nightOtPay) },
            { label: 'Sunday OT', value: fmt(item.sundayOtPay) },
            { label: 'Public Holiday Pay', value: fmt(item.publicHolidayPay) },
            { label: 'Siniority', value: fmt(item.seniorityIndemnity) },
            { label: 'Transport Allowance', value: fmt(item.allowances.transport) },
            { label: 'Meal Allowance', value: fmt(item.allowances.meal) },
            { label: 'Housing Allowance', value: fmt(item.allowances.housing) },
            { label: 'Other Allowance', value: fmt(item.allowances.other) },
            { label: 'Allowance Total', value: fmt(item.allowances.total) },
            { label: 'Gross Pay', value: fmt(item.grossPay) },
          ],
        },
        {
          title: 'Deductions',
          rows: [
            { label: 'NSSF Health', value: fmt(item.nssfHealth) },
            { label: 'NSSF Pension', value: fmt(item.nssfPension) },
            { label: 'Tax on Salary', value: fmt(item.taxOnSalary) },
            { label: 'Taxable Base', value: fmt(item.taxableBase) },
            { label: 'Advance', value: fmt(item.otherDeductions.advance) },
            { label: 'Absence', value: fmt(item.otherDeductions.absence) },
            { label: 'Other Deductions', value: fmt(item.otherDeductions.other) },
            { label: 'Total Deductions', value: fmt(totalDeductions) },
          ],
        },
        {
          title: 'Net Pay',
          rows: [
            { label: 'Net Pay (USD)', value: fmt(item.netPay) },
            { label: 'Net Pay (KHR)', value: item.netPayKHR.toLocaleString() },
            { label: 'Exchange Rate', value: item.exchangeRate.toLocaleString() },
            { label: 'Minimum Wage Compliant', value: item.minimumWageCompliant ? 'Yes' : 'No' },
          ],
        },
      ],
    });
  };

  const earningsRows: { label: string; amount: number; note?: string; show: boolean }[] = [
    {
      label: 'Base Salary (Prorated)',
      amount: item.proratedBase,
      note: `${item.workedDays}/${item.standardWorkingDays ?? '—'} scheduled days`,
      show: true,
    },
    { label: 'Siniority', amount: item.seniorityIndemnity, note: 'Labor Law Art. 89', show: item.seniorityIndemnity > 0 },
    { label: 'Transport Allowance', amount: item.allowances.transport, note: 'Non-taxable', show: item.allowances.transport > 0 },
    { label: 'Meal Allowance', amount: item.allowances.meal, note: 'Non-taxable', show: item.allowances.meal > 0 },
    { label: 'Housing Allowance', amount: item.allowances.housing, show: item.allowances.housing > 0 },
    { label: 'Overtime (Regular 150%)', amount: item.regularOtPay, note: 'Art. 139', show: item.regularOtPay > 0 },
    { label: 'Overtime (Night 195%)', amount: item.nightOtPay, note: 'Art. 139', show: item.nightOtPay > 0 },
    { label: 'Overtime (Rest day 200%)', amount: item.sundayOtPay, note: 'Art. 140', show: item.sundayOtPay > 0 },
    { label: 'Public Holiday Pay (200%)', amount: item.publicHolidayPay, note: 'Art. 166', show: item.publicHolidayPay > 0 },
  ];

  const deductionRows: { label: string; amount: number; note?: string; show: boolean }[] = [
    {
      label: 'NSSF Pension (employee 2%)',
      amount: item.nssfPension || item.nssfHealth + item.nssfPension,
      note: 'Assumed wage table · max 24,000 KHR/mo',
      show: true,
    },
    { label: 'Tax on Salary', amount: item.taxOnSalary, note: `Taxable base: ${fmt(item.taxableBase)}`, show: true },
    { label: 'Salary Advance', amount: item.otherDeductions.advance, show: item.otherDeductions.advance > 0 },
    {
      label: 'Leave / late deduction',
      amount: item.otherDeductions.absence,
      show: item.otherDeductions.absence > 0,
    },
  ];

  return (
    <div className="space-y-4">
      <div ref={printRef} className="max-w-[680px] mx-auto bg-white text-slate-900 p-8 shadow-2xl rounded-lg">
        <div className="flex justify-between items-start border-b-2 border-slate-800 pb-6 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center text-white">
              <Building2 className="w-7 h-7" />
            </div>
            <div>
              <p className="font-bold text-lg">ROC HR</p>
              <p className="text-xs text-slate-500">123 Corporate Blvd, Phnom Penh</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-3xl font-light uppercase tracking-widest text-slate-400">Payslip</p>
            <p className="text-sm font-semibold mt-1">{period}</p>
            <p className="text-xs text-slate-500 mt-1">Period: {period}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 bg-slate-50 rounded-lg p-4 mb-6">
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-400">Employee</p>
            <p className="font-semibold">{employeeName}</p>
            <p className="text-sm text-slate-600">{position}</p>
            <p className="text-xs text-slate-500 mt-1">ID: {normalizeEmployeeDisplayId(item.employeeId)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase font-bold text-slate-400">Net Payable</p>
            <p className="text-3xl font-bold text-blue-600">${fmt(item.netPay)}</p>
            <p className="text-sm text-slate-600">{item.netPayKHR.toLocaleString()} KHR</p>
            <p className="text-xs text-slate-500 mt-1">Rate: 1 USD = {item.exchangeRate.toLocaleString()} ៛</p>
          </div>
        </div>

        {!item.minimumWageCompliant && (
          <div className="mb-6 flex gap-2 items-start bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <p>⚠️ Base salary below Cambodia minimum wage ($204/month)</p>
          </div>
        )}

        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500 border-b">
              <th className="py-2">Earnings</th>
              <th className="py-2 text-right">Amount</th>
              <th className="py-2 text-right">Note</th>
            </tr>
          </thead>
          <tbody>
            {earningsRows
              .filter((r) => r.show)
              .map((row) => (
                <tr key={row.label} className="border-b border-slate-100">
                  <td className="py-2">{row.label}</td>
                  <td className="py-2 text-right font-mono text-emerald-700">${fmt(row.amount)}</td>
                  <td className="py-2 text-right text-xs text-slate-400">{row.note}</td>
                </tr>
              ))}
            <tr className="bg-emerald-50 font-bold">
              <td className="py-2">Gross Pay</td>
              <td className="py-2 text-right font-mono text-emerald-700">${fmt(item.grossPay)}</td>
              <td />
            </tr>
          </tbody>
        </table>

        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500 border-b">
              <th className="py-2">Deductions</th>
              <th className="py-2 text-right">Amount</th>
              <th className="py-2 text-right">Note</th>
            </tr>
          </thead>
          <tbody>
            {deductionRows
              .filter((r) => r.show)
              .map((row) => (
                <tr key={row.label} className="border-b border-slate-100">
                  <td className="py-2">{row.label}</td>
                  <td className="py-2 text-right font-mono text-red-600">-${fmt(row.amount)}</td>
                  <td className="py-2 text-right text-xs text-slate-400">{row.note}</td>
                </tr>
              ))}
            <tr className="bg-red-50 font-bold">
              <td className="py-2">Total Deductions</td>
              <td className="py-2 text-right font-mono text-red-600">-{fmt(totalDeductions)}</td>
              <td />
            </tr>
          </tbody>
        </table>

        <div className="bg-slate-900 text-white rounded-xl p-5 flex justify-between items-center">
          <div>
            <p className="text-xs text-slate-400">Net Take-Home Pay</p>
            <p className="text-2xl font-bold">${item.netPay.toFixed(2)}</p>
            <p className="text-sm text-slate-400">{item.netPayKHR.toLocaleString()} KHR</p>
          </div>
          <div className="text-right text-xs text-slate-400">
            <p>Gross: {fmt(item.grossPay)}</p>
            <p>Deductions: -{fmt(totalDeductions)}</p>
          </div>
        </div>

        <p className="text-[10px] text-center text-slate-400 mt-6">
          This is a system-generated payslip. Cambodia Labor Law 1997 | NSSF Sub-Decree No. 28 | GDT
          Tax Prakas
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => void handlePDF()}
          isLoading={isLoading}
          icon={<Upload className="w-4 h-4" />}
        >
          Download PDF (HTML)
        </Button>
        <ExportFormatMenu variant="button" onExport={handleExport} formats={['pdf', 'csv', 'xlsx']} />
      </div>
    </div>
  );
};

export default PayslipCard;
