import { Department, Employee, Position, User } from './db.js';
import { DEFAULT_POSITION_LEVELS } from './positionLevelDefaults.js';
import { loadPositionLevelsFromDb } from './positionLevelSettingsService.js';

const ROLE_RANK: Record<string, number> = {
  SUPER_ADMIN: 0,
  ADMIN: 10,
  HR: 20,
  MANAGER: 30,
  EMPLOYEE: 40,
};

const DEFAULT_LEVEL_SORT = Object.fromEntries(
  DEFAULT_POSITION_LEVELS.map((level) => [level.code, level.tier ?? level.sortOrder])
) as Record<string, number>;

function titleTierRank(title: string | null | undefined): number {
  const t = String(title ?? '').toLowerCase();
  if (/\b(chief|cto|ceo|cfo|coo|president)\b/.test(t)) return 5;
  if (/\b(director|vp|vice president)\b/.test(t)) return 15;
  if (/\b(head|lead)\b/.test(t)) return 25;
  if (/\bsenior\b/.test(t)) return 35;
  return 50;
}

function levelTierRank(
  levelCode: string | null | undefined,
  levelCatalog: { code: string; sortOrder: number; tier?: number }[]
): number {
  const code = String(levelCode ?? '').trim().toUpperCase();
  if (!code) return 500;
  const hit = levelCatalog.find((row) => row.code === code);
  return hit?.tier ?? hit?.sortOrder ?? DEFAULT_LEVEL_SORT[code] ?? 500;
}

export type ApproverTierInput = {
  role?: string | null;
  levelCode?: string | null;
  positionTitle?: string | null;
  isDepartmentHead?: boolean;
};

/** Lower score = higher organizational tier (approves earlier in the chain). */
export function computeApproverTierRank(
  input: ApproverTierInput,
  levelCatalog = DEFAULT_POSITION_LEVELS
): number {
  const role = ROLE_RANK[String(input.role ?? 'EMPLOYEE').trim().toUpperCase()] ?? 50;
  const level = levelTierRank(input.levelCode, levelCatalog);
  const title = titleTierRank(input.positionTitle);
  const head = input.isDepartmentHead ? -5 : 0;
  return role * 100_000 + level * 1_000 + title + head;
}

async function tierRankForUserId(
  userId: string,
  levelCatalog: { code: string; sortOrder: number }[],
  deptHeadUserIds: Set<string>
): Promise<number> {
  const user = await User.findByPk(userId, { attributes: ['id', 'role', 'employeeId'] });
  if (!user) return 9_999_999;

  const plain = user.get({ plain: true }) as Record<string, unknown>;
  const role = String(plain.role ?? 'EMPLOYEE');
  const empPk = String(plain.employeeId ?? '').trim();

  if (!empPk) {
    return computeApproverTierRank({ role, isDepartmentHead: deptHeadUserIds.has(userId) }, levelCatalog);
  }

  const employee = await Employee.findByPk(empPk, {
    attributes: ['id', 'department_id', 'position_id'],
    include: [{ model: Position, as: 'position', attributes: ['title', 'level'], required: false }],
  });
  if (!employee) {
    return computeApproverTierRank({ role, isDepartmentHead: deptHeadUserIds.has(userId) }, levelCatalog);
  }

  const empPlain = employee.get({ plain: true }) as Record<string, unknown>;
  const pos = (empPlain.position ?? {}) as Record<string, unknown>;
  return computeApproverTierRank(
    {
      role,
      levelCode: pos.level != null ? String(pos.level) : null,
      positionTitle: pos.title != null ? String(pos.title) : null,
      isDepartmentHead: deptHeadUserIds.has(userId),
    },
    levelCatalog
  );
}

/** Sort portal user ids from highest to lowest tier (first id approves first). */
export async function sortUserIdsByApproverTier(userIds: string[]): Promise<string[]> {
  const unique = [...new Set(userIds.map((id) => String(id ?? '').trim()).filter(Boolean))];
  if (unique.length <= 1) return unique;

  await loadPositionLevelsFromDb();
  const { getCachedPositionLevels } = await import('./positionLevelSettingsService.js');
  const levelCatalog = getCachedPositionLevels();

  const departments = await Department.findAll({
    attributes: ['managerId', 'department_head_id'],
    raw: true,
  });
  const deptHeadUserIds = new Set<string>();
  for (const dept of departments as { managerId?: string | null; department_head_id?: string | null }[]) {
    const head = String(dept.managerId ?? dept.department_head_id ?? '').trim();
    if (head) deptHeadUserIds.add(head);
  }

  const ranked = await Promise.all(
    unique.map(async (id) => ({
      id,
      rank: await tierRankForUserId(id, levelCatalog, deptHeadUserIds),
    }))
  );

  return ranked.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id)).map((row) => row.id);
}
