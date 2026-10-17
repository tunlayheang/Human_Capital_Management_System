import { Op } from 'sequelize';

const OFFBOARDED_EMPLOYEE_STATUSES = ['terminated', 'resigned', 'absconded', 'retired', 'inactive'];
const CLOSED_SETTLEMENT_STATUSES = ['PAID', 'REJECTED', 'LOCKED'];

export type OffboardingWorkflowFields = {
  offboarding_in_progress?: boolean;
  offboarding_settlement_status?: string | null;
};

export async function attachOffboardingWorkflowToEmployeeRows<T extends Record<string, unknown>>(
  rows: T[]
): Promise<Array<T & OffboardingWorkflowFields>> {
  const pks = rows.map((r) => String(r.id ?? '').trim()).filter(Boolean);
  if (!pks.length) return rows;

  const { FinalSettlementRun } = await import('./payroll/finalSettlementSchema.js');
  const settlements = await FinalSettlementRun.findAll({
    where: {
      employee_id: { [Op.in]: pks },
      status: { [Op.notIn]: CLOSED_SETTLEMENT_STATUSES },
    },
    attributes: ['employee_id', 'status'],
    order: [['updatedAt', 'DESC']],
  });

  const statusByPk = new Map<string, string>();
  for (const row of settlements) {
    const pk = String(row.get('employee_id') ?? '').trim();
    if (!pk || statusByPk.has(pk)) continue;
    statusByPk.set(pk, String(row.get('status') ?? 'DRAFT').toUpperCase());
  }

  return rows.map((row) => {
    const pk = String(row.id ?? '').trim();
    const employeeStatus = String(row.status ?? '')
      .trim()
      .toLowerCase();
    const settlementStatus = statusByPk.get(pk) ?? null;
    const pendingSettlementId = String(row.offboard_pending_settlement_id ?? '').trim();
    const alreadyOffboarded = OFFBOARDED_EMPLOYEE_STATUSES.includes(employeeStatus);
    const inProgress = !alreadyOffboarded && (Boolean(settlementStatus) || Boolean(pendingSettlementId));

    return {
      ...row,
      offboarding_in_progress: inProgress,
      offboarding_settlement_status: settlementStatus,
    };
  });
}

export const OFFBOARDING_IN_PROGRESS_EMPLOYEE_STATUSES = [
  'active',
  'pending_approval',
  'draft',
  'suspended',
  'profile_incomplete',
];
