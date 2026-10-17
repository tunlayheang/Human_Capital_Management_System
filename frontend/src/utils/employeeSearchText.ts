/** Build a searchable haystack for employee/user rows (EN + Khmer names, IDs, phones). */
export function employeeSearchHaystack(parts: Array<string | null | undefined>): string {
  const tokens: string[] = [];
  for (const part of parts) {
    const t = String(part ?? '').trim();
    if (t) tokens.push(t);
  }
  // Include compacted form so spaced queries still match glued Khmer/Latin names.
  const joined = tokens.join(' ');
  const compact = tokens.map((t) => t.replace(/\s+/g, '')).join('');
  return `${joined} ${compact}`.toLocaleLowerCase();
}

export function normalizeClientSearchQuery(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

/** True when every whitespace-separated token appears in the haystack (full-name friendly). */
export function matchesEmployeeSearch(haystack: string, query: string): boolean {
  const q = normalizeClientSearchQuery(query);
  if (!q) return true;
  const hay = haystack.toLocaleLowerCase();
  if (hay.includes(q)) return true;
  const compactQ = q.replace(/\s+/g, '');
  if (compactQ && hay.replace(/\s+/g, '').includes(compactQ)) return true;
  const tokens = q.split(' ').filter(Boolean);
  if (tokens.length > 1) return tokens.every((t) => hay.includes(t));
  return false;
}
