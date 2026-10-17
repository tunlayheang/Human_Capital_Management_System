import crypto from 'crypto';
import { sequelize, SystemSetting } from '../../db.js';

const CREATE_RULES_SQL = `
CREATE TABLE IF NOT EXISTS seniority_rules (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  accrual_type VARCHAR(32) NOT NULL,
  accrual_config JSON NOT NULL,
  calculation_base VARCHAR(32) NOT NULL DEFAULT 'basic_salary',
  eligibility_rules JSON NOT NULL,
  proration_rules JSON NOT NULL,
  payment_frequency VARCHAR(32) NOT NULL DEFAULT 'monthly',
  applicable_groups JSON NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_sr_active (active),
  KEY idx_sr_effective (effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const CREATE_LEDGER_SQL = `
CREATE TABLE IF NOT EXISTS seniority_ledger (
  id VARCHAR(64) NOT NULL,
  employee_id VARCHAR(64) NOT NULL,
  type VARCHAR(24) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  balance_after DECIMAL(12,2) NOT NULL,
  payroll_month VARCHAR(7) NULL,
  reference_id VARCHAR(64) NULL,
  reason VARCHAR(255) NULL,
  rule_id VARCHAR(64) NULL,
  snapshot JSON NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_sl_employee (employee_id),
  KEY idx_sl_month (payroll_month),
  KEY idx_sl_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const CREATE_PROFILE_SQL = `
CREATE TABLE IF NOT EXISTS employee_seniority_profiles (
  employee_id VARCHAR(64) NOT NULL,
  active_rule_id VARCHAR(64) NULL,
  total_service_days INT NOT NULL DEFAULT 0,
  current_balance_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  last_calculated_date DATE NULL,
  last_accrual_usd DECIMAL(12,2) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

export function seniorityRuleId(): string {
  return `sr-${crypto.randomBytes(8).toString('hex')}`;
}

export function seniorityLedgerId(): string {
  return `sl-${crypto.randomBytes(10).toString('hex')}`;
}

const DEFAULT_RULES = [
  {
    id: 'sr-default-service-tiers',
    name: 'Service-based seniority (template)',
    description: 'Inactive template — milestone accrual by years of service. Activate to include in payroll.',
    effective_from: '2020-01-01',
    accrual_type: 'service_tiers',
    accrual_config: {
      tiers: [
        { yearsMin: 0, yearsMax: 0, amountUsd: 0 },
        { yearsMin: 1, yearsMax: 2, amountUsd: 10 },
        { yearsMin: 3, yearsMax: 4, amountUsd: 20 },
        { yearsMin: 5, yearsMax: 99, amountUsd: 40 },
      ],
    },
    eligibility_rules: {
      employeeStatuses: ['active'],
      excludeProbation: true,
      minWorkingDaysInMonth: 0,
    },
    proration_rules: { enabled: true, basis: 'eligible_payroll_days' },
    payment_frequency: 'monthly',
    applicable_groups: { allEmployees: true },
    priority: 100,
    active: false,
  },
  {
    id: 'sr-fixed-5',
    name: 'Fixed $5 monthly (inactive template)',
    description: 'Fixed monthly accrual — enable for all staff if preferred over tiers.',
    effective_from: '2020-01-01',
    accrual_type: 'fixed_monthly',
    accrual_config: { amountUsd: 5 },
    eligibility_rules: { employeeStatuses: ['active'], employmentTypes: ['Full-Time', 'Permanent'] },
    proration_rules: { enabled: true, basis: 'eligible_payroll_days' },
    payment_frequency: 'monthly',
    applicable_groups: { allEmployees: true },
    priority: 200,
    active: false,
  },
];

const SEEDED_DEFAULT_RULE_ID = 'sr-default-service-tiers';
const SEEDED_DEFAULT_INACTIVE_KEY = 'seniority.seededDefaultMonthlyInactive';

/** One-time: turn off auto-active monthly accrual; legal indemnity uses compliance rules instead. */
async function deactivateSeededDefaultMonthlySeniorityIfNeeded(): Promise<void> {
  const marker = await SystemSetting.findOne({ where: { key: SEEDED_DEFAULT_INACTIVE_KEY } });
  if (marker) return;
  await sequelize.query(
    `UPDATE seniority_rules SET active = 0, updated_at = NOW() WHERE id = :id AND active = 1`,
    { replacements: { id: SEEDED_DEFAULT_RULE_ID } }
  );
  await SystemSetting.create({
    id: 'ss-seniority-default-monthly-inactive',
    key: SEEDED_DEFAULT_INACTIVE_KEY,
    value: JSON.stringify({ deactivatedAt: new Date().toISOString() }),
    description:
      'Marker: seeded monthly seniority policy deactivated (legal indemnity uses compliance rules).',
    category: 'payroll',
    isPublic: false,
  });
}

export async function ensureSeniorityEngineSchema(): Promise<void> {
  await sequelize.query(CREATE_RULES_SQL);
  await sequelize.query(CREATE_LEDGER_SQL);
  await sequelize.query(CREATE_PROFILE_SQL);

  const [existing] = (await sequelize.query(
    'SELECT id FROM seniority_rules WHERE id = :id LIMIT 1',
    { replacements: { id: DEFAULT_RULES[0]!.id } }
  )) as [Array<{ id: string }>, unknown];

  if (existing?.length) {
    await deactivateSeededDefaultMonthlySeniorityIfNeeded();
    return;
  }

  const now = new Date();
  for (const r of DEFAULT_RULES) {
    await sequelize.query(
      `INSERT INTO seniority_rules
        (id, name, description, effective_from, effective_to, accrual_type, accrual_config, calculation_base,
         eligibility_rules, proration_rules, payment_frequency, applicable_groups, priority, active, created_at, updated_at)
       VALUES
        (:id, :name, :description, :effective_from, NULL, :accrual_type, :accrual_config, 'basic_salary',
         :eligibility_rules, :proration_rules, :payment_frequency, :applicable_groups, :priority, :active, :now, :now)`,
      {
        replacements: {
          id: r.id,
          name: r.name,
          description: r.description,
          effective_from: r.effective_from,
          accrual_type: r.accrual_type,
          accrual_config: JSON.stringify(r.accrual_config),
          eligibility_rules: JSON.stringify(r.eligibility_rules),
          proration_rules: JSON.stringify(r.proration_rules),
          payment_frequency: r.payment_frequency,
          applicable_groups: JSON.stringify(r.applicable_groups),
          priority: r.priority,
          active: r.active ? 1 : 0,
          now,
        },
      }
    );
  }
  console.log('[db] Seeded seniority_rules defaults.');
  await deactivateSeededDefaultMonthlySeniorityIfNeeded();
}
