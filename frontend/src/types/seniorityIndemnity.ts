export type ServiceLengthBreakdown = {
  years: number;
  months: number;
  days: number;
  totalMonths: number;
  label: string;
};

export type SeniorityIndemnityPreview = {
  eligible: boolean;
  ineligibleReason: string | null;
  payoutUsd: number;
  payoutDays: number;
  dailyRateUsd: number;
  salaryBasisUsd: number;
  serviceLength: ServiceLengthBreakdown | null;
  calendarYearEntitlementDays: number;
  formula: string;
  paymentKind: 'june' | 'december' | 'settlement' | 'none';
  audit: Record<string, unknown>;
};
