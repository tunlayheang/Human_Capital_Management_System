import { Api } from './api';
import { resolvePermissionKeys } from '../constants/permissionKeys';
import { Role } from '../types';
import { roleGrantsInherentPermission } from '../utils/roleInherentPermissions';

export type PermissionRecord = {
  id: string;
  name: string;
  key: string;
  module: string;
  description?: string;
  isSensitive?: boolean;
};

export type UserOverrideRecord = {
  id: string;
  userId: string;
  permissionId: string;
  overrideType: 'GRANT' | 'REVOKE';
  status: string;
  reason: string;
  expiresAt?: string | null;
  grantedBy?: string;
  grantedByName?: string;
  createdAt: string;
  permission?: PermissionRecord;
};

export type RoleId = 'admin' | 'hr' | 'manager' | 'employee';
export type PermissionGrantState = boolean | null;

const BACKEND_ROLE_BY_ID: Record<RoleId, string> = {
  admin: 'ADMIN',
  hr: 'HR',
  manager: 'MANAGER',
  employee: 'EMPLOYEE',
};

const ROLE_TO_ID: Record<Role, RoleId> = {
  [Role.ADMIN]: 'admin',
  [Role.HR]: 'hr',
  [Role.MANAGER]: 'manager',
  [Role.EMPLOYEE]: 'employee',
};

type Listener = () => void;

/** Normalize DB/API role action payloads (array or JSON string). */
export function normalizeRoleActions(actions: unknown): string[] {
  if (Array.isArray(actions)) {
    return actions.map((action) => String(action)).filter(Boolean);
  }
  if (typeof actions === 'string') {
    const trimmed = actions.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((action) => String(action)).filter(Boolean);
      }
    } catch {
      return [trimmed];
    }
  }
  return [];
}

export function isRoleActionGranted(actions: unknown): boolean {
  return normalizeRoleActions(actions).length > 0;
}

function defaultGrantActionsForKey(key: string, existing: string[]): string[] {
  if (existing.length > 0) return existing;
  if (key === 'hr.payroll.process') return ['view', 'create', 'approve'];
  if (key.includes('.approve') || key.endsWith('.approve')) return ['view', 'approve'];
  if (key.includes('.export')) return ['view', 'export'];
  if (key.includes('.manage')) return ['view', 'create', 'edit', 'delete', 'manage'];
  if (key.includes('.create')) return ['view', 'create'];
  if (key.includes('.edit')) return ['view', 'edit'];
  return ['view'];
}

function resolveOverrideUserId(row: Record<string, unknown>): string {
  const nestedUser = row.user as Record<string, unknown> | undefined;
  const raw = row.userId ?? row.user_id ?? nestedUser?.id ?? '';
  return String(raw).trim();
}

function resolveOverridePermissionId(row: Record<string, unknown>): string {
  const nestedPerm = row.permission as Record<string, unknown> | undefined;
  const raw = row.permissionId ?? row.permission_id ?? nestedPerm?.id ?? '';
  return String(raw).trim();
}

function normalizeOverride(row: Record<string, unknown>): UserOverrideRecord | null {
  const id = String(row.id ?? '').trim();
  const userId = resolveOverrideUserId(row);
  const permissionId = resolveOverridePermissionId(row);
  if (!id || !userId || userId === 'undefined' || !permissionId) return null;

  const permissionRaw = row.permission as Record<string, unknown> | undefined;
  const permission: PermissionRecord | undefined = permissionRaw
    ? {
        id: String(permissionRaw.id ?? permissionId),
        name: String(permissionRaw.name ?? permissionRaw.key ?? permissionId),
        key: String(permissionRaw.key ?? ''),
        module: String(permissionRaw.module ?? 'general'),
        description:
          permissionRaw.description != null ? String(permissionRaw.description) : undefined,
        isSensitive: permissionRaw.isSensitive === true,
      }
    : undefined;

  return {
    id,
    userId,
    permissionId,
    overrideType: (row.overrideType ?? row.override_type ?? 'GRANT') as 'GRANT' | 'REVOKE',
    status: String(row.status || 'ACTIVE'),
    reason: String(row.reason || ''),
    expiresAt: (row.expiresAt as string | null) ?? (row.expires_at as string | null) ?? null,
    grantedBy:
      row.grantedBy != null
        ? String(row.grantedBy)
        : row.granted_by != null
          ? String(row.granted_by)
          : undefined,
    grantedByName:
      (row.grantedByName as string) ||
      (row.grantedBy != null ? String(row.grantedBy) : 'System'),
    createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
    permission,
  };
}

class PermissionService {
  private permissions: PermissionRecord[] = [];
  private matrix: Record<string, Record<string, string[]>> = {};
  private userOverrides: UserOverrideRecord[] = [];
  private permissionsLoaded = false;
  private overridesLoaded = false;

  private rolePermissions: Record<RoleId, Record<string, PermissionGrantState>> = {
    admin: {},
    hr: {},
    manager: {},
    employee: {},
  };

  private hydratedRoles = new Set<RoleId>();
  private listeners = new Set<Listener>();
  private initialized = false;
  private sessionRole: Role | string | undefined;
  private loadGeneration = 0;

  /** Admin-only permission management UI — not used for normal session checks. */
  static canLoadPermissionCatalog(role?: Role | string): boolean {
    const r = String(role ?? '').toUpperCase();
    return r === 'ADMIN' || r === 'SUPER_ADMIN';
  }

  isReady(): boolean {
    return this.permissionsLoaded;
  }

  reset(): void {
    this.initialized = false;
    this.permissionsLoaded = false;
    this.overridesLoaded = false;
    this.sessionRole = undefined;
    this.hydratedRoles.clear();
    this.permissions = [];
    this.matrix = {};
    this.userOverrides = [];
    this.rolePermissions = { admin: {}, hr: {}, manager: {}, employee: {} };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  /**
   * Session bootstrap. Employees/managers skip admin-only `/permissions` APIs;
   * AuthContext loads effective permissions via `GET /users/:id/permissions`.
   */
  async initialize(options?: { role?: Role | string }): Promise<void> {
    const role = options?.role ?? this.sessionRole;
    if (this.initialized && this.sessionRole === role) return;

    const wasInitialized = this.initialized;
    this.sessionRole = role;
    this.permissionsLoaded = false;
    this.overridesLoaded = false;

    if (!role || !PermissionService.canLoadPermissionCatalog(role)) {
      this.permissions = [];
      this.matrix = {};
      this.userOverrides = [];
      this.permissionsLoaded = true;
      this.overridesLoaded = true;
      this.initialized = true;
      if (!wasInitialized) this.notify();
      return;
    }

    this.hydratedRoles.clear();
    this.rolePermissions = { admin: {}, hr: {}, manager: {}, employee: {} };
    await this.loadPermissions();
    await this.loadUserOverrides();
    this.initialized = true;
    this.notify();
  }

  async fetchPermissions(): Promise<void> {
    await this.initialize({ role: Role.ADMIN });
  }

  findPermissionByKey(key: string): PermissionRecord | undefined {
    return this.permissions.find((p) => p.key === key);
  }

  async loadPermissions(force = false): Promise<void> {
    if (this.permissionsLoaded && !force) return;
    const generation = ++this.loadGeneration;
    try {
      const data = await Api.system.getPermissions();
      if (generation !== this.loadGeneration) return;
      this.permissions = data?.permissions || [];
      this.matrix = data?.matrix || {};
    } catch {
      if (generation !== this.loadGeneration) return;
      // Session might not have permission to view catalog (403). Keep safe empty state.
      this.permissions = [];
      this.matrix = {};
    }
    if (generation !== this.loadGeneration) return;
    this.permissionsLoaded = true;
    this.hydratedRoles.clear();
    this.rolePermissions = { admin: {}, hr: {}, manager: {}, employee: {} };
    this.notify();
  }

  async loadUserOverrides(): Promise<void> {
    if (this.overridesLoaded) return;
    try {
      const rows = await Api.system.getAllUserOverrides();
      this.userOverrides = (Array.isArray(rows) ? rows : [])
        .map((row) => normalizeOverride(row as Record<string, unknown>))
        .filter((row): row is UserOverrideRecord => row != null);
    } catch {
      this.userOverrides = [];
    }
    this.overridesLoaded = true;
  }

  async reloadOverrides(): Promise<void> {
    this.overridesLoaded = false;
    await this.loadUserOverrides();
    this.notify();
  }

  async refresh(): Promise<void> {
    // Soft refresh: keep existing catalog/overrides visible until the new payload arrives
    // so admin UI counts (e.g. System Rules) do not flicker to 0 mid-request.
    this.initialized = false;
    this.permissionsLoaded = false;
    this.overridesLoaded = false;
    this.hydratedRoles.clear();
    this.sessionRole = undefined;
    await this.initialize({ role: Role.ADMIN });
  }

  /** Drop cached role hydration and reload matrix from API (permission admin UI). */
  async reloadPermissionsFromServer(): Promise<void> {
    this.permissionsLoaded = false;
    this.hydratedRoles.clear();
    await this.loadPermissions(true);
  }

  getAll(): PermissionRecord[] {
    return this.permissions;
  }

  getMatrix(): Record<string, Record<string, string[]>> {
    return this.matrix;
  }

  getAllUserOverrides(): UserOverrideRecord[] {
    return this.userOverrides;
  }

  getUserOverrides(userId: string): UserOverrideRecord[] {
    const uid = String(userId).trim();
    return this.userOverrides.filter((o) => o.userId === uid);
  }

  isOverrideActive(override: UserOverrideRecord): boolean {
    if (override.expiresAt == null) return true;
    return new Date(override.expiresAt) > new Date();
  }

  async addUserOverride(
    userId: string,
    permId: string,
    overrideType: 'GRANT' | 'REVOKE',
    reason: string,
    expiresAt?: string | null,
    _grantedBy?: { id: string; name: string }
  ): Promise<UserOverrideRecord> {
    const result = (await Api.system.createUserOverride(userId, {
      permissionId: permId,
      overrideType,
      reason,
      expiresAt: expiresAt || undefined,
    })) as Record<string, unknown>;

    if (result.request && !result.id) {
      throw new Error(
        String(result.message || 'This permission requires approval before it takes effect.')
      );
    }

    const created = normalizeOverride(result);
    if (created) {
      this.userOverrides = [
        created,
        ...this.userOverrides.filter((o) => o.id !== created.id),
      ];
      this.overridesLoaded = true;
      this.notify();
    }

    await this.reloadOverrides();

    if (!created) {
      throw new Error('Override was saved but could not be read back. Refresh the page.');
    }
    return created;
  }

  async removeUserOverride(userId: string, overrideId: string): Promise<void> {
    await Api.system.deleteUserOverride(userId, overrideId);
    await this.reloadOverrides();
  }

  roleIdFromUserRole(role: Role | string): RoleId {
    const normalized = String(role ?? '')
      .trim()
      .toUpperCase();
    if (normalized === 'ADMIN' || normalized === 'SUPER_ADMIN') return 'admin';
    if (normalized === 'HR') return 'hr';
    if (normalized === 'MANAGER') return 'manager';
    if (normalized === 'EMPLOYEE' || normalized === 'STAFF') return 'employee';
    return ROLE_TO_ID[role as Role] ?? 'employee';
  }

  private hydrateRole(roleId: RoleId): void {
    if (this.hydratedRoles.has(roleId)) return;

    const backendRole = BACKEND_ROLE_BY_ID[roleId];
    const roleMatrix = this.matrix[backendRole] || {};

    for (const perm of this.permissions) {
      const actions = roleMatrix[perm.key];
      // Role matrix defines explicit defaults: granted or denied (no unset state).
      this.rolePermissions[roleId][perm.id] = isRoleActionGranted(actions);
    }

    this.hydratedRoles.add(roleId);
  }

  getRolePermissions(roleId: RoleId): Record<string, PermissionGrantState> {
    this.hydrateRole(roleId);
    return { ...this.rolePermissions[roleId] };
  }

  getPermissionState(roleId: RoleId, permId: string): PermissionGrantState {
    this.hydrateRole(roleId);
    const value = this.rolePermissions[roleId][permId];
    return value === undefined ? null : value;
  }

  getRolePermissionByKey(roleId: RoleId, permKey: string): PermissionGrantState {
    const perm = this.permissions.find((p) => p.key === permKey);
    if (!perm) return null;
    return this.getPermissionState(roleId, perm.id);
  }

  private getActiveOverrideForKey(
    userId: string,
    permKey: string
  ): UserOverrideRecord | undefined {
    const perm = this.permissions.find((p) => p.key === permKey);
    if (!perm) return undefined;
    return this.userOverrides.find(
      (o) =>
        o.userId === userId &&
        o.permissionId === perm.id &&
        this.isOverrideActive(o)
    );
  }

  effectivePermission(userId: string, userRole: Role, permKey: string): PermissionGrantState {
    const activeOverride = this.getActiveOverrideForKey(userId, permKey);
    if (activeOverride) {
      return activeOverride.overrideType === 'GRANT';
    }
    const roleId = this.roleIdFromUserRole(userRole);
    return this.getRolePermissionByKey(roleId, permKey);
  }

  /** Resolve spec key aliases; first defined catalog key wins. */
  effectivePermissionAny(userId: string, userRole: Role, specKey: string): PermissionGrantState {
    const keys = resolvePermissionKeys(specKey);
    let sawNull = false;
    for (const key of keys) {
      const perm = this.findPermissionByKey(key);
      if (!perm) continue;
      const state = this.effectivePermission(userId, userRole, key);
      if (state === true) return true;
      if (state === false) return false;
      sawNull = true;
    }
    if (sawNull) return null;
    return null;
  }

  canAccess(userId: string, userRole: Role, permKey: string): boolean {
    if (roleGrantsInherentPermission(userRole, permKey)) return true;
    const state = this.effectivePermission(userId, userRole, permKey);
    if (state === true) return true;
    if (state === false) return false;
    return false;
  }

  canAccessAny(userId: string, userRole: Role, specKey: string): boolean {
    if (roleGrantsInherentPermission(userRole, specKey)) return true;
    const keys = resolvePermissionKeys(specKey);
    let explicitDeny = false;
    let sawKey = false;
    for (const key of keys) {
      if (!this.findPermissionByKey(key)) continue;
      sawKey = true;
      const state = this.effectivePermission(userId, userRole, key);
      if (state === true) return true;
      if (state === false) explicitDeny = true;
    }
    if (explicitDeny) return false;
    if (!sawKey) return false;
    return false;
  }

  countEffectivePermissions(userId: string, userRole: Role): number {
    const keys = new Set<string>();
    const roleId = this.roleIdFromUserRole(userRole);
    this.hydrateRole(roleId);

    for (const perm of this.permissions) {
      const roleState = this.getPermissionState(roleId, perm.id);
      if (roleState === true) keys.add(perm.key);
    }

    for (const override of this.getUserOverrides(userId)) {
      if (!this.isOverrideActive(override)) continue;
      const perm = this.permissions.find((p) => p.id === override.permissionId);
      if (!perm) continue;
      if (override.overrideType === 'GRANT') keys.add(perm.key);
      else if (override.overrideType === 'REVOKE') keys.delete(perm.key);
    }

    return keys.size;
  }

  getUserOverrideStats(userId: string, userRole: Role) {
    const now = new Date();
    const overrides = this.getUserOverrides(userId);
    let activeOverrides = 0;
    let expiredRules = 0;

    for (const o of overrides) {
      if (!o.expiresAt || new Date(o.expiresAt) > now) activeOverrides += 1;
      else if (new Date(o.expiresAt) <= now) expiredRules += 1;
    }

    return {
      activeOverrides,
      expiredRules,
      effectivePermissions: this.countEffectivePermissions(userId, userRole),
    };
  }

  updateRolePermission(roleId: RoleId, permId: string, granted: boolean): void {
    this.hydrateRole(roleId);
    this.rolePermissions[roleId][permId] = granted;
    this.notify();
  }

  clearRolePermission(roleId: RoleId, permId: string): void {
    this.hydrateRole(roleId);
    delete this.rolePermissions[roleId][permId];
    this.notify();
  }

  clearRolePermissionsBatch(roleId: RoleId, permIds: string[]): void {
    this.hydrateRole(roleId);
    for (const permId of permIds) {
      delete this.rolePermissions[roleId][permId];
    }
    this.notify();
  }

  updateRolePermissionsBatch(roleId: RoleId, permIds: string[], granted: boolean): void {
    this.hydrateRole(roleId);
    for (const permId of permIds) {
      this.rolePermissions[roleId][permId] = granted;
    }
    this.notify();
  }

  /** Push current role grant/deny state to the server and refresh the catalog. */
  async saveRoleToBackend(roleId: RoleId): Promise<void> {
    this.hydrateRole(roleId);
    const backendRole = BACKEND_ROLE_BY_ID[roleId];
    const roleMatrix = this.matrix[backendRole] || {};
    const payload: Record<string, string[]> = {};

    let grantCount = 0;
    for (const perm of this.permissions) {
      const granted = this.rolePermissions[roleId][perm.id] === true;
      if (!granted) {
        payload[perm.key] = [];
        continue;
      }
      grantCount += 1;
      const existing = normalizeRoleActions(roleMatrix[perm.key]);
      payload[perm.key] = defaultGrantActionsForKey(perm.key, existing);
    }

    if (roleId === 'admin' && grantCount === 0) {
      throw new Error('Administrator role cannot be saved with zero grants.');
    }

    await Api.system.updateRolePermissions(backendRole, payload);

    this.permissionsLoaded = false;
    this.hydratedRoles.clear();
    await this.loadPermissions(true);

    this.hydratedRoles.delete(roleId);
    this.hydrateRole(roleId);
    this.notify();
  }
}

export const permissionService = new PermissionService();
