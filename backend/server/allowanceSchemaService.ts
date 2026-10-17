import {
  AllowanceType,
  AllowanceRule,
  AllowanceTemplate,
} from './db.js';
import { ALLOWANCE_TYPE_CODES } from './allowanceTypes.js';

const DEFAULT_TYPES: Array<{
  id: string;
  code: string;
  name: string;
  category: string;
  calculation_type: string;
  taxable: boolean;
  description: string;
}> = [
  {
    id: 'at-transport',
    code: ALLOWANCE_TYPE_CODES.TRANSPORT,
    name: 'Transportation Allowance',
    category: 'fixed',
    calculation_type: 'fixed',
    taxable: true,
    description: 'Monthly transportation allowance.',
  },
  {
    id: 'at-meal',
    code: ALLOWANCE_TYPE_CODES.MEAL,
    name: 'Meal Allowance',
    category: 'fixed',
    calculation_type: 'fixed',
    taxable: true,
    description: 'Monthly meal allowance.',
  },
  {
    id: 'at-attendance',
    code: ALLOWANCE_TYPE_CODES.ATTENDANCE,
    name: 'Attendance Allowance',
    category: 'attendance',
    calculation_type: 'attendance_based',
    taxable: true,
    description: 'Attendance performance allowance with absence/late deductions.',
  },
  {
    id: 'at-position',
    code: ALLOWANCE_TYPE_CODES.POSITION,
    name: 'Position Allowance',
    category: 'position',
    calculation_type: 'conditional',
    taxable: true,
    description: 'Role or designation-based allowance.',
  },
  {
    id: 'at-commission',
    code: ALLOWANCE_TYPE_CODES.COMMISSION,
    name: 'Commission',
    category: 'commission',
    calculation_type: 'commission_based',
    taxable: true,
    description: 'Sales or performance commission.',
  },
  {
    id: 'at-other',
    code: ALLOWANCE_TYPE_CODES.OTHER,
    name: 'Other Allowance',
    category: 'fixed',
    calculation_type: 'fixed',
    taxable: true,
    description: 'Custom onboarding or ad-hoc allowance.',
  },
];

/** Default rules mirror legacy payroll engine ($30 transport, $50 meal, etc.). */
const DEFAULT_RULES: Array<{
  id: string;
  allowance_type_id: string;
  rule_name: string;
  trigger_type: string;
  condition_json: Record<string, unknown>;
  fixed_amount: number;
  percentage_rate: number;
  priority: number;
  stackable: boolean;
}> = [
  {
    id: 'ar-transport-default',
    allowance_type_id: 'at-transport',
    rule_name: 'Standard transport (base salary > 0)',
    trigger_type: 'fixed',
    condition_json: { requires_base_salary: true },
    fixed_amount: 30,
    percentage_rate: 0,
    priority: 100,
    stackable: true,
  },
  {
    id: 'ar-meal-default',
    allowance_type_id: 'at-meal',
    rule_name: 'Standard meal (base salary > 0)',
    trigger_type: 'fixed',
    condition_json: { requires_base_salary: true },
    fixed_amount: 50,
    percentage_rate: 0,
    priority: 100,
    stackable: true,
  },
  {
    id: 'ar-attendance-full',
    allowance_type_id: 'at-attendance',
    rule_name: 'Full attendance bonus',
    trigger_type: 'attendance',
    condition_json: {
      present_min: 10,
      absence_max: 0,
      late_max: 999,
      full_amount: 70,
      one_absence_pct: 50,
      two_plus_absence_pct: 0,
    },
    fixed_amount: 70,
    percentage_rate: 0,
    priority: 100,
    stackable: true,
  },
  {
    id: 'ar-position-manager',
    allowance_type_id: 'at-position',
    rule_name: 'Manager position allowance',
    trigger_type: 'position',
    // Amount is paid via Manager package (or title filter). Portal roles are not payment gates.
    condition_json: { position_titles: [], amount: 100 },
    fixed_amount: 100,
    percentage_rate: 0,
    priority: 300,
    stackable: true,
  },
  {
    id: 'ar-position-supervisor',
    allowance_type_id: 'at-position',
    rule_name: 'Supervisor position allowance',
    trigger_type: 'position',
    condition_json: { position_titles: ['Supervisor'], amount: 50 },
    fixed_amount: 50,
    percentage_rate: 0,
    priority: 290,
    stackable: true,
  },
  {
    id: 'ar-commission-default',
    allowance_type_id: 'at-commission',
    rule_name: 'Sales commission (inactive until configured)',
    trigger_type: 'commission',
    condition_json: { sales_threshold: 5000, commission_pct: 3, sales_amount: 0 },
    fixed_amount: 0,
    percentage_rate: 3,
    priority: 100,
    stackable: true,
  },
];

export async function ensureEmployeeAllowanceTemplateColumn(): Promise<void> {
  const { sequelize } = await import('./db.js');
  try {
    const [rows]: any = await sequelize.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'allowance_template_id' LIMIT 1`
    );
    if (Array.isArray(rows) && rows.length) return;
    await sequelize.query(
      'ALTER TABLE `employees` ADD COLUMN `allowance_template_id` VARCHAR(64) NULL'
    );
    console.log('[db] Added employees.allowance_template_id.');
  } catch (err) {
    console.warn('[db] Could not add employees.allowance_template_id:', (err as Error)?.message || err);
  }
}

export async function ensureAllowanceRulesSchema(): Promise<void> {
  await ensureEmployeeAllowanceTemplateColumn();
  const { ensureAllowanceTemplateItemsConsolidated } = await import('./tableConsolidationService.js');
  await ensureAllowanceTemplateItemsConsolidated();
  await AllowanceType.sync();
  await AllowanceRule.sync();
  await AllowanceTemplate.sync();
  const { EmployeeAllowanceAssignment } = await import('./db.js');
  await EmployeeAllowanceAssignment.sync();

  const { ensurePayslipAllowanceColumns } = await import('./payslipBreakdownService.js');
  await ensurePayslipAllowanceColumns();

  const typeCount = await AllowanceType.count();
  if (typeCount === 0) {
    await AllowanceType.bulkCreate(DEFAULT_TYPES);
    console.log('[db] Seeded allowance_types.');
  } else {
    for (const t of DEFAULT_TYPES) {
      const exists = await AllowanceType.findOne({ where: { code: t.code } });
      if (!exists) await AllowanceType.create(t);
    }
  }

  const ruleCount = await AllowanceRule.count();
  if (ruleCount === 0) {
    await AllowanceRule.bulkCreate(
      DEFAULT_RULES.map((r) => ({
        ...r,
        active: r.id !== 'ar-commission-default',
        effective_from: null,
        effective_to: null,
      }))
    );
    console.log('[db] Seeded allowance_rules.');
  } else {
    for (const r of DEFAULT_RULES) {
      const exists = await AllowanceRule.findByPk(r.id);
      if (!exists) {
        await AllowanceRule.create({
          ...r,
          active: r.id !== 'ar-commission-default',
          effective_from: null,
          effective_to: null,
        });
      }
    }
  }

  await seedDefaultAllowanceTemplates();
  await deactivateLegacySeniorityAllowances();
  await deactivateRetiredOtMealAllowances();
}

const LEGACY_SENIORITY_TYPE_ID = 'at-seniority';
const LEGACY_SENIORITY_RULE_IDS = ['ar-seniority-1-2', 'ar-seniority-3-5', 'ar-seniority-6-plus'];

/** Retire allowance-catalog seniority — payroll uses Seniority Rules engine (`calculateSeniorityForPayroll`). */
export async function deactivateLegacySeniorityAllowances(): Promise<void> {
  await AllowanceType.update(
    { active: false },
    { where: { code: ALLOWANCE_TYPE_CODES.SENIORITY } }
  );
  await AllowanceType.update({ active: false }, { where: { id: LEGACY_SENIORITY_TYPE_ID } });
  await AllowanceRule.update({ active: false }, { where: { id: LEGACY_SENIORITY_RULE_IDS } });
  const senType = await AllowanceType.findOne({
    where: { code: ALLOWANCE_TYPE_CODES.SENIORITY },
    attributes: ['id'],
  });
  if (senType) {
    await AllowanceRule.update(
      { active: false },
      { where: { allowance_type_id: String(senType.get('id')) } }
    );
  }
}

const RETIRED_OT_MEAL_TYPE_ID = 'at-ot-meal';
const RETIRED_OT_MEAL_RULE_IDS = ['ar-ot-meal-2h'];

/** Retire OT meal allowance — meals provided physically, not via payroll. */
export async function deactivateRetiredOtMealAllowances(): Promise<void> {
  await AllowanceType.update(
    { active: false },
    { where: { code: ALLOWANCE_TYPE_CODES.OT_MEAL } }
  );
  await AllowanceType.update({ active: false }, { where: { id: RETIRED_OT_MEAL_TYPE_ID } });
  await AllowanceRule.update({ active: false }, { where: { id: RETIRED_OT_MEAL_RULE_IDS } });
  const otType = await AllowanceType.findOne({
    where: { code: ALLOWANCE_TYPE_CODES.OT_MEAL },
    attributes: ['id'],
  });
  if (otType) {
    await AllowanceRule.update(
      { active: false },
      { where: { allowance_type_id: String(otType.get('id')) } }
    );
  }
}

const DEFAULT_TEMPLATE_PACKAGES: Array<{
  id: string;
  template_name: string;
  items: Array<{
    id: string;
    allowance_type_id: string;
    allowance_rule_id: string;
    amount: number;
  }>;
}> = [
  {
    id: 'atpl-standard',
    template_name: 'Standard employee package',
    items: [
      {
        id: 'ati-std-transport',
        allowance_type_id: 'at-transport',
        allowance_rule_id: 'ar-transport-default',
        amount: 30,
      },
      {
        id: 'ati-std-meal',
        allowance_type_id: 'at-meal',
        allowance_rule_id: 'ar-meal-default',
        amount: 50,
      },
      {
        id: 'ati-std-attendance',
        allowance_type_id: 'at-attendance',
        allowance_rule_id: 'ar-attendance-full',
        amount: 70,
      },
    ],
  },
  {
    id: 'atpl-manager',
    template_name: 'Manager package',
    items: [
      {
        id: 'ati-mgr-transport',
        allowance_type_id: 'at-transport',
        allowance_rule_id: 'ar-transport-default',
        amount: 30,
      },
      {
        id: 'ati-mgr-meal',
        allowance_type_id: 'at-meal',
        allowance_rule_id: 'ar-meal-default',
        amount: 50,
      },
      {
        id: 'ati-mgr-position',
        allowance_type_id: 'at-position',
        allowance_rule_id: 'ar-position-manager',
        amount: 100,
      },
    ],
  },
];

async function seedDefaultAllowanceTemplates(): Promise<void> {
  // Clear legacy department/role scoping (packages are assigned explicitly).
  try {
    await AllowanceTemplate.update(
      { department_id: null, role_id: null } as never,
      { where: {} }
    );
  } catch {
    /* columns may not exist yet on first boot */
  }

  for (const pkg of DEFAULT_TEMPLATE_PACKAGES) {
    const exists = await AllowanceTemplate.findByPk(pkg.id);
    if (!exists) {
      await AllowanceTemplate.create({
        id: pkg.id,
        template_name: pkg.template_name,
        department_id: null,
        role_id: null,
        active: true,
        items_json: pkg.items,
      } as never);
      console.log(`[db] Seeded allowance template: ${pkg.template_name}`);
      continue;
    }

    const itemsJson = exists.get('items_json');
    const hasItems =
      Array.isArray(itemsJson) && itemsJson.length > 0
        ? true
        : typeof itemsJson === 'string' && itemsJson.trim().length > 2;
    if (!hasItems) {
      await exists.update({ items_json: pkg.items } as never);
      console.log(`[db] Backfilled allowance template items: ${pkg.template_name}`);
    }
  }
}
