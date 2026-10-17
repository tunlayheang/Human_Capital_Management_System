import { DataTypes } from 'sequelize';
import { Employee, Position, sequelize } from './db.js';

let jobPositionColumnReady = false;

export async function ensureEmployeeJobPositionColumn(): Promise<void> {
  if (jobPositionColumnReady) return;
  const qi = sequelize.getQueryInterface();
  const table = 'employees';
  try {
    const desc = await qi.describeTable(table);
    if (!desc.job_position) {
      await qi.addColumn(table, 'job_position', {
        type: DataTypes.STRING(120),
        allowNull: true,
      });
      console.log('[db] employees.job_position column added.');
    }
    jobPositionColumnReady = true;
  } catch (err) {
    console.warn('[db] ensureEmployeeJobPositionColumn:', (err as Error).message);
  }
}

export async function resolveJobPositionTitle(positionId: string | null | undefined): Promise<string | null> {
  const id = String(positionId ?? '').trim();
  if (!id) return null;
  const pos: any = await Position.findByPk(id);
  const title = pos?.title ?? pos?.get?.('title');
  return title ? String(title).trim() : null;
}

export async function syncEmployeeJobPosition(
  employeeRowId: string,
  positionId?: string | null,
  explicitTitle?: string | null
): Promise<string | null> {
  await ensureEmployeeJobPositionColumn();
  const title =
    (explicitTitle && String(explicitTitle).trim()) ||
    (await resolveJobPositionTitle(positionId)) ||
    null;
  if (!title) return null;
  const row: any = await Employee.findByPk(employeeRowId);
  if (row) {
    await row.update({ job_position: title } as any);
  }
  return title;
}
