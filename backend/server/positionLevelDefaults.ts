import type { StructureTier } from './companyStructureService.js';

export type PositionLevelRecord = {
  code: string;
  label: string;
  tier: number;
  sortOrder: number;
  structureTier: StructureTier;
};

export const DEFAULT_POSITION_LEVELS: PositionLevelRecord[] = [
  { code: 'EXECUTIVE', label: 'Executive', tier: 1, sortOrder: 1, structureTier: 'officer' },
  { code: 'SENIOR_MANAGER', label: 'Senior Manager', tier: 2, sortOrder: 2, structureTier: 'manager' },
  { code: 'MANAGER', label: 'Manager', tier: 3, sortOrder: 3, structureTier: 'manager' },
  { code: 'SENIOR_OFFICER', label: 'Senior Officer', tier: 4, sortOrder: 4, structureTier: 'officer' },
  { code: 'OFFICER', label: 'Officer', tier: 5, sortOrder: 5, structureTier: 'officer' },
  { code: 'STAFF', label: 'Staff', tier: 6, sortOrder: 6, structureTier: 'staff' },
  { code: 'INTERN', label: 'Intern', tier: 7, sortOrder: 7, structureTier: 'staff' },
];

export function sortPositionLevels(levels: PositionLevelRecord[]): PositionLevelRecord[] {
  return [...levels].sort(
    (a, b) => a.tier - b.tier || a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)
  );
}

/** Assign tier 1..n and matching sortOrder from the given list order. */
export function assignTiersFromOrder(levels: PositionLevelRecord[]): PositionLevelRecord[] {
  return levels.map((level, index) => {
    const tier = index + 1;
    return { ...level, tier, sortOrder: tier };
  });
}
