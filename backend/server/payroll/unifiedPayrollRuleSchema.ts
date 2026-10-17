import crypto from 'crypto';
import { sequelize } from '../db.js';
import type { UnifiedPayrollRuleRow } from './unifiedPayrollRuleTypes.js';

const CREATE_RULES_SQL = `
CREATE TABLE IF NOT EXISTS unified_payroll_rules (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  category VARCHAR(32) NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'employee',
  mode VARCHAR(16) NOT NULL DEFAULT 'simple',
  condition_json JSON NOT NULL,
  action_json JSON NOT NULL,
  priority INT NOT NULL DEFAULT 50,
  active TINYINT(1) NOT NULL DEFAULT 1,
  is_template TINYINT(1) NOT NULL DEFAULT 0,
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  effective_from DATE NULL,
  effective_to DATE NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_upr_category (category),
  KEY idx_upr_active (active),
  KEY idx_upr_priority (priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const CREATE_LOGS_SQL = `
CREATE TABLE IF NOT EXISTS unified_payroll_rule_logs (
  id VARCHAR(64) NOT NULL,
  employee_id VARCHAR(64) NOT NULL,
  payroll_month VARCHAR(7) NULL,
  rule_id VARCHAR(64) NOT NULL,
  triggered_at DATETIME NOT NULL,
  input_snapshot JSON NULL,
  output_result JSON NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_uprl_employee (employee_id),
  KEY idx_uprl_rule (rule_id),
  KEY idx_uprl_month (payroll_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

function ruleId(): string {
  return `upr-${crypto.randomBytes(8).toString('hex')}`;
}

const DEFAULT_RULES: Omit<UnifiedPayrollRuleRow, 'created_at' | 'updated_at'>[] = [
  {
    id: 'upr-leave-paid-default',
    name: 'Paid leave → payable day',
    description: 'Approved paid leave types count toward present/payable days.',
    category: 'leave',
    source: 'leave',
    mode: 'simple',
    condition_json: {
      mode: 'simple',
      logic: 'all',
      conditions: [{ field: 'leave.isPaid', op: 'eq', value: true }],
    },
    action_json: { type: 'set_leave_category', value: 'payable', merge: 'override' },
    priority: 10,
    active: true,
    is_template: true,
    is_system: true,
    effective_from: null,
    effective_to: null,
  },
  {
    id: 'upr-leave-unpaid-default',
    name: 'Unpaid leave → deduct day',
    description: 'Unpaid leave reduces salary via absence deduction.',
    category: 'leave',
    source: 'leave',
    mode: 'simple',
    condition_json: {
      mode: 'simple',
      logic: 'all',
      conditions: [{ field: 'leave.isPaid', op: 'eq', value: false }],
    },
    action_json: { type: 'set_leave_category', value: 'deductible', merge: 'override' },
    priority: 20,
    active: true,
    is_template: true,
    is_system: true,
    effective_from: null,
    effective_to: null,
  },
  {
    id: 'upr-att-present',
    name: 'Present → payable',
    category: 'attendance',
    source: 'attendance',
    mode: 'simple',
    condition_json: {
      mode: 'simple',
      logic: 'all',
      conditions: [{ field: 'attendance.status', op: 'eq', value: 'PRESENT' }],
    },
    action_json: {
      type: 'set_attendance_category',
      target: 'PRESENT',
      value: 'payable',
      merge: 'override',
    },
    priority: 10,
    active: true,
    is_template: true,
    is_system: true,
    effective_from: null,
    effective_to: null,
  },
  {
    id: 'upr-att-late',
    name: 'Late → payable',
    category: 'attendance',
    source: 'attendance',
    mode: 'simple',
    condition_json: {
      mode: 'simple',
      logic: 'all',
      conditions: [{ field: 'attendance.status', op: 'eq', value: 'LATE' }],
    },
    action_json: {
      type: 'set_attendance_category',
      target: 'LATE',
      value: 'payable',
      merge: 'override',
    },
    priority: 11,
    active: true,
    is_template: true,
    is_system: true,
    effective_from: null,
    effective_to: null,
  },
  {
    id: 'upr-att-absent',
    name: 'Absent → deduct',
    category: 'attendance',
    source: 'attendance',
    mode: 'simple',
    condition_json: {
      mode: 'simple',
      logic: 'all',
      conditions: [{ field: 'attendance.status', op: 'eq', value: 'ABSENT' }],
    },
    action_json: {
      type: 'set_attendance_category',
      target: 'ABSENT',
      value: 'deductible',
      merge: 'override',
    },
    priority: 12,
    active: true,
    is_template: true,
    is_system: true,
    effective_from: null,
    effective_to: null,
  },
  {
    id: 'upr-allow-transport-active',
    name: 'Active employee transport allowance',
    category: 'allowance',
    source: 'employee',
    mode: 'simple',
    condition_json: {
      mode: 'simple',
      logic: 'all',
      conditions: [
        { field: 'employee.status', op: 'eq', value: 'ACTIVE' },
        { field: 'contract.baseSalary', op: 'gt', value: 0 },
      ],
    },
    action_json: {
      type: 'add_allowance',
      code: 'TRANSPORT',
      name: 'Transport (rule)',
      amount: 30,
      merge: 'stack',
    },
    priority: 50,
    active: false,
    is_template: true,
    is_system: false,
    effective_from: null,
    effective_to: null,
  },
];

export async function ensureUnifiedPayrollRuleSchema(): Promise<void> {
  await sequelize.query(CREATE_RULES_SQL);
  await sequelize.query(CREATE_LOGS_SQL);

  const [existing] = (await sequelize.query(
    'SELECT id FROM unified_payroll_rules WHERE id = :id LIMIT 1',
    { replacements: { id: DEFAULT_RULES[0]!.id } }
  )) as [Array<{ id: string }>, unknown];

  if (existing?.length) return;

  const now = new Date();
  for (const r of DEFAULT_RULES) {
    await sequelize.query(
      `INSERT INTO unified_payroll_rules
        (id, name, description, category, source, mode, condition_json, action_json, priority, active, is_template, is_system, effective_from, effective_to, created_at, updated_at)
       VALUES
        (:id, :name, :description, :category, :source, :mode, :condition_json, :action_json, :priority, :active, :is_template, :is_system, :effective_from, :effective_to, :created_at, :updated_at)`,
      {
        replacements: {
          ...r,
          condition_json: JSON.stringify(r.condition_json),
          action_json: JSON.stringify(r.action_json),
          active: r.active ? 1 : 0,
          is_template: r.is_template ? 1 : 0,
          is_system: r.is_system ? 1 : 0,
          created_at: now,
          updated_at: now,
        },
      }
    );
  }
  console.log('[db] Seeded unified_payroll_rules defaults.');
}

export { ruleId };
