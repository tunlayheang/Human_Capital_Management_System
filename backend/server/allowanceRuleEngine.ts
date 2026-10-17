import { Op } from 'sequelize';
import {
  AllowanceType,
  AllowanceRule,
  EmployeeAllowanceAssignment,
  AllowanceTemplate,
  Position,
  Employee,
} from './db.js';
import { parseAllowanceTemplateItems } from './allowanceTemplateItems.js';
import {
  isLegacySeniorityAllowanceCode,
  isRetiredOtMealAllowanceCode,
  LEGACY_ALLOWANCE_FIELD_BY_CODE,
} from './allowanceTypes.js';
import { isPayrollExcusedAbsence } from './payrollCalculation.js';

export type AllowanceEvaluationContext = {
  employeeInternalId: string;
  employeeDisplayId?: string;
  userId?: string;
  month: string;
  /** Inclusive payroll period start (cutoff window). When set with periodEnd, attendance counts use this window. */
  periodStart?: string | null;
  /** Inclusive payroll period end (cutoff). */
  periodEnd?: string | null;
  baseSalary: number;
  joinDate?: string | Date | null;
  departmentId?: string | null;
  positionId?: string | null;
  positionTitle?: string | null;
  accessRole?: string | null;
  attendance: Array<{ date?: string; status?: string }>;
  approvedOvertime: { hours100?: number; hours150: number; hours200: number };
  unpaidLeaveDays: number;
  gracePeriodMinutes?: number;
  /** Optional commission / sales input for commission rules */
  salesAmount?: number;
  standardDailyHours?: number;
  /** When set, use this package instead of auto-matching by department/role */
  explicitTemplateId?: string | null;
};

export type AppliedAllowanceLine = {
  allowanceTypeId: string;
  code: string;
  name: string;
  category: string;
  calculationType: string;
  amount: number;
  taxable: boolean;
  ruleId: string;
  ruleName: string;
  triggerType: string;
  priority: number;
  appliedConditions: Record<string, unknown>;
  formula?: string | null;
};

export type AllowanceEngineResult = {
  lines: AppliedAllowanceLine[];
  legacy: {
    transport: number;
    attendance: number;
    meal: number;
    seniority: number;
    position: number;
    commission: number;
    otMeal: number;
  };
  total: number;
  audit: AppliedAllowanceLine[];
};

let rulesCache: {
  at: number;
  types: Map<string, { id: string; code: string; name: string; category: string; calculation_type: string; taxable: boolean }>;
  rules: Array<Record<string, unknown>>;
} | null = null;

const CACHE_TTL_MS = 60_000;

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

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

function monthInRange(month: string, from?: string | null, to?: string | null): boolean {
  const m = month.slice(0, 7);
  if (from && m < from.slice(0, 7)) return false;
  if (to && m > to.slice(0, 7)) return false;
  return true;
}

function isPresentForBonus(status: unknown): boolean {
  const st = String(status ?? '').toUpperCase();
  return st === 'PRESENT' || st === 'LATE';
}

/**
 * Attendance rows for allowance scoring.
 * Prefer explicit cutoff period bounds; otherwise trust the caller-provided array
 * (payroll already filters to the salary window — do not re-filter by calendar month).
 */
function isAttendanceDateInScope(
  date: unknown,
  ctx: Pick<AllowanceEvaluationContext, 'periodStart' | 'periodEnd' | 'month'>
): boolean {
  const d = String(date ?? '').slice(0, 10);
  if (!d) return false;
  const start = ctx.periodStart?.slice(0, 10) || null;
  const end = ctx.periodEnd?.slice(0, 10) || null;
  if (start && end) return d >= start && d <= end;
  return true;
}

function countAbsences(
  attendance: AllowanceEvaluationContext['attendance'],
  ctx: Pick<AllowanceEvaluationContext, 'periodStart' | 'periodEnd' | 'month'>
): number {
  return attendance.filter((r) => {
    if (!isAttendanceDateInScope(r.date, ctx)) return false;
    const st = String(r.status ?? '').toUpperCase();
    return st === 'ABSENT' && !isPayrollExcusedAbsence(st);
  }).length;
}

function countLate(
  attendance: AllowanceEvaluationContext['attendance'],
  ctx: Pick<AllowanceEvaluationContext, 'periodStart' | 'periodEnd' | 'month'>
): number {
  return attendance.filter((r) => {
    if (!isAttendanceDateInScope(r.date, ctx)) return false;
    return String(r.status ?? '').toUpperCase() === 'LATE';
  }).length;
}

function countPresentForBonus(
  attendance: AllowanceEvaluationContext['attendance'],
  ctx: Pick<AllowanceEvaluationContext, 'periodStart' | 'periodEnd' | 'month'>
): number {
  return attendance.filter(
    (r) => isAttendanceDateInScope(r.date, ctx) && isPresentForBonus(r.status)
  ).length;
}

function serviceYears(joinDate?: string | Date | null, asOf = Date.now()): number {
  if (!joinDate) return 0;
  const t = new Date(joinDate).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((asOf - t) / (365.25 * 24 * 60 * 60 * 1000)));
}

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

async function loadRulesCatalog(): Promise<typeof rulesCache> {
  const now = Date.now();
  if (rulesCache && now - rulesCache.at < CACHE_TTL_MS) return rulesCache;

  const types = await AllowanceType.findAll({ where: { active: true } });
  const typeMap = new Map<
    string,
    { id: string; code: string; name: string; category: string; calculation_type: string; taxable: boolean }
  >();
  for (const t of types) {
    const p = t.get({ plain: true }) as {
      id: string;
      code: string;
      name: string;
      category: string;
      calculation_type: string;
      taxable: boolean;
    };
    typeMap.set(p.id, p);
  }

  const rules = await AllowanceRule.findAll({
    where: { active: true },
    order: [['priority', 'DESC']],
  });

  rulesCache = {
    at: now,
    types: typeMap,
    rules: rules.map((r) => r.get({ plain: true }) as Record<string, unknown>),
  };
  return rulesCache;
}

export function invalidateAllowanceRulesCache(): void {
  rulesCache = null;
}

function isCommissionCalculation(
  calcType: string,
  typeCode?: string,
  triggerType?: string
): boolean {
  const calc = String(calcType ?? '').toLowerCase();
  const code = String(typeCode ?? '').toUpperCase();
  const trigger = String(triggerType ?? '').toLowerCase();
  return (
    calc === 'commission_based' ||
    calc === 'commission' ||
    code === 'COMMISSION' ||
    trigger === 'commission'
  );
}

function evaluateRuleAmount(
  rule: Record<string, unknown>,
  type: { calculation_type: string; code: string },
  ctx: AllowanceEvaluationContext,
  _monthPrefix: string,
  overrideAmount?: number | null,
  options?: { ignoreRoleGates?: boolean }
): { amount: number; applied: Record<string, unknown> } | null {
  const cond = parseCondition(rule.condition_json);
  let calcType = String(type.calculation_type ?? rule.trigger_type ?? 'fixed');
  // Commission rules must use sales × % even if the type catalog row was mis-tagged as fixed.
  if (isCommissionCalculation(calcType, type.code, String(rule.trigger_type ?? ''))) {
    calcType = 'commission_based';
  }
  const fixed = num(rule.fixed_amount);
  const pct = num(rule.percentage_rate);
  const ignoreRoleGates = options?.ignoreRoleGates === true;

  if (overrideAmount != null && Number.isFinite(overrideAmount)) {
    // Commission always evaluates from Sales Target — package/assignment amounts must not freeze it.
    if (!isCommissionCalculation(calcType, type.code, String(rule.trigger_type ?? ''))) {
      return {
        amount: roundUsd(overrideAmount),
        applied: { source: ignoreRoleGates ? 'allowance_package' : 'employee_override' },
      };
    }
  }

  if (cond.requires_base_salary && ctx.baseSalary <= 0) {
    return null;
  }

  switch (calcType) {
    case 'fixed':
    case 'conditional': {
      if (calcType === 'conditional') {
        const deptIds = Array.isArray(cond.department_ids) ? (cond.department_ids as string[]) : [];
        const posIds = Array.isArray(cond.position_ids) ? (cond.position_ids as string[]) : [];
        // Portal `roles` in condition_json are never a payment gate (see package Position $100 bug).
        if (deptIds.length && ctx.departmentId && !deptIds.includes(ctx.departmentId)) return null;
        if (posIds.length && ctx.positionId && !posIds.includes(ctx.positionId)) return null;
        const amt = num(cond.amount, fixed);
        return { amount: roundUsd(amt), applied: { ...cond } };
      }
      return { amount: roundUsd(fixed), applied: cond };
    }

    case 'attendance_based': {
      const presentMin = num(cond.present_min, 10);
      const absenceMax = num(cond.absence_max, 0);
      const lateMax = num(cond.late_max, 999);
      const fullAmount = num(cond.full_amount, fixed);
      const oneAbsPct = num(cond.one_absence_pct, 50);
      const twoPlusPct = num(cond.two_plus_absence_pct, 0);

      const present = countPresentForBonus(ctx.attendance, ctx);
      const absences = countAbsences(ctx.attendance, ctx);
      const lates = countLate(ctx.attendance, ctx);

      if (present < presentMin) {
        return { amount: 0, applied: { present, absences, lates, reason: 'below_present_min' } };
      }

      let amount = fullAmount;
      if (absences > num(cond.absence_max, 0)) {
        if (absences >= 2) amount = fullAmount * (twoPlusPct / 100);
        else if (absences === 1) amount = fullAmount * (oneAbsPct / 100);
      } else if (lates > lateMax) {
        amount = fullAmount * (oneAbsPct / 100);
      } else if (absences <= absenceMax && lates <= lateMax) {
        amount = fullAmount;
      }

      return {
        amount: roundUsd(amount),
        applied: { present, absences, lates, fullAmount, oneAbsPct, twoPlusPct },
      };
    }

    case 'seniority_based': {
      const years = serviceYears(ctx.joinDate);
      const yMin = num(cond.years_min);
      const yMax = num(cond.years_max, 99);
      if (years < yMin || years > yMax) return null;
      return { amount: roundUsd(fixed), applied: { years, years_min: yMin, years_max: yMax } };
    }

    case 'overtime_based': {
      const totalOt =
        num(ctx.approvedOvertime.hours100) +
        num(ctx.approvedOvertime.hours150) +
        num(ctx.approvedOvertime.hours200);
      const minH = num(cond.ot_hours_min, 2);
      const doubleAt = num(cond.ot_hours_double_at, 4);
      const baseMeal = num(cond.base_meal_amount, fixed);
      if (totalOt < minH) return null;
      const multiplier = totalOt >= doubleAt ? 2 : 1;
      return {
        amount: roundUsd(baseMeal * multiplier),
        applied: { totalOt, minH, doubleAt, multiplier },
      };
    }

    case 'commission_based': {
      const sales = num(ctx.salesAmount ?? cond.sales_amount, 0);
      const threshold = num(cond.sales_threshold, 0);
      const commissionPct = num(cond.commission_pct, pct);
      const perUnit = num(cond.fixed_per_unit, 0);

      // Below minimum sales → fixed amount fallback (if configured); otherwise no commission.
      if (sales < threshold) {
        if (fixed > 0) {
          return {
            amount: roundUsd(fixed),
            applied: {
              sales,
              threshold,
              commissionPct,
              source: 'fixed_fallback_below_threshold',
            },
          };
        }
        return null;
      }

      let amount = (sales * commissionPct) / 100;
      if (perUnit > 0) amount += perUnit;
      // Met gate but % result is $0 (e.g. rate unset) → fixed fallback.
      if (amount === 0 && fixed > 0) amount = fixed;
      return {
        amount: roundUsd(amount),
        applied: { sales, threshold, commissionPct, source: 'sales_commission' },
      };
    }

    case 'percentage': {
      if (ctx.baseSalary <= 0) return null;
      return {
        amount: roundUsd((ctx.baseSalary * pct) / 100),
        applied: { percentage_rate: pct, baseSalary: ctx.baseSalary },
      };
    }

    case 'formula': {
      const formula = String(rule.formula ?? '').trim();
      if (!formula) return null;
      try {
        const base = ctx.baseSalary;
        const present = countPresentForBonus(ctx.attendance, ctx);
        const otH =
          num(ctx.approvedOvertime.hours100) +
          num(ctx.approvedOvertime.hours150) +
          num(ctx.approvedOvertime.hours200);
        const expr = formula
          .replace(/\bbase\b/gi, String(base))
          .replace(/\bpresent\b/gi, String(present))
          .replace(/\bot_hours\b/gi, String(otH))
          .replace(/[^0-9+\-*/().\s]/g, '');
        if (!expr.trim()) return null;
        const amount = Function(`"use strict"; return (${expr})`)() as number;
        if (!Number.isFinite(amount)) return null;
        return { amount: roundUsd(amount), applied: { formula, expr } };
      } catch {
        return null;
      }
    }

    default:
      return { amount: roundUsd(fixed), applied: cond };
  }
}

/**
 * Position-trigger matching.
 * Portal role is intentionally NOT a payment gate (packages must never be zeroed by role).
 * - Job titles, when set, still filter who auto-receives the rule without a package.
 * - Role-only rules (no titles) do not auto-apply — assign via allowance package instead.
 */
function matchesPositionRule(
  cond: Record<string, unknown>,
  ctx: AllowanceEvaluationContext
): boolean {
  const titles = Array.isArray(cond.position_titles)
    ? (cond.position_titles as string[]).map((x) => x.toLowerCase()).filter(Boolean)
    : [];
  if (!titles.length) {
    return false;
  }
  const title = String(ctx.positionTitle ?? '').toLowerCase();
  return titles.some((t) => title.includes(t));
}

async function loadEmployeeOverrides(
  employeeInternalId: string,
  month: string
): Promise<Map<string, { amount: number | null; ruleId: string | null }>> {
  const rows = await EmployeeAllowanceAssignment.findAll({
    where: {
      employee_id: employeeInternalId,
      active: true,
      [Op.or]: [
        { start_date: null },
        { start_date: { [Op.lte]: `${month}-28` } },
      ],
    },
  });
  const map = new Map<string, { amount: number | null; ruleId: string | null }>();
  for (const row of rows) {
    const p = row.get({ plain: true }) as {
      allowance_type_id: string;
      custom_amount?: number | null;
      allowance_rule_id?: string | null;
      start_date?: string | null;
      end_date?: string | null;
    };
    if (p.end_date && month.slice(0, 7) > p.end_date.slice(0, 7)) continue;
    if (p.start_date && month.slice(0, 7) < p.start_date.slice(0, 7)) continue;
    map.set(p.allowance_type_id, {
      amount: p.custom_amount != null ? num(p.custom_amount) : null,
      ruleId: p.allowance_rule_id ?? null,
    });
  }
  return map;
}

async function loadTemplateItemHints(
  templateId: string
): Promise<Map<string, { ruleId?: string; amount?: number }>> {
  const out = new Map<string, { ruleId?: string; amount?: number }>();
  const tpl = await AllowanceTemplate.findOne({
    where: { id: templateId, active: true },
  });
  if (!tpl) return out;
  const items = parseAllowanceTemplateItems(tpl.get('items_json'));
  for (const item of items) {
    out.set(item.allowance_type_id, {
      ruleId: item.allowance_rule_id ?? undefined,
      amount: item.amount != null ? num(item.amount) : undefined,
    });
  }
  return out;
}

async function resolveTemplateRuleIds(
  ctx: AllowanceEvaluationContext,
  explicitTemplateId?: string | null
): Promise<Map<string, { ruleId?: string; amount?: number }>> {
  const out = new Map<string, { ruleId?: string; amount?: number }>();
  // Packages are assigned explicitly only — never auto-matched by department/role.
  const explicit = String(explicitTemplateId ?? ctx.explicitTemplateId ?? '').trim();
  if (!explicit) return out;
  return loadTemplateItemHints(explicit);
}

export async function calculateAllowancesForEmployee(
  ctx: AllowanceEvaluationContext
): Promise<AllowanceEngineResult> {
  const catalog = await loadRulesCatalog();
  if (!catalog) {
    return {
      lines: [],
      legacy: { transport: 0, attendance: 0, meal: 0, seniority: 0, position: 0, commission: 0, otMeal: 0 },
      total: 0,
      audit: [],
    };
  }

  const monthPrefix = ctx.month.slice(0, 7);
  let explicitTemplateId = ctx.explicitTemplateId ?? null;
  if (
    !explicitTemplateId &&
    ctx.employeeInternalId &&
    ctx.employeeInternalId !== 'preview'
  ) {
    try {
      const emp = await Employee.findByPk(ctx.employeeInternalId, {
        attributes: ['allowance_template_id'],
      });
      const tpl = emp?.get('allowance_template_id');
      explicitTemplateId = tpl ? String(tpl) : null;
    } catch (err) {
      console.warn(
        '[allowance] template lookup skipped:',
        (err as Error)?.message || err
      );
    }
  }

  let overrides = new Map<string, { amount: number | null; ruleId: string | null }>();
  if (ctx.employeeInternalId && ctx.employeeInternalId !== 'preview') {
    try {
      overrides = await loadEmployeeOverrides(ctx.employeeInternalId, monthPrefix);
    } catch (err) {
      console.warn(
        '[allowance] overrides lookup skipped:',
        (err as Error)?.message || err
      );
    }
  }
  const templateHints = await resolveTemplateRuleIds(ctx, explicitTemplateId);

  if (!ctx.positionTitle && ctx.positionId) {
    const pos = await Position.findByPk(ctx.positionId, { attributes: ['title'] });
    if (pos) ctx.positionTitle = String((pos.get({ plain: true }) as { title?: string }).title ?? '');
  }

  const appliedByType = new Map<string, AppliedAllowanceLine>();
  const lines: AppliedAllowanceLine[] = [];

  const rulesByType = new Map<string, Array<Record<string, unknown>>>();
  for (const rule of catalog.rules) {
    const typeId = String(rule.allowance_type_id);
    if (!monthInRange(monthPrefix, rule.effective_from as string, rule.effective_to as string)) continue;
    const list = rulesByType.get(typeId) ?? [];
    list.push(rule);
    rulesByType.set(typeId, list);
  }

  for (const [typeId, type] of catalog.types) {
    if (isLegacySeniorityAllowanceCode(String(type.code))) continue;
    if (isRetiredOtMealAllowanceCode(String(type.code))) continue;
    const override = overrides.get(typeId);
    const template = templateHints.get(typeId);
    // No package / type not in package → do not auto-apply catalog rules (assign via package).
    if (!override && !template) continue;

    const typeRules = (rulesByType.get(typeId) ?? []).sort(
      (a, b) => num(b.priority) - num(a.priority)
    );

    let chosen: { rule: Record<string, unknown>; amount: number; applied: Record<string, unknown> } | null =
      null;

    if (override?.ruleId) {
      const forced = typeRules.find((r) => String(r.id) === override.ruleId);
      if (forced) {
        const forcedIsCommission = isCommissionCalculation(
          String(type.calculation_type),
          type.code,
          String(forced.trigger_type ?? '')
        );
        const ev = evaluateRuleAmount(
          forced,
          type,
          ctx,
          monthPrefix,
          forcedIsCommission ? null : override.amount,
          { ignoreRoleGates: true }
        );
        if (ev) chosen = { rule: forced, ...ev };
      }
    }

    if (!chosen) {
      for (const rule of typeRules) {
        if (template?.ruleId && String(rule.id) !== template.ruleId) continue;
        const cond = parseCondition(rule.condition_json);
        const packageForcesThisRule =
          Boolean(template?.ruleId) && String(rule.id) === String(template.ruleId);
        const packageAmount =
          template?.amount != null && Number.isFinite(Number(template.amount))
            ? num(template.amount)
            : null;
        const isCommissionType = isCommissionCalculation(
          String(type.calculation_type),
          type.code,
          String(rule.trigger_type ?? '')
        );
        // Package rows must never be blocked by portal role (or skipped before amount apply).
        // Job-title filters still apply only when there is no package for this type.
        const ignoreRoleGates = Boolean(template);
        if (
          String(rule.trigger_type) === 'position' &&
          !ignoreRoleGates &&
          !matchesPositionRule(cond, ctx)
        ) {
          continue;
        }

        // Commission must always evaluate from Sales Target × rate (package amount is display-only /
        // fallback inside the rule — never a hard override that freezes commission at a fixed $).
        const amountOverride =
          isCommissionType
            ? null
            : override?.amount != null && Number.isFinite(Number(override.amount))
              ? Number(override.amount)
              : packageAmount != null && packageAmount > 0
                ? packageAmount
                : null;

        const ev = evaluateRuleAmount(rule, type, ctx, monthPrefix, amountOverride, {
          ignoreRoleGates,
        });
        if (ev && ev.amount > 0) {
          chosen = { rule, ...ev };
          if (rule.stackable === false) break;
          break;
        }
        if (ev && ev.amount === 0 && String(type.calculation_type) === 'attendance_based') {
          chosen = { rule, ...ev };
          break;
        }
      }
    }

    // Package row with a fixed amount but no matching/evaluable rule still pays the package amount.
    // Skip for commission — $0 when sales miss the gate / no rule; never fall back to package $ fixed.
    const isCommissionType = isCommissionCalculation(
      String(type.calculation_type),
      type.code
    );
    if (
      !chosen &&
      !isCommissionType &&
      template?.amount != null &&
      Number.isFinite(Number(template.amount)) &&
      num(template.amount) > 0
    ) {
      chosen = {
        rule: {
          id: template.ruleId ?? `package-${typeId}`,
          rule_name: 'Allowance package',
          trigger_type: 'package',
          priority: 0,
          formula: null,
          stackable: false,
        },
        amount: roundUsd(num(template.amount)),
        applied: { source: 'allowance_package', amount: num(template.amount) },
      };
    }

    if (!chosen || (chosen.amount === 0 && String(type.code) === 'COMMISSION')) continue;

    const line: AppliedAllowanceLine = {
      allowanceTypeId: typeId,
      code: type.code,
      name: type.name,
      category: type.category,
      calculationType: type.calculation_type,
      amount: chosen.amount,
      taxable: type.taxable,
      ruleId: String(chosen.rule.id),
      ruleName: String(chosen.rule.rule_name),
      triggerType: String(chosen.rule.trigger_type),
      priority: num(chosen.rule.priority),
      appliedConditions: chosen.applied,
      formula: (chosen.rule.formula as string) ?? null,
    };

    if (!appliedByType.has(typeId) || !typeRules.some((r) => r.stackable === false)) {
      appliedByType.set(typeId, line);
      lines.push(line);
    }
  }

  const legacy = {
    transport: 0,
    attendance: 0,
    meal: 0,
    seniority: 0,
    position: 0,
    commission: 0,
    otMeal: 0,
  };

  for (const line of lines) {
    const field = LEGACY_ALLOWANCE_FIELD_BY_CODE[line.code];
    if (field) {
      legacy[field] += line.amount;
      continue;
    }
    // Custom commission / position codes still feed indemnity salary basis.
    const code = String(line.code || '').toUpperCase();
    const calc = String(line.calculationType || '').toLowerCase();
    const trigger = String(line.triggerType || '').toLowerCase();
    if (
      code.includes('COMMISSION') ||
      calc === 'commission_based' ||
      calc === 'commission' ||
      trigger === 'commission'
    ) {
      legacy.commission += line.amount;
      continue;
    }
    if (code.includes('POSITION') || calc.includes('position')) {
      legacy.position += line.amount;
    }
  }

  const total = roundUsd(lines.reduce((s, l) => s + l.amount, 0));

  return { lines, legacy, total, audit: [...lines] };
}
