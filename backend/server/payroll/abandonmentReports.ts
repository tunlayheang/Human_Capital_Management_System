import { Op } from 'sequelize';
import { Employee } from '../db.js';
import { EmployeeAbandonmentCase, PayrollDeductionAuthorization } from './abandonmentSchema.js';
import { FinalSettlementRun } from './finalSettlementSchema.js';

export async function reportAbscondedEmployees() {
  const employees = await Employee.findAll({
    where: { status: 'absconded' },
    order: [['updated_at', 'DESC']],
    limit: 500,
  });
  return employees.map((e) => e.get({ plain: true }));
}

export async function reportResignationWithoutNotice() {
  const employees = await Employee.findAll({
    where: {
      [Op.or]: [
        { separation_type: 'resignation_without_notice' },
        { offboard_type: 'resignation_without_notice' },
      ],
    },
    order: [['updated_at', 'DESC']],
    limit: 500,
  });
  return employees.map((e) => e.get({ plain: true }));
}

export async function reportConsecutiveAbsenceAlerts() {
  const cases = await EmployeeAbandonmentCase.findAll({
    where: {
      caseStatus: { [Op.in]: ['POTENTIAL_ABANDONMENT', 'UNDER_INVESTIGATION', 'MONITORING'] },
    },
    order: [['flaggedAt', 'DESC']],
    limit: 500,
  });
  return cases.map((c) => c.get({ plain: true }));
}

export async function reportFinalSettlementSummary() {
  const rows = await FinalSettlementRun.findAll({
    order: [['createdAt', 'DESC']],
    limit: 500,
  });
  return rows.map((r) => r.get({ plain: true }));
}

export async function reportOutstandingDeductions() {
  const rows = await PayrollDeductionAuthorization.findAll({
    where: { status: { [Op.in]: ['PENDING_APPROVAL', 'APPROVED'] } },
    order: [['createdAt', 'DESC']],
    limit: 500,
  });
  return rows.map((r) => r.get({ plain: true }));
}
