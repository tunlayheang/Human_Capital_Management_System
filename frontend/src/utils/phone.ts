/**
 * Normalize phone for auth API — digits only, with Cambodia local variants.
 * Matches backend phoneLookupVariants (0-prefix, 855, 8–9 digit local).
 */
export function normalizePhone(phone: string): string {
  let digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('855') && digits.length >= 11) {
    digits = `0${digits.slice(3)}`;
  }

  if (!digits.startsWith('0')) {
    if (digits.length === 8 || digits.length === 9) {
      digits = `0${digits}`;
    }
  }

  return digits;
}

/** Compare two phone inputs after normalization and common KH variants. */
export function phonesMatch(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.endsWith(nb) || nb.endsWith(na)) return true;
  const stripLeading = (p: string) => (p.startsWith('0') ? p.slice(1) : p);
  return stripLeading(na) === stripLeading(nb);
}
