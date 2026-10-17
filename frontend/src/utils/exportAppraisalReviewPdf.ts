import type { jsPDF } from 'jspdf';
import type { EmployeeAppraisal, ComponentScore } from '../types/appraisal';
import { formatAppraisalScore } from '../types/appraisal';
import type { EmployeeMovementRow } from '../types/employeeMovement';
import {
  buildAppraisalWorkflowTimeline,
  formatAppraisalDocumentDateTime,
  workflowStatusSummaryLabel,
  type WorkflowTimelineStep,
} from '../components/appraisal/appraisalWorkflowTimelineModel';
import { parseEmployeeEvaluationPayload } from '../components/appraisal/appraisalDetailUtils';
import {
  isAppraisalMovementReviewVisible,
  plannedMovementFollowUp,
} from '../components/appraisal/appraisalMovementUtils';
import {
  resolveDualScoreSummary,
  roundComponentWeightedScore,
} from '../components/appraisal/appraisalDualScore';
import { movementTypeLabel, parseMovementChangeParts } from '../components/employee/employeeMovementDisplay';
import { formatCurrency, normalizeEmployeeDisplayId } from './index';
import type { ExportFileExt } from './export/exportDocumentStandard';
import { exportKeyValueDocument, type KeyValueSection } from './export/exportDocumentFormats';
import { ensurePdfUnicodeFont, pdfSetFont } from './export/pdfUnicodeFont';
import {
  BRANDED_PDF_COLOR,
  BRANDED_PDF_BODY_BOTTOM,
  BRANDED_PDF_MARGIN,
  drawBrandedPdfFooter,
  drawBrandedPdfHeader,
  loadBrandedPdfContext,
} from './export/brandedPdfBase';

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = BRANDED_PDF_MARGIN;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BODY_BOTTOM = BRANDED_PDF_BODY_BOTTOM;

const COLOR = BRANDED_PDF_COLOR;

export type AppraisalReviewPdfPayload = {
  appraisal: EmployeeAppraisal;
  componentScores: ComponentScore[];
  linkedMovements?: EmployeeMovementRow[];
};

function display(val: unknown): string {
  if (val == null || val === '') return '—';
  const s = String(val).trim();
  return s || '—';
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^\w.-]+/g, '_').slice(0, 48) || 'Appraisal';
}

function buildPdfFilename(appraisal: EmployeeAppraisal): string {
  const code = safeFilenamePart(
    normalizeEmployeeDisplayId(appraisal.employeeCode) || appraisal.employeeName || 'Employee'
  );
  const period = safeFilenamePart(appraisal.periodName ?? 'Period');
  return `Appraisal_${code}_${period}.pdf`;
}

function drawFooter(
  doc: jsPDF,
  page: number,
  total: number,
  generatedAt: string,
  branding?: Parameters<typeof drawBrandedPdfFooter>[1]['branding']
) {
  drawBrandedPdfFooter(doc, {
    generatedAt,
    branding,
    page,
    totalPages: total,
    margin: MARGIN,
    documentLabel: 'Appraisal Review',
  });
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed <= BODY_BOTTOM) return y;
  doc.addPage();
  return MARGIN + 4;
}

function drawSectionTitle(doc: jsPDF, y: number, title: string): number {
  y = ensureSpace(doc, y, 10);
  doc.setDrawColor(...COLOR.border);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 4;
  pdfSetFont(doc, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...COLOR.primary);
  doc.text(title.toUpperCase(), MARGIN, y);
  return y + 5;
}

function drawParagraph(doc: jsPDF, y: number, label: string, text: string): number {
  const body = display(text);
  if (body === '—') return y;
  pdfSetFont(doc, 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLOR.muted);
  doc.text(label.toUpperCase(), MARGIN, y);
  y += 3.5;
  pdfSetFont(doc, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...COLOR.text);
  const lines = doc.splitTextToSize(body, CONTENT_W);
  y = ensureSpace(doc, y, lines.length * 4 + 2);
  doc.text(lines, MARGIN, y);
  return y + lines.length * 4 + 3;
}

function drawTimelineStep(doc: jsPDF, y: number, step: WorkflowTimelineStep, indent = 0): number {
  const x = MARGIN + indent;
  const w = CONTENT_W - indent;
  y = ensureSpace(doc, y, 8);
  pdfSetFont(doc, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLOR.text);
  doc.text(step.title, x, y);
  pdfSetFont(doc, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLOR.muted);
  doc.text(
    step.status === 'complete'
      ? 'Complete'
      : step.status === 'current'
        ? 'In progress'
        : step.status === 'rejected'
          ? 'Rejected'
          : step.status === 'skipped'
            ? 'Not started'
            : 'Pending',
    PAGE_W - MARGIN,
    y,
    { align: 'right' }
  );
  y += 3.5;
  if (step.completedAt) {
    doc.setFontSize(7);
    doc.text(formatAppraisalDocumentDateTime(step.completedAt), x, y);
    y += 3.5;
  }
  if (step.detail) {
    pdfSetFont(doc, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLOR.text);
    const lines = doc.splitTextToSize(step.detail, w);
    y = ensureSpace(doc, y, lines.length * 3.5 + 1);
    doc.text(lines, x, y);
    y += lines.length * 3.5 + 1.5;
  }
  if (step.subSteps?.length) {
    for (const sub of step.subSteps) {
      y = ensureSpace(doc, y, 6);
      pdfSetFont(doc, 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...COLOR.text);
      doc.text(`• ${sub.label}`, x + 2, y);
      y += 3;
      if (sub.detail) {
        pdfSetFont(doc, 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...COLOR.muted);
        const subLines = doc.splitTextToSize(sub.detail, w - 4);
        doc.text(subLines, x + 4, y);
        y += subLines.length * 3.2 + 1;
      }
      if (sub.completedAt) {
        doc.setFontSize(7);
        doc.text(formatAppraisalDocumentDateTime(sub.completedAt), x + 4, y);
        y += 3.5;
      }
    }
  }
  return y + 2;
}

function drawKpiTable(doc: jsPDF, y: number, scores: ComponentScore[], managerSubmitted: boolean, employeeSubmitted: boolean): number {
  const cols = ['Component', 'Mgmt', 'Emp', 'Avg', 'Wt%', 'Weighted'];
  const colW = [58, 16, 16, 16, 14, 18];
  y = ensureSpace(doc, y, 12);
  doc.setFillColor(...COLOR.panel);
  doc.rect(MARGIN, y - 3, CONTENT_W, 5.5, 'F');
  pdfSetFont(doc, 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...COLOR.muted);
  let x = MARGIN;
  cols.forEach((label, i) => {
    doc.text(label, x + (i === 0 ? 0 : colW[i] - 1), y, { align: i === 0 ? 'left' : 'right' });
    x += colW[i];
  });
  y += 4;

  let totalWeighted = 0;
  pdfSetFont(doc, 'normal');
  doc.setFontSize(8);
  for (const s of scores) {
    y = ensureSpace(doc, y, 5);
    const dual = resolveDualScoreSummary(s, managerSubmitted);
    const weighted = roundComponentWeightedScore(dual.averageScore, s.weightPercent);
    totalWeighted += weighted;
    const row = [
      s.componentName,
      dual.managementAverage != null ? formatAppraisalScore(dual.managementAverage) : '—',
      dual.employeeScore != null ? formatAppraisalScore(dual.employeeScore) : '—',
      formatAppraisalScore(dual.averageScore),
      `${s.weightPercent}%`,
      formatAppraisalScore(weighted, 2),
    ];
    x = MARGIN;
    row.forEach((cell, i) => {
      const text =
        i === 0 ? doc.splitTextToSize(String(cell), colW[0] - 1)[0] : String(cell);
      doc.setTextColor(...(i === 0 ? COLOR.text : COLOR.muted));
      doc.text(text, x + (i === 0 ? 0 : colW[i] - 1), y, { align: i === 0 ? 'left' : 'right' });
      x += colW[i];
    });
    y += 4.2;
  }

  y = ensureSpace(doc, y, 6);
  doc.setDrawColor(...COLOR.border);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 4;
  pdfSetFont(doc, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COLOR.text);
  doc.text('Overall weighted score', MARGIN, y);
  doc.setTextColor(...COLOR.accent);
  doc.text(formatAppraisalScore(Math.round(totalWeighted * 100) / 100), PAGE_W - MARGIN, y, {
    align: 'right',
  });
  return y + 6;
}

function drawMovementBlock(doc: jsPDF, y: number, row: EmployeeMovementRow): number {
  y = ensureSpace(doc, y, 14);
  doc.setFillColor(...COLOR.panel);
  doc.roundedRect(MARGIN, y, CONTENT_W, 8, 1, 1, 'F');
  pdfSetFont(doc, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLOR.text);
  doc.text(movementTypeLabel(row.movementType), MARGIN + 2, y + 5);
  pdfSetFont(doc, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLOR.muted);
  doc.text(`Effective ${display(row.effectiveDate)}`, PAGE_W - MARGIN - 2, y + 5, { align: 'right' });
  y += 10;

  const parts = parseMovementChangeParts(row);
  if (parts.hasPlacementChange && parts.placementFrom && parts.placementTo) {
    y = ensureSpace(doc, y, 5);
    pdfSetFont(doc, 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLOR.muted);
    doc.text('ROLE', MARGIN, y);
    y += 3.5;
    pdfSetFont(doc, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLOR.text);
    const line = `${parts.placementFrom}  →  ${parts.placementTo}`;
    const lines = doc.splitTextToSize(line, CONTENT_W);
    doc.text(lines, MARGIN, y);
    y += lines.length * 3.8 + 2;
  }
  if (parts.hasSalaryChange) {
    y = ensureSpace(doc, y, 5);
    pdfSetFont(doc, 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLOR.muted);
    doc.text('PAY', MARGIN, y);
    y += 3.5;
    pdfSetFont(doc, 'normal');
    doc.setFontSize(8);
    doc.text(
      `${formatCurrency(parts.salaryFrom ?? 0, parts.salaryCurrency)}  →  ${formatCurrency(parts.salaryTo ?? 0, parts.salaryCurrency)}`,
      MARGIN,
      y
    );
    y += 5;
  }
  if (row.notes?.trim()) {
    y = drawParagraph(doc, y, 'Notes', row.notes);
  }
  return y + 2;
}

/**
 * Export a clean multi-section appraisal review PDF (workflow, scores, movement).
 */
export async function exportAppraisalReviewPdf(payload: AppraisalReviewPdfPayload): Promise<void> {
  const { branding, logo, generatedAt } = await loadBrandedPdfContext(true);
  const { default: JsPDF } = await import('jspdf');
  const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  await ensurePdfUnicodeFont(doc);
  const { appraisal, componentScores, linkedMovements = [] } = payload;

  let y = drawBrandedPdfHeader(doc, {
    title: 'Performance Appraisal',
    subtitle: display(appraisal.employeeName),
    metaLines: [
      appraisal.employeeCode ? `ID ${normalizeEmployeeDisplayId(appraisal.employeeCode)}` : '',
      appraisal.periodName ? `Period ${appraisal.periodName}` : '',
      workflowStatusSummaryLabel(appraisal.workflow_status),
    ].filter(Boolean),
    branding,
    logo,
    margin: MARGIN,
  });

  if (appraisal.assignedManagerName) {
    pdfSetFont(doc, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLOR.text);
    doc.text(`Evaluating manager: ${appraisal.assignedManagerName}`, MARGIN, y);
    y += 6;
  }

  y = drawSectionTitle(doc, y, 'Workflow history');
  const timeline = buildAppraisalWorkflowTimeline(appraisal, linkedMovements);
  for (const step of timeline) {
    y = drawTimelineStep(doc, y, step);
  }

  y = drawSectionTitle(doc, y, 'Overall outcome');
  y = ensureSpace(doc, y, 14);
  pdfSetFont(doc, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...COLOR.text);
  const outcomeLines = [
    `Weighted score: ${appraisal.weighted_score != null ? formatAppraisalScore(appraisal.weighted_score) : '—'}`,
    `Grade: ${display(appraisal.final_grade)}`,
    `Recommendation: ${display(appraisal.recommendation)}`,
  ];
  outcomeLines.forEach((line) => {
    doc.text(line, MARGIN, y);
    y += 4.5;
  });
  y += 2;

  if (componentScores.length) {
    y = drawSectionTitle(doc, y, 'KPI component scores');
    const managerSubmitted = Boolean(appraisal.manager_submitted_at);
    const employeeSubmitted = Boolean(appraisal.self_review_at);
    y = drawKpiTable(doc, y, componentScores, managerSubmitted, employeeSubmitted);
  }

  if (appraisal.strengths || appraisal.weaknesses || appraisal.manager_recommendations) {
    y = drawSectionTitle(doc, y, 'Manager evaluation');
    y = drawParagraph(doc, y, 'Strengths', appraisal.strengths ?? '');
    y = drawParagraph(doc, y, 'Areas for improvement', appraisal.weaknesses ?? '');
    y = drawParagraph(doc, y, 'Recommendations', appraisal.manager_recommendations ?? '');
  }

  if (appraisal.self_review_at) {
    y = drawSectionTitle(doc, y, 'Employee self-evaluation');
    const employeeEval = parseEmployeeEvaluationPayload(appraisal.outcome_payload_json);
    y = drawParagraph(doc, y, 'Strengths', (employeeEval?.strengths as string) ?? '');
    y = drawParagraph(doc, y, 'Areas for improvement', (employeeEval?.weaknesses as string) ?? '');
    y = drawParagraph(doc, y, 'Additional notes', appraisal.self_review_notes ?? '');
  }

  y = drawSectionTitle(doc, y, 'Employee movement follow-up');
  if (linkedMovements.length) {
    for (const movement of linkedMovements) {
      y = drawMovementBlock(doc, y, movement);
    }
  } else if (isAppraisalMovementReviewVisible(appraisal.workflow_status)) {
    const planned = plannedMovementFollowUp(appraisal);
    y = ensureSpace(doc, y, 8);
    pdfSetFont(doc, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLOR.text);
    doc.text(
      String(appraisal.workflow_status ?? '') === 'PENDING_FINAL_APPROVAL'
        ? 'Planned follow-up — for your review'
        : 'Planned follow-up',
      MARGIN,
      y
    );
    y += 4;
    pdfSetFont(doc, 'normal');
    doc.setFontSize(8);
    for (const line of planned.detailLines) {
      const lines = doc.splitTextToSize(`• ${line}`, CONTENT_W);
      y = ensureSpace(doc, y, lines.length * 3.8 + 1);
      doc.text(lines, MARGIN, y);
      y += lines.length * 3.8 + 1;
    }
    y += 2;
  } else {
    y = ensureSpace(doc, y, 6);
    pdfSetFont(doc, 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLOR.muted);
    doc.text('Employee movement follow-up opens at final approval.', MARGIN, y);
    y += 6;
  }

  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p += 1) {
    doc.setPage(p);
    drawFooter(doc, p, pageCount, generatedAt, branding);
  }

  doc.save(buildPdfFilename(appraisal));
}

function buildAppraisalReviewSections(payload: AppraisalReviewPdfPayload): KeyValueSection[] {
  const { appraisal, componentScores } = payload;
  const sections: KeyValueSection[] = [
    {
      title: 'Summary',
      rows: [
        { label: 'Employee', value: display(appraisal.employeeName) },
        { label: 'Employee ID', value: display(normalizeEmployeeDisplayId(appraisal.employeeCode)) },
        { label: 'Period', value: display(appraisal.periodName) },
        { label: 'Status', value: workflowStatusSummaryLabel(appraisal.workflow_status) },
        { label: 'Manager', value: display(appraisal.assignedManagerName) },
        {
          label: 'Weighted score',
          value:
            appraisal.weighted_score != null ? formatAppraisalScore(appraisal.weighted_score) : '—',
        },
        { label: 'Grade', value: display(appraisal.final_grade) },
        { label: 'Recommendation', value: display(appraisal.recommendation) },
      ],
    },
  ];

  if (componentScores.length) {
    sections.push({
      title: 'KPI component scores',
      rows: componentScores.map((score) => ({
        label: display(score.componentName),
        value: [
          score.manager_raw_score != null ? `Manager ${formatAppraisalScore(score.manager_raw_score)}` : null,
          score.employee_raw_score != null ? `Employee ${formatAppraisalScore(score.employee_raw_score)}` : null,
          score.weightPercent != null ? `Weight ${score.weightPercent}%` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      })),
    });
  }

  if (appraisal.strengths || appraisal.weaknesses || appraisal.manager_recommendations) {
    sections.push({
      title: 'Manager evaluation',
      rows: [
        { label: 'Strengths', value: appraisal.strengths ?? '—' },
        { label: 'Areas for improvement', value: appraisal.weaknesses ?? '—' },
        { label: 'Recommendations', value: appraisal.manager_recommendations ?? '—' },
      ],
    });
  }

  return sections;
}

export async function exportAppraisalReviewDocument(
  format: ExportFileExt,
  payload: AppraisalReviewPdfPayload
): Promise<void> {
  const { appraisal } = payload;
  await exportKeyValueDocument(format, {
    module: 'Appraisal',
    filenameParts: [
      normalizeEmployeeDisplayId(appraisal.employeeCode) || appraisal.employeeName || 'Employee',
      appraisal.periodName ?? 'Period',
    ],
    reportTitle: 'Performance Appraisal',
    sections: buildAppraisalReviewSections(payload),
    exportPdf: () => exportAppraisalReviewPdf(payload),
    sheetName: 'Appraisal',
  });
}
