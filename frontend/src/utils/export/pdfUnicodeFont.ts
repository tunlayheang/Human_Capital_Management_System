import type { jsPDF } from 'jspdf';

/**
 * Self-hosted Kantumruy Pro (Latin + Khmer) for jsPDF text exports.
 * Served from /public/fonts — do not import the TTF into the JS graph
 * (that can hang Vite HMR when the asset is large).
 */
export const PDF_UNICODE_FONT = 'HCMSUnicode';
export const PDF_FONT_FILE_URL = '/fonts/KantumruyPro-Variable.ttf';
const PDF_FONT_VFS_NAME = 'KantumruyPro.ttf';

export type PdfFontStyle = 'normal' | 'bold' | 'italic' | 'bolditalic';

let cachedBase64: string | null = null;
let loadPromise: Promise<string> | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Reject SPA HTML fallbacks and other non-font payloads. */
function looksLikeTrueTypeFont(buffer: ArrayBuffer, contentType: string | null): boolean {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/json')) return false;
  if (buffer.byteLength < 4) return false;
  const b = new Uint8Array(buffer, 0, 4);
  const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
  if (tag === 'OTTO' || tag === 'true' || tag === 'typ1') return true;
  return b[0] === 0x00 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00;
}

function resolveFontFetchUrl(): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
  const path = `${base}fonts/KantumruyPro-Variable.ttf`.replace(/\/{2,}/g, '/');
  try {
    return new URL(path, window.location.origin).href;
  } catch {
    return path;
  }
}

async function loadFontBase64(): Promise<string> {
  if (cachedBase64) return cachedBase64;
  if (!loadPromise) {
    loadPromise = (async () => {
      const res = await fetch(resolveFontFetchUrl());
      if (!res.ok) {
        throw new Error(`Failed to load PDF Unicode font (${res.status})`);
      }
      const buf = await res.arrayBuffer();
      if (!looksLikeTrueTypeFont(buf, res.headers.get('content-type'))) {
        throw new Error('PDF Unicode font response was not a TrueType file');
      }
      cachedBase64 = arrayBufferToBase64(buf);
      return cachedBase64;
    })().catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  return loadPromise;
}

function fontRegistered(doc: jsPDF): boolean {
  try {
    const list = doc.getFontList?.() as Record<string, string[]> | undefined;
    return Boolean(list && list[PDF_UNICODE_FONT]?.length);
  } catch {
    return false;
  }
}

/** Register Khmer-capable font on a jsPDF instance (idempotent per document). */
export async function ensurePdfUnicodeFont(doc: jsPDF): Promise<boolean> {
  if (fontRegistered(doc)) {
    pdfSetFont(doc, 'normal');
    return true;
  }
  try {
    const base64 = await loadFontBase64();
    doc.addFileToVFS(PDF_FONT_VFS_NAME, base64);
    doc.addFont(PDF_FONT_VFS_NAME, PDF_UNICODE_FONT, 'normal');
    doc.addFont(PDF_FONT_VFS_NAME, PDF_UNICODE_FONT, 'bold');
    doc.addFont(PDF_FONT_VFS_NAME, PDF_UNICODE_FONT, 'italic');
    doc.addFont(PDF_FONT_VFS_NAME, PDF_UNICODE_FONT, 'bolditalic');
    pdfSetFont(doc, 'normal');
    doc.getTextWidth('Aa');
    return true;
  } catch (err) {
    console.warn('[pdf] Unicode/Khmer font unavailable; falling back to Helvetica', err);
    try {
      doc.setFont('helvetica', 'normal');
    } catch {
      /* ignore */
    }
    return false;
  }
}

/** Prefer Unicode font when registered; otherwise Helvetica. */
export function pdfSetFont(doc: jsPDF, style: PdfFontStyle = 'normal'): void {
  if (fontRegistered(doc)) {
    const mapped: PdfFontStyle =
      style === 'bolditalic' || style === 'bold' ? 'bold' : 'normal';
    try {
      doc.setFont(PDF_UNICODE_FONT, mapped);
      return;
    } catch {
      /* fall through */
    }
  }
  const helveticaStyle =
    style === 'bolditalic' ? 'bold' : style === 'italic' ? 'italic' : style;
  doc.setFont('helvetica', helveticaStyle);
}

/** Google Fonts links for print-window / HTML exports (Khmer + Latin). */
export const EXPORT_PRINT_FONT_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Kantumruy+Pro:wght@400;600;700&display=swap" rel="stylesheet" />`;

export const EXPORT_PRINT_FONT_FAMILY =
  "'Kantumruy Pro', 'Inter', 'Segoe UI', system-ui, sans-serif";
