import type { ProbationRow } from '../types';
import { probationStatusLabel } from '../components/probation/probationReviewUi';
import { probationRecommendationLabel } from '../components/probation/probationApprovalDisplay';
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
import { normalizeEmployeeDisplayId } from './index';

const RATING_LABELS: Record<string, string> = {
  excellent: 'Excellent',
  good: 'Good',
  satisfactory: 'Satisfactory',
  needs_improvement: 'Needs improvement',
  unsatisfactory: 'Unsatisfactory',
};

function formatRatingBlock(
  title: string,
  ratings: ProbationRow['ratings'] | ProbationRow['managerRatings'] | ProbationRow['employeeRatings']
): string {
  if (!ratings) return '—';
  return [
    `Job performance: ${RATING_LABELS[ratings.jobPerformance] ?? ratings.jobPerformance}`,
    `Attendance: ${RATING_LABELS[ratings.attendance] ?? ratings.attendance}`,
    `Work attitude: ${RATING_LABELS[ratings.workAttitude] ?? ratings.workAttitude}`,
    `Teamwork: ${RATING_LABELS[ratings.teamwork] ?? ratings.teamwork}`,
  ].join('\n');
}

export async function exportProbationReviewPdf(row: ProbationRow): Promise<void> {
  const { branding, logo, generatedAt } = await loadApprovalPdfContext();
  const doc = await createApprovalPdf();
  const employeeIdDisplay = normalizeEmployeeDisplayId(row.employeeId);
  const employeeLabel = employeeIdDisplay || row.name;
  let y = pdfDrawCover(
    doc,
    0,
    'Probation Review',
    row.name,
    [employeeLabel, probationStatusLabel(row.status)],
    branding,
    logo
  );

  y = pdfDrawSectionTitle(doc, y, 'Summary');
  y = pdfDrawKeyValueGrid(doc, y, [
    { label: 'Employee', value: row.name },
    { label: 'Employee ID', value: employeeIdDisplay || '—' },
    { label: 'Department', value: row.departmentName ?? '—' },
    { label: 'Position', value: row.position ?? '—' },
    { label: 'Probation end', value: row.probationEnd ?? '—' },
    { label: 'Status', value: probationStatusLabel(row.status) },
    {
      label: 'Proposed outcome',
      value: probationRecommendationLabel(row.recommendation),
    },
    { label: 'HR assignee', value: row.assignedHrName ?? '—' },
    { label: 'Manager assignee', value: row.assignedManagerName ?? '—' },
  ]);

  y = pdfDrawSectionTitle(doc, y, 'Manager evaluation');
  y = pdfDrawParagraph(doc, y, 'Ratings', formatRatingBlock('Manager', row.managerRatings ?? row.ratings));
  y = pdfDrawParagraph(doc, y, 'Strengths', row.managerStrengths || row.strengths);
  y = pdfDrawParagraph(doc, y, 'Areas for improvement', row.managerAreasForImprovement || row.areasForImprovement);
  y = pdfDrawParagraph(doc, y, 'Overall recommendation', row.managerOverallRecommendation || row.overallRecommendation);

  y = pdfDrawSectionTitle(doc, y, 'Employee self-evaluation');
  y = pdfDrawParagraph(doc, y, 'Ratings', formatRatingBlock('Employee', row.employeeRatings));
  y = pdfDrawParagraph(doc, y, 'Strengths', row.employeeStrengths);
  y = pdfDrawParagraph(doc, y, 'Areas for improvement', row.employeeAreasForImprovement);

  y = pdfDrawSectionTitle(doc, y, 'HR notes');
  y = pdfDrawParagraph(doc, y, 'Notes', row.hrNotes);

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

  const filename = `Probation_${pdfSafeFilenamePart(employeeIdDisplay || row.name)}.pdf`;
  pdfFinalizeAndSave(doc, filename, generatedAt, branding, 'Probation Review');
}

function buildProbationReviewSections(row: ProbationRow): KeyValueSection[] {
  const sections: KeyValueSection[] = [
    {
      title: 'Summary',
      rows: [
        { label: 'Employee', value: row.name },
        { label: 'Employee ID', value: normalizeEmployeeDisplayId(row.employeeId) || '—' },
        { label: 'Department', value: row.departmentName ?? '—' },
        { label: 'Position', value: row.position ?? '—' },
        { label: 'Probation end', value: row.probationEnd ?? '—' },
        { label: 'Status', value: probationStatusLabel(row.status) },
        { label: 'Proposed outcome', value: probationRecommendationLabel(row.recommendation) },
        { label: 'HR assignee', value: row.assignedHrName ?? '—' },
        { label: 'Manager assignee', value: row.assignedManagerName ?? '—' },
      ],
    },
    {
      title: 'Manager evaluation',
      rows: [
        { label: 'Ratings', value: formatRatingBlock('Manager', row.managerRatings ?? row.ratings) },
        { label: 'Strengths', value: row.managerStrengths || row.strengths || '—' },
        {
          label: 'Areas for improvement',
          value: row.managerAreasForImprovement || row.areasForImprovement || '—',
        },
        {
          label: 'Overall recommendation',
          value: row.managerOverallRecommendation || row.overallRecommendation || '—',
        },
      ],
    },
    {
      title: 'Employee self-evaluation',
      rows: [
        { label: 'Ratings', value: formatRatingBlock('Employee', row.employeeRatings) },
        { label: 'Strengths', value: row.employeeStrengths || '—' },
        { label: 'Areas for improvement', value: row.employeeAreasForImprovement || '—' },
      ],
    },
    {
      title: 'HR notes',
      rows: [{ label: 'Notes', value: row.hrNotes || '—' }],
    },
  ];

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

export async function exportProbationReviewDocument(
  format: ExportFileExt,
  row: ProbationRow
): Promise<void> {
  await exportKeyValueDocument(format, {
    module: 'Probation',
    filenameParts: [normalizeEmployeeDisplayId(row.employeeId) || row.name],
    reportTitle: 'Probation Review',
    sections: buildProbationReviewSections(row),
    exportPdf: () => exportProbationReviewPdf(row),
    sheetName: 'Probation',
  });
}
