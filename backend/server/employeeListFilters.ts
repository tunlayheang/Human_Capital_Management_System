import { Op } from 'sequelize';
import { Department, User, sequelize } from './db.js';

const OFFBOARDED_STATUSES = ['terminated', 'resigned', 'absconded', 'retired', 'inactive'];

/** SQL fragment: employee has an open offboarding settlement / pending settlement link. */
export function offboardingInProgressSql(alias = 'Employee'): string {
  return `(
    (
      \`${alias}\`.\`offboard_pending_settlement_id\` IS NOT NULL
      AND TRIM(\`${alias}\`.\`offboard_pending_settlement_id\`) != ''
    )
    OR EXISTS (
      SELECT 1 FROM \`finalsettlementruns\` fsr
      WHERE fsr.\`employee_id\` = \`${alias}\`.\`id\`
        AND UPPER(COALESCE(fsr.\`status\`, '')) NOT IN ('PAID', 'REJECTED', 'LOCKED')
      LIMIT 1
    )
  )`;
}

function isDraftEmailSql(alias = 'Employee'): string {
  return `LOWER(COALESCE(\`${alias}\`.\`email\`, '')) LIKE '%@pending.iroc'`;
}

function pushAnd(where: Record<string, unknown>, clause: unknown) {
  const prior = where[Op.and as unknown as string]
    ? [...(where[Op.and as unknown as string] as unknown[])]
    : [];
  where[Op.and as unknown as string] = [...prior, clause];
}

/**
 * Align list `status=` filter with UI badges / Onboarding cards:
 * - Draft: draft / profile_incomplete / @pending.iroc, excluding offboarded + in-progress offboarding
 * - Active: active, not draft-email, not offboarding-in-progress
 * - Inactive: inactive/terminated/resigned OR offboarding-in-progress
 * - (empty / Total): Active + Draft + Inactive — same population as summary Total card
 */
function draftStatusClause(): Record<string, unknown> {
  return {
    [Op.and]: [
      {
        [Op.or]: [
          { status: { [Op.in]: ['draft', 'profile_incomplete'] } },
          sequelize.literal(isDraftEmailSql()),
        ],
      },
      // Offboarded drafts must stay under Inactive, not Draft.
      {
        status: {
          [Op.notIn]: [...OFFBOARDED_STATUSES, 'suspended'],
        },
      },
      sequelize.literal(`NOT (${offboardingInProgressSql()})`),
    ],
  };
}

function activeStatusClause(): Record<string, unknown> {
  return {
    [Op.and]: [
      { status: 'active' },
      sequelize.literal(`NOT (${isDraftEmailSql()})`),
      sequelize.literal(`NOT (${offboardingInProgressSql()})`),
    ],
  };
}

function inactiveStatusClause(statusKey: 'inactive' | 'offboarded' | 'archived'): Record<string, unknown> {
  const statusList =
    statusKey === 'inactive' ? ['inactive', 'terminated', 'resigned'] : OFFBOARDED_STATUSES;
  return {
    [Op.or]: [
      { status: { [Op.in]: statusList } },
      sequelize.literal(`(
          LOWER(COALESCE(\`Employee\`.\`status\`, '')) NOT IN (${OFFBOARDED_STATUSES.map(
            (s) => `'${s}'`
          ).join(',')})
          AND ${offboardingInProgressSql()}
        )`),
    ],
  };
}

export function applyEffectiveEmployeeStatusFilter(
  where: Record<string, unknown>,
  statusRaw: unknown
): void {
  const statusKey = String(statusRaw ?? '')
    .trim()
    .toLowerCase();
  if (!statusKey) {
    // Total Employees card: include every row counted by Active + Draft + Inactive.
    pushAnd(where, {
      [Op.or]: [activeStatusClause(), draftStatusClause(), inactiveStatusClause('inactive')],
    });
    return;
  }

  if (statusKey === 'draft') {
    pushAnd(where, draftStatusClause());
    return;
  }

  if (statusKey === 'active') {
    pushAnd(where, activeStatusClause());
    return;
  }

  if (statusKey === 'inactive' || statusKey === 'offboarded' || statusKey === 'archived') {
    pushAnd(where, inactiveStatusClause(statusKey));
    return;
  }

  where.status = statusKey;
}

/** Filter by department.office_location_id (attendance office zone), not employees.work_location. */
export async function applyOfficeLocationFilter(
  where: Record<string, unknown>,
  officeLocationId: unknown
): Promise<'ok' | 'empty'> {
  const officeId = String(officeLocationId ?? '').trim();
  if (!officeId) return 'ok';

  const depts = await Department.findAll({
    where: { office_location_id: officeId },
    attributes: ['id'],
  });
  const deptIds = depts.map((d) => String(d.get('id') ?? '')).filter(Boolean);
  if (!deptIds.length) return 'empty';

  const existingDept = where.department_id;
  if (existingDept != null && existingDept !== '') {
    const wanted = String(existingDept);
    if (!deptIds.includes(wanted)) return 'empty';
    where.department_id = wanted;
    return 'ok';
  }

  where.department_id = { [Op.in]: deptIds };
  return 'ok';
}

/**
 * Portal role filter. Matches User by employeeId or email.
 * EMPLOYEE also includes employees with no portal account (UI defaults those to Staff).
 */
export async function applyPortalRoleFilter(
  where: Record<string, unknown>,
  roleRaw: unknown
): Promise<'ok' | 'empty'> {
  const roleName = String(roleRaw ?? '')
    .trim()
    .toUpperCase();
  if (!roleName) return 'ok';
  if (roleName === 'ADMIN' || roleName === 'SUPER_ADMIN') return 'empty';

  const usersWithRole = await User.findAll({
    where: { role: roleName },
    attributes: ['email', 'employeeId'],
  });

  const emailsLower = [
    ...new Set(
      usersWithRole
        .map((u) => String((u as { email?: string }).email ?? '').trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
  const employeePks = [
    ...new Set(
      usersWithRole
        .map((u) => String((u as { employeeId?: string }).employeeId ?? '').trim())
        .filter(Boolean)
    ),
  ];

  const matchClauses: Record<string, unknown>[] = [];
  if (emailsLower.length) {
    matchClauses.push(
      sequelize.literal(
        `LOWER(COALESCE(\`Employee\`.\`email\`, '')) IN (${emailsLower
          .map((e) => sequelize.escape(e))
          .join(', ')})`
      )
    );
  }
  if (employeePks.length) {
    matchClauses.push({ id: { [Op.in]: employeePks } });
  }

  if (roleName === 'EMPLOYEE') {
    matchClauses.push(
      sequelize.literal(`NOT EXISTS (
        SELECT 1 FROM \`users\` u
        WHERE (
          u.\`employeeId\` IS NOT NULL AND u.\`employeeId\` = \`Employee\`.\`id\`
        ) OR (
          u.\`email\` IS NOT NULL AND TRIM(u.\`email\`) != ''
          AND LOWER(u.\`email\`) = LOWER(COALESCE(\`Employee\`.\`email\`, ''))
        )
      )`)
    );
  }

  if (!matchClauses.length) return 'empty';
  pushAnd(where, { [Op.or]: matchClauses });
  return 'ok';
}
