import { Role } from '../types';
import type { StructureTier } from '../types/positionLevels';

export type PositionLevelOption = {
  value: string;
  label: string;
  structureTier?: StructureTier;
  tier?: number;
  sortOrder?: number;
};

export const FALLBACK_POSITION_LEVEL_OPTIONS: PositionLevelOption[] = [
  { value: 'EXECUTIVE', label: 'Executive', structureTier: 'officer', tier: 1, sortOrder: 1 },
  { value: 'SENIOR_MANAGER', label: 'Senior Manager', structureTier: 'manager', tier: 2, sortOrder: 2 },
  { value: 'MANAGER', label: 'Manager', structureTier: 'manager', tier: 3, sortOrder: 3 },
  { value: 'SENIOR_OFFICER', label: 'Senior Officer', structureTier: 'officer', tier: 4, sortOrder: 4 },
  { value: 'OFFICER', label: 'Officer', structureTier: 'officer', tier: 5, sortOrder: 5 },
  { value: 'STAFF', label: 'Staff', structureTier: 'staff', tier: 6, sortOrder: 6 },
  { value: 'INTERN', label: 'Intern', structureTier: 'staff', tier: 7, sortOrder: 7 },
];

let cachedOptions: PositionLevelOption[] | null = null;

export function setPositionLevelOptions(options: PositionLevelOption[]): void {
  cachedOptions = options;
}

export function getPositionLevelOptions(): PositionLevelOption[] {
  const opts = cachedOptions ?? FALLBACK_POSITION_LEVEL_OPTIONS;
  return [...opts].sort(
    (a, b) => (a.tier ?? a.sortOrder ?? 0) - (b.tier ?? b.sortOrder ?? 0)
  );
}

/** @deprecated Use getPositionLevelOptions() — kept for gradual migration */
export const POSITION_LEVEL_OPTIONS = FALLBACK_POSITION_LEVEL_OPTIONS;

export type PositionLevelValue = string;

export const POSITION_ACCESS_ROLE_OPTIONS = [
  { value: Role.MANAGER, label: 'Manager' },
  { value: Role.EMPLOYEE, label: 'Staff' },
  { value: Role.HR, label: 'HR' },
] as const;

export function positionLevelLabel(code: string | undefined | null): string {
  if (!code) return '';
  const hit = getPositionLevelOptions().find((o) => o.value === code);
  return hit?.label ?? code;
}

export function positionAccessRoleLabel(role: string | undefined | null): string {
  const normalized = String(role ?? '')
    .trim()
    .toUpperCase();
  const hit = POSITION_ACCESS_ROLE_OPTIONS.find(
    (o) => o.value === role || (normalized === 'STAFF' && o.value === Role.EMPLOYEE)
  );
  return hit?.label ?? (normalized === 'EMPLOYEE' || normalized === 'STAFF' ? 'Staff' : role ?? '');
}
