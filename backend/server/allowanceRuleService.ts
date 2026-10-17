import { Op } from 'sequelize';
import {
  AllowanceType,
  AllowanceRule,
  EmployeeAllowanceAssignment,
  AllowanceTemplate,
  AuditLog,
  Employee,
} from './db.js';
import { AUDIT_SOURCE_ALLOWANCE } from './auditLogConsolidationService.js';
import {
  attachItemsToTemplate,
  parseAllowanceTemplateItems,
  type AllowanceTemplateItemRow,
} from './allowanceTemplateItems.js';
import { ALLOWANCE_CALCULATION_TYPES } from './allowanceTypes.js';
import {
  calculateAllowancesForEmployee,
  invalidateAllowanceRulesCache,
  type AllowanceEvaluationContext,
} from './allowanceRuleEngine.js';

function parseCondition(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function validateFormula(formula: string | null | undefined): string | null {
  if (!formula?.trim()) return null;
  const expr = formula
    .replace(/\bbase\b/gi, '1000')
    .replace(/\bpresent\b/gi, '10')
    .replace(/\bot_hours\b/gi, '5')
    .replace(/[^0-9+\-*/().\s]/g, '');
  if (!expr.trim()) return 'Formula contains invalid characters';
  try {
    const v = Function(`"use strict"; return (${expr})`)();
    if (!Number.isFinite(v)) return 'Formula does not evaluate to a number';
  } catch {
    return 'Formula syntax is invalid';
  }
  return null;
}

export async function logAllowanceAudit(params: {
  entityType: string;
  entityId: string;
  action: string;
  changedBy?: string;
  oldValue?: unknown;
  newValue?: unknown;
}): Promise<void> {
  const allowanceAuditId = `aal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await AuditLog.create({
    id: `audit-${allowanceAuditId}`,
    entityType: params.entityType || 'allowance',
    entityId: params.entityId,
    action: params.action,
    oldValue: params.oldValue ?? null,
    newValue: params.newValue ?? null,
    performedBy: params.changedBy ?? 'system',
    reason: `Allowance ${params.action.toLowerCase()}`,
    metadata: { source: AUDIT_SOURCE_ALLOWANCE, allowanceAuditId },
  } as any);
}

export async function listAllowanceTypes() {
  const rows = await AllowanceType.findAll({ order: [['name', 'ASC']] });
  return rows.map((r) => r.get({ plain: true }));
}

export async function upsertAllowanceType(
  payload: Record<string, unknown>,
  changedBy?: string
) {
  const id = String(payload.id ?? `at-${Date.now()}`);
  const code = String(payload.code ?? '').trim().toUpperCase();
  if (!code) throw new Error('Allowance code is required');
  const calc = String(payload.calculation_type ?? 'fixed');
  if (!ALLOWANCE_CALCULATION_TYPES.includes(calc as (typeof ALLOWANCE_CALCULATION_TYPES)[number])) {
    throw new Error('Invalid calculation_type');
  }

  const existing = await AllowanceType.findByPk(id);
  const dup = await AllowanceType.findOne({ where: { code, id: { [Op.ne]: id } } });
  if (dup) throw new Error('Allowance code already exists');

  const data = {
    code,
    name: String(payload.name ?? code),
    category: String(payload.category ?? 'fixed'),
    calculation_type: calc,
    taxable: payload.taxable !== false,
    active: payload.active !== false,
    description: payload.description ?? null,
  };

  if (existing) {
    const old = existing.get({ plain: true });
    await existing.update(data);
    await logAllowanceAudit({
      entityType: 'allowance_type',
      entityId: id,
      action: 'update',
      changedBy,
      oldValue: old,
      newValue: data,
    });
  } else {
    await AllowanceType.create({ id, ...data });
    await logAllowanceAudit({
      entityType: 'allowance_type',
      entityId: id,
      action: 'create',
      changedBy,
      newValue: data,
    });
  }
  invalidateAllowanceRulesCache();
  return AllowanceType.findByPk(id);
}

export async function listAllowanceRules(filters?: { allowance_type_id?: string }) {
  const where: Record<string, unknown> = {};
  if (filters?.allowance_type_id) where.allowance_type_id = filters.allowance_type_id;
  const rows = await AllowanceRule.findAll({
    where,
    order: [
      ['priority', 'DESC'],
      ['rule_name', 'ASC'],
    ],
    include: [{ model: AllowanceType, as: 'type', required: false }],
  });
  return rows.map((r) => r.get({ plain: true }));
}

export async function validateAllowanceRulePayload(payload: Record<string, unknown>): Promise<void> {
  const typeId = String(payload.allowance_type_id ?? '');
  if (!typeId) throw new Error('allowance_type_id is required');
  const type = await AllowanceType.findByPk(typeId);
  if (!type) throw new Error('Allowance type not found');

  const from = payload.effective_from ? String(payload.effective_from).slice(0, 10) : null;
  const to = payload.effective_to ? String(payload.effective_to).slice(0, 10) : null;
  if (!from) throw new Error('effective_from is required for allowance rules');
  if (from && to && from > to) throw new Error('effective_from must be before effective_to');

  const formulaErr = validateFormula(payload.formula as string);
  if (formulaErr) throw new Error(formulaErr);

  const calcType = String((type.get('calculation_type') as string) ?? '');
  if (calcType === 'seniority_based') {
    const cond = parseCondition(payload.condition_json);
    const yMin = Number(cond.years_min);
    const yMax = Number(cond.years_max);
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMin > yMax) {
      throw new Error('Seniority rules require valid years_min and years_max');
    }
    const overlapping = await AllowanceRule.findAll({
      where: {
        allowance_type_id: typeId,
        active: true,
        id: payload.id ? { [Op.ne]: String(payload.id) } : { [Op.ne]: '' },
      },
    });
    for (const row of overlapping) {
      const c = parseCondition(row.get('condition_json'));
      const a = Number(c.years_min);
      const b = Number(c.years_max);
      if (yMin <= b && yMax >= a) {
        throw new Error('Overlapping seniority year range with another active rule');
      }
    }
  }
}

export async function upsertAllowanceRule(
  payload: Record<string, unknown>,
  changedBy?: string
) {
  await validateAllowanceRulePayload(payload);
  const effectiveFrom = String(payload.effective_from).slice(0, 10);
  const { assertPayrollMasterDataEditableForEffectiveDate } = await import(
    './payroll/payrollMasterDataGuard.js'
  );
  await assertPayrollMasterDataEditableForEffectiveDate(effectiveFrom);
  const id = String(payload.id ?? `ar-${Date.now()}`);
  const existing = await AllowanceRule.findByPk(id);

  const data = {
    allowance_type_id: String(payload.allowance_type_id),
    rule_name: String(payload.rule_name ?? 'Rule'),
    trigger_type: String(payload.trigger_type ?? 'fixed'),
    condition_json: parseCondition(payload.condition_json ?? {}),
    formula: payload.formula ? String(payload.formula) : null,
    fixed_amount: Number(payload.fixed_amount) || 0,
    percentage_rate: Number(payload.percentage_rate) || 0,
    priority: Number(payload.priority) || 100,
    effective_from: payload.effective_from || null,
    effective_to: payload.effective_to || null,
    active: payload.active !== false,
    stackable: payload.stackable !== false,
  };

  if (existing) {
    const old = existing.get({ plain: true });
    await existing.update(data);
    await logAllowanceAudit({
      entityType: 'allowance_rule',
      entityId: id,
      action: 'update',
      changedBy,
      oldValue: old,
      newValue: data,
    });
  } else {
    await AllowanceRule.create({ id, ...data });
    await logAllowanceAudit({
      entityType: 'allowance_rule',
      entityId: id,
      action: 'create',
      changedBy,
      newValue: data,
    });
  }
  invalidateAllowanceRulesCache();
  return AllowanceRule.findByPk(id, {
    include: [{ model: AllowanceType, as: 'type' }],
  });
}

/**
 * Permanently delete an allowance rule (hard delete — not recoverable).
 * Clears rule references from templates and employee assignments first.
 */
export async function deleteAllowanceRule(
  ruleId: string,
  changedBy?: string
): Promise<void> {
  const existing = await AllowanceRule.findByPk(ruleId);
  if (!existing) throw Object.assign(new Error('Allowance rule not found'), { statusCode: 404 });
  const old = existing.get({ plain: true });

  const templates = await AllowanceTemplate.findAll();
  for (const tpl of templates) {
    const items = parseAllowanceTemplateItems(tpl.get('items_json'));
    let changed = false;
    const next = items.map((item) => {
      if (String(item.allowance_rule_id ?? '') !== ruleId) return item;
      changed = true;
      return { ...item, allowance_rule_id: null };
    });
    if (changed) {
      await tpl.update({ items_json: next } as never);
    }
  }

  await EmployeeAllowanceAssignment.update(
    { allowance_rule_id: null },
    { where: { allowance_rule_id: ruleId } }
  );

  await existing.destroy();
  await logAllowanceAudit({
    entityType: 'allowance_rule',
    entityId: ruleId,
    action: 'delete',
    changedBy,
    oldValue: old,
  });
  invalidateAllowanceRulesCache();
}

export async function listEmployeeAllowanceAssignments(employeeId: string) {
  const emp = await Employee.findOne({
    where: { [Op.or]: [{ id: employeeId }, { employee_id: employeeId }] },
    attributes: ['id', 'employee_id'],
  });
  if (!emp) return [];
  const internalId = String((emp.get({ plain: true }) as { id: string }).id);
  const rows = await EmployeeAllowanceAssignment.findAll({
    where: { employee_id: internalId },
    order: [['created_at', 'DESC']],
  });
  return rows.map((r) => r.get({ plain: true }));
}

export async function upsertEmployeeAllowanceAssignment(
  employeeId: string,
  payload: Record<string, unknown>,
  changedBy?: string
) {
  const emp = await Employee.findOne({
    where: { [Op.or]: [{ id: employeeId }, { employee_id: employeeId }] },
  });
  if (!emp) throw new Error('Employee not found');
  const internalId = String((emp.get({ plain: true }) as { id: string }).id);
  const typeId = String(payload.allowance_type_id ?? '');
  const dup = await EmployeeAllowanceAssignment.findOne({
    where: {
      employee_id: internalId,
      allowance_type_id: typeId,
      active: true,
      id: payload.id ? { [Op.ne]: String(payload.id) } : { [Op.ne]: '' },
    },
  });
  if (dup && !payload.id) throw new Error('Active allowance assignment already exists for this type');

  const id = String(payload.id ?? `eaa-${Date.now()}`);
  const data = {
    employee_id: internalId,
    allowance_type_id: typeId,
    allowance_rule_id: payload.allowance_rule_id || null,
    custom_amount: payload.custom_amount != null ? Number(payload.custom_amount) : null,
    start_date: payload.start_date || null,
    end_date: payload.end_date || null,
    active: payload.active !== false,
    notes: payload.notes || null,
  };

  const existing = await EmployeeAllowanceAssignment.findByPk(id);
  if (existing) {
    await existing.update(data);
  } else {
    await EmployeeAllowanceAssignment.create({ id, ...data });
  }
  await logAllowanceAudit({
    entityType: 'employee_allowance',
    entityId: id,
    action: existing ? 'update' : 'create',
    changedBy,
    newValue: data,
  });
  return EmployeeAllowanceAssignment.findByPk(id);
}

export async function listAllowanceTemplates() {
  const rows = await AllowanceTemplate.findAll({
    order: [['template_name', 'ASC']],
  });
  return rows.map((r) => attachItemsToTemplate(r.get({ plain: true }) as Record<string, unknown>));
}

export async function validateAllowanceTemplatePayload(
  payload: Record<string, unknown>
): Promise<void> {
  const name = String(payload.template_name ?? '').trim();
  if (!name) throw new Error('Template name is required');

  const items = payload.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Add at least one allowance to the template');
  }

  const typeIds = new Set<string>();
  for (const raw of items) {
    const item = raw as Record<string, unknown>;
    const typeId = String(item.allowance_type_id ?? '').trim();
    if (!typeId) throw new Error('Each template row needs an allowance type');
    if (typeIds.has(typeId)) {
      throw Object.assign(
        new Error(
          'Each allowance type can only appear once in a template. Choose a different type or remove the duplicate row.'
        ),
        { statusCode: 400 }
      );
    }
    typeIds.add(typeId);
    const type = await AllowanceType.findByPk(typeId);
    if (!type) throw new Error('Invalid allowance type in template');
    if (item.allowance_rule_id) {
      const rule = await AllowanceRule.findByPk(String(item.allowance_rule_id));
      if (!rule) throw new Error('Invalid allowance rule in template');
    }
  }
}

export async function upsertAllowanceTemplate(
  payload: Record<string, unknown>,
  changedBy?: string
) {
  await validateAllowanceTemplatePayload(payload);
  const id = String(payload.id ?? `atpl-${Date.now()}`);
  const data = {
    template_name: String(payload.template_name ?? 'Template').trim(),
    // Department/role scoping removed — packages are assigned to employees explicitly.
    department_id: null,
    role_id: null,
    active: payload.active !== false,
  };
  const existing = await AllowanceTemplate.findByPk(id);
  const old = existing?.get({ plain: true });
  if (existing) await existing.update(data);
  else await AllowanceTemplate.create({ id, ...data });

  const items = payload.items as Record<string, unknown>[];
  const itemsJson: AllowanceTemplateItemRow[] = items.map((item) => ({
    id: String(item.id ?? `ati-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
    allowance_type_id: String(item.allowance_type_id),
    allowance_rule_id: item.allowance_rule_id ? String(item.allowance_rule_id) : null,
    amount: Number(item.amount) || 0,
  }));
  await AllowanceTemplate.update({ items_json: itemsJson } as never, { where: { id } });

  await logAllowanceAudit({
    entityType: 'allowance_template',
    entityId: id,
    action: existing ? 'update' : 'create',
    changedBy,
    oldValue: old,
    newValue: { ...data, items: payload.items },
  });
  invalidateAllowanceRulesCache();
  const saved = await AllowanceTemplate.findByPk(id);
  return saved ? attachItemsToTemplate(saved.get({ plain: true }) as Record<string, unknown>) : null;
}

/**
 * Permanently delete an allowance template (hard delete — not recoverable).
 * Clears employee package assignments that pointed at this template.
 */
export async function deleteAllowanceTemplate(
  templateId: string,
  changedBy?: string
): Promise<void> {
  const existing = await AllowanceTemplate.findByPk(templateId);
  if (!existing) {
    throw Object.assign(new Error('Template not found'), { statusCode: 404 });
  }
  const old = attachItemsToTemplate(existing.get({ plain: true }) as Record<string, unknown>);

  await Employee.update(
    { allowance_template_id: null },
    { where: { allowance_template_id: templateId } }
  );

  await existing.destroy();
  await logAllowanceAudit({
    entityType: 'allowance_template',
    entityId: templateId,
    action: 'delete',
    changedBy,
    oldValue: old,
  });
  invalidateAllowanceRulesCache();
}

export async function simulatePayrollAllowances(params: {
  employeeId: string;
  month: string;
  salesAmount?: number;
  userId?: string;
}): Promise<{
  employee: Record<string, unknown>;
  month: string;
  result: Awaited<ReturnType<typeof calculateAllowancesForEmployee>>;
}> {
  const emp = await Employee.findOne({
    where: { [Op.or]: [{ id: params.employeeId }, { employee_id: params.employeeId }] },
  });
  if (!emp) throw new Error('Employee not found');
  const plain = emp.get({ plain: true }) as Record<string, unknown>;

  const { AttendanceRecord, User } = await import('./db.js');
  const { enrichAttendanceRecords } = await import('./attendanceRecordStatus.js');
  const { getApprovedOvertimeHoursForMonth } = await import('./overtimeRequestService.js');
  const { countApprovedUnpaidLeaveDays } = await import('./payrollLeaveDeductions.js');
  const { findEmployeeWithCompensation } = await import('./salaryStructureService.js');
  const { resolvePayrollPeriod } = await import('./payroll/payrollPeriodService.js');

  const userId =
    params.userId ??
    (await User.findOne({ where: { employeeId: plain.id }, attributes: ['id'] }))?.get('id');

  const monthStr = params.month.slice(0, 7);
  const period = await resolvePayrollPeriod(monthStr);
  const start = period.payPeriodStart.slice(0, 10);
  const end = period.payPeriodEnd.slice(0, 10);
  const periodBounds = { periodStart: start, periodEnd: end };

  const employee = userId ? await findEmployeeWithCompensation(String(userId)) : plain;
  const attendanceRows = userId
    ? await AttendanceRecord.findAll({
        where: { userId: String(userId), date: { [Op.between]: [start, end] } },
      })
    : [];
  const enriched = await enrichAttendanceRecords(attendanceRows);
  const [approvedOvertime, unpaidLeaveDays] = userId
    ? await Promise.all([
        getApprovedOvertimeHoursForMonth(String(userId), monthStr, null, periodBounds),
        countApprovedUnpaidLeaveDays(String(userId), monthStr, periodBounds),
      ])
    : [{ hours100: 0, hours150: 0, hours200: 0 }, 0];

  const ctx: AllowanceEvaluationContext = {
    employeeInternalId: String(plain.id),
    employeeDisplayId: String(plain.employee_id ?? ''),
    userId: userId ? String(userId) : undefined,
    month: monthStr,
    periodStart: start,
    periodEnd: end,
    baseSalary: Number(employee?.base_salary ?? 0),
    joinDate: (employee?.join_date as string) ?? null,
    departmentId: (employee?.department_id as string) ?? null,
    positionId: (employee?.position_id as string) ?? null,
    accessRole: String(employee?.access_role ?? employee?.role ?? 'EMPLOYEE'),
    attendance: enriched,
    approvedOvertime,
    unpaidLeaveDays,
    gracePeriodMinutes: Number(employee?.grace_period_minutes ?? 0),
    salesAmount: params.salesAmount,
    standardDailyHours: Number(employee?.work_hours ?? 8),
  };

  const result = await calculateAllowancesForEmployee(ctx);
  return { employee: plain, month: monthStr, result };
}

async function resolveEmployeeInternalId(employeeId: string): Promise<{
  internalId: string;
  displayId: string;
}> {
  const { employeeLookupWhere } = await import('./employeeIdFormat.js');
  const emp = await Employee.findOne({
    where: employeeLookupWhere(employeeId) as never,
    attributes: ['id', 'employee_id'],
  });
  if (!emp) throw new Error('Employee not found');
  const plain = emp.get({ plain: true }) as { id: string; employee_id?: string };
  return {
    internalId: String(plain.id),
    displayId: String(plain.employee_id ?? plain.id),
  };
}

/** Persist assigned package on employee and sync per-type overrides from template items. */
export async function assignAllowancePackage(
  employeeId: string,
  templateId: string | null | undefined,
  changedBy?: string
): Promise<{ allowance_template_id: string | null }> {
  const { internalId } = await resolveEmployeeInternalId(employeeId);
  const normalized = templateId ? String(templateId).trim() : '';

  if (normalized) {
    const tpl = await AllowanceTemplate.findOne({
      where: { id: normalized, active: true },
    });
    if (!tpl) throw new Error('Allowance package not found or inactive');
  }

  const emp = await Employee.findByPk(internalId);
  if (!emp) throw new Error('Employee not found');
  await emp.update({ allowance_template_id: normalized || null });

  await EmployeeAllowanceAssignment.update(
    { active: false },
    { where: { employee_id: internalId, active: true } }
  );

  if (normalized) {
    const tpl = await AllowanceTemplate.findByPk(normalized);
    const items = parseAllowanceTemplateItems(tpl?.get('items_json'));
    for (const raw of items) {
      const typeId = String(raw.allowance_type_id ?? '').trim();
      if (!typeId) continue;
      const assignmentId = `eaa-${internalId}-${typeId}`;
      const data = {
        employee_id: internalId,
        allowance_type_id: typeId,
        allowance_rule_id: raw.allowance_rule_id ? String(raw.allowance_rule_id) : null,
        custom_amount: raw.amount != null ? Number(raw.amount) : null,
        start_date: null,
        end_date: null,
        active: true,
        notes: `From package: ${normalized}`,
      };
      const existing = await EmployeeAllowanceAssignment.findByPk(assignmentId);
      if (existing) await existing.update(data);
      else await EmployeeAllowanceAssignment.create({ id: assignmentId, ...data });
    }
    await logAllowanceAudit({
      entityType: 'employee_allowance_package',
      entityId: internalId,
      action: 'assign',
      changedBy,
      newValue: { allowance_template_id: normalized, itemCount: items.length },
    });
  } else {
    await logAllowanceAudit({
      entityType: 'employee_allowance_package',
      entityId: internalId,
      action: 'clear',
      changedBy,
      newValue: { allowance_template_id: null },
    });
  }

  invalidateAllowanceRulesCache();
  return { allowance_template_id: normalized || null };
}

export async function previewAllowancePackage(params: {
  allowanceTemplateId?: string | null;
  baseSalary: number;
  joinDate?: string | null;
  departmentId?: string | null;
  positionId?: string | null;
  accessRole?: string | null;
  employeeId?: string;
  month?: string;
  workHours?: number;
  gracePeriodMinutes?: number;
  userId?: string;
}): Promise<Awaited<ReturnType<typeof calculateAllowancesForEmployee>>> {
  const monthStr = (params.month ?? new Date().toISOString().slice(0, 7)).slice(0, 7);
  let internalId = 'preview';
  let attendance: AllowanceEvaluationContext['attendance'] = [];
  let approvedOvertime = { hours100: 0, hours150: 0, hours200: 0 };
  let unpaidLeaveDays = 0;

  const { resolvePayrollPeriod } = await import('./payroll/payrollPeriodService.js');
  const period = await resolvePayrollPeriod(monthStr);
  const periodStart = period.payPeriodStart.slice(0, 10);
  const periodEnd = period.payPeriodEnd.slice(0, 10);
  const periodBounds = { periodStart, periodEnd };

  if (params.employeeId) {
    try {
      const { internalId: id } = await resolveEmployeeInternalId(params.employeeId);
      internalId = id;
      const empRow = await Employee.findByPk(internalId);
      const plain = empRow?.get({ plain: true }) as Record<string, unknown> | undefined;
      if (!params.departmentId && plain?.department_id) {
        params.departmentId = String(plain.department_id);
      }
      if (!params.positionId && plain?.position_id) {
        params.positionId = String(plain.position_id);
      }
      if (!params.joinDate && plain?.join_date) {
        params.joinDate = String(plain.join_date);
      }
      if (!params.workHours && plain?.work_hours != null) {
        params.workHours = Number(plain.work_hours);
      }
      if (params.gracePeriodMinutes == null && plain?.grace_period_minutes != null) {
        params.gracePeriodMinutes = Number(plain.grace_period_minutes);
      }
      if (!params.userId && plain) {
        const { User } = await import('./db.js');
        const u = await User.findOne({
          where: { employeeId: internalId },
          attributes: ['id'],
        });
        if (u) params.userId = String(u.get('id'));
      }
    } catch {
      // Unsaved / unknown employee id — preview from form fields only.
      internalId = 'preview';
    }
  }

  if (params.userId) {
    const { AttendanceRecord } = await import('./db.js');
    const { enrichAttendanceRecords } = await import('./attendanceRecordStatus.js');
    const { getApprovedOvertimeHoursForMonth } = await import('./overtimeRequestService.js');
    const { countApprovedUnpaidLeaveDays } = await import('./payrollLeaveDeductions.js');
    const attendanceRows = await AttendanceRecord.findAll({
      where: {
        userId: String(params.userId),
        date: { [Op.between]: [periodStart, periodEnd] },
      },
    });
    attendance = await enrichAttendanceRecords(attendanceRows);
    [approvedOvertime, unpaidLeaveDays] = await Promise.all([
      getApprovedOvertimeHoursForMonth(String(params.userId), monthStr, null, periodBounds),
      countApprovedUnpaidLeaveDays(String(params.userId), monthStr, periodBounds),
    ]);
  }

  let explicitTemplateId = params.allowanceTemplateId ?? null;
  if (
    explicitTemplateId == null &&
    internalId !== 'preview'
  ) {
    const empRow = await Employee.findByPk(internalId, { attributes: ['allowance_template_id'] });
    const stored = empRow?.get('allowance_template_id');
    explicitTemplateId = stored ? String(stored) : null;
  }

  const ctx: AllowanceEvaluationContext = {
    employeeInternalId: internalId,
    month: monthStr,
    periodStart,
    periodEnd,
    baseSalary: Number(params.baseSalary) || 0,
    joinDate: params.joinDate ?? null,
    departmentId: params.departmentId ?? null,
    positionId: params.positionId ?? null,
    accessRole: params.accessRole ?? 'EMPLOYEE',
    attendance,
    approvedOvertime,
    unpaidLeaveDays,
    gracePeriodMinutes: params.gracePeriodMinutes ?? 0,
    standardDailyHours: params.workHours ?? 8,
    explicitTemplateId,
  };

  return calculateAllowancesForEmployee(ctx);
}
