import {
  aoaToCsvLines,
  appendReportFooterCsvLines,
  buildTabularMetadataAoa,
  downloadBrandedWorkbookAsXlsx,
  downloadCsvLines,
  exportFilename,
  type ExportFileExt,
  type TabularMetadataField,
} from './exportDocumentStandard';
import type { DocumentBranding } from '../documentBranding';
import { loadDocumentBranding } from '../documentBranding';

export type KeyValueSection = {
  title: string;
  rows: Array<{ label: string; value: string }>;
};

function buildKeyValueAoa(
  reportTitle: string,
  sections: KeyValueSection[],
  metadata: TabularMetadataField[] = [],
  branding?: DocumentBranding
): (string | number)[][] {
  const aoa = buildTabularMetadataAoa(reportTitle, metadata, branding);
  for (const section of sections) {
    aoa.push([section.title]);
    aoa.push(['Field', 'Value']);
    for (const row of section.rows) {
      aoa.push([row.label, row.value]);
    }
    aoa.push([]);
  }
  return aoa;
}

function keyValueStyleRows(
  sections: KeyValueSection[],
  metadataRowCount: number
): { headerRows: number[]; sectionRows: number[] } {
  const headerRows: number[] = [];
  const sectionRows: number[] = [];
  let cursor = metadataRowCount;
  for (const section of sections) {
    sectionRows.push(cursor);
    headerRows.push(cursor + 1);
    cursor += section.rows.length + 3;
  }
  return { headerRows, sectionRows };
}

/** Run PDF / CSV / Excel export for structured key-value documents. */
export async function exportKeyValueDocument(
  format: ExportFileExt,
  options: {
    module: string;
    filenameParts: string[];
    reportTitle: string;
    sections: KeyValueSection[];
    metadata?: TabularMetadataField[];
    exportPdf: () => void | Promise<void>;
    sheetName?: string;
    branding?: DocumentBranding;
  }
): Promise<void> {
  const { module, filenameParts, reportTitle, sections, metadata, exportPdf, sheetName, branding } =
    options;
  // Always refresh so Company Profile document templates apply immediately after edit.
  const resolvedBranding = branding ?? (await loadDocumentBranding(true));

  if (format === 'pdf') {
    await exportPdf();
    return;
  }

  const aoa = buildKeyValueAoa(reportTitle, sections, metadata, resolvedBranding);
  const filename = exportFilename(module, filenameParts, format);

  if (format === 'csv') {
    downloadCsvLines(appendReportFooterCsvLines(aoaToCsvLines(aoa), resolvedBranding), filename);
    return;
  }

  const styles = keyValueStyleRows(
    sections,
    buildTabularMetadataAoa(reportTitle, metadata ?? [], resolvedBranding).length
  );
  await downloadBrandedWorkbookAsXlsx({
    filename,
    reportTitle,
    branding: resolvedBranding,
    fields: [
      { label: 'Document', value: reportTitle },
      ...(metadata ?? []).slice(0, 4).map((f) => ({
        label: f.label,
        value: String(f.value ?? ''),
      })),
      { label: 'Prepared by', value: '' },
    ].slice(0, 6),
    purpose: sections.map((s) => s.title).filter(Boolean).slice(0, 3).join(' · ') || undefined,
    sheets: [
      {
        name: sheetName ?? module,
        aoa,
        headerRows: styles.headerRows,
        sectionRows: styles.sectionRows,
        columnWidths: [24, 52],
      },
    ],
  });
}
