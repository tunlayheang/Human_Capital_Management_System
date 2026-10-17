export type PaymentMethod = 'bank' | 'cash';

export function normalizePaymentMethod(raw: unknown): PaymentMethod {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'cash') return 'cash';
  return 'bank';
}

export function inferPaymentMethodFromBank(
  bankName: unknown,
  bankAccount: unknown
): PaymentMethod {
  const hasBank =
    String(bankName ?? '').trim().length > 0 ||
    String(bankAccount ?? '').trim().length > 0;
  return hasBank ? 'bank' : 'cash';
}
