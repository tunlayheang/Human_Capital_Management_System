/** Offboarding hub paths (final pay lives here, not under Payroll). */
export const OFFBOARDING_HUB_PATH = '/employees/offboarding';
export const OFFBOARDING_WIZARD_PATH = '/employees/offboarding/wizard';
export const OFFBOARDING_PAYMENT_PATH = '/employees/offboarding/payment';

export function offboardingHubUrl(params?: {
  view?: 'cases' | 'final-pay';
  employeeId?: string;
  wizard?: boolean;
  step?: number;
}): string {
  if (params?.wizard || params?.step != null) {
    const q = new URLSearchParams();
    if (params.employeeId) q.set('employeeId', params.employeeId);
    if (params.step != null && params.step > 0) q.set('step', String(params.step));
    const qs = q.toString();
    return `${OFFBOARDING_WIZARD_PATH}${qs ? `?${qs}` : ''}`;
  }
  const q = new URLSearchParams();
  if (params?.view === 'final-pay') q.set('view', 'final-pay');
  if (params.employeeId) q.set('employeeId', params.employeeId);
  const qs = q.toString();
  return `${OFFBOARDING_HUB_PATH}${qs ? `?${qs}` : ''}`;
}

export function offboardingPaymentUrl(params: { settlementId?: string; employeeId?: string }): string {
  const q = new URLSearchParams();
  if (params.settlementId) q.set('settlementId', params.settlementId);
  if (params.employeeId) q.set('employeeId', params.employeeId);
  const qs = q.toString();
  return `${OFFBOARDING_PAYMENT_PATH}${qs ? `?${qs}` : ''}`;
}

/** Legacy payroll URLs → offboarding hub (preserve query string). */
export function redirectFromLegacyFinalPay(pathname: string, search: string): string {
  if (pathname.includes('/payment')) {
    return `${OFFBOARDING_PAYMENT_PATH}${search}`;
  }
  const params = new URLSearchParams(search);
  params.delete('view');
  const qs = params.toString();
  return `${OFFBOARDING_HUB_PATH}${qs ? `?${qs}` : ''}#offboarding-case-list`;
}
