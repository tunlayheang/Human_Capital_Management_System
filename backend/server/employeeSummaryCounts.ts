import { Op } from 'sequelize';
import { Employee, User, sequelize } from './db.js';
import { applyEmployeeTextSearch } from './employeeSearch.js';
import { applyEffectiveEmployeeStatusFilter } from './employeeListFilters.js';

type SummaryQuery = {
  search?: string;
  department_id?: string;
  role?: string;
};

function cloneWhere(base: Record<string, unknown>): Record<string, unknown> {
  const andKey = Op.and as unknown as string;
  const cloned: Record<string, unknown> = { ...base };
  if (Array.isArray(base[andKey])) {
    cloned[andKey] = [...(base[andKey] as unknown[])];
  }
  return cloned;
}

async function buildSummaryBaseWhere(
  query: SummaryQuery
): Promise<{ where: Record<string, unknown>; empty: boolean }> {
  const where: Record<string, unknown> = {};

  if (query.search) {
    applyEmployeeTextSearch(where, query.search);
  }

  if (query.department_id) {
    where.department_id = query.department_id;
  }

  if (query.role) {
    const roleName = String(query.role).trim().toUpperCase();
    if (roleName === 'ADMIN' || roleName === 'SUPER_ADMIN') {
      return { where, empty: true };
    }
    const usersWithRole = await User.findAll({
      where: { role: roleName },
      attributes: ['email'],
    });
    const emails = usersWithRole.map((u: { email?: string }) => u.email).filter(Boolean);
    if (!emails.length) return { where, empty: true };
    where.email = { [Op.in]: emails };
  }

  const { listSystemAdminEmployeeExclusions } = await import('./systemAdminAccount.js');
  const adminExclusions = await listSystemAdminEmployeeExclusions();
  const exclusionClauses: Record<string, unknown>[] = [];
  if (adminExclusions.employeeIds.length) {
    exclusionClauses.push({ id: { [Op.notIn]: adminExclusions.employeeIds } });
  }
  if (adminExclusions.emails.length) {
    exclusionClauses.push({
      [Op.or as unknown as string]: [
        { email: { [Op.notIn]: adminExclusions.emails } },
        { email: { [Op.is]: null } },
        { email: '' },
      ],
    });
  }
  if (exclusionClauses.length) {
    const priorAnd = where[Op.and as unknown as string]
      ? [...(where[Op.and as unknown as string] as unknown[])]
      : [];
    where[Op.and as unknown as string] = [...priorAnd, ...exclusionClauses];
  }

  return { where, empty: false };
}

/**
 * Org-wide Onboarding cards — same effective status rules as GET /employees filters.
 * Total = Active + Draft + Inactive. Active excludes placeholder emails +
 * offboarding-in-progress (those count as Inactive).
 */
type EmployeeSummaryCounts = {
  total: number;
  active: number;
  draft: number;
  inactive: number;
  probation: number;
};

const summaryCountCache = new Map<string, { at: number; value: EmployeeSummaryCounts }>();
const SUMMARY_COUNT_TTL_MS = 30_000;

async function computeEmployeeSummaryCounts(
  rawQuery: Record<string, unknown>
): Promise<EmployeeSummaryCounts> {
  const query: SummaryQuery = {
    search: rawQuery.search ? String(rawQuery.search) : undefined,
    department_id: rawQuery.department_id ? String(rawQuery.department_id) : undefined,
    role: rawQuery.role ? String(rawQuery.role) : undefined,
  };

  const { where: baseWhere, empty } = await buildSummaryBaseWhere(query);
  if (empty) {
    return { total: 0, active: 0, draft: 0, inactive: 0, probation: 0 };
  }

  const { probationInFilterSqlLiterals } = await import('./probationService.js');
  const probationClauses = [
    ...probationInFilterSqlLiterals().map((clause) => sequelize.literal(clause)),
    sequelize.literal("email IS NOT NULL AND TRIM(email) != ''"),
    sequelize.literal("LOWER(email) NOT LIKE '%@pending.iroc'"),
  ];
  const probationWhere = cloneWhere(baseWhere);
  const andKey = Op.and as unknown as string;
  probationWhere[andKey] = [
    ...((probationWhere[andKey] as unknown[]) || []),
    ...probationClauses,
  ];

  const activeWhere = cloneWhere(baseWhere);
  applyEffectiveEmployeeStatusFilter(activeWhere, 'active');

  const draftWhere = cloneWhere(baseWhere);
  applyEffectiveEmployeeStatusFilter(draftWhere, 'draft');

  const inactiveWhere = cloneWhere(baseWhere);
  applyEffectiveEmployeeStatusFilter(inactiveWhere, 'inactive');

  const [active, draft, inactive, probation] = await Promise.all([
    Employee.count({ where: activeWhere }),
    Employee.count({ where: draftWhere }),
    Employee.count({ where: inactiveWhere }),
    Employee.count({ where: probationWhere }),
  ]);

  // Total = all primary status buckets (Active + Draft + Inactive).
  const total = active + draft + inactive;

  return { total, active, draft, inactive, probation };
}

export async function getEmployeeSummaryCounts(rawQuery: Record<string, unknown>) {
  const cacheKey = JSON.stringify({
    search: rawQuery.search ? String(rawQuery.search) : '',
    department_id: rawQuery.department_id ? String(rawQuery.department_id) : '',
    role: rawQuery.role ? String(rawQuery.role) : '',
  });
  const cached = summaryCountCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SUMMARY_COUNT_TTL_MS) {
    return cached.value;
  }
  const value = await computeEmployeeSummaryCounts(rawQuery);
  summaryCountCache.set(cacheKey, { at: Date.now(), value });
  return value;
}
