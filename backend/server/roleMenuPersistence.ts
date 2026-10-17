import { Op } from 'sequelize';
import { sequelize, PermissionTemplate, SystemSetting } from './db.js';
import {
  MENU_MANAGEABLE_ROLES,
  ROLE_MENU_SETTING_KEY,
  buildDefaultRoleMenuConfig,
  sanitizeRoleMenuConfig,
  type RoleMenuConfigPayload,
} from './navMenuCatalog.js';

export const ROLE_MENU_TEMPLATE_KIND = 'role_menu';
export const PERMISSION_BUNDLE_TEMPLATE_KIND = 'permission_bundle';

export function roleMenuTemplateId(roleCode: string): string {
  return `role-menu-${String(roleCode).toLowerCase()}`;
}

function parseLegacyMenuConfig(raw: unknown): RoleMenuConfigPayload | null {
  if (!raw) return null;
  try {
    const parsed =
      typeof raw === 'string'
        ? JSON.parse(raw)
        : typeof raw === 'object' && raw !== null && 'roles' in (raw as object)
          ? raw
          : null;
    if (!parsed) return null;
    return sanitizeRoleMenuConfig(parsed);
  } catch {
    return null;
  }
}

async function ensurePermissionTemplateColumns(): Promise<void> {
  const [cols] = (await sequelize.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'permissiontemplates'`
  )) as [{ COLUMN_NAME: string }[], unknown];
  const names = new Set((cols ?? []).map((c) => c.COLUMN_NAME));

  if (!names.has('template_kind')) {
    await sequelize.query(
      `ALTER TABLE permissiontemplates
       ADD COLUMN template_kind varchar(32) NOT NULL DEFAULT 'permission_bundle' AFTER description`
    );
  }
  if (!names.has('role_code')) {
    await sequelize.query(
      `ALTER TABLE permissiontemplates
       ADD COLUMN role_code varchar(32) DEFAULT NULL AFTER template_kind`
    );
  }
  await PermissionTemplate.sync();
}

/** Move rows from deprecated settings_role_menu_paths into permissiontemplates. */
async function migrateFromSettingsRoleMenuPathsTable(): Promise<boolean> {
  const [tables] = (await sequelize.query(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settings_role_menu_paths'`
  )) as [{ TABLE_NAME: string }[], unknown];
  if (!tables?.length) return false;

  const [rows] = (await sequelize.query(
    `SELECT role_code, menu_key, sort_order FROM settings_role_menu_paths ORDER BY role_code, sort_order`
  )) as [Array<{ role_code: string; menu_key: string }>, unknown];

  if (!rows?.length) {
    await sequelize.query('DROP TABLE IF EXISTS settings_role_menu_paths');
    return false;
  }

  const rolesInput: Record<string, string[]> = {};
  for (const row of rows) {
    const role = String(row.role_code || '').toUpperCase();
    const key = String(row.menu_key || '').trim();
    if (!role || !key) continue;
    (rolesInput[role] ??= []).push(key);
  }

  const config = sanitizeRoleMenuConfig({ version: 1, roles: rolesInput });
  await saveRoleMenuConfigToPermissionTemplates(config);
  await sequelize.query('DROP TABLE IF EXISTS settings_role_menu_paths');
  return true;
}

export async function ensureRoleMenuPermissionTemplates(): Promise<void> {
  await ensurePermissionTemplateColumns();
}

function parseStoredMenuPermissions(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((p) => String(p).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((p) => String(p).trim()).filter(Boolean);
      }
    } catch {
      /* ignore */
    }
  }
  return [];
}

export async function loadRoleMenuConfigFromPermissionTemplates(): Promise<RoleMenuConfigPayload | null> {
  await ensureRoleMenuPermissionTemplates();

  const rows = await PermissionTemplate.findAll({
    where: { template_kind: ROLE_MENU_TEMPLATE_KIND },
    order: [['role_code', 'ASC']],
  });
  if (!rows.length) return null;

  const rolesInput: Record<string, string[]> = {};
  for (const row of rows) {
    const plain = row.get({ plain: true }) as {
      role_code?: string;
      permissions?: unknown;
    };
    const role = String(plain.role_code || '').toUpperCase();
    if (!role) continue;
    rolesInput[role] = parseStoredMenuPermissions(plain.permissions);
  }

  return sanitizeRoleMenuConfig({ version: 1, roles: rolesInput });
}

export async function saveRoleMenuConfigToPermissionTemplates(
  config: RoleMenuConfigPayload
): Promise<void> {
  await ensureRoleMenuPermissionTemplates();
  const sanitized = sanitizeRoleMenuConfig(config);

  for (const roleCode of MENU_MANAGEABLE_ROLES) {
    const paths = sanitized.roles[roleCode] ?? [];
    const id = roleMenuTemplateId(roleCode);
    const rowPayload = {
      name: `Sidebar menu — ${roleCode}`,
      description: `Sidebar routes visible to ${roleCode} users (Permissions → Menu).`,
      template_kind: ROLE_MENU_TEMPLATE_KIND,
      role_code: roleCode,
      permissions: paths,
      createdBy: null,
    };

    const byRole = await PermissionTemplate.findOne({
      where: { role_code: roleCode, template_kind: ROLE_MENU_TEMPLATE_KIND },
    });
    if (byRole) {
      await byRole.update(rowPayload);
      continue;
    }

    const byId = await PermissionTemplate.findByPk(id);
    if (byId) {
      await byId.update(rowPayload);
      continue;
    }

    await PermissionTemplate.create({ id, ...rowPayload });
  }
}

export async function migrateRoleMenuFromLegacyStores(): Promise<{ migrated: boolean }> {
  const existing = await PermissionTemplate.count({
    where: { template_kind: ROLE_MENU_TEMPLATE_KIND },
  });
  if (existing > 0) {
    await SystemSetting.destroy({ where: { key: ROLE_MENU_SETTING_KEY } });
    await migrateFromSettingsRoleMenuPathsTable();
    return { migrated: false };
  }

  if (await migrateFromSettingsRoleMenuPathsTable()) {
    await SystemSetting.destroy({ where: { key: ROLE_MENU_SETTING_KEY } });
    return { migrated: true };
  }

  const legacy = await SystemSetting.findOne({ where: { key: ROLE_MENU_SETTING_KEY } });
  if (legacy) {
    const config = parseLegacyMenuConfig(legacy.get('value'));
    if (config) {
      await saveRoleMenuConfigToPermissionTemplates(config);
      await SystemSetting.destroy({ where: { key: ROLE_MENU_SETTING_KEY } });
      return { migrated: true };
    }
    await SystemSetting.destroy({ where: { key: ROLE_MENU_SETTING_KEY } });
  }

  return { migrated: false };
}

export async function seedDefaultRoleMenuTemplatesIfEmpty(): Promise<void> {
  const count = await PermissionTemplate.count({
    where: { template_kind: ROLE_MENU_TEMPLATE_KIND },
  });
  if (count > 0) return;
  const defaults = buildDefaultRoleMenuConfig();
  await saveRoleMenuConfigToPermissionTemplates(
    sanitizeRoleMenuConfig({ version: 1, roles: defaults })
  );
}

/** Exclude role-menu rows from permission-bundle template listings. */
export const permissionBundleTemplateWhere = {
  [Op.or]: [
    { template_kind: PERMISSION_BUNDLE_TEMPLATE_KIND },
    { template_kind: { [Op.is]: null } },
  ],
} as const;
