/** Stored in `employees.spouse_occupation`: yes = employed, no = not employed (tax dependent). */
export type SpouseHasWork = 'yes' | 'no';

export function encodeSpouseHasWork(hasWork: boolean): SpouseHasWork {
  return hasWork ? 'yes' : 'no';
}

/** Parse DB/form value; legacy free-text occupation returns undefined. */
export function parseSpouseHasWork(raw: unknown): SpouseHasWork | undefined {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return undefined;
  if (s === 'yes' || s === 'true' || s === '1' || s === 'employed' || s === 'has_work') {
    return 'yes';
  }
  if (s === 'no' || s === 'false' || s === '0' || s === 'unemployed' || s === 'no_work') {
    return 'no';
  }
  return undefined;
}

export function spouseHasWorkLabel(value: SpouseHasWork | undefined): string {
  if (value === 'yes') return 'Yes';
  if (value === 'no') return 'No';
  return '—';
}

export type ChildDependentInput = {
  name?: string;
  age?: string | number | null;
  hasJob?: SpouseHasWork | string;
};

/** Wizard placeholder rows must not count toward GDT relief. */
export function isPopulatedChildRow(child: {
  name?: string | null;
  nameKh?: string | null;
  age?: string | number | null;
}): boolean {
  const name = String(child.name ?? '').trim();
  if (name.length > 0) return true;
  const nameKh = String(child.nameKh ?? '').trim();
  if (nameKh.length > 0) return true;
  const ageRaw = child.age;
  if (ageRaw == null || String(ageRaw).trim() === '') return false;
  const n = Number(ageRaw);
  return Number.isFinite(n);
}

/** Cambodia GDT: each child without paid work + non-working spouse = one dependent (150,000 KHR/mo each). */
export function computeTaxDependents(
  maritalStatus: string,
  childrenOrLegacyCount: number | ChildDependentInput[],
  spouseHasWork?: SpouseHasWork
): number {
  if (maritalStatus !== 'married') return 0;
  const spouseDependent = spouseHasWork === 'no' ? 1 : 0;
  if (Array.isArray(childrenOrLegacyCount)) {
    const childDependents = childrenOrLegacyCount.filter(
      (c) => isPopulatedChildRow(c) && parseSpouseHasWork(c.hasJob) === 'no'
    ).length;
    return childDependents + spouseDependent;
  }
  const kids = Math.max(0, Math.floor(Number(childrenOrLegacyCount)) || 0);
  return kids + spouseDependent;
}

/** Reverse stored total into children count for the form. */
export function numberOfKidsFromTaxDependents(
  taxDependents: number,
  spouseHasWork: SpouseHasWork | undefined
): number {
  const total = Math.max(0, Math.floor(Number(taxDependents)) || 0);
  const spouseDependent = spouseHasWork === 'no' ? 1 : 0;
  return Math.max(0, total - spouseDependent);
}
