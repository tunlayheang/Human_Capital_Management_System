/** Page numbers to show in a sliding window (e.g. 1–5 around the current page). */
export function visiblePages(current: number, total: number, windowSize = 5): number[] {
  if (total <= 0) return [];
  if (total <= windowSize) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  let start = Math.max(1, current - Math.floor(windowSize / 2));
  let end = start + windowSize - 1;
  if (end > total) {
    end = total;
    start = Math.max(1, end - windowSize + 1);
  }
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export const DEFAULT_LIST_PAGE_SIZE = 20;
