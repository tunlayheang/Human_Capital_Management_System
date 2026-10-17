import { Op } from 'sequelize';
import { Employee, User, sequelize } from './db.js';
import { isPlaceholderDraftEmail } from './employeeDraft.js';
import { normalizePhone, phoneLookupVariants } from './phoneUtils.js';
import { portalPhoneMatchWhere } from './portalUserPhone.js';
import { joinEmployeeNameParts } from './employeeDisplayName.js';

/** Case-insensitive email match (MariaDB/MySQL — no ILIKE). */
function emailEqualsClause(email: string) {
  return sequelize.where(sequelize.fn('LOWER', sequelize.col('email')), email);
}

export type EmployeeContactConflict = {
  field: 'email' | 'phone';
  message: string;
  usedBy?: string;
};

function employeeLabel(row: {
  employee_id?: string;
  first_name?: string;
  last_name?: string;
}): string {
  const name = joinEmployeeNameParts(row.first_name, row.last_name);
  const eid = String(row.employee_id ?? '').trim();
  if (name && eid) return `${name} (${eid})`;
  return name || eid || 'another employee';
}

function phonesMatch(a: unknown, b: unknown): boolean {
  const va = phoneLookupVariants(a);
  const vb = phoneLookupVariants(b);
  if (!va.length || !vb.length) return false;
  return va.some((x) => vb.includes(x));
}

async function resolveExcludeEmployee(excludeDisplayId?: string): Promise<{
  internalId: string | null;
  displayIds: string[];
}> {
  const displayId = String(excludeDisplayId ?? '').trim();
  if (!displayId) return { internalId: null, displayIds: [] };
  const { employeeDisplayIdLookupVariants, employeeLookupWhere } = await import(
    './employeeIdFormat.js'
  );
  const displayIds = employeeDisplayIdLookupVariants(displayId);
  const row = await Employee.findOne({
    where: employeeLookupWhere(displayId) as any,
    attributes: ['id', 'employee_id'],
  });
  if (!row) return { internalId: null, displayIds };
  const plain = row.get({ plain: true }) as { id?: string; employee_id?: string };
  const actual = String(plain.employee_id ?? '').trim();
  if (actual && !displayIds.includes(actual)) displayIds.push(actual);
  return { internalId: String(plain.id ?? '') || null, displayIds };
}

/** Check work email / phone are not already used by another employee or portal user. */
export async function findEmployeeContactConflicts(params: {
  email?: string;
  phone?: string;
  excludeEmployeeDisplayId?: string;
}): Promise<EmployeeContactConflict[]> {
  const conflicts: EmployeeContactConflict[] = [];
  const excludeDisplayId = String(params.excludeEmployeeDisplayId ?? '').trim();
  const { internalId: excludeInternalId, displayIds: excludeDisplayIds } =
    await resolveExcludeEmployee(excludeDisplayId);

  const email = String(params.email ?? '').trim().toLowerCase();
  if (email && !isPlaceholderDraftEmail(email)) {
    const employeeWhere: Record<string, unknown> = {};
    if (excludeDisplayIds.length) {
      employeeWhere.employee_id = { [Op.notIn]: excludeDisplayIds };
    }
    const emailRow = await Employee.findOne({
      where: { ...employeeWhere, [Op.and]: [emailEqualsClause(email)] },
      attributes: ['employee_id', 'first_name', 'last_name', 'email'],
    });
    if (emailRow) {
      conflicts.push({
        field: 'email',
        message: `Work email is already used by ${employeeLabel(emailRow.get({ plain: true }))}.`,
        usedBy: String(emailRow.get('employee_id') ?? ''),
      });
    } else {
      const user = await User.findOne({
        where: { [Op.and]: [emailEqualsClause(email)] },
        attributes: ['id', 'email', 'employeeId'],
      });
      if (user) {
        const uid = String((user as { employeeId?: string }).employeeId ?? '');
        if (!excludeInternalId || uid !== excludeInternalId) {
          conflicts.push({
            field: 'email',
            message: 'Work email is already used by another portal account.',
          });
        }
      }
    }
  }

  const phoneNorm = params.phone ? normalizePhone(params.phone) : '';
  if (phoneNorm.length >= 8) {
    const phoneWhere: Record<string, unknown> = {};
    if (excludeDisplayIds.length) {
      phoneWhere.employee_id = { [Op.notIn]: excludeDisplayIds };
    }
    const candidates = await Employee.findAll({
      where: phoneWhere,
      attributes: ['employee_id', 'first_name', 'last_name', 'phone'],
    });
    const phoneRow = candidates.find((row) =>
      phonesMatch(phoneNorm, (row as { phone?: string }).phone)
    );
    if (phoneRow) {
      const plain = phoneRow.get({ plain: true }) as {
        employee_id?: string;
        first_name?: string;
        last_name?: string;
      };
      conflicts.push({
        field: 'phone',
        message: `Phone number is already used by ${employeeLabel(plain)}.`,
        usedBy: String(plain.employee_id ?? ''),
      });
    } else {
      const portalPhoneWhere = portalPhoneMatchWhere(phoneNorm);
      const portalUser = portalPhoneWhere
        ? await User.findOne({
            where: portalPhoneWhere,
            attributes: ['id', 'employeeId', 'phone'],
          })
        : null;
      if (portalUser) {
        const linkedEmpId = String(portalUser.employeeId ?? '').trim();
        if (!excludeInternalId || linkedEmpId !== excludeInternalId) {
          conflicts.push({
            field: 'phone',
            message: 'Phone number is already used by another portal account.',
          });
        }
      }
    }
  }

  return conflicts;
}
