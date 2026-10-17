import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/** Standard thermal / POS receipt roll width (mm). */
export const RECEIPT_PAPER_WIDTH_MM = 80;

/** CSS px width used when cloning HTML for receipt capture (~80mm at screen density). */
export const RECEIPT_CLONE_WIDTH_PX = 320;

export type PdfPaperFormat = 'a4' | 'receipt';

export type HtmlElementToPdfOptions = {
  filename: string;
  /** Target paper. Payslips use `receipt` (80mm continuous). Default `a4`. */
  paper?: PdfPaperFormat;
  /** html2canvas scale (default 2). */
  scale?: number;
  /** Margin around the captured content (mm). Receipt defaults to 3; A4 to 0. */
  marginMm?: number;
  /**
   * Off-screen clone width in CSS pixels.
   * Receipt defaults to {@link RECEIPT_CLONE_WIDTH_PX} so layouts stack for narrow paper.
   */
  cloneWidthPx?: number;
};

export type HtmlElementToA4PdfOptions = Omit<HtmlElementToPdfOptions, 'paper'>;

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function prepareReceiptClone(clone: HTMLElement): void {
  clone.style.borderRadius = '0';
  clone.style.boxShadow = 'none';
  // Flatten card chrome so the strip reads like a printed slip.
  clone.querySelectorAll<HTMLElement>('[class*="rounded"], [class*="shadow"], [class*="ring-"]').forEach(
    (node) => {
      node.style.borderRadius = '0';
      node.style.boxShadow = 'none';
    }
  );
}

/**
 * Snapshot an HTML element to a PDF.
 *
 * Clones off-DOM so modal `max-height` / `overflow` cannot truncate html2canvas.
 * - `receipt`: 80mm-wide continuous page sized to content height (thermal/receipt roll).
 * - `a4`: standard A4 with multi-page slicing when content is taller than one page.
 */
export async function downloadHtmlElementAsPdf(
  source: HTMLElement,
  options: HtmlElementToPdfOptions
): Promise<void> {
  const paper: PdfPaperFormat = options.paper ?? 'a4';
  const isReceipt = paper === 'receipt';
  const scale = options.scale ?? 2;
  const marginMm = Math.max(
    0,
    options.marginMm ?? (isReceipt ? 3 : 0)
  );
  const widthPx =
    options.cloneWidthPx ??
    (isReceipt
      ? RECEIPT_CLONE_WIDTH_PX
      : Math.max(source.scrollWidth, source.offsetWidth, source.clientWidth, 720));

  const host = document.createElement('div');
  host.setAttribute('data-html-pdf-export-host', 'true');
  host.style.cssText = [
    'position:fixed',
    'left:-10000px',
    'top:0',
    `width:${widthPx}px`,
    'overflow:visible',
    'height:auto',
    'max-height:none',
    'pointer-events:none',
    'z-index:2147483646',
    'background:#ffffff',
  ].join(';');

  const clone = source.cloneNode(true) as HTMLElement;
  clone.style.cssText = [
    `width:${widthPx}px`,
    'max-width:none',
    'height:auto',
    'max-height:none',
    'overflow:visible',
    'position:static',
    'transform:none',
    'box-sizing:border-box',
  ].join(';');

  if (isReceipt) prepareReceiptClone(clone);

  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    await waitForNextPaint();

    const captureHeight = Math.max(clone.scrollHeight, clone.offsetHeight, 1);
    const captureWidth = Math.max(clone.scrollWidth, widthPx, 1);

    const canvas = await html2canvas(clone, {
      scale,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      width: captureWidth,
      height: captureHeight,
      windowWidth: captureWidth,
      windowHeight: captureHeight,
      scrollX: 0,
      scrollY: 0,
    });

    if (isReceipt) {
      await saveReceiptPdf(canvas, options.filename, marginMm);
      return;
    }

    await saveA4Pdf(canvas, options.filename, marginMm);
  } finally {
    host.remove();
  }
}

/** @deprecated Prefer {@link downloadHtmlElementAsPdf} with `paper: 'a4'`. */
export async function downloadHtmlElementAsA4Pdf(
  source: HTMLElement,
  options: HtmlElementToA4PdfOptions
): Promise<void> {
  return downloadHtmlElementAsPdf(source, { ...options, paper: 'a4' });
}

async function saveReceiptPdf(
  canvas: HTMLCanvasElement,
  filename: string,
  marginMm: number
): Promise<void> {
  const pageWidth = RECEIPT_PAPER_WIDTH_MM;
  const contentWidth = Math.max(pageWidth - marginMm * 2, 1);
  const imgWidthMm = contentWidth;
  const imgHeightMm = (canvas.height * imgWidthMm) / canvas.width;
  // Continuous receipt: one page tall enough for the full slip (min 100mm).
  const pageHeight = Math.max(imgHeightMm + marginMm * 2, 100);

  const pdf = new jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: [pageWidth, pageHeight],
    compress: true,
  });

  pdf.addImage(
    canvas.toDataURL('image/png'),
    'PNG',
    marginMm,
    marginMm,
    imgWidthMm,
    imgHeightMm,
    undefined,
    'FAST'
  );
  pdf.save(filename);
}

async function saveA4Pdf(
  canvas: HTMLCanvasElement,
  filename: string,
  marginMm: number
): Promise<void> {
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = Math.max(pageWidth - marginMm * 2, 1);
  const contentHeight = Math.max(pageHeight - marginMm * 2, 1);
  const imgWidthMm = contentWidth;
  const imgHeightMm = (canvas.height * imgWidthMm) / canvas.width;

  if (imgHeightMm <= contentHeight + 0.05) {
    pdf.addImage(
      canvas.toDataURL('image/png'),
      'PNG',
      marginMm,
      marginMm,
      imgWidthMm,
      imgHeightMm,
      undefined,
      'FAST'
    );
    pdf.save(filename);
    return;
  }

  const pxPerMm = canvas.width / imgWidthMm;
  const pageHeightPx = contentHeight * pxPerMm;
  let yPx = 0;
  let pageIndex = 0;

  while (yPx < canvas.height - 0.5) {
    const sliceHeightPx = Math.min(pageHeightPx, canvas.height - yPx);
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvas.width;
    pageCanvas.height = Math.max(1, Math.ceil(sliceHeightPx));
    const ctx = pageCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to create PDF page canvas');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    ctx.drawImage(
      canvas,
      0,
      yPx,
      canvas.width,
      sliceHeightPx,
      0,
      0,
      canvas.width,
      sliceHeightPx
    );

    const sliceHeightMm = sliceHeightPx / pxPerMm;
    if (pageIndex > 0) pdf.addPage();
    pdf.addImage(
      pageCanvas.toDataURL('image/png'),
      'PNG',
      marginMm,
      marginMm,
      imgWidthMm,
      sliceHeightMm,
      undefined,
      'FAST'
    );

    yPx += sliceHeightPx;
    pageIndex += 1;
    if (pageIndex > 40) break;
  }

  pdf.save(filename);
}
