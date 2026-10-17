import {
  aoaToCsvLines,
  buildTabularMetadataAoa,
  downloadBrandedWorkbookAsXlsx,
  downloadCsvLines,
  exportFilename,
  type ExportFileExt,
  type TabularMetadataField,
} from './exportDocumentStandard';
import { downloadTabularPdfFromAoa } from './downloadTabularPdf';
import { loadDocumentBranding } from '../documentBranding';

export type ListExportColumn<Row> = {
  header: string;
  value: (row: Row) => string | number | null | undefined;
  width?: number;
};

export async function exportListTable<Row>(
  format: ExportFileExt,
  options: {
    module: string;
    reportTitle: string;
    sheetName?: string;
    filenameParts?: string[];
    rows: Row[];
    columns: Array<ListExportColumn<Row>>;
    metadata?: TabularMetadataField[];
  }
): Promise<void> {
  const {
    module,
    reportTitle,
    sheetName = 'Export',
    filenameParts = [new Date().toISOString().slice(0, 10)],
    rows,
    columns,
    metadata = [],
  } = options;

  const branding = await loadDocumentBranding(true);
  const headerRow = columns.map((column) => column.header);
  const dataRows = rows.map((row) =>
    columns.map((column) => {
      const value = column.value(row);
      return value == null ? '' : value;
    })
  );
  const meta = buildTabularMetadataAoa(reportTitle, metadata, branding);
  const aoa = [...meta, headerRow, ...dataRows];
  const tableAoa = [headerRow, ...dataRows];
  const filename = exportFilename(module, filenameParts, format);

  if (format === 'pdf') {
    await downloadTabularPdfFromAoa({
      title: reportTitle,
      rows: aoa,
      branding,
      filename,
      module,
      filenameParts,
    });
    return;
  }

  if (format === 'csv') {
    downloadCsvLines(aoaToCsvLines(aoa), filename);
    return;
  }

  await downloadBrandedWorkbookAsXlsx({
    filename,
    reportTitle,
    branding,
    fields: [
      { label: 'Document', value: reportTitle },
      ...metadata.slice(0, 4).map((f) => ({ label: f.label, value: String(f.value ?? '') })),
      { label: 'Prepared by', value: '' },
    ].slice(0, 6),
    sheets: [
      {
        name: sheetName,
        aoa: tableAoa,
        headerRows: [0],
        columnWidths: columns.map((column) => column.width ?? 18),
      },
    ],
  });
}
