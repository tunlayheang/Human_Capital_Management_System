import { Op } from 'sequelize';
import { Department, Employee, Position, User } from './db';
import {
  countActiveEmployeesByDepartment,
  resolveDepartmentHeadDisplay,
  resolveDepartmentHeadsBatch,
} from './departmentManager.js';

export function parseRequiredKhmerText(
  body: Record<string, unknown> | null | undefined,
  camelKey: string,
  snakeKey: string,
  fieldLabel: string
): string | null {
  const raw = body?.[camelKey] ?? body?.[snakeKey];
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return null;
  return trimmed;
}

export function departmentNameKhFromRow(plain: Record<string, unknown>): string | undefined {
  const kh = String(plain.name_kh ?? plain.nameKh ?? '').trim();
  return kh || undefined;
}

export function positionTitleKhFromRow(plain: Record<string, unknown>): string | undefined {
  const kh = String(plain.title_kh ?? plain.titleKh ?? '').trim();
  return kh || undefined;
}

export async function countActiveEmployees(departmentId: string): Promise<number> {
  return Employee.count({
    where: {
      department_id: departmentId,
      status: { [Op.in]: ['active', 'pending_approval', 'ACTIVE'] },
    },
  });
}

/** Staff still assigned to the unit (blocks soft-deactivate). Excludes fully separated employees. */
const SEPARATED_FOR_DEACTIVATE = ['terminated', 'resigned', 'TERMINATED', 'RESIGNED'];

export async function countAssignedStaffBlockingDeactivate(departmentId: string): Promise<number> {
  return Employee.count({
    where: {
      department_id: departmentId,
      status: { [Op.notIn]: SEPARATED_FOR_DEACTIVATE },
    },
  });
}

export function departmentIsActiveFromRow(plain: Record<string, unknown>): boolean {
  const raw = plain.isActive ?? plain.is_active;
  if (raw === false || raw === 0 || raw === '0') return false;
  return true;
}

export function positionIsActiveFromRow(plain: Record<string, unknown>): boolean {
  const raw = plain.isActive ?? plain.is_active;
  if (raw === false || raw === 0 || raw === '0') return false;
  return true;
}

/** Staff still assigned to a position (blocks soft-deactivate). */
export async function countAssignedStaffBlockingPositionDeactivate(
  positionId: string
): Promise<number> {
  return Employee.count({
    where: {
      position_id: positionId,
      status: { [Op.notIn]: SEPARATED_FOR_DEACTIVATE },
    },
  });
}

/** Any employee row still referencing the position (blocks hard delete / FK). */
export async function countEmployeesReferencingPosition(positionId: string): Promise<number> {
  return Employee.count({
    where: { position_id: positionId },
  });
}

/** Any employee row still referencing the department (blocks hard delete / FK). */
export async function countEmployeesReferencingDepartment(departmentId: string): Promise<number> {
  return Employee.count({
    where: { department_id: departmentId },
  });
}

export async function formatDepartmentRow(dept: any): Promise<Record<string, unknown>> {
  const plain = dept?.toJSON ? dept.toJSON() : { ...dept };
  if (dept?.get) {
    plain.department_head_id =
      plain.department_head_id ?? dept.get('department_head_id') ?? dept.get('departmentHeadId');
    plain.managerId = plain.managerId ?? dept.get('managerId') ?? dept.get('manager_id');
  }
  const id = String(plain.id);
  const headCount = await countActiveEmployees(id);
  const head = await resolveDepartmentHeadDisplay(plain);

  const code = String(plain.code ?? '').trim().toUpperCase();
  return {
    id,
    name: plain.name,
    nameKh: departmentNameKhFromRow(plain),
    code: code || undefined,
    headCount,
    managerId: head.managerId,
    managerName: head.managerName ?? undefined,
    department_head_id: head.department_head_id,
    isActive: departmentIsActiveFromRow(plain),
  };
}

export async function formatDepartmentsList(rows: any[]): Promise<Record<string, unknown>[]> {
  if (!rows.length) return [];

  const [headByDeptId, headCountByDeptId] = await Promise.all([
    resolveDepartmentHeadsBatch(rows),
    countActiveEmployeesByDepartment(),
  ]);

  return rows.map((dept) => {
    const plain = dept?.toJSON ? dept.toJSON() : { ...dept };
    if (dept?.get) {
      plain.department_head_id =
        plain.department_head_id ?? dept.get('department_head_id') ?? dept.get('departmentHeadId');
      plain.managerId = plain.managerId ?? dept.get('managerId') ?? dept.get('manager_id');
    }
    const id = String(plain.id);
    const head = headByDeptId.get(id) ?? {};

    const code = String(plain.code ?? '').trim().toUpperCase();
    return {
      id,
      name: plain.name,
      nameKh: departmentNameKhFromRow(plain),
      code: code || undefined,
      headCount: headCountByDeptId.get(id) ?? 0,
      managerId: head.managerId,
      managerName: head.managerName ?? undefined,
      department_head_id: head.department_head_id,
      isActive: departmentIsActiveFromRow(plain),
    };
  });
}

export function parseOptionalDepartmentCode(
  body: Record<string, unknown> | null | undefined
): string | null | undefined {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'code')) return undefined;
  const raw = body.code;
  if (raw == null || String(raw).trim() === '') return null;
  const code = String(raw)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 16);
  return code || null;
}

export function parsePositionSalaryRange(body: {
  salary?: number;
  salaryMin?: number;
  salaryMax?: number;
}): { salaryMin: number; salaryMax: number; salary: number } {
  const legacy = Number(body.salary) || 0;
  let min = body.salaryMin != null ? Number(body.salaryMin) : legacy;
  let max = body.salaryMax != null ? Number(body.salaryMax) : legacy;
  if (Number.isNaN(min)) min = 0;
  if (Number.isNaN(max)) max = min;
  if (max < min) [min, max] = [max, min];
  const salary = Math.round(((min + max) / 2) * 100) / 100;
  return { salaryMin: min, salaryMax: max, salary };
}

export function salaryOutOfPositionRangeMessage(
  baseSalary: number,
  position: { salaryMin?: number; salaryMax?: number; salary?: number; title?: string }
): string | null {
  const hasExplicitMin = position.salaryMin != null && !Number.isNaN(Number(position.salaryMin));
  const hasExplicitMax = position.salaryMax != null && !Number.isNaN(Number(position.salaryMax));
  const legacy = Number(position.salary) || 0;
  let min: number;
  let max: number;
  if (hasExplicitMin && hasExplicitMax) {
    min = Number(position.salaryMin);
    max = Number(position.salaryMax);
  } else {
    min = hasExplicitMin ? Number(position.salaryMin) : legacy;
    max = hasExplicitMax ? Number(position.salaryMax) : legacy;
  }
  if (Number.isNaN(min) || Number.isNaN(max) || max <= 0) return null;
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const amount = Number(baseSalary);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (amount < low || amount > high) {
    const title = String(position.title ?? '').trim();
    const role = title ? ` for ${title}` : ' for this position';
    return `Base salary must be between ${low} and ${high}${role}.`;
  }
  return null;
}

export async function validateEmployeeSalaryForPosition(
  positionId: string | null | undefined,
  baseSalary: number | null | undefined
): Promise<string | null> {
  const pid = String(positionId ?? '').trim();
  if (!pid) return null;
  const amount = Number(baseSalary);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const pos: any = await Position.findByPk(pid);
  if (!pos) return null;
  const plain = pos?.toJSON ? pos.toJSON() : { ...pos };
  const normalized = normalizePositionRow(plain);
  return salaryOutOfPositionRangeMessage(amount, {
    salaryMin: Number(normalized.salaryMin),
    salaryMax: Number(normalized.salaryMax),
    salary: Number(normalized.salary),
    title: String(normalized.title ?? ''),
  });
}

export function normalizePositionRow(row: any): Record<string, unknown> {
  const plain = row?.toJSON ? row.toJSON() : { ...row };
  const departmentId = String(plain.departmentId ?? plain.department_id ?? '');
  const hasMin = plain.salary_min != null || plain.salaryMin != null;
  const hasMax = plain.salary_max != null || plain.salaryMax != null;
  const salaryMin = hasMin ? Number(plain.salary_min ?? plain.salaryMin) : 0;
  const salaryMax = hasMax ? Number(plain.salary_max ?? plain.salaryMax) : salaryMin;
  const legacy = hasMin ? salaryMin : salaryMax;
  const levelRaw = plain.level ?? null;
  const accessRoleRaw = plain.access_role ?? plain.accessRole ?? null;
  return {
    id: plain.id,
    title: plain.title,
    titleKh: positionTitleKhFromRow(plain),
    departmentId,
    level: levelRaw ? String(levelRaw) : null,
    accessRole: accessRoleRaw ? String(accessRoleRaw).toUpperCase() : 'EMPLOYEE',
    salaryMin: Number.isNaN(salaryMin) ? 0 : salaryMin,
    salaryMax: Number.isNaN(salaryMax) ? salaryMin : salaryMax,
    salary: legacy,
    description: plain.description ?? '',
    isActive: positionIsActiveFromRow(plain),
  };
}
