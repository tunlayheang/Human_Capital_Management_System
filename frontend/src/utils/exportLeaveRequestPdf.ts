import type { LeaveRequest } from '../types';
import { calculateLeaveDays, formatLeaveDateRange, formatLeaveDurationLabel } from './leaveDays';
import { formatLeaveRequestedAt, formatLeaveStatusLabel, leaveApproverTrackingLines, type LeaveApproverUserLike } from './leaveWorkflow';
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
import { normalizeEmployeeDisplayId } from './index';

export async function exportLeaveRequestPdf(
  leave: LeaveRequest,
  usersMap: Record<string, LeaveApproverUserLike | undefined> = {},
  employeeMeta?: { name?: string; employeeId?: string; department?: string }
): Promise<void> {
  const { branding, logo, generatedAt } = await loadApprovalPdfContext();
  const doc = await createApprovalPdf();
  const dayCount = calculateLeaveDays(leave);
  const approverLines = leaveApproverTrackingLines(leave, usersMap);
  const employeeName = employeeMeta?.name?.trim() || '—';
  const employeeId = normalizeEmployeeDisplayId(employeeMeta?.employeeId) || '—';

  let y = pdfDrawCover(
    doc,
    0,
    'Leave Request',
    employeeName !== '—' ? employeeName : leave.type,
    [
      employeeId !== '—' ? employeeId : formatLeaveDateRange(leave),
      formatLeaveDateRange(leave),
      formatLeaveStatusLabel(leave.status),
    ],
    branding,
    logo
  );

  y = pdfDrawSectionTitle(doc, y, 'Employee');
  y = pdfDrawKeyValueGrid(doc, y, [
    { label: 'Name', value: employeeName },
    { label: 'Employee ID', value: employeeId },
    { label: 'Department', value: employeeMeta?.department?.trim() || '—' },
  ]);

  y = pdfDrawSectionTitle(doc, y, 'Request details');
  y = pdfDrawKeyValueGrid(doc, y, [
    { label: 'Leave type', value: leave.type },
    { label: 'Status', value: formatLeaveStatusLabel(leave.status) },
    { label: 'Dates', value: formatLeaveDateRange(leave) },
    {
      label: 'Duration',
      value: formatLeaveDurationLabel(dayCount, { day: 'day', days: 'days', halfDay: '½ day' }),
    },
    { label: 'Requested at', value: formatLeaveRequestedAt(leave) },
  ]);

  y = pdfDrawParagraph(doc, y, 'Reason', leave.reason ?? '');

  if (approverLines.length) {
    y = pdfDrawSectionTitle(doc, y, 'Approval');
    for (const line of approverLines) {
      y = pdfDrawParagraph(doc, y, line.label, line.name);
    }
  }

  if (leave.rejectionReason) {
    y = pdfDrawParagraph(doc, y, 'Decline reason', leave.rejectionReason);
  }

  const filename = `Leave_${pdfSafeFilenamePart(leave.type)}_${pdfSafeFilenamePart(leave.startDate)}.pdf`;
  pdfFinalizeAndSave(doc, filename, generatedAt, branding, 'Leave Request');
}

function buildLeaveRequestSections(
  leave: LeaveRequest,
  usersMap: Record<string, LeaveApproverUserLike | undefined>,
  employeeMeta?: { name?: string; employeeId?: string; department?: string }
): KeyValueSection[] {
  const dayCount = calculateLeaveDays(leave);
  const approverLines = leaveApproverTrackingLines(leave, usersMap);
  const employeeName = employeeMeta?.name?.trim() || '—';
  const employeeId = normalizeEmployeeDisplayId(employeeMeta?.employeeId) || '—';

  const sections: KeyValueSection[] = [
    {
      title: 'Employee',
      rows: [
        { label: 'Name', value: employeeName },
        { label: 'Employee ID', value: employeeId },
        { label: 'Department', value: employeeMeta?.department?.trim() || '—' },
      ],
    },
    {
      title: 'Request details',
      rows: [
        { label: 'Leave type', value: leave.type },
        { label: 'Status', value: formatLeaveStatusLabel(leave.status) },
        { label: 'Dates', value: formatLeaveDateRange(leave) },
        {
          label: 'Duration',
          value: formatLeaveDurationLabel(dayCount, { day: 'day', days: 'days', halfDay: '½ day' }),
        },
        { label: 'Requested at', value: formatLeaveRequestedAt(leave) },
        { label: 'Reason', value: leave.reason ?? '—' },
      ],
    },
  ];

  if (approverLines.length) {
    sections.push({
      title: 'Approval',
      rows: approverLines.map((line) => ({ label: line.label, value: line.name })),
    });
  }
  if (leave.rejectionReason) {
    sections.push({
      title: 'Decline',
      rows: [{ label: 'Decline reason', value: leave.rejectionReason }],
    });
  }
  return sections;
}

export async function exportLeaveRequestDocument(
  format: ExportFileExt,
  leave: LeaveRequest,
  usersMap: Record<string, LeaveApproverUserLike | undefined> = {},
  employeeMeta?: { name?: string; employeeId?: string; department?: string }
): Promise<void> {
  await exportKeyValueDocument(format, {
    module: 'Leave',
    filenameParts: [leave.type, leave.startDate],
    reportTitle: 'Leave Request',
    sections: buildLeaveRequestSections(leave, usersMap, employeeMeta),
    exportPdf: () => exportLeaveRequestPdf(leave, usersMap, employeeMeta),
    sheetName: 'Leave',
  });
}
