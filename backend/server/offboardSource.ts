export const OFFBOARD_SOURCES = ['wizard', 'probation', 'employee', 'abandonment'] as const;

export type OffboardSource = (typeof OFFBOARD_SOURCES)[number];

export function normalizeOffboardSource(raw: unknown): OffboardSource | null {
  const val = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (val === 'wizard' || val === 'probation' || val === 'employee' || val === 'abandonment') {
    return val;
  }
  return null;
}

export function inferOffboardSourceFromSeparation(separationType: unknown): OffboardSource | null {
  const val = String(separationType ?? '')
    .trim()
    .toLowerCase();
  if (!val || val === 'normal_resignation') return null;
  return 'abandonment';
}
