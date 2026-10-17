import html2canvas from 'html2canvas';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'office';
}

function resolvePublicUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://') || pathOrUrl.startsWith('data:')) {
    return pathOrUrl;
  }
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${window.location.origin}${path}`;
}

async function fetchAsDataUrl(url: string): Promise<string> {
  const resolved = resolvePublicUrl(url);
  const response = await fetch(resolved);
  if (!response.ok) {
    throw new Error(`Failed to load image (${response.status})`);
  }
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read image'));
    reader.readAsDataURL(blob);
  });
}

function inlineSvgAssetUrls(svgHtml: string, logoDataUrl: string): string {
  return svgHtml
    .replace(/href="(\/[^"]+|https?:[^"]+)"/gi, `href="${logoDataUrl}"`)
    .replace(/xlink:href="(\/[^"]+|https?:[^"]+)"/gi, `xlink:href="${logoDataUrl}"`);
}

function waitForElementImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'));
  if (imgs.length === 0) return Promise.resolve();
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => resolve();
        })
    )
  ).then(() => undefined);
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      try {
        const dataUrl = canvas.toDataURL('image/png');
        const base64 = dataUrl.split(',')[1];
        if (!base64) throw new Error('Empty canvas');
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        resolve(new Blob([bytes], { type: 'image/png' }));
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Could not create image'));
      }
    }, 'image/png', 1);
  });
}

export type QrPrintPosterOptions = {
  officeName: string;
  qrSvgHtml: string;
  logoUrl: string;
  ttlSeconds: number;
  subtitle: string;
  instructionTitle: string;
  steps: string[];
  footnote: string;
  brandLine: string;
};

/** Resolved assets for export (data URLs — safe for html2canvas). */
export type QrPrintPosterResolvedOptions = QrPrintPosterOptions & {
  logoDataUrl: string;
  qrSvgHtml: string;
};

export async function resolveQrPosterAssets(
  opts: QrPrintPosterOptions
): Promise<QrPrintPosterResolvedOptions> {
  const logoDataUrl = await fetchAsDataUrl(opts.logoUrl);
  const qrSvgHtml = inlineSvgAssetUrls(opts.qrSvgHtml, logoDataUrl);
  return { ...opts, logoDataUrl, qrSvgHtml };
}

function buildPosterSheetMarkup(opts: QrPrintPosterResolvedOptions, forPrint: boolean): string {
  const stepFont = forPrint ? '9pt' : '12px';
  const stepsHtml = opts.steps
    .map(
      (step, i) =>
        `<li style="display:flex;align-items:flex-start;font-size:${stepFont};color:#475569;margin-bottom:8px;line-height:1.35;">
          <span style="flex-shrink:0;width:18px;height:18px;border-radius:50%;background:#0078C1;color:#fff;font-size:10px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;margin-right:8px;">${i + 1}</span>
          <span>${escapeHtml(step)}</span>
        </li>`
    )
    .join('');

  const qrSize = forPrint ? '72mm' : '272px';
  const sheetWidth = forPrint ? '100%' : '400px';
  const sheetMax = forPrint ? '148mm' : '400px';

  return `
    <div class="sheet" style="
      width:${sheetWidth};
      max-width:${sheetMax};
      background:linear-gradient(145deg,#0f172a 0%,#134e4a 45%,#0f172a 100%);
      border-radius:16px;
      padding:10px;
      box-sizing:border-box;
    ">
      <div class="inner" style="background:#fff;border-radius:12px;padding:32px 28px 28px;text-align:center;box-sizing:border-box;">
        <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:20px;">
          <img src="${opts.logoDataUrl}" alt="" width="44" height="44" style="width:44px;height:44px;border-radius:50%;object-fit:contain;border:2px solid #e2e8f0;" />
          <div style="text-align:left;">
            <strong style="display:block;font-size:14px;color:#0f766e;">ROC</strong>
            <span style="font-size:11px;color:#64748b;">${escapeHtml(opts.brandLine)}</span>
          </div>
        </div>
        <h1 style="font-size:22px;font-weight:800;color:#0f172a;margin:0 0 6px;line-height:1.25;">${escapeHtml(opts.officeName)}</h1>
        <p style="font-size:13px;color:#64748b;margin:0 0 20px;">${escapeHtml(opts.subtitle)}</p>
        <div class="qr-frame" style="display:inline-block;padding:16px;background:#fff;border:3px solid #0078C1;border-radius:12px;margin-bottom:20px;position:relative;line-height:0;">
          ${opts.qrSvgHtml.replace(
            /<svg([^>]*)>/i,
            `<svg$1 style="width:${qrSize};height:${qrSize};display:block;">`
          )}
          <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:56px;height:56px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 3px #fff;">
            <img src="${opts.logoDataUrl}" alt="" width="44" height="44" style="width:44px;height:44px;border-radius:50%;object-fit:contain;" />
          </div>
        </div>
        <p style="font-size:11px;font-weight:700;color:#334155;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(opts.instructionTitle)}</p>
        <ol style="list-style:none;text-align:left;max-width:320px;margin:0 auto 16px;padding:0;">
          ${stepsHtml}
        </ol>
        <p style="font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:14px;margin:0;line-height:1.45;">${escapeHtml(opts.footnote)}</p>
      </div>
      <p style="text-align:center;color:rgba(255,255,255,0.85);font-size:9px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;padding:12px 0 4px;margin:0;">ROC · Human Capital Management</p>
    </div>
  `;
}

/** Render the same layout as print, capture as PNG (matches print poster). */
export async function downloadQrPosterFromPrintLayout(
  opts: QrPrintPosterOptions,
  officeName: string
): Promise<void> {
  const resolved = await resolveQrPosterAssets(opts);

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:fixed;left:0;top:0;z-index:-1;pointer-events:none;opacity:0.01;width:420px;overflow:visible;';
  host.innerHTML = buildPosterSheetMarkup(resolved, false);
  document.body.appendChild(host);

  try {
    const sheet = host.querySelector('.sheet');
    if (!sheet || !(sheet instanceof HTMLElement)) {
      throw new Error('Poster layout not ready');
    }

    await waitForElementImages(host);
    await new Promise<void>((r) => {
      requestAnimationFrame(() => setTimeout(r, 250));
    });

    if (sheet.offsetWidth < 50 || sheet.offsetHeight < 50) {
      throw new Error('Poster has no dimensions');
    }

    const canvas = await html2canvas(sheet, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      width: sheet.offsetWidth,
      height: sheet.offsetHeight,
    });

    const blob = await canvasToPngBlob(canvas);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `attendance-qr-${slugify(officeName)}-${stamp}.png`;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } finally {
    host.remove();
  }
}

export function buildAttendanceQrPrintHtml(
  opts: QrPrintPosterOptions | QrPrintPosterResolvedOptions
): string {
  const resolved: QrPrintPosterResolvedOptions =
    'logoDataUrl' in opts && opts.logoDataUrl.startsWith('data:')
      ? (opts as QrPrintPosterResolvedOptions)
      : {
          ...opts,
          logoDataUrl: resolvePublicUrl(opts.logoUrl),
          qrSvgHtml: opts.qrSvgHtml,
        };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(opts.officeName)} — Attendance QR</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Kantumruy+Pro:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>
    body { margin:0; font-family:'Kantumruy Pro','Inter',system-ui,sans-serif; background:#f1f5f9; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:12mm; box-sizing:border-box; }
    @media print { body { background:#fff; padding:0; } }
  </style>
</head>
<body>
  ${buildPosterSheetMarkup(resolved, true)}
</body>
</html>`;
}

export function openAttendanceQrPrintWindow(html: string): void {
  const win = window.open('', '_blank');
  if (!win) {
    throw new Error('POPUP_BLOCKED');
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.onload = () =>
    setTimeout(() => {
      win.print();
      win.close();
    }, 500);
}
