import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCatalogRoleMatrix,
  listCatalogPermissions,
  type SystemRoleName,
} from './permissionCatalog.js';
import { normalizeRoleActions, isRoleActionGranted } from './permissionActions.js';
import { applyAlwaysOnPermissions } from './alwaysOnPermissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type FilePermissionOverride = {
  id: string;
  userId: string;
  permissionId: string;
  overrideType: 'GRANT' | 'REVOKE';
  status: string;
  reason: string;
  expiresAt: string | null;
  grantedBy?: string;
  grantedByName?: string;
  createdAt: string;
  updatedAt?: string;
};

type PermissionStoreFile = {
  version: 1;
  /** Bumped when catalog role policy changes so stale Grant rows are re-seeded once. */
  policyVersion?: number;
  updatedAt: string;
  /** Role name → permission key → actions */
  matrix: Record<string, Record<string, string[]>>;
  overrides: FilePermissionOverride[];
};

/** Must match `actionsForRole` product policy (HR: no Project/Task manage, no Administration). */
/**
 * Bump this when catalog default *policy* for roles changes (e.g. HR loses a module).
 * On load, stores with a lower policyVersion are fully re-seeded from catalog defaults
 * so stale grants cannot stick after a deploy. User overrides are preserved.
 */
export const PERMISSION_MATRIX_POLICY_VERSION = 2;

const ROLE_NAMES: SystemRoleName[] = ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'];

let cache: PermissionStoreFile | null = null;
let writeChain: Promise<void> = Promise.resolve();

function storePath(): string {
  const fromEnv = String(process.env.PERMISSION_STORE_PATH || '').trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(__dirname, '..', 'data', 'permission-grants.json');
}

function cloneMatrix(matrix: Record<string, Record<string, string[]>>): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  for (const [role, grants] of Object.entries(matrix)) {
    out[role] = {};
    for (const [key, actions] of Object.entries(grants)) {
      out[role][key] = [...normalizeRoleActions(actions)];
    }
  }
  return out;
}

function seedFromCatalog(): PermissionStoreFile {
  return {
    version: 1,
    policyVersion: PERMISSION_MATRIX_POLICY_VERSION,
    updatedAt: new Date().toISOString(),
    matrix: cloneMatrix(buildCatalogRoleMatrix()),
    overrides: [],
  };
}

/**
 * Keep edited grants; add new catalog keys with defaults; drop removed catalog keys.
 * Empty arrays (Deny) are preserved — they are intentional, not "missing".
 * When policyVersion is behind, re-seed the full role matrix from catalog defaults
 * (preserves user overrides) so HR Project/Admin drift cannot stick after a code change.
 */
function mergeCatalogKeys(store: PermissionStoreFile): PermissionStoreFile {
  const defaults = buildCatalogRoleMatrix();
  const catalogKeys = new Set(listCatalogPermissions().map((p) => p.key));
  const policyStale =
    Number(store.policyVersion ?? 0) < PERMISSION_MATRIX_POLICY_VERSION;

  if (policyStale) {
    console.log(
      `[permissions] Re-seeding role matrix to catalog defaults (policy v${PERMISSION_MATRIX_POLICY_VERSION}).`
    );
    return {
      version: 1,
      policyVersion: PERMISSION_MATRIX_POLICY_VERSION,
      updatedAt: new Date().toISOString(),
      matrix: cloneMatrix(defaults),
      overrides: Array.isArray(store.overrides) ? store.overrides : [],
    };
  }

  const next: Record<string, Record<string, string[]>> = {};

  for (const role of ROLE_NAMES) {
    next[role] = {};
    const existing = store.matrix[role] || {};
    const seedingSelfView = !Object.prototype.hasOwnProperty.call(existing, 'projects.self.view');
    for (const key of catalogKeys) {
      if (Object.prototype.hasOwnProperty.call(existing, key)) {
        next[role][key] = normalizeRoleActions(existing[key]);
      } else {
        next[role][key] = [...normalizeRoleActions(defaults[role]?.[key])];
      }
    }

    /**
     * One-time split: staff previously used `projects.view` for My Project.
     * When introducing `projects.self.view`, move EMPLOYEE off the management key.
     */
    if (role === 'EMPLOYEE' && seedingSelfView) {
      if (isRoleActionGranted(next[role]['projects.view'])) {
        next[role]['projects.view'] = [];
      }
      if (isRoleActionGranted(next[role]['project.view'])) {
        next[role]['project.view'] = [];
      }
      if (!isRoleActionGranted(next[role]['projects.self.view'])) {
        next[role]['projects.self.view'] = ['view'];
      }
    }
  }

  return {
    ...store,
    policyVersion: PERMISSION_MATRIX_POLICY_VERSION,
    matrix: next,
    overrides: Array.isArray(store.overrides) ? store.overrides : [],
  };
}

function readStoreFromDisk(): PermissionStoreFile {
  const file = storePath();
  try {
    if (!fs.existsSync(file)) return seedFromCatalog();
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PermissionStoreFile>;
    if (!parsed || typeof parsed !== 'object' || !parsed.matrix) {
      return seedFromCatalog();
    }
    const beforePolicy = Number(parsed.policyVersion ?? 0);
    const merged = mergeCatalogKeys({
      version: 1,
      policyVersion: beforePolicy,
      updatedAt: String(parsed.updatedAt || new Date().toISOString()),
      matrix: parsed.matrix as Record<string, Record<string, string[]>>,
      overrides: Array.isArray(parsed.overrides)
        ? (parsed.overrides as FilePermissionOverride[])
        : [],
    });
    // Persist one-time policy re-seed so stale HR Project/Admin grants do not return.
    if (beforePolicy < PERMISSION_MATRIX_POLICY_VERSION) {
      try {
        persistStore(merged);
      } catch (err) {
        console.warn(
          '[permissions] Could not persist policy re-seed:',
          (err as Error)?.message || err
        );
      }
    }
    return merged;
  } catch (err) {
    console.warn(
      '[permissions] Could not read file store; using catalog defaults:',
      (err as Error)?.message || err
    );
    return seedFromCatalog();
  }
}

function persistStore(store: PermissionStoreFile): void {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

async function withWriteLock<T>(fn: () => T | Promise<T>): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prev = writeChain;
  writeChain = prev.then(() => gate);
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function loadPermissionStore(forceReload = false): Promise<PermissionStoreFile> {
  if (!forceReload && cache) return cache;
  const store = readStoreFromDisk();
  cache = store;
  return store;
}

export async function getPermissionMatrix(): Promise<Record<string, Record<string, string[]>>> {
  const store = await loadPermissionStore();
  return cloneMatrix(store.matrix);
}

export async function resetPermissionStoreToCatalogDefaults(options?: {
  /** When true, also remove all user overrides so effective permissions fully rollback. */
  clearOverrides?: boolean;
}): Promise<PermissionStoreFile> {
  return withWriteLock(async () => {
    const store = seedFromCatalog();
    const current = cache ?? readStoreFromDisk();
    store.overrides = options?.clearOverrides ? [] : current.overrides || [];
    persistStore(store);
    cache = store;
    return store;
  });
}

/**
 * Persist role Grant/Deny exactly as submitted. Empty actions = Deny.
 * Does not re-apply "inherent" keys — matrix is the source of truth.
 */
export async function saveRolePermissions(
  roleName: string,
  rolePermissions: Record<string, unknown>
): Promise<PermissionStoreFile> {
  const normalizedRole = String(roleName || '').toUpperCase();
  if (!ROLE_NAMES.includes(normalizedRole as SystemRoleName)) {
    throw Object.assign(new Error('Role not found'), { status: 404 });
  }

  return withWriteLock(async () => {
    const store = mergeCatalogKeys(cache ?? readStoreFromDisk());
    const roleMatrix = { ...(store.matrix[normalizedRole] || {}) };

    for (const [permissionKey, actionsValue] of Object.entries(rolePermissions)) {
      const actions = [...new Set(normalizeRoleActions(actionsValue))];
      roleMatrix[permissionKey] = actions;
    }

    if (normalizedRole === 'ADMIN') {
      const grantCount = Object.values(roleMatrix).filter((a) => isRoleActionGranted(a)).length;
      if (grantCount === 0) {
        throw Object.assign(
          new Error('Administrator role cannot be saved with zero grants.'),
          { status: 400 }
        );
      }
    }

    store.matrix[normalizedRole] = roleMatrix;
    store.updatedAt = new Date().toISOString();
    persistStore(store);
    cache = store;
    return store;
  });
}

export async function listFileOverrides(userId?: string): Promise<FilePermissionOverride[]> {
  const store = await loadPermissionStore();
  const rows = store.overrides || [];
  if (!userId) return rows.map((o) => ({ ...o }));
  const uid = String(userId).trim();
  return rows.filter((o) => o.userId === uid).map((o) => ({ ...o }));
}

export function serializeOverrideForApi(override: FilePermissionOverride) {
  const perm = listCatalogPermissions().find((p) => p.id === override.permissionId);
  return {
    ...override,
    permission: perm
      ? {
          id: perm.id,
          name: perm.name,
          key: perm.key,
          module: perm.module,
          description: perm.description,
          isSensitive: perm.isSensitive,
        }
      : undefined,
  };
}

export async function createFileOverride(input: {
  userId: string;
  permissionId: string;
  overrideType: 'GRANT' | 'REVOKE';
  reason: string;
  expiresAt?: string | null;
  grantedBy?: string;
  grantedByName?: string;
}): Promise<FilePermissionOverride> {
  const perm = listCatalogPermissions().find((p) => p.id === input.permissionId);
  if (!perm) {
    throw Object.assign(new Error('Permission not found'), { status: 404 });
  }

  return withWriteLock(async () => {
    const store = mergeCatalogKeys(cache ?? readStoreFromDisk());
    const now = new Date().toISOString();
    const override: FilePermissionOverride = {
      id: `ovr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId: String(input.userId).trim(),
      permissionId: input.permissionId,
      overrideType: input.overrideType,
      status: 'ACTIVE',
      reason: String(input.reason || ''),
      expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
      grantedBy: input.grantedBy,
      grantedByName: input.grantedByName,
      createdAt: now,
      updatedAt: now,
    };
    store.overrides = [override, ...store.overrides.filter((o) => o.id !== override.id)];
    store.updatedAt = now;
    persistStore(store);
    cache = store;
    return override;
  });
}

export async function deleteFileOverride(overrideId: string): Promise<boolean> {
  return withWriteLock(async () => {
    const store = mergeCatalogKeys(cache ?? readStoreFromDisk());
    const before = store.overrides.length;
    store.overrides = store.overrides.filter((o) => o.id !== overrideId);
    if (store.overrides.length === before) return false;
    store.updatedAt = new Date().toISOString();
    persistStore(store);
    cache = store;
    return true;
  });
}

/**
 * Effective map from file matrix + active overrides only.
 * Matrix Deny (empty actions) is respected — no inherent re-grant.
 * Applies to ADMIN, HR, MANAGER, and EMPLOYEE.
 */
export function buildEffectivePermissionsFromStore(
  roleName: string,
  userId: string,
  store: PermissionStoreFile
): Record<string, { actions: string[]; source: string }> {
  const normalized = String(roleName || '').toUpperCase();
  const matrixRole =
    normalized === 'SUPER_ADMIN' || normalized === 'ADMIN'
      ? 'ADMIN'
      : normalized === 'HR' || normalized === 'MANAGER' || normalized === 'EMPLOYEE'
        ? normalized
        : null;
  if (!matrixRole) {
    return {};
  }

  const roleMatrix = store.matrix[matrixRole] || {};
  const catalog = listCatalogPermissions();
  const now = Date.now();
  const overrideByPermId = new Map<string, FilePermissionOverride>();
  for (const o of store.overrides || []) {
    if (o.userId !== userId || o.status !== 'ACTIVE') continue;
    if (o.expiresAt && new Date(o.expiresAt).getTime() <= now) continue;
    overrideByPermId.set(o.permissionId, o);
  }

  const effective: Record<string, { actions: string[]; source: string }> = {};
  for (const perm of catalog) {
    const override = overrideByPermId.get(perm.id);
    if (override) {
      if (override.overrideType === 'GRANT') {
        // Override GRANT always unlocks the full action set for that catalog key so
        // Manage/Edit/Approve flows work after Allow — never view-only leftovers.
        effective[perm.key] = {
          actions: ['view', 'create', 'edit', 'delete', 'approve', 'export', 'manage'],
          source: 'override',
        };
      }
      continue;
    }
    const actions = normalizeRoleActions(roleMatrix[perm.key]);
    if (actions.length > 0) {
      effective[perm.key] = { actions, source: 'role' };
    }
  }

  // Matrix Deny (empty actions) is respected for every catalog key.
  return applyAlwaysOnPermissions(effective);
}

export function getPermissionStorePath(): string {
  return storePath();
}
