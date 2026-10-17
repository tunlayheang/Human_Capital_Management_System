import type { EmployeeMovementRow } from '../types/employeeMovement';
import {
  movementTypeLabel,
  parseMovementChangeParts,
  formatMovementDate,
  formatMovementDateTime,
} from '../components/employee/employeeMovementDisplay';
import { formatCurrency, normalizeEmployeeDisplayId } from './index';
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

export async function exportMovementReviewPdf(row: EmployeeMovementRow): Promise<void> {
  const { branding, logo, generatedAt } = await loadApprovalPdfContext();
  const doc = await createApprovalPdf();
  const changes = parseMovementChangeParts(row);

  let y = pdfDrawCover(
    doc,
    0,
    'Employee Movement',
    row.employeeName,
    [movementTypeLabel(row.movementType), formatMovementDate(row.effectiveDate)],
    branding,
    logo
  );

  y = pdfDrawSectionTitle(doc, y, 'Employee');
  y = pdfDrawKeyValueGrid(doc, y, [
    { label: 'Name', value: row.employeeName },
    { label: 'Employee ID', value: normalizeEmployeeDisplayId(row.employeeId) },
    { label: 'Email', value: row.employeeEmail ?? '—' },
    { label: 'Movement type', value: movementTypeLabel(row.movementType) },
    { label: 'Effective date', value: formatMovementDate(row.effectiveDate) },
    { label: 'Status', value: row.status },
    { label: 'Submitted by', value: row.createdByName ?? '—' },
    { label: 'Submitted at', value: row.createdAt ? formatMovementDateTime(row.createdAt) : '—' },
  ]);

  y = pdfDrawSectionTitle(doc, y, 'Change details');
  if (changes.hasPlacementChange) {
    y = pdfDrawKeyValueGrid(doc, y, [
      { label: 'From', value: changes.placementFrom ?? '—' },
      { label: 'To', value: changes.placementTo ?? '—' },
      { label: 'Department from', value: row.fromDepartmentName || '—' },
      { label: 'Department to', value: row.toDepartmentName || '—' },
      { label: 'Position from', value: row.fromPositionTitle || '—' },
      { label: 'Position to', value: row.toPositionTitle || '—' },
    ]);
  }
  if (changes.hasSalaryChange) {
    y = pdfDrawKeyValueGrid(doc, y, [
      {
        label: 'Salary from',
        value:
          changes.salaryFrom != null
            ? formatCurrency(changes.salaryFrom, changes.salaryCurrency ?? 'USD')
            : '—',
      },
      {
        label: 'Salary to',
        value:
          changes.salaryTo != null
            ? formatCurrency(changes.salaryTo, changes.salaryCurrency ?? 'USD')
            : '—',
      },
    ]);
  }

  y = pdfDrawParagraph(doc, y, 'Remark', row.remark ?? '');

  if (row.assignedApprovers?.length) {
    y = pdfDrawSectionTitle(doc, y, 'Approval chain');
    for (const approver of row.assignedApprovers) {
      y = pdfDrawParagraph(
        doc,
        y,
        approver.name ?? approver.userId,
        `${approver.status === 'approved' ? 'Approved' : 'Pending'}${approver.approvedAt ? ` · ${pdfDisplay(approver.approvedAt)}` : ''}`
      );
    }
  }

  const filename = `Movement_${pdfSafeFilenamePart(normalizeEmployeeDisplayId(row.employeeId))}_${pdfSafeFilenamePart(row.movementType)}.pdf`;
  pdfFinalizeAndSave(doc, filename, generatedAt, branding, 'Movement Review');
}

function buildMovementReviewSections(row: EmployeeMovementRow): KeyValueSection[] {
  const changes = parseMovementChangeParts(row);
  const sections: KeyValueSection[] = [
    {
      title: 'Employee',
      rows: [
        { label: 'Name', value: row.employeeName },
        { label: 'Employee ID', value: normalizeEmployeeDisplayId(row.employeeId) },
        { label: 'Email', value: row.employeeEmail ?? '—' },
        { label: 'Movement type', value: movementTypeLabel(row.movementType) },
        { label: 'Effective date', value: formatMovementDate(row.effectiveDate) },
        { label: 'Status', value: row.status },
        { label: 'Submitted by', value: row.createdByName ?? '—' },
        { label: 'Submitted at', value: row.createdAt ? formatMovementDateTime(row.createdAt) : '—' },
        { label: 'Remark', value: row.remark ?? '—' },
      ],
    },
  ];

  if (changes.hasPlacementChange) {
    sections.push({
      title: 'Placement change',
      rows: [
        { label: 'From', value: changes.placementFrom ?? '—' },
        { label: 'To', value: changes.placementTo ?? '—' },
        { label: 'Department from', value: row.fromDepartmentName || '—' },
        { label: 'Department to', value: row.toDepartmentName || '—' },
        { label: 'Position from', value: row.fromPositionTitle || '—' },
        { label: 'Position to', value: row.toPositionTitle || '—' },
      ],
    });
  }
  if (changes.hasSalaryChange) {
    sections.push({
      title: 'Salary change',
      rows: [
        {
          label: 'Salary from',
          value:
            changes.salaryFrom != null
              ? formatCurrency(changes.salaryFrom, changes.salaryCurrency ?? 'USD')
              : '—',
        },
        {
          label: 'Salary to',
          value:
            changes.salaryTo != null
              ? formatCurrency(changes.salaryTo, changes.salaryCurrency ?? 'USD')
              : '—',
        },
      ],
    });
  }
  if (row.assignedApprovers?.length) {
    sections.push({
      title: 'Approval chain',
      rows: row.assignedApprovers.map((approver) => ({
        label: approver.name ?? approver.userId,
        value: `${approver.status === 'approved' ? 'Approved' : 'Pending'}${approver.approvedAt ? ` · ${pdfDisplay(approver.approvedAt)}` : ''}`,
      })),
    });
  }
  return sections;
}

export async function exportMovementReviewDocument(
  format: ExportFileExt,
  row: EmployeeMovementRow
): Promise<void> {
  await exportKeyValueDocument(format, {
    module: 'Movement',
    filenameParts: [normalizeEmployeeDisplayId(row.employeeId), row.movementType],
    reportTitle: 'Employee Movement',
    sections: buildMovementReviewSections(row),
    exportPdf: () => exportMovementReviewPdf(row),
    sheetName: 'Movement',
  });
}
