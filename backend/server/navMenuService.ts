import {
  NAV_MENU_CATALOG,
  MENU_MANAGEABLE_ROLES,
  buildDefaultRoleMenuConfig,
  sanitizeRoleMenuConfig,
  pathsVisibleForRole,
  buildRouteGuardsFromConfig,
  ensureHrInherentMenuPaths,
  ensureApprovalsPathForRole,
  ensurePerformancePathForRole,
  ensureSelfPerformancePathForRole,
  type RoleMenuConfigPayload,
} from './navMenuCatalog.js';
import {
  ensureRoleMenuPermissionTemplates,
  migrateRoleMenuFromLegacyStores,
  seedDefaultRoleMenuTemplatesIfEmpty,
} from './roleMenuPersistence.js';

let cachedConfig: RoleMenuConfigPayload | null = null;

/** Role sidebar paths — always derived from catalog defaults (permission matrix controls access). */
export const loadRoleMenuConfig = async (): Promise<RoleMenuConfigPayload> => {
  if (cachedConfig) return cachedConfig;
  cachedConfig = sanitizeRoleMenuConfig({ version: 1, roles: buildDefaultRoleMenuConfig() });
  return cachedConfig;
};

export const clearRoleMenuCache = () => {
  cachedConfig = null;
};

export async function ensureRoleMenuStorage(): Promise<void> {
  await ensureRoleMenuPermissionTemplates();
  const mig = await migrateRoleMenuFromLegacyStores();
  if (mig.migrated) {
    console.log('[db] Migrated legacy role menu visibility into permissiontemplates.');
  }
  await seedDefaultRoleMenuTemplatesIfEmpty();
  clearRoleMenuCache();
}

export const getMenuForUser = async (role: string) => {
  const config = await loadRoleMenuConfig();
  return {
    paths: pathsVisibleForRole(role, config),
    routeGuards: buildRouteGuardsFromConfig(config),
  };
};
