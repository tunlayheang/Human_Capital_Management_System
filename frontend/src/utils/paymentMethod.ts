export type PaymentMethod = 'bank' | 'cash';

export const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'bank', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
];

export function normalizePaymentMethod(raw: unknown): PaymentMethod {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'cash') return 'cash';
  return 'bank';
}

export function paymentMethodLabel(method: PaymentMethod | undefined): string {
  return PAYMENT_METHOD_OPTIONS.find((o) => o.value === method)?.label ?? 'Bank transfer';
}

/** Infer method when loading legacy rows without `payment_method`. */
export function inferPaymentMethodFromBank(
  bankName: unknown,
  bankAccount: unknown
): PaymentMethod {
  const hasBank =
    String(bankName ?? '').trim().length > 0 ||
    String(bankAccount ?? '').trim().length > 0;
  return hasBank ? 'bank' : 'cash';
}
