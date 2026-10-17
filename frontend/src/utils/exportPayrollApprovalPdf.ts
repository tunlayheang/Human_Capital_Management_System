import type { PayrollPendingApprovalItem } from '../types';
import { formatRunStatusLabel } from '../pages/payroll/payrollUtils';
import {
  createApprovalPdf,
  loadApprovalPdfContext,
  pdfDisplay,
  pdfDrawCover,
  pdfDrawKeyValueGrid,
  pdfDrawParagraph,
  pdfDrawSectionTitle,
  pdfFinalizeAndSave,
  pdfSafeFilenamePart,
} from './approvalDocumentPdfBase';
import type { ExportFileExt } from './export/exportDocumentStandard';
import { exportKeyValueDocument, type KeyValueSection } from './export/exportDocumentFormats';

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value || 0);
}

export async function exportPayrollApprovalPdf(row: PayrollPendingApprovalItem): Promise<void> {
  const { branding, logo, generatedAt } = await loadApprovalPdfContext();
  const doc = await createApprovalPdf();

  let y = pdfDrawCover(
    doc,
    0,
    'Payroll Run Approval',
    row.monthLabel,
    [formatRunStatusLabel(row.status), `${row.totalEmployees} employees`],
    branding,
    logo
  );

  y = pdfDrawSectionTitle(doc, y, 'Run summary');
  y = pdfDrawKeyValueGrid(doc, y, [
    { label: 'Payroll period', value: row.monthLabel },
    { label: 'Status', value: formatRunStatusLabel(row.status) },
    { label: 'Employees', value: String(row.totalEmployees) },
    { label: 'Net pay', value: formatMoney(row.totalNetPay) },
    { label: 'Prepared by', value: row.calculatedByName ?? row.calculatedBy ?? '—' },
    { label: 'Calculated at', value: pdfDisplay(row.calculatedAt) },
    { label: 'Current approver', value: row.currentApproverName ?? '—' },
    {
      label: 'Approval progress',
      value: row.approvalProgress
        ? `${row.approvalProgress.approved} of ${row.approvalProgress.total} signed`
        : '—',
    },
  ]);

  if (row.assignedApprovers?.length) {
    y = pdfDrawSectionTitle(doc, y, 'Approval chain');
    for (const approver of row.assignedApprovers) {
      y = pdfDrawParagraph(
        doc,
        y,
        approver.name ?? approver.userId,
        `${approver.status === 'approved' ? 'Approved' : approver.phase === 'current' ? 'Current approver' : 'Queued'}${approver.approvedAt ? ` · ${pdfDisplay(approver.approvedAt)}` : ''}`
      );
    }
  }

  const filename = `PayrollApproval_${pdfSafeFilenamePart(row.month)}.pdf`;
  pdfFinalizeAndSave(doc, filename, generatedAt, branding, 'Payroll Approval');
}

function buildPayrollApprovalSections(row: PayrollPendingApprovalItem): KeyValueSection[] {
  const sections: KeyValueSection[] = [
    {
      title: 'Run summary',
      rows: [
        { label: 'Payroll period', value: row.monthLabel },
        { label: 'Status', value: formatRunStatusLabel(row.status) },
        { label: 'Employees', value: String(row.totalEmployees) },
        { label: 'Net pay', value: formatMoney(row.totalNetPay) },
        { label: 'Prepared by', value: row.calculatedByName ?? row.calculatedBy ?? '—' },
        { label: 'Calculated at', value: pdfDisplay(row.calculatedAt) },
        { label: 'Current approver', value: row.currentApproverName ?? '—' },
        {
          label: 'Approval progress',
          value: row.approvalProgress
            ? `${row.approvalProgress.approved} of ${row.approvalProgress.total} signed`
            : '—',
        },
      ],
    },
  ];

  if (row.assignedApprovers?.length) {
    sections.push({
      title: 'Approval chain',
      rows: row.assignedApprovers.map((approver) => ({
        label: approver.name ?? approver.userId,
        value: `${approver.status === 'approved' ? 'Approved' : approver.phase === 'current' ? 'Current approver' : 'Queued'}${approver.approvedAt ? ` · ${pdfDisplay(approver.approvedAt)}` : ''}`,
      })),
    });
  }
  return sections;
}

export async function exportPayrollApprovalDocument(
  format: ExportFileExt,
  row: PayrollPendingApprovalItem
): Promise<void> {
  await exportKeyValueDocument(format, {
    module: 'Payroll_Approval',
    filenameParts: [row.month],
    reportTitle: 'Payroll Run Approval',
    sections: buildPayrollApprovalSections(row),
    exportPdf: () => exportPayrollApprovalPdf(row),
    sheetName: 'Payroll Approval',
  });
}
