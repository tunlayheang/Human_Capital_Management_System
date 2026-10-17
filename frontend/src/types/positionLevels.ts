export type StructureTier = 'manager' | 'officer' | 'staff';

export type PositionLevelRecord = {
  code: string;
  label: string;
  /** Numeric rank (1 = highest); derived from list order when saving. */
  tier: number;
  sortOrder: number;
  structureTier: StructureTier;
};
