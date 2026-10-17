import type { OvertimeRequest, User } from '../types';
import type { Language } from '../i18n/types';
import { formatOvertimeRequestedAt, overtimeRateLabel } from './overtimeLabels';
import { userDisplayName } from './userProfile';
import {
  createApprovalPdf,
  loadApprovalPdfContext,
  pdfDrawCover,
  pdfDrawKeyValueGrid,
  pdfDrawParagraph,
  pdfDrawSectionTitle,
  pdfFinalizeAndSave,
  pdfSafeFilenamePart,
} from './approvalDocumentPdfBase';
import type { ExportFileExt } from './export/exportDocumentStandard';
import { exportKeyValueDocument, type KeyValueSection } from './export/exportDocumentFormats';
import { formatDateOnlyDisplay } from './formatDisplayDate';
import { normalizeEmployeeDisplayId } from './index';

export async function exportOvertimeRequestPdf(
  request: OvertimeRequest,
  usersMap: Record<string, User> = {},
  language: Language = 'en',
  employeeMeta?: { name?: string; employeeId?: string }
): Promise<void> {
  const { branding, logo, generatedAt } = await loadApprovalPdfContext();
  const doc = await createApprovalPdf();
  const approver =
    request.approvedBy && usersMap[request.approvedBy]
      ? userDisplayName(usersMap[request.approvedBy], language)
      : request.approvedBy ?? '—';
  const employeeName = employeeMeta?.name?.trim() || '—';
  const employeeId = normalizeEmployeeDisplayId(employeeMeta?.employeeId) || '—';
  const workDateLabel = formatDateOnlyDisplay(request.workDate);

  let y = pdfDrawCover(
    doc,
    0,
    'Overtime Request',
    employeeName !== '—' ? employeeName : request.otTypeName ?? 'Overtime',
    [employeeId !== '—' ? employeeId : workDateLabel, workDateLabel, request.status],
    branding,
    logo
  );

  y = pdfDrawSectionTitle(doc, y, 'Employee');
  y = pdfDrawKeyValueGrid(doc, y, [
    { label: 'Name', value: employeeName },
    { label: 'Employee ID', value: employeeId },
  ]);

  y = pdfDrawSectionTitle(doc, y, 'Request details');
  y = pdfDrawKeyValueGrid(doc, y, [
    { label: 'Work date', value: workDateLabel },
    { label: 'Type', value: request.otTypeName ?? '—' },
    { label: 'Hours', value: `${request.hours}h` },
    { label: 'Rate', value: overtimeRateLabel(request.rateTier) },
    { label: 'Status', value: request.status },
    { label: 'Submitted', value: formatOvertimeRequestedAt(request) },
    { label: 'Start time', value: request.startTime ?? '—' },
    { label: 'End time', value: request.endTime ?? '—' },
  ]);

  y = pdfDrawParagraph(doc, y, 'Reason', request.reason ?? '');

  if (request.status === 'APPROVED') {
    y = pdfDrawParagraph(
      doc,
      y,
      'Approved by',
      [approver, request.approvedAt ? formatOvertimeRequestedAt({ createdAt: request.approvedAt }) : null]
        .filter(Boolean)
        .join(' · ')
    );
  }
  if (request.status === 'REJECTED' && request.rejectionReason) {
    y = pdfDrawParagraph(doc, y, 'Rejection reason', request.rejectionReason);
  }

  const filename = `Overtime_${pdfSafeFilenamePart(request.workDate)}_${pdfSafeFilenamePart(request.otTypeName ?? 'OT')}.pdf`;
  pdfFinalizeAndSave(doc, filename, generatedAt, branding, 'Overtime Request');
}

function buildOvertimeRequestSections(
  request: OvertimeRequest,
  usersMap: Record<string, User> = {},
  language: Language = 'en',
  employeeMeta?: { name?: string; employeeId?: string }
): KeyValueSection[] {
  const approver =
    request.approvedBy && usersMap[request.approvedBy]
      ? userDisplayName(usersMap[request.approvedBy], language)
      : request.approvedBy ?? '—';
  const employeeName = employeeMeta?.name?.trim() || '—';
  const employeeId = normalizeEmployeeDisplayId(employeeMeta?.employeeId) || '—';

  const sections: KeyValueSection[] = [
    {
      title: 'Employee',
      rows: [
        { label: 'Name', value: employeeName },
        { label: 'Employee ID', value: employeeId },
      ],
    },
    {
      title: 'Request details',
      rows: [
        { label: 'Work date', value: formatDateOnlyDisplay(request.workDate) },
        { label: 'Type', value: request.otTypeName ?? '—' },
        { label: 'Hours', value: `${request.hours}h` },
        { label: 'Rate', value: overtimeRateLabel(request.rateTier) },
        { label: 'Status', value: request.status },
        { label: 'Submitted', value: formatOvertimeRequestedAt(request) },
        { label: 'Start time', value: request.startTime ?? '—' },
        { label: 'End time', value: request.endTime ?? '—' },
        { label: 'Reason', value: request.reason ?? '—' },
      ],
    },
  ];

  if (request.status === 'APPROVED') {
    sections.push({
      title: 'Approval',
      rows: [
        {
          label: 'Approved by',
          value: [approver, request.approvedAt ? formatOvertimeRequestedAt({ createdAt: request.approvedAt }) : null]
            .filter(Boolean)
            .join(' · '),
        },
      ],
    });
  }
  if (request.status === 'REJECTED' && request.rejectionReason) {
    sections.push({
      title: 'Rejection',
      rows: [{ label: 'Rejection reason', value: request.rejectionReason }],
    });
  }
  return sections;
}

export async function exportOvertimeRequestDocument(
  format: ExportFileExt,
  request: OvertimeRequest,
  usersMap: Record<string, User> = {},
  language: Language = 'en',
  employeeMeta?: { name?: string; employeeId?: string }
): Promise<void> {
  await exportKeyValueDocument(format, {
    module: 'Overtime',
    filenameParts: [request.workDate, request.otTypeName ?? 'OT'],
    reportTitle: 'Overtime Request',
    sections: buildOvertimeRequestSections(request, usersMap, language, employeeMeta),
    exportPdf: () => exportOvertimeRequestPdf(request, usersMap, language, employeeMeta),
    sheetName: 'Overtime',
  });
}
