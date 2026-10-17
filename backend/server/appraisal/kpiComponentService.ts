import { QueryTypes } from 'sequelize';
import { sequelize } from '../db.js';
import type {
  AttendanceDeductionRuleRow,
  KpiAutoMetric,
  KpiComponentRow,
  KpiScoringMethod,
  RecommendationRuleRow,
} from './appraisalTypes.js';
import { appraisalId } from './appraisalSchema.js';
import { KPI_CONFIG_TABLE } from './kpiConfigSchema.js';

const COMPONENT_KIND = 'component';
const ATTENDANCE_KIND = 'attendance_rule';
const RECOMMENDATION_KIND = 'recommendation';

export async function listKpiComponents(
  activeOnly = false,
  asOfDate?: string | null
): Promise<KpiComponentRow[]> {
  const clauses: string[] = [`kind = '${COMPONENT_KIND}'`];
  const replacements: Record<string, unknown> = {};
  if (activeOnly) clauses.push('active = 1');
  if (asOfDate) {
    clauses.push('(effective_from IS NULL OR effective_from <= :asOfDate)');
    replacements.asOfDate = asOfDate;
  }
  const where = `WHERE ${clauses.join(' AND ')}`;
  return (await sequelize.query(
    `SELECT * FROM \`${KPI_CONFIG_TABLE}\` ${where} ORDER BY sort_order ASC, name ASC`,
    { replacements, type: QueryTypes.SELECT }
  )) as KpiComponentRow[];
}

export async function getKpiComponent(id: string): Promise<KpiComponentRow | null> {
  const rows = (await sequelize.query(
    `SELECT * FROM \`${KPI_CONFIG_TABLE}\` WHERE id = :id AND kind = :kind LIMIT 1`,
    { replacements: { id, kind: COMPONENT_KIND }, type: QueryTypes.SELECT }
  )) as KpiComponentRow[];
  return rows[0] ?? null;
}

export function validateComponentWeights(components: KpiComponentRow[]): string | null {
  const active = components.filter((c) => Number(c.active) === 1);
  const total = active.reduce((sum, c) => sum + Number(c.weight_percent), 0);
  if (active.length === 0) return 'At least one active KPI component is required';
  if (Math.abs(total - 100) > 0.01) {
    return `Active component weights must total 100% (currently ${total.toFixed(2)}%)`;
  }
  return null;
}

/**
 * Validate the incoming save payload before any DB writes so an invalid weight total can never
 * leave the table in a partial/over-100 state. Active weights must total exactly 100%.
 */
export function validateComponentWeightsPayload(
  items: Array<{ weightPercent: number; active?: boolean }>
): string | null {
  const active = items.filter((item) => item.active !== false);
  if (active.length === 0) return 'At least one active KPI component is required';
  const total = active.reduce((sum, item) => sum + (Number(item.weightPercent) || 0), 0);
  if (total > 100.01) {
    return `Active component weights cannot exceed 100% (currently ${total.toFixed(2)}%)`;
  }
  if (Math.abs(total - 100) > 0.01) {
    return `Active component weights must total 100% (currently ${total.toFixed(2)}%)`;
  }
  return null;
}

export async function deleteKpiComponent(id: string): Promise<void> {
  await sequelize.query(`DELETE FROM appraisal_component_scores WHERE component_id = :id`, {
    replacements: { id },
  });
  await sequelize.query(
    `DELETE FROM \`${KPI_CONFIG_TABLE}\` WHERE id = :id AND kind = :kind`,
    { replacements: { id, kind: COMPONENT_KIND } }
  );
}

export async function saveKpiComponents(
  items: Array<{
    id?: string;
    name: string;
    description?: string | null;
    weightPercent: number;
    scoringMethod: KpiScoringMethod;
    autoMetric?: KpiAutoMetric;
    sortOrder?: number;
    active?: boolean;
    effectiveFrom?: string | null;
  }>,
  performedBy?: string | null
): Promise<KpiComponentRow[]> {
  // Reject bad weight totals BEFORE deleting/writing so the table can never be left over 100%.
  const payloadError = validateComponentWeightsPayload(items);
  if (payloadError) throw new Error(payloadError);

  const before = (await listKpiComponents()).map((row) => ({
    id: row.id,
    name: row.name,
    weightPercent: Number(row.weight_percent),
    scoringMethod: row.scoring_method,
    autoMetric: row.auto_metric,
    active: Number(row.active) === 1,
    effectiveFrom: row.effective_from ? String(row.effective_from).slice(0, 10) : null,
  }));
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const keepIds = new Set(
    items.map((item) => item.id?.trim()).filter((id): id is string => Boolean(id))
  );

  const existing = await listKpiComponents();
  for (const row of existing) {
    if (!keepIds.has(row.id)) {
      await deleteKpiComponent(row.id);
    }
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const id = item.id?.trim() || appraisalId().replace('appr-', 'kpi-');
    const row = {
      name: item.name.trim(),
      description: item.description?.trim() || null,
      weight_percent: Number(item.weightPercent) || 0,
      scoring_method: item.scoringMethod,
      auto_metric: item.autoMetric ?? null,
      sort_order: item.sortOrder ?? i + 1,
      active: item.active === false ? 0 : 1,
      effective_from: item.effectiveFrom?.trim() || null,
    };

    const existingRow = item.id ? await getKpiComponent(item.id) : null;
    if (existingRow) {
      await sequelize.query(
        `UPDATE \`${KPI_CONFIG_TABLE}\` SET
          name = :name, description = :desc, weight_percent = :weight,
          scoring_method = :method, auto_metric = :metric, sort_order = :sort,
          active = :active, effective_from = :effectiveFrom, updated_at = :now
         WHERE id = :id AND kind = :kind`,
        {
          replacements: {
            id,
            kind: COMPONENT_KIND,
            name: row.name,
            desc: row.description,
            weight: row.weight_percent,
            method: row.scoring_method,
            metric: row.auto_metric,
            sort: row.sort_order,
            active: row.active,
            effectiveFrom: row.effective_from,
            now,
          },
        }
      );
    } else {
      await sequelize.query(
        `INSERT INTO \`${KPI_CONFIG_TABLE}\`
         (id, kind, name, description, weight_percent, scoring_method, auto_metric, sort_order, active, effective_from, created_at, updated_at)
         VALUES (:id, :kind, :name, :desc, :weight, :method, :metric, :sort, :active, :effectiveFrom, :now, :now)`,
        {
          replacements: {
            id,
            kind: COMPONENT_KIND,
            name: row.name,
            desc: row.description,
            weight: row.weight_percent,
            method: row.scoring_method,
            metric: row.auto_metric,
            sort: row.sort_order,
            active: row.active,
            effectiveFrom: row.effective_from,
            now,
          },
        }
      );
    }
  }

  const allActive = await listKpiComponents(true);
  const err = validateComponentWeights(allActive);
  if (err) throw new Error(err);

  const saved = await listKpiComponents();
  const after = saved.map((row) => ({
    id: row.id,
    name: row.name,
    weightPercent: Number(row.weight_percent),
    scoringMethod: row.scoring_method,
    autoMetric: row.auto_metric,
    active: Number(row.active) === 1,
    effectiveFrom: row.effective_from ? String(row.effective_from).slice(0, 10) : null,
  }));
  const { writeAppraisalConfigAudit } = await import('./appraisalConfigAuditService.js');
  await writeAppraisalConfigAudit({
    configKey: 'kpi_components',
    oldValue: before,
    newValue: after,
    performedBy,
  });
  return saved;
}

export async function listAttendanceDeductionRules(): Promise<AttendanceDeductionRuleRow[]> {
  return (await sequelize.query(
    `SELECT * FROM \`${KPI_CONFIG_TABLE}\`
     WHERE kind = :kind AND active = 1 ORDER BY sort_order ASC`,
    { replacements: { kind: ATTENDANCE_KIND }, type: QueryTypes.SELECT }
  )) as AttendanceDeductionRuleRow[];
}

export async function saveAttendanceDeductionRules(
  rules: Array<{
    id?: string;
    ruleType: AttendanceDeductionRuleRow['rule_type'];
    minCount: number;
    maxCount?: number | null;
    deductionPoints: number;
    deductionMode?: string;
    active?: boolean;
    sortOrder?: number;
  }>,
  performedBy?: string | null
): Promise<AttendanceDeductionRuleRow[]> {
  const before = (await listAttendanceDeductionRules()).map((row) => ({
    id: row.id,
    ruleType: row.rule_type,
    minCount: Number(row.min_count),
    maxCount: row.max_count != null ? Number(row.max_count) : null,
    deductionPoints: Number(row.deduction_points),
    deductionMode: row.deduction_mode,
    active: Number(row.active) === 1,
  }));
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await sequelize.query(`DELETE FROM \`${KPI_CONFIG_TABLE}\` WHERE kind = :kind`, {
    replacements: { kind: ATTENDANCE_KIND },
  });
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    await sequelize.query(
      `INSERT INTO \`${KPI_CONFIG_TABLE}\`
       (id, kind, rule_type, min_count, max_count, deduction_points, deduction_mode, active, sort_order, created_at, updated_at)
       VALUES (:id, :kind, :type, :min, :max, :ded, :mode, :active, :sort, :now, :now)`,
      {
        replacements: {
          id: r.id || `att-rule-${i + 1}`,
          kind: ATTENDANCE_KIND,
          type: r.ruleType,
          min: r.minCount,
          max: r.maxCount ?? null,
          ded: r.deductionPoints,
          mode: (r.deductionMode ?? 'RANGE').toUpperCase(),
          active: r.active === false ? 0 : 1,
          sort: r.sortOrder ?? i + 1,
          now,
        },
      }
    );
  }
  const saved = await listAttendanceDeductionRules();
  const after = saved.map((row) => ({
    id: row.id,
    ruleType: row.rule_type,
    minCount: Number(row.min_count),
    maxCount: row.max_count != null ? Number(row.max_count) : null,
    deductionPoints: Number(row.deduction_points),
    deductionMode: row.deduction_mode,
    active: Number(row.active) === 1,
  }));
  const { writeAppraisalConfigAudit } = await import('./appraisalConfigAuditService.js');
  await writeAppraisalConfigAudit({
    configKey: 'kpi_attendance_rules',
    oldValue: before,
    newValue: after,
    performedBy,
  });
  return saved;
}

export async function listRecommendationRules(): Promise<RecommendationRuleRow[]> {
  return (await sequelize.query(
    `SELECT * FROM \`${KPI_CONFIG_TABLE}\`
     WHERE kind = :kind AND active = 1 ORDER BY sort_order ASC`,
    { replacements: { kind: RECOMMENDATION_KIND }, type: QueryTypes.SELECT }
  )) as RecommendationRuleRow[];
}

export async function saveRecommendationRules(
  rules: Array<{
    id?: string;
    gradeCodes: string[];
    recommendationType: string;
    message: string;
    active?: boolean;
    sortOrder?: number;
  }>,
  performedBy?: string | null
): Promise<RecommendationRuleRow[]> {
  const before = (await listRecommendationRules()).map((row) => ({
    id: row.id,
    gradeCodes: JSON.parse(String(row.grade_codes_json || '[]')) as string[],
    recommendationType: row.recommendation_type,
    message: row.message,
    active: Number(row.active) === 1,
  }));
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await sequelize.query(`DELETE FROM \`${KPI_CONFIG_TABLE}\` WHERE kind = :kind`, {
    replacements: { kind: RECOMMENDATION_KIND },
  });
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    await sequelize.query(
      `INSERT INTO \`${KPI_CONFIG_TABLE}\`
       (id, kind, grade_codes_json, recommendation_type, message, active, sort_order, created_at, updated_at)
       VALUES (:id, :kind, :grades, :type, :msg, :active, :sort, :now, :now)`,
      {
        replacements: {
          id: r.id || `rec-rule-${i + 1}`,
          kind: RECOMMENDATION_KIND,
          grades: JSON.stringify(r.gradeCodes),
          type: r.recommendationType,
          msg: r.message,
          active: r.active === false ? 0 : 1,
          sort: r.sortOrder ?? i + 1,
          now,
        },
      }
    );
  }
  const saved = await listRecommendationRules();
  const after = saved.map((row) => ({
    id: row.id,
    gradeCodes: JSON.parse(String(row.grade_codes_json || '[]')) as string[],
    recommendationType: row.recommendation_type,
    message: row.message,
    active: Number(row.active) === 1,
  }));
  const { writeAppraisalConfigAudit } = await import('./appraisalConfigAuditService.js');
  await writeAppraisalConfigAudit({
    configKey: 'kpi_recommendation_rules',
    oldValue: before,
    newValue: after,
    performedBy,
  });
  return saved;
}

export async function resolveRecommendation(grade: string): Promise<string | null> {
  const rules = await listRecommendationRules();
  for (const rule of rules) {
    try {
      const codes = JSON.parse(String(rule.grade_codes_json)) as string[];
      if (codes.includes(grade)) return rule.message;
    } catch {
      /* skip */
    }
  }
  return null;
}
