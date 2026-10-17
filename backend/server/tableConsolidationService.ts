import { QueryTypes } from 'sequelize';
import { sequelize, SystemSetting } from './db.js';
import {
  NSSF_CONFIG_SETTING_KEY,
  ensureDefaultNssfConfigSetting,
  type NssfConfigPayload,
} from './nssfConfigService.js';

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = (await sequelize.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column], type: QueryTypes.SELECT }
  )) as unknown[];
  return rows.length > 0;
}

async function tableExists(table: string): Promise<boolean> {
  const rows = (await sequelize.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    { replacements: [table], type: QueryTypes.SELECT }
  )) as unknown[];
  return rows.length > 0;
}

/** Merge singleton nssfconfigs row into systemsettings, then drop nssfconfigs. */
export async function ensureNssfConfigConsolidated(): Promise<void> {
  if (!(await tableExists('nssfconfigs'))) {
    await ensureDefaultNssfConfigSetting();
    return;
  }

  const legacyRows = (await sequelize.query(`SELECT * FROM nssfconfigs ORDER BY isActive DESC, id ASC LIMIT 1`, {
    type: QueryTypes.SELECT,
  })) as Array<Record<string, unknown>>;

  const legacy = legacyRows[0];
  const payload: NssfConfigPayload = legacy
    ? {
        id: String(legacy.id ?? 'nssf-1'),
        employeeRate: Number(legacy.employeeRate ?? 4),
        employerRate: Number(legacy.employerRate ?? 4),
        capAmount: Number(legacy.capAmount ?? 1300000),
        currency: String(legacy.currency ?? 'KHR'),
        isActive: legacy.isActive !== false && legacy.isActive !== 0,
        effectiveFrom: legacy.effectiveFrom != null ? String(legacy.effectiveFrom) : null,
      }
    : {
        id: 'nssf-1',
        employeeRate: 4,
        employerRate: 4,
        capAmount: 1300000,
        currency: 'KHR',
        isActive: true,
      };

  const existing = await SystemSetting.findOne({ where: { key: NSSF_CONFIG_SETTING_KEY } });
  if (existing) {
    await existing.update({ value: payload } as never);
  } else {
    await SystemSetting.create({
      id: 'ss-nssf-config',
      key: NSSF_CONFIG_SETTING_KEY,
      value: payload,
      category: 'payroll',
      description: 'NSSF contribution rates and cap',
    } as never);
  }

  await sequelize.query('DROP TABLE IF EXISTS `nssfconfigs`', { raw: true });
  console.log('[db] Consolidated nssfconfigs into systemsettings (payroll.nssf_config). Legacy table dropped.');
}

type LegacyTemplateItem = {
  id: string;
  template_id: string;
  allowance_type_id: string;
  allowance_rule_id?: string | null;
  amount?: number | string | null;
};

/** Merge allowance_template_items rows into allowance_templates.items_json, then drop child table. */
export async function ensureAllowanceTemplateItemsConsolidated(): Promise<void> {
  if (!(await columnExists('allowance_templates', 'items_json'))) {
    await sequelize.query('ALTER TABLE `allowance_templates` ADD COLUMN `items_json` JSON NULL');
    console.log('[db] Added allowance_templates.items_json column.');
  }

  if (!(await tableExists('allowance_template_items'))) {
    return;
  }

  const legacyRows = (await sequelize.query(
    `SELECT id, template_id, allowance_type_id, allowance_rule_id, amount
     FROM allowance_template_items
     ORDER BY template_id ASC, id ASC`,
    { type: QueryTypes.SELECT }
  )) as LegacyTemplateItem[];

  const grouped = new Map<string, LegacyTemplateItem[]>();
  for (const row of legacyRows) {
    const templateId = String(row.template_id ?? '').trim();
    if (!templateId) continue;
    const list = grouped.get(templateId) ?? [];
    list.push(row);
    grouped.set(templateId, list);
  }

  let migrated = 0;
  for (const [templateId, items] of grouped.entries()) {
    const payload = items.map((row) => ({
      id: String(row.id),
      allowance_type_id: String(row.allowance_type_id),
      allowance_rule_id: row.allowance_rule_id ? String(row.allowance_rule_id) : null,
      amount: row.amount != null ? Number(row.amount) : 0,
    }));

    await sequelize.query(
      `UPDATE allowance_templates
       SET items_json = :payload
       WHERE id = :templateId
         AND (items_json IS NULL OR JSON_LENGTH(items_json) = 0)`,
      { replacements: { payload: JSON.stringify(payload), templateId } }
    );
    migrated += 1;
  }

  await sequelize.query('DROP TABLE IF EXISTS `allowance_template_items`', { raw: true });
  console.log(
    `[db] Consolidated allowance_template_items into allowance_templates.items_json` +
      (migrated ? ` (${migrated} template(s)).` : '.') +
      ' Legacy table dropped.'
  );
}

/** Safe table-count reductions — idempotent, runs after module schemas are ready. */
export async function ensureTableConsolidations(): Promise<void> {
  await ensureAllowanceTemplateItemsConsolidated();
  await ensureNssfConfigConsolidated();
}
