import { EmployeeDependent } from './db.js';

export type SpouseHasWork = 'yes' | 'no';

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

export type EmployeeChildInput = {
  name?: string;
  name_kh?: string;
  nameKh?: string;
  age?: number | string | null;
  gender?: string | null;
  occupation?: string | null;
  hasJob?: SpouseHasWork | string | boolean | null;
  sortOrder?: number;
};

export type EmployeeChildDto = {
  id: number;
  childNumber: number;
  name: string;
  nameKh: string | null;
  age: number | null;
  gender: string | null;
  occupation: string | null;
  hasJob: SpouseHasWork;
  isTaxDependent: boolean;
};

export function parseChildHasJob(raw: unknown): SpouseHasWork {
  const parsed = parseSpouseHasWork(raw);
  if (parsed) return parsed;
  if (raw === true || raw === 1) return 'yes';
  if (raw === false || raw === 0) return 'no';
  return 'no';
}

function rowToDto(row: Record<string, unknown>, index: number): EmployeeChildDto {
  const hasJob = parseChildHasJob(row.has_job ?? row.hasJob);
  return {
    id: Number(row.id),
    childNumber: index + 1,
    name: String(row.name ?? '').trim(),
    nameKh: row.name_kh != null ? String(row.name_kh).trim() || null : null,
    age: row.age != null && row.age !== '' ? Number(row.age) : null,
    gender: row.gender != null ? String(row.gender).trim() || null : null,
    occupation: row.occupation != null ? String(row.occupation).trim() || null : null,
    hasJob,
    isTaxDependent: hasJob === 'no',
  };
}

export async function listEmployeeChildren(employeeRowId: string): Promise<EmployeeChildDto[]> {
  const rows = await EmployeeDependent.findAll({
    where: { employee_id: employeeRowId, relationship: 'child' },
    order: [
      ['sort_order', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  return rows.map((row, index) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    return rowToDto(plain, index);
  });
}

/** Ignore blank wizard rows (legacy tax_dependents backfill used empty placeholders). */
export function isPopulatedChildRow(child: {
  name?: string | null;
  name_kh?: string | null;
  nameKh?: string | null;
  age?: number | string | null;
}): boolean {
  const name = String(child.name ?? '').trim();
  if (name.length > 0) return true;
  const nameKh = String(child.name_kh ?? child.nameKh ?? '').trim();
  if (nameKh.length > 0) return true;
  const ageRaw = child.age;
  if (ageRaw == null || String(ageRaw).trim() === '') return false;
  const n = Number(ageRaw);
  return Number.isFinite(n);
}

export function normalizeChildrenInput(raw: unknown): EmployeeChildInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const ageRaw = row.age;
    let age: number | null = null;
    if (ageRaw != null && String(ageRaw).trim() !== '') {
      const n = Number(ageRaw);
      age = Number.isFinite(n) ? Math.max(0, Math.min(99, Math.floor(n))) : null;
    }
    const nameKh = String(row.name_kh ?? row.nameKh ?? '').trim();
    return {
      name: String(row.name ?? '').trim(),
      name_kh: nameKh || undefined,
      age,
      gender: row.gender != null ? String(row.gender).trim() : '',
      occupation: row.occupation != null ? String(row.occupation).trim() : '',
      hasJob: parseChildHasJob(row.hasJob ?? row.has_job),
      sortOrder: Number(row.sortOrder ?? row.sort_order ?? index),
    };
  })
    .filter((child) => isPopulatedChildRow(child));
}

/** Replace all child rows for an employee (relationship = child). */
export async function syncEmployeeChildren(
  employeeRowId: string,
  children: EmployeeChildInput[]
): Promise<EmployeeChildDto[]> {
  await EmployeeDependent.destroy({
    where: { employee_id: employeeRowId, relationship: 'child' },
  });

  const normalized = normalizeChildrenInput(children);
  for (let i = 0; i < normalized.length; i++) {
    const child = normalized[i];
    const hasJob = parseChildHasJob(child.hasJob);
    const nameEn = String(child.name ?? '').trim();
    const nameKh = String(child.name_kh ?? '').trim();
    const name = nameEn || nameKh || `Child ${i + 1}`;
    await EmployeeDependent.create({
      employee_id: employeeRowId,
      name,
      name_kh: nameKh || null,
      relationship: 'child',
      age: child.age != null ? child.age : null,
      gender: child.gender || null,
      occupation: child.occupation || null,
      has_job: hasJob === 'yes',
      is_beneficiary: hasJob === 'no',
      sort_order: child.sortOrder ?? i,
    } as Record<string, unknown>);
  }

  return listEmployeeChildren(employeeRowId);
}

export function countTaxDependentChildren(children: EmployeeChildInput[] | EmployeeChildDto[]): number {
  return children.filter((c) => {
    if (!isPopulatedChildRow(c)) return false;
    const raw =
      'hasJob' in c && c.hasJob != null
        ? c.hasJob
        : (c as EmployeeChildInput).hasJob;
    return parseChildHasJob(raw) === 'no';
  }).length;
}

/** GDT dependents from marital status, spouse work flag, and child rows (no paid work). */
export function resolveTaxDependentsFromEmployeeAndChildren(
  employee: {
    marital_status?: unknown;
    spouse_occupation?: unknown;
    tax_dependents?: unknown;
  } | null | undefined,
  children: EmployeeChildDto[]
): number {
  const computed = computeTaxDependentsForFamily(
    employee?.marital_status,
    employee?.spouse_occupation,
    children
  );
  const stored = Math.max(0, Math.floor(Number(employee?.tax_dependents) || 0));
  if (computed > 0) return computed;
  // Salary structure may still hold a manual count when child rows are not synced yet.
  if (stored > 0 && children.length === 0) return stored;
  return computed;
}

export async function bulkListEmployeeChildren(
  employeeRowIds: string[]
): Promise<Map<string, EmployeeChildDto[]>> {
  const map = new Map<string, EmployeeChildDto[]>();
  const ids = [...new Set(employeeRowIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!ids.length) return map;
  const rows = await EmployeeDependent.findAll({
    where: { employee_id: ids, relationship: 'child' },
    order: [
      ['sort_order', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const eid = String(plain.employee_id ?? '');
    if (!eid) continue;
    if (!grouped.has(eid)) grouped.set(eid, []);
    grouped.get(eid)!.push(plain);
  }
  for (const eid of ids) {
    const list = grouped.get(eid) ?? [];
    map.set(eid, list.map((plain, index) => rowToDto(plain, index)));
  }
  return map;
}

/** Resolve tax_dependents on each payroll employee row (batch — one child query). */
export async function attachTaxDependentsToPayrollEmployees(
  employees: Array<Record<string, unknown>>
): Promise<Array<Record<string, unknown>>> {
  const childrenById = await bulkListEmployeeChildren(
    employees.map((e) => String(e.id ?? '')).filter(Boolean)
  );
  return employees.map((emp) => {
    const pk = String(emp.id ?? '');
    return {
      ...emp,
      tax_dependents: resolveTaxDependentsFromEmployeeAndChildren(
        emp,
        childrenById.get(pk) ?? []
      ),
    };
  });
}

export async function resolveTaxDependentsForEmployeeRow(
  employee: { id?: unknown; marital_status?: unknown; spouse_occupation?: unknown; tax_dependents?: unknown } | null | undefined,
  children?: EmployeeChildDto[]
): Promise<number> {
  if (!employee?.id) {
    return Math.max(0, Math.floor(Number(employee?.tax_dependents) || 0));
  }
  const list =
    children ?? (await listEmployeeChildren(String(employee.id)));
  return resolveTaxDependentsFromEmployeeAndChildren(employee, list);
}

export async function persistTaxDependentsForEmployee(
  employeeRowId: string,
  maritalStatus: unknown,
  spouseOccupation: unknown,
  children?: EmployeeChildInput[] | EmployeeChildDto[],
  options?: { effectiveFrom?: string; changeReason?: string }
): Promise<number> {
  const { upsertSalaryStructure } = await import('./salaryStructureService.js');
  let list: EmployeeChildDto[];
  if (children) {
    list = children.map((c, index) => {
      const hasJob = parseChildHasJob(
        'hasJob' in c ? (c as EmployeeChildDto).hasJob : (c as EmployeeChildInput).hasJob
      );
      return {
        id: 0,
        childNumber: index + 1,
        name: String(c.name ?? ''),
        age: c.age != null && c.age !== '' ? Number(c.age) : null,
        gender: c.gender != null ? String(c.gender) : null,
        occupation: c.occupation != null ? String(c.occupation) : null,
        hasJob,
        isTaxDependent: hasJob === 'no',
      };
    });
  } else {
    list = await listEmployeeChildren(employeeRowId);
  }
  const taxDeps = computeTaxDependentsForFamily(maritalStatus, spouseOccupation, list);
  const effectiveFrom = options?.effectiveFrom ?? new Date().toISOString().slice(0, 10);
  await upsertSalaryStructure(
    employeeRowId,
    { tax_dependents: taxDeps },
    {
      effectiveFrom,
      changeReason: options?.changeReason ?? 'Tax dependents from family profile',
    }
  );
  return taxDeps;
}

export function computeTaxDependentsForFamily(
  maritalStatus: string | null | undefined,
  spouseOccupation: unknown,
  children: EmployeeChildInput[] | EmployeeChildDto[]
): number {
  if (String(maritalStatus ?? '').toLowerCase() !== 'married') return 0;
  const spouseHasWork = parseSpouseHasWork(spouseOccupation);
  const spouseDependent = spouseHasWork === 'no' ? 1 : 0;
  return countTaxDependentChildren(children) + spouseDependent;
}
