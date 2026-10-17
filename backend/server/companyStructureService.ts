import { Department, Employee, Position } from './db.js';
import { listActiveOfficeLocations } from './attendanceSettings.js';
import { ACTIVE_EMPLOYEE_STATUS } from './dashboardChartStats.js';
import { hasAssignedEmployeeDisplayId } from './employeeDirectoryEligibility.js';
import { joinEmployeeNameParts } from './employeeDisplayName.js';
import { toCanonicalEmployeeDisplayId } from './employeeIdFormat.js';
import { listSystemAdminEmployeeExclusions } from './systemAdminAccount.js';
import { positionLevelLabel, structureTierForLevelCode, tierForLevelCode } from './positionCatalog.js';
import { loadPositionLevelsFromDb } from './positionLevelSettingsService.js';

export type StructureTier = 'manager' | 'officer' | 'staff';

export type CompanyStructureMember = {
  id: string;
  employeeCode: string;
  name: string;
  nameKh?: string;
  positionTitle: string;
  positionTitleKh?: string;
  levelLabel: string;
  levelTier: number;
  tier: StructureTier;
  avatarUrl: string | null;
};

export type CompanyStructureTierGroup = {
  manager: CompanyStructureMember[];
  officer: CompanyStructureMember[];
  staff: CompanyStructureMember[];
};

export type CompanyStructureDepartmentNode = {
  id: string;
  name: string;
  nameKh?: string;
  children: CompanyStructureDepartmentNode[];
  tiers: CompanyStructureTierGroup;
};

export type CompanyStructureOfficeNode = {
  id: string;
  name: string;
  departments: CompanyStructureDepartmentNode[];
};

export type CompanyStructurePayload = {
  offices: CompanyStructureOfficeNode[];
  unassigned: CompanyStructureTierGroup;
  totals: { offices: number; departments: number; employees: number };
};

const EMPTY_TIERS = (): CompanyStructureTierGroup => ({
  manager: [],
  officer: [],
  staff: [],
});

export function classifyStructureTier(level: string | null | undefined): StructureTier {
  return structureTierForLevelCode(level);
}

function pushMember(tiers: CompanyStructureTierGroup, member: CompanyStructureMember): void {
  tiers[member.tier].push(member);
}

function sortMembers(tiers: CompanyStructureTierGroup): void {
  const byRankThenName = (a: CompanyStructureMember, b: CompanyStructureMember) =>
    a.levelTier - b.levelTier ||
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  tiers.manager.sort(byRankThenName);
  tiers.officer.sort(byRankThenName);
  tiers.staff.sort(byRankThenName);
}

function sortDepartmentTree(node: CompanyStructureDepartmentNode): void {
  sortMembers(node.tiers);
  node.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  node.children.forEach(sortDepartmentTree);
}

function countMembers(tiers: CompanyStructureTierGroup): number {
  return tiers.manager.length + tiers.officer.length + tiers.staff.length;
}

/**
 * Org chart: Office (attendance settings) → Department (departments) → Employee
 * (employees.department_id) with Position (employees.position_id) for title/level.
 *
 * Departments are org-wide (`office_location_id` is legacy and cleared on write),
 * so every department is attached under the active office node(s).
 */
export async function buildCompanyStructure(): Promise<CompanyStructurePayload> {
  await loadPositionLevelsFromDb();

  const [offices, departments, employees, adminExclusions] = await Promise.all([
    listActiveOfficeLocations(),
    Department.findAll({
      attributes: ['id', 'name', 'name_kh'],
      order: [['name', 'ASC']],
    }),
    Employee.findAll({
      where: { status: ACTIVE_EMPLOYEE_STATUS },
      attributes: [
        'id',
        'employee_id',
        'email',
        'first_name',
        'last_name',
        'first_name_kh',
        'last_name_kh',
        'department_id',
        'position_id',
        'avatar_url',
      ],
      include: [
        {
          model: Department,
          as: 'department',
          attributes: ['id', 'name', 'name_kh'],
          required: false,
        },
        {
          model: Position,
          as: 'position',
          attributes: ['id', 'title', 'title_kh', 'level', 'department_id'],
          required: false,
        },
      ],
      order: [
        ['last_name', 'ASC'],
        ['first_name', 'ASC'],
      ],
    }),
    listSystemAdminEmployeeExclusions(),
  ]);

  const exclusionIds = new Set(adminExclusions.employeeIds.map(String));
  const exclusionEmails = new Set(adminExclusions.emails.map((e) => e.toLowerCase()));

  const deptPlain = departments.map((d) => d.get({ plain: true }) as Record<string, unknown>);
  const deptById = new Map(deptPlain.map((d) => [String(d.id), d]));

  const employeesByDept = new Map<string, CompanyStructureMember[]>();

  for (const row of employees) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const id = String(plain.id ?? '');
    if (!id || exclusionIds.has(id)) continue;
    if (!hasAssignedEmployeeDisplayId(plain)) continue;
    const email = String(plain.email ?? '').trim().toLowerCase();
    if (email && exclusionEmails.has(email)) continue;

    const pos = (plain.position ?? {}) as Record<string, unknown>;
    const levelRaw = pos.level != null ? String(pos.level) : null;
    const tier = classifyStructureTier(levelRaw);
    const name = joinEmployeeNameParts(
      String(plain.first_name ?? ''),
      String(plain.last_name ?? '')
    );
    const nameKh = joinEmployeeNameParts(
      String(plain.first_name_kh ?? ''),
      String(plain.last_name_kh ?? '')
    );
    const badge =
      toCanonicalEmployeeDisplayId(plain.employee_id) || String(plain.employee_id ?? id);

    const member: CompanyStructureMember = {
      id,
      employeeCode: badge,
      name: name || badge,
      nameKh: nameKh || undefined,
      positionTitle: String(pos.title ?? '').trim() || '—',
      positionTitleKh: String(pos.title_kh ?? '').trim() || undefined,
      levelLabel: levelRaw ? positionLevelLabel(levelRaw) : '',
      levelTier: tierForLevelCode(levelRaw),
      tier,
      avatarUrl: plain.avatar_url ? String(plain.avatar_url) : null,
    };

    // Prefer the live department FK; fall back to position.department_id when the
    // employee row points at a missing department. Unknown ids → unassigned.
    const linkedDept = plain.department as Record<string, unknown> | null | undefined;
    const fromEmployee = String(plain.department_id ?? '').trim();
    const fromPosition = String(pos.department_id ?? '').trim();
    let bucket = '__none__';
    if (fromEmployee && deptById.has(fromEmployee)) {
      bucket = fromEmployee;
    } else if (linkedDept?.id && deptById.has(String(linkedDept.id))) {
      bucket = String(linkedDept.id);
    } else if (fromPosition && deptById.has(fromPosition)) {
      bucket = fromPosition;
    }

    const list = employeesByDept.get(bucket) ?? [];
    list.push(member);
    employeesByDept.set(bucket, list);
  }

  const buildDeptNode = (deptId: string): CompanyStructureDepartmentNode => {
    const dept = deptById.get(deptId);
    const name = String(dept?.name ?? 'Department');
    const nameKh = String(dept?.name_kh ?? '').trim() || undefined;
    const tiers = EMPTY_TIERS();
    for (const m of employeesByDept.get(deptId) ?? []) pushMember(tiers, m);
    return { id: deptId, name, nameKh, children: [], tiers };
  };

  const allDeptIds = new Set(deptPlain.map((d) => String(d.id)));
  const buildAllDepartments = () => {
    const nodes = [...allDeptIds].map((id) => buildDeptNode(id));
    nodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    nodes.forEach(sortDepartmentTree);
    return nodes;
  };

  const officeNodes: CompanyStructureOfficeNode[] = offices.length
    ? offices.map((office) => ({
        id: office.id,
        name: office.name,
        departments: buildAllDepartments(),
      }))
    : [
        {
          id: '__organization__',
          name: 'Organization',
          departments: buildAllDepartments(),
        },
      ];

  const unassigned = EMPTY_TIERS();
  for (const m of employeesByDept.get('__none__') ?? []) pushMember(unassigned, m);
  sortMembers(unassigned);

  // When multiple offices are shown, department nodes are duplicated per office —
  // count departments/employees once from the first office (or Organization).
  const departmentCount = officeNodes[0]?.departments.length ?? 0;
  let employeeCount = 0;
  for (const d of officeNodes[0]?.departments ?? []) {
    employeeCount += countMembers(d.tiers);
  }
  employeeCount += countMembers(unassigned);

  return {
    offices: officeNodes,
    unassigned,
    totals: {
      offices: officeNodes.length,
      departments: departmentCount,
      employees: employeeCount,
    },
  };
}
