import { Op } from 'sequelize';
import { Employee, EmployeeReview, User } from './db.js';
import {
  inferOffboardSourceFromSeparation,
  normalizeOffboardSource,
  type OffboardSource,
} from './offboardSource.js';

export async function mapProbationFailSourcesByDisplayId(
  displayIds: string[]
): Promise<Map<string, OffboardSource>> {
  const out = new Map<string, OffboardSource>();
  const ids = [...new Set(displayIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return out;

  const employees: any[] = await Employee.findAll({
    where: { employee_id: { [Op.in]: ids } },
    attributes: ['id', 'employee_id'],
  });
  if (!employees.length) return out;

  const displayByPk = new Map<string, string>();
  const pkList: string[] = [];
  for (const emp of employees) {
    const pk = String(emp.id ?? '').trim();
    const displayId = String(emp.employee_id ?? '').trim();
    if (!pk || !displayId) continue;
    displayByPk.set(pk, displayId);
    pkList.push(pk);
  }
  if (!pkList.length) return out;

  const users: any[] = await User.findAll({
    where: { employeeId: { [Op.in]: pkList } },
    attributes: ['id', 'employeeId'],
  });
  if (!users.length) return out;

  const displayByUserId = new Map<string, string>();
  const userIds: string[] = [];
  for (const user of users) {
    const userId = String(user.id ?? '').trim();
    const displayId = displayByPk.get(String(user.employeeId ?? '').trim());
    if (!userId || !displayId) continue;
    displayByUserId.set(userId, displayId);
    userIds.push(userId);
  }
  if (!userIds.length) return out;

  const reviews: any[] = await EmployeeReview.findAll({
    where: {
      userId: { [Op.in]: userIds },
      reviewType: 'PROBATION',
      status: 'FAILED',
      recommendation: 'FAIL',
    },
    attributes: ['userId'],
  });

  for (const review of reviews) {
    const displayId = displayByUserId.get(String(review.userId ?? '').trim());
    if (displayId) out.set(displayId, 'probation');
  }

  return out;
}

export function resolveRowOffboardSource(
  row: Record<string, unknown>,
  probationSources: Map<string, OffboardSource>,
  options?: { defaultInProgress?: OffboardSource }
): OffboardSource | null {
  const stored = normalizeOffboardSource(row.offboard_source);
  if (stored) return stored;

  const separation = inferOffboardSourceFromSeparation(row.separation_type);
  if (separation) return separation;

  const displayId = String(row.employee_id ?? '').trim();
  if (displayId && probationSources.has(displayId)) {
    return probationSources.get(displayId)!;
  }

  if (options?.defaultInProgress) return options.defaultInProgress;
  return null;
}

export function attachOffboardSource(
  row: Record<string, unknown>,
  probationSources: Map<string, OffboardSource>,
  options?: { defaultInProgress?: OffboardSource }
): Record<string, unknown> {
  const source = resolveRowOffboardSource(row, probationSources, options);
  return source ? { ...row, offboard_source: source } : row;
}
