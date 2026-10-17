import { QueryTypes } from 'sequelize';
import { EmployeeMovement, sequelize } from '../db.js';

/** Movement statuses that should not count as a recorded follow-up. */
export const EXCLUDED_MOVEMENT_LINK_STATUSES = ['draft', 'rejected', 'cancelled'] as const;

/** Movement types that can satisfy a KPI appraisal follow-up. */
const KPI_FOLLOW_UP_MOVEMENT_TYPES = [
  'promotion',
  'salary_update',
  'salary_adjustment',
  'salary_increase',
  'transfer',
  'position_change',
  'department_change',
] as const;

export const LINKED_MOVEMENT_COUNT_SQL = `COALESCE(mov.linkedMovementCount, 0)`;

/** Aggregate join — prefer this over a correlated COUNT subquery on list reads. */
export const LINKED_MOVEMENT_COUNT_JOIN = `
  LEFT JOIN (
    SELECT em.source_appraisal_id AS appraisal_id, COUNT(*) AS linkedMovementCount
    FROM employee_movements em
    WHERE em.source_appraisal_id IS NOT NULL
      AND LOWER(COALESCE(em.status, '')) NOT IN ('draft', 'rejected', 'cancelled')
    GROUP BY em.source_appraisal_id
  ) mov ON mov.appraisal_id = ea.id
`;

function isExcludedMovementStatus(status: unknown): boolean {
  const s = String(status ?? '').toLowerCase();
  return (EXCLUDED_MOVEMENT_LINK_STATUSES as readonly string[]).includes(s);
}

function isKpiFollowUpMovementType(type: unknown): boolean {
  const t = String(type ?? '').toLowerCase();
  return (KPI_FOLLOW_UP_MOVEMENT_TYPES as readonly string[]).includes(t);
}

export async function findAppraisalAwaitingMovement(opts: {
  employeePk: string;
  employeeId: string;
  periodId?: string | null;
  movementCreatedAt?: string | null;
}): Promise<string | null> {
  const employeePk = String(opts.employeePk ?? '').trim();
  const employeeId = String(opts.employeeId ?? '').trim();
  if (!employeePk && !employeeId) return null;

  const rows = (await sequelize.query(
    `SELECT ea.id
     FROM employee_appraisals ea
     JOIN users u ON u.id = ea.user_id
     LEFT JOIN employees e ON e.id = u.employeeId
     WHERE ea.workflow_status IN ('APPROVED', 'CLOSED')
       AND (
         (:employeePk <> '' AND e.id = :employeePk)
         OR (:employeeId <> '' AND e.employee_id = :employeeId)
       )
       AND NOT EXISTS (
         SELECT 1 FROM employee_movements em
         WHERE em.source_appraisal_id = ea.id
           AND LOWER(COALESCE(em.status, '')) NOT IN ('draft', 'rejected', 'cancelled')
       )
       AND (:periodId IS NULL OR :periodId = '' OR ea.period_id = :periodId)
       AND (
         :movementCreatedAt IS NULL
         OR :movementCreatedAt = ''
         OR COALESCE(ea.final_approved_at, ea.hr_approved_at, ea.updated_at) <= :movementCreatedAt
       )
     ORDER BY COALESCE(ea.final_approved_at, ea.hr_approved_at, ea.updated_at) DESC
     LIMIT 1`,
    {
      replacements: {
        employeePk,
        employeeId,
        periodId: opts.periodId?.trim() || null,
        movementCreatedAt: opts.movementCreatedAt?.trim() || null,
      },
      type: QueryTypes.SELECT,
    }
  )) as Array<{ id?: string }>;

  const id = rows[0]?.id ? String(rows[0].id).trim() : '';
  return id || null;
}

export async function tryAutoLinkMovementToAppraisal(
  movementId: string,
  opts?: { periodId?: string | null }
): Promise<boolean> {
  const id = String(movementId ?? '').trim();
  if (!id) return false;

  const row: any = await EmployeeMovement.findByPk(id);
  if (!row) return false;

  const plain = row.get({ plain: true });
  if (plain.source_appraisal_id || plain.source_probation_review_id) return false;
  if (isExcludedMovementStatus(plain.status)) return false;
  if (!isKpiFollowUpMovementType(plain.movement_type)) return false;

  const appraisalId = await findAppraisalAwaitingMovement({
    employeePk: String(plain.employee_pk ?? ''),
    employeeId: String(plain.employee_id ?? ''),
    periodId: opts?.periodId ?? null,
    movementCreatedAt: plain.created_at ? String(plain.created_at) : null,
  });
  if (!appraisalId) return false;

  await row.update({ source_appraisal_id: appraisalId });
  return true;
}

/** Link orphan movements to finalized appraisals still awaiting follow-up. */
export async function reconcileAppraisalMovementLinks(opts?: {
  periodId?: string | null;
}): Promise<number> {
  const periodId = opts?.periodId?.trim() || null;
  const typeList = KPI_FOLLOW_UP_MOVEMENT_TYPES.map((t) => `'${t}'`).join(', ');
  const statusList = EXCLUDED_MOVEMENT_LINK_STATUSES.map((s) => `'${s}'`).join(', ');

  const orphanRows = (await sequelize.query(
    `SELECT em.id
     FROM employee_movements em
     WHERE em.source_appraisal_id IS NULL
       AND em.source_probation_review_id IS NULL
       AND LOWER(COALESCE(em.status, '')) NOT IN (${statusList})
       AND LOWER(COALESCE(em.movement_type, '')) IN (${typeList})
     ORDER BY em.created_at ASC`,
    { type: QueryTypes.SELECT }
  )) as Array<{ id?: string }>;

  let linked = 0;
  for (const orphan of orphanRows) {
    const movementId = orphan.id ? String(orphan.id).trim() : '';
    if (!movementId) continue;
    const didLink = await tryAutoLinkMovementToAppraisal(movementId, { periodId });
    if (didLink) linked += 1;
  }
  return linked;
}
