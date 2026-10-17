import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

export const SalaryStructureHistory = sequelize.define(
  'SalaryStructureHistory',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    employee_id: { type: DataTypes.STRING, allowNull: false },
    effective_from: { type: DataTypes.DATE, allowNull: false },
    snapshot_json: { type: DataTypes.TEXT('long'), allowNull: false },
    previous_snapshot_json: { type: DataTypes.TEXT('long'), allowNull: true },
    changed_by: { type: DataTypes.STRING, allowNull: true },
    change_reason: { type: DataTypes.STRING(500), allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    tableName: 'salary_structure_history',
    timestamps: false,
    indexes: [{ fields: ['employee_id'] }, { fields: ['effective_from'] }],
  }
);

export async function ensureSalaryStructureHistorySchema(): Promise<void> {
  await SalaryStructureHistory.sync();
}

export async function recordSalaryStructureChange(params: {
  employeeRowId: string;
  previous: Record<string, unknown> | null;
  next: Record<string, unknown>;
  changedBy?: string | null;
  changeReason?: string | null;
  effectiveFrom?: string | null;
}): Promise<void> {
  await ensureSalaryStructureHistorySchema();
  const id = `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const effectiveFrom = params.effectiveFrom?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  await SalaryStructureHistory.create({
    id,
    employee_id: params.employeeRowId,
    effective_from: `${effectiveFrom}T12:00:00.000Z`,
    snapshot_json: JSON.stringify(params.next),
    previous_snapshot_json: params.previous ? JSON.stringify(params.previous) : null,
    changed_by: params.changedBy ?? null,
    change_reason: params.changeReason ?? null,
    created_at: new Date(),
  });
}

export async function listSalaryStructureHistory(employeeRowId: string, limit = 50) {
  await ensureSalaryStructureHistorySchema();
  const rows = await SalaryStructureHistory.findAll({
    where: { employee_id: employeeRowId },
    order: [['effective_from', 'DESC']],
    limit,
  });
  return rows.map((r) => r.get({ plain: true }));
}
