/** Strip non-digits from phone input (login, OTP, user provisioning). */
export function normalizePhone(phone: unknown): string {
  return String(phone || '').replace(/\D/g, '');
}

/** Build likely stored forms for Cambodia (+855) and local 0-prefix numbers. */
export function phoneLookupVariants(raw: unknown): string[] {
  const digits = normalizePhone(raw);
  if (!digits) return [];

  const variants = new Set<string>([digits]);

  if (digits.startsWith('0') && digits.length >= 9) {
    variants.add(`855${digits.slice(1)}`);
  }
  if (digits.startsWith('855') && digits.length >= 11) {
    variants.add(`0${digits.slice(3)}`);
  }
  if (digits.length >= 9) {
    variants.add(digits.slice(-9));
  }
  if (digits.length >= 8) {
    variants.add(digits.slice(-8));
  }

  return [...variants];
}
