/** In-memory id → title from the last loaded report catalog (for workspace tab labels). */
const titlesById = new Map<string, string>();

export function setReportCatalogTitles(
  reports: Array<{ id?: string; title?: string } | null | undefined>
): void {
  for (const report of reports) {
    const id = String(report?.id ?? '').trim();
    const title = String(report?.title ?? '').trim();
    if (id && title) titlesById.set(id, title);
  }
}

export function getCachedReportCatalogTitle(reportId: string): string | null {
  const id = reportId.trim();
  if (!id) return null;
  return titlesById.get(id) ?? null;
}

/** Fallback when catalog has not loaded yet — never preferred over API titles. */
export function humanizeReportCatalogId(reportId: string): string {
  return reportId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
