import { Op } from 'sequelize';
import crypto from 'crypto';
import { Employee, EmployeeMonthlySales } from '../db.js';
import { ensureEmployeeMonthlySalesSchema } from './employeeMonthlySalesSchema.js';

export type MonthlySalesListItem = {
  employeeInternalId: string;
  employeeId: string;
  employeeName: string;
  salesAmount: number;
  notes: string | null;
};

function monthKey(month: string): string {
  return String(month ?? '').slice(0, 7);
}

function numSales(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function displayName(emp: Record<string, unknown>): string {
  const first = String(emp.first_name ?? '').trim();
  const last = String(emp.last_name ?? '').trim();
  const combined = `${first} ${last}`.trim();
  return combined || String(emp.employee_id ?? emp.id ?? '—');
}

/** Load sales_amount keyed by employees.id for a payroll month. */
export async function loadMonthlySalesMapByEmployeeId(
  month: string
): Promise<Map<string, number>> {
  await ensureEmployeeMonthlySalesSchema();
  const key = monthKey(month);
  if (!/^\d{4}-\d{2}$/.test(key)) return new Map();
  const rows = await EmployeeMonthlySales.findAll({
    where: { payroll_month: key },
    attributes: ['employee_id', 'sales_amount'],
  });
  const map = new Map<string, number>();
  for (const row of rows) {
    const p = row.get({ plain: true }) as { employee_id?: string; sales_amount?: unknown };
    const id = String(p.employee_id ?? '').trim();
    if (!id) continue;
    map.set(id, numSales(p.sales_amount));
  }
  return map;
}

export async function listMonthlySalesForMonth(month: string): Promise<MonthlySalesListItem[]> {
  await ensureEmployeeMonthlySalesSchema();
  const key = monthKey(month);
  if (!/^\d{4}-\d{2}$/.test(key)) {
    const err = new Error('month must be YYYY-MM') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  const salesRows = await EmployeeMonthlySales.findAll({
    where: { payroll_month: key },
  });
  const byEmp = new Map<string, { salesAmount: number; notes: string | null }>();
  for (const row of salesRows) {
    const p = row.get({ plain: true }) as {
      employee_id?: string;
      sales_amount?: unknown;
      notes?: string | null;
    };
    const id = String(p.employee_id ?? '').trim();
    if (!id) continue;
    byEmp.set(id, {
      salesAmount: numSales(p.sales_amount),
      notes: p.notes != null ? String(p.notes) : null,
    });
  }

  const empIds = [...byEmp.keys()];
  if (!empIds.length) return [];

  const employees = await Employee.findAll({
    where: { id: { [Op.in]: empIds } },
    attributes: ['id', 'employee_id', 'first_name', 'last_name'],
  });

  return employees.map((emp) => {
    const p = emp.get({ plain: true }) as Record<string, unknown>;
    const internalId = String(p.id);
    const sales = byEmp.get(internalId) ?? { salesAmount: 0, notes: null };
    return {
      employeeInternalId: internalId,
      employeeId: String(p.employee_id ?? internalId),
      employeeName: displayName(p),
      salesAmount: sales.salesAmount,
      notes: sales.notes,
    };
  });
}

async function resolveEmployeeInternalId(employeeId: string): Promise<string | null> {
  const raw = String(employeeId ?? '').trim();
  if (!raw) return null;
  const emp = await Employee.findOne({
    where: { [Op.or]: [{ id: raw }, { employee_id: raw }] },
    attributes: ['id'],
  });
  return emp ? String(emp.get('id')) : null;
}

export async function upsertMonthlySales(params: {
  month: string;
  items: Array<{ employeeId: string; salesAmount: number; notes?: string | null }>;
}): Promise<MonthlySalesListItem[]> {
  await ensureEmployeeMonthlySalesSchema();
  const key = monthKey(params.month);
  if (!/^\d{4}-\d{2}$/.test(key)) {
    const err = new Error('month must be YYYY-MM') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }
  const items = Array.isArray(params.items) ? params.items : [];
  if (!items.length) {
    const err = new Error('items are required') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  const results: MonthlySalesListItem[] = [];

  for (const item of items) {
    const internalId = await resolveEmployeeInternalId(item.employeeId);
    if (!internalId) {
      const err = new Error(`Employee not found: ${item.employeeId}`) as Error & {
        statusCode?: number;
      };
      err.statusCode = 404;
      throw err;
    }

    const salesAmount = numSales(item.salesAmount);
    const notes =
      item.notes != null && String(item.notes).trim() ? String(item.notes).trim() : null;

    const existing = await EmployeeMonthlySales.findOne({
      where: { employee_id: internalId, payroll_month: key },
    });

    if (existing) {
      await existing.update({ sales_amount: salesAmount, notes });
    } else {
      await EmployeeMonthlySales.create({
        id: `ems-${crypto.randomUUID()}`,
        employee_id: internalId,
        payroll_month: key,
        sales_amount: salesAmount,
        notes,
      });
    }

    const emp = await Employee.findByPk(internalId, {
      attributes: ['id', 'employee_id', 'first_name', 'last_name'],
    });
    const p = (emp?.get({ plain: true }) ?? { id: internalId }) as Record<string, unknown>;
    results.push({
      employeeInternalId: internalId,
      employeeId: String(p.employee_id ?? internalId),
      employeeName: displayName(p),
      salesAmount,
      notes,
    });
  }

  return results;
}
