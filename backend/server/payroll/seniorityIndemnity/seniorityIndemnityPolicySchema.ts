import crypto from 'crypto';
import { PayrollComplianceRule, sequelize, SystemSetting } from '../../db.js';
import { parseSeniorityIndemnityConfig, DEFAULT_SENIORITY_INDEMNITY_CONFIG } from './seniorityIndemnityConfig.js';

const CREATE_POLICIES_SQL = `
CREATE TABLE IF NOT EXISTS seniority_indemnity_policies (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  legal_ref VARCHAR(255) NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  days_per_year DECIMAL(6,2) NOT NULL DEFAULT 15,
  payout_june_days DECIMAL(6,2) NOT NULL DEFAULT 7.5,
  payout_december_days DECIMAL(6,2) NOT NULL DEFAULT 7.5,
  daily_rate_method VARCHAR(32) NOT NULL DEFAULT 'scheduled_26',
  salary_basis JSON NOT NULL,
  eligible_contract_types JSON NOT NULL,
  excluded_employment_types JSON NOT NULL,
  inclusion_rule VARCHAR(32) NOT NULL DEFAULT 'after_probation',
  inclusion_months INT NOT NULL DEFAULT 0,
  working_days_divisor INT NOT NULL DEFAULT 26,
  extended_config JSON NULL,
  priority INT NOT NULL DEFAULT 100,
  active TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_sip_active (active),
  KEY idx_sip_effective (effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

export function seniorityIndemnityPolicyId(): string {
  return `sip-${crypto.randomBytes(8).toString('hex')}`;
}

const DEFAULT_TEMPLATE = {
  id: 'sip-cambodia-art89-template',
  name: 'Cambodian Labor Law (Art. 89) — template',
  description:
    '15 days per year paid semi-annually (7.5 days in June, 7.5 in December) for UDC employees.',
  legal_ref: 'Labor Law Art. 89',
  effective_from: '2020-01-01',
  days_per_year: DEFAULT_SENIORITY_INDEMNITY_CONFIG.daysPerYear,
  payout_june_days: DEFAULT_SENIORITY_INDEMNITY_CONFIG.payoutJuneDays,
  payout_december_days: DEFAULT_SENIORITY_INDEMNITY_CONFIG.payoutDecemberDays,
  daily_rate_method: DEFAULT_SENIORITY_INDEMNITY_CONFIG.dailyRateMethod,
  salary_basis: DEFAULT_SENIORITY_INDEMNITY_CONFIG.salaryBasis,
  eligible_contract_types: DEFAULT_SENIORITY_INDEMNITY_CONFIG.eligibleContractTypes,
  excluded_employment_types: DEFAULT_SENIORITY_INDEMNITY_CONFIG.excludedEmploymentTypes,
  inclusion_rule: DEFAULT_SENIORITY_INDEMNITY_CONFIG.inclusionRule,
  inclusion_months: DEFAULT_SENIORITY_INDEMNITY_CONFIG.inclusionMonths,
  priority: 100,
  active: false,
};

const MIGRATION_KEY = 'seniority_indemnity.policiesMigrated';

async function migrateFromComplianceRuleIfNeeded(): Promise<void> {
  const marker = await SystemSetting.findOne({ where: { key: MIGRATION_KEY } });
  if (marker) return;

  const compliance = await PayrollComplianceRule.findOne({
    where: { ruleKey: 'seniority_indemnity' },
  });
  const complianceCfg = parseSeniorityIndemnityConfig(compliance?.get('config'));
  const wasLive =
    compliance?.get('isActive') !== false && complianceCfg.enabled !== false;

  if (wasLive) {
    const now = new Date();
    await sequelize.query(
      `INSERT INTO seniority_indemnity_policies
        (id, name, description, legal_ref, effective_from, effective_to,
         days_per_year, payout_june_days, payout_december_days, daily_rate_method,
         salary_basis, eligible_contract_types, excluded_employment_types,
         inclusion_rule, inclusion_months, priority, active, created_at, updated_at)
       VALUES
        (:id, :name, :description, :legal_ref, :effective_from, NULL,
         :days_per_year, :payout_june_days, :payout_december_days, :daily_rate_method,
         :salary_basis, :eligible_contract_types, :excluded_employment_types,
         :inclusion_rule, :inclusion_months, :priority, 1, :now, :now)`,
      {
        replacements: {
          id: 'sip-company-active',
          name: 'Company seniority indemnity',
          description: 'Migrated from legacy compliance rule settings.',
          legal_ref: 'Labor Law Art. 89',
          effective_from: '2020-01-01',
          days_per_year: complianceCfg.daysPerYear,
          payout_june_days: complianceCfg.payoutJuneDays,
          payout_december_days: complianceCfg.payoutDecemberDays,
          daily_rate_method: complianceCfg.dailyRateMethod,
          salary_basis: JSON.stringify(complianceCfg.salaryBasis),
          eligible_contract_types: JSON.stringify(complianceCfg.eligibleContractTypes),
          excluded_employment_types: JSON.stringify(complianceCfg.excludedEmploymentTypes),
          inclusion_rule: complianceCfg.inclusionRule,
          inclusion_months: complianceCfg.inclusionMonths,
          priority: 50,
          now,
        },
      }
    );
    console.log('[db] Migrated active seniority indemnity policy from compliance rule.');
  }

  if (compliance) {
    await compliance.update({ isActive: false });
  }

  await SystemSetting.create({
    id: 'ss-seniority-indemnity-policies-migrated',
    key: MIGRATION_KEY,
    value: JSON.stringify({ migratedAt: new Date().toISOString(), wasLive }),
    description: 'Marker: seniority indemnity moved to configurable policies table.',
    category: 'payroll',
    isPublic: false,
  });
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = (await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column] }
  )) as [Array<{ ok: number }>, unknown];
  return Array.isArray(rows) && rows.length > 0;
}

async function ensurePolicyColumnAlters(): Promise<void> {
  const table = 'seniority_indemnity_policies';
  if (!(await columnExists(table, 'working_days_divisor'))) {
    await sequelize.query(
      `ALTER TABLE \`${table}\` ADD COLUMN \`working_days_divisor\` INT NOT NULL DEFAULT 26`
    );
  }
  if (!(await columnExists(table, 'extended_config'))) {
    await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`extended_config\` JSON NULL`);
  }
}

export async function ensureSeniorityIndemnityPolicySchema(): Promise<void> {
  await sequelize.query(CREATE_POLICIES_SQL);
  await ensurePolicyColumnAlters();

  const [existing] = (await sequelize.query(
    'SELECT id FROM seniority_indemnity_policies WHERE id = :id LIMIT 1',
    { replacements: { id: DEFAULT_TEMPLATE.id } }
  )) as [Array<{ id: string }>, unknown];

  if (!existing?.length) {
    const t = DEFAULT_TEMPLATE;
    const now = new Date();
    await sequelize.query(
      `INSERT INTO seniority_indemnity_policies
        (id, name, description, legal_ref, effective_from, effective_to,
         days_per_year, payout_june_days, payout_december_days, daily_rate_method,
         salary_basis, eligible_contract_types, excluded_employment_types,
         inclusion_rule, inclusion_months, priority, active, created_at, updated_at)
       VALUES
        (:id, :name, :description, :legal_ref, :effective_from, NULL,
         :days_per_year, :payout_june_days, :payout_december_days, :daily_rate_method,
         :salary_basis, :eligible_contract_types, :excluded_employment_types,
         :inclusion_rule, :inclusion_months, :priority, :active, :now, :now)`,
      {
        replacements: {
          ...t,
          salary_basis: JSON.stringify(t.salary_basis),
          eligible_contract_types: JSON.stringify(t.eligible_contract_types),
          excluded_employment_types: JSON.stringify(t.excluded_employment_types),
          active: t.active ? 1 : 0,
          now,
        },
      }
    );
    console.log('[db] Seeded seniority_indemnity_policies default template.');
  }

  await migrateFromComplianceRuleIfNeeded();
}
