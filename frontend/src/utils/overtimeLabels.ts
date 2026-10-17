import type { OvertimeRateTier, OvertimeRequest } from '../types';
import { formatDateTimeDisplay } from './formatDisplayDate';

export function normalizeOvertimeRequest(raw: unknown): OvertimeRequest {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    ...(r as unknown as OvertimeRequest),
    createdAt: (r.createdAt ?? r.created_at ?? null) as string | null | undefined,
    updatedAt: (r.updatedAt ?? r.updated_at ?? null) as string | null | undefined,
    appliedOn: (r.appliedOn ?? r.applied_on ?? null) as string | null | undefined,
  };
}

/** When the employee submitted the overtime request. */
export function formatOvertimeRequestedAt(
  request: Pick<OvertimeRequest, 'createdAt' | 'appliedOn'>
): string {
  const raw = request.createdAt ?? request.appliedOn;
  return formatDateTimeDisplay(raw);
}

export const OVERTIME_RATE_OPTIONS: { id: OvertimeRateTier; label: string; hint: string }[] = [
  {
    id: 'regular_100',
    label: 'Regular OT (100%)',
    hint: 'Straight-time overtime at base hourly rate',
  },
  {
    id: 'daytime_150',
    label: 'Weekday OT (150%)',
    hint: 'Extra hours on a normal working day',
  },
  {
    id: 'rest_holiday_200',
    label: 'Rest day / Holiday (200%)',
    hint: 'Work on scheduled day off or public holiday',
  },
  {
    id: 'night_200',
    label: 'Night OT (200%)',
    hint: 'Work between 10 PM and 5 AM',
  },
];

export function overtimeRateLabel(tier: OvertimeRateTier): string {
  return OVERTIME_RATE_OPTIONS.find((o) => o.id === tier)?.label ?? tier;
}

/** Short display label for overtime request status badges. */
export function formatOvertimeStatusLabel(
  status: string,
  request?: Pick<OvertimeRequest, 'assignedApprovers' | 'approvalProgress'>
): string {
  const s = String(status ?? '').toUpperCase();
  if (
    s === 'PENDING' &&
    request?.approvalProgress &&
    (request.assignedApprovers?.length ?? 0) > 0
  ) {
    return `Pending (${request.approvalProgress.approved}/${request.approvalProgress.total})`;
  }
  switch (s) {
    case 'PENDING':
      return 'Pending';
    case 'APPROVED':
      return 'Approved';
    case 'REJECTED':
      return 'Rejected';
    case 'RETURNED':
      return 'Returned';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return s
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
