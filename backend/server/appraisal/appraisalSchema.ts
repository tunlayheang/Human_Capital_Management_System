import crypto from 'crypto';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../db.js';
import type {
  AttendanceDeductionRuleRow,
  KpiComponentRow,
  RecommendationRuleRow,
} from './appraisalTypes.js';

export function appraisalId(): string {
  return `appr-${crypto.randomBytes(8).toString('hex')}`;
}

const TABLES = [
  `CREATE TABLE IF NOT EXISTS appraisal_periods (
    id VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    period_type VARCHAR(16) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by VARCHAR(64) NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    KEY idx_ap_period_dates (start_date, end_date),
    KEY idx_ap_period_status (status),
    KEY idx_ap_period_active (is_active)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS employee_appraisals (
    id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    period_id VARCHAR(64) NOT NULL,
    workflow_status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    self_review_notes TEXT NULL,
    self_review_at DATETIME NULL,
    supervisor_id VARCHAR(64) NULL,
    supervisor_submitted_at DATETIME NULL,
    manager_id VARCHAR(64) NULL,
    manager_reviewed_at DATETIME NULL,
    hr_approved_by VARCHAR(64) NULL,
    hr_approved_at DATETIME NULL,
    final_approved_by VARCHAR(64) NULL,
    final_approved_at DATETIME NULL,
    raw_score DECIMAL(6,2) NULL,
    weighted_score DECIMAL(6,2) NULL,
    final_grade VARCHAR(8) NULL,
    recommendation TEXT NULL,
    locked TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_appraisal_user_period (user_id, period_id),
    KEY idx_ea_period (period_id),
    KEY idx_ea_user (user_id),
    KEY idx_ea_status (workflow_status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS appraisal_component_scores (
    id VARCHAR(64) NOT NULL,
    appraisal_id VARCHAR(64) NOT NULL,
    component_id VARCHAR(64) NOT NULL,
    raw_score DECIMAL(6,2) NOT NULL,
    weighted_score DECIMAL(6,2) NOT NULL,
    hr_raw_score DECIMAL(6,2) NULL,
    manager_raw_score DECIMAL(6,2) NULL,
    auto_calculated TINYINT(1) NOT NULL DEFAULT 0,
    comment TEXT NULL,
    evaluation_notes TEXT NULL,
    calculated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_acs_appraisal_component (appraisal_id, component_id),
    KEY idx_acs_appraisal (appraisal_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

];

const DEFAULT_COMPONENTS: Omit<KpiComponentRow, 'created_at' | 'updated_at'>[] = [
  {
    id: 'kpi-attendance',
    name: 'Attendance',
    description: 'Automatic score from attendance records',
    weight_percent: 20,
    scoring_method: 'AUTOMATIC',
    auto_metric: 'ATTENDANCE',
    sort_order: 1,
    active: 1,
  },
  {
    id: 'kpi-task-completion',
    name: 'Task Completion',
    description: 'Automatic score from assigned tasks',
    weight_percent: 30,
    scoring_method: 'AUTOMATIC',
    auto_metric: 'TASK_COMPLETION',
    sort_order: 2,
    active: 1,
  },
  {
    id: 'kpi-quality',
    name: 'Quality of Work',
    description: 'Manual evaluation by supervisor',
    weight_percent: 15,
    scoring_method: 'MANUAL',
    auto_metric: null,
    sort_order: 3,
    active: 1,
  },
  {
    id: 'kpi-teamwork',
    name: 'Teamwork',
    description: 'Manual evaluation',
    weight_percent: 10,
    scoring_method: 'MANUAL',
    auto_metric: null,
    sort_order: 4,
    active: 1,
  },
  {
    id: 'kpi-discipline',
    name: 'Discipline',
    description: 'Manual evaluation',
    weight_percent: 10,
    scoring_method: 'MANUAL',
    auto_metric: null,
    sort_order: 5,
    active: 1,
  },
  {
    id: 'kpi-initiative',
    name: 'Initiative',
    description: 'Manual evaluation',
    weight_percent: 5,
    scoring_method: 'MANUAL',
    auto_metric: null,
    sort_order: 6,
    active: 1,
  },
  {
    id: 'kpi-communication',
    name: 'Communication',
    description: 'Manual evaluation',
    weight_percent: 5,
    scoring_method: 'MANUAL',
    auto_metric: null,
    sort_order: 7,
    active: 1,
  },
  {
    id: 'kpi-leadership',
    name: 'Leadership',
    description: 'Manual evaluation',
    weight_percent: 5,
    scoring_method: 'MANUAL',
    auto_metric: null,
    sort_order: 8,
    active: 1,
  },
];

const DEFAULT_ATTENDANCE_RULES: Omit<AttendanceDeductionRuleRow, never>[] = [
  {
    id: 'att-late-1-2',
    rule_type: 'LATE',
    min_count: 1,
    max_count: 2,
    deduction_points: 2,
    active: 1,
    sort_order: 1,
  },
  {
    id: 'att-late-3-5',
    rule_type: 'LATE',
    min_count: 3,
    max_count: 5,
    deduction_points: 5,
    active: 1,
    sort_order: 2,
  },
  {
    id: 'att-absence-1',
    rule_type: 'ABSENCE',
    min_count: 1,
    max_count: 1,
    deduction_points: 10,
    active: 1,
    sort_order: 3,
  },
  {
    id: 'att-absence-2plus',
    rule_type: 'ABSENCE',
    min_count: 2,
    max_count: null,
    deduction_points: 20,
    active: 1,
    sort_order: 4,
  },
  {
    id: 'att-early-1-2',
    rule_type: 'EARLY_LEAVE',
    min_count: 1,
    max_count: 2,
    deduction_points: 2,
    active: 1,
    sort_order: 5,
  },
];

const DEFAULT_RECOMMENDATIONS = [
  {
    id: 'rec-a-plus',
    grade_codes: ['A+', 'A'],
    type: 'PROMOTION_CANDIDATE',
    message: 'Promotion candidate / Bonus candidate',
    sort_order: 1,
  },
  {
    id: 'rec-b',
    grade_codes: ['B+', 'B'],
    type: 'MEETS_EXPECTATIONS',
    message: 'Meets expectations',
    sort_order: 2,
  },
  {
    id: 'rec-c',
    grade_codes: ['C+', 'C'],
    type: 'IMPROVEMENT_PLAN',
    message: 'Performance improvement plan recommended',
    sort_order: 3,
  },
  {
    id: 'rec-df',
    grade_codes: ['D', 'F'],
    type: 'PERFORMANCE_WARNING',
    message: 'Performance warning — coaching required',
    sort_order: 4,
  },
];

export async function ensureAppraisalSchema(): Promise<void> {
  const { ensureKpiConfigSchema, KPI_CONFIG_TABLE } = await import('./kpiConfigSchema.js');
  await ensureKpiConfigSchema();
  for (const sql of TABLES) {
    await sequelize.query(sql);
  }
  const { ensureAppraisalColumnMigrations } = await import('./appraisalSchemaMigration.js');
  await ensureAppraisalColumnMigrations();
  await seedDefaultsIfEmpty(KPI_CONFIG_TABLE);
}

async function seedDefaultsIfEmpty(kpiTable: string): Promise<void> {
  const [countRow] = (await sequelize.query(
    `SELECT COUNT(*) AS c FROM \`${kpiTable}\` WHERE kind = 'component'`,
    { type: QueryTypes.SELECT }
  )) as Array<{ c: number }>;
  if (Number(countRow?.c) > 0) return;

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  for (const c of DEFAULT_COMPONENTS) {
    await sequelize.query(
      `INSERT INTO \`${kpiTable}\`
       (id, kind, name, description, weight_percent, scoring_method, auto_metric, sort_order, active, created_at, updated_at)
       VALUES (:id, 'component', :name, :description, :weight, :method, :metric, :sort, 1, :now, :now)`,
      {
        replacements: {
          id: c.id,
          name: c.name,
          description: c.description,
          weight: c.weight_percent,
          method: c.scoring_method,
          metric: c.auto_metric,
          sort: c.sort_order,
          now,
        },
      }
    );
  }

  for (const r of DEFAULT_ATTENDANCE_RULES) {
    await sequelize.query(
      `INSERT INTO \`${kpiTable}\`
       (id, kind, rule_type, min_count, max_count, deduction_points, deduction_mode, active, sort_order, created_at, updated_at)
       VALUES (:id, 'attendance_rule', :type, :min, :max, :ded, 'RANGE', 1, :sort, :now, :now)`,
      {
        replacements: {
          id: r.id,
          type: r.rule_type,
          min: r.min_count,
          max: r.max_count,
          ded: r.deduction_points,
          sort: r.sort_order,
          now,
        },
      }
    );
  }

  for (const r of DEFAULT_RECOMMENDATIONS) {
    await sequelize.query(
      `INSERT INTO \`${kpiTable}\`
       (id, kind, grade_codes_json, recommendation_type, message, active, sort_order, created_at, updated_at)
       VALUES (:id, 'recommendation', :grades, :type, :msg, 1, :sort, :now, :now)`,
      {
        replacements: {
          id: r.id,
          grades: JSON.stringify(r.grade_codes),
          type: r.type,
          msg: r.message,
          sort: r.sort_order,
          now,
        },
      }
    );
  }

  console.log('[db] Seeded default KPI components and appraisal rules.');
}
