import {
  EXPORT_BRAND,
  csvRow,
  csvStringToAoa,
  downloadBrandedWorkbookAsXlsx,
  downloadCsvContent,
  exportFilename,
  exportGeneratedAtIso,
  appendReportFooterCsvLines,
  type ExportFileExt,
} from './export/exportDocumentStandard';
import { openTabularPrintWindow } from './export/downloadTabularPdf';
import { loadDocumentBranding } from './documentBranding';
import type { User } from '../types';
import { Role } from '../types';
import {
  permissionService,
  type PermissionRecord,
  type RoleId,
  type UserOverrideRecord,
} from '../services/permissionService';
import { SYSTEM_ROLES } from '../components/permissions/permissionRoles';
import { resolvePermissionCategory, CATEGORY_META } from '../components/permissions/permissionCategories';

const ROLE_IDS: RoleId[] = ['admin', 'hr', 'manager', 'employee'];

const BACKEND_ROLE_BY_ID: Record<RoleId, string> = {
  admin: 'ADMIN',
  hr: 'HR',
  manager: 'MANAGER',
  employee: 'EMPLOYEE',
};

export type PendingPermissionRequestRow = {
  id: string;
  userId?: string;
  permissionId?: string;
  status?: string;
  reason?: string;
  createdAt?: string;
  user?: { id?: string; name?: string; email?: string; role?: string } | null;
  permission?: { key?: string; name?: string; module?: string; isSensitive?: boolean } | null;
};

export type AccessGovernanceAuditInput = {
  users: User[];
  pendingRequests?: PendingPermissionRequestRow[];
  exportedBy?: string;
};

function formatTs(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : exportGeneratedAtIso(d);
}

function roleGranted(matrix: Record<string, Record<string, string[]>>, roleId: RoleId, permKey: string): string {
  const actions = matrix[BACKEND_ROLE_BY_ID[roleId]]?.[permKey];
  return actions && actions.length > 0 ? 'Granted' : 'Denied';
}

function userById(users: User[]): Map<string, User> {
  return new Map(users.map((u) => [u.id, u]));
}

function buildMetaSection(input: AccessGovernanceAuditInput, permissions: PermissionRecord[]): string[] {
  const overrides = permissionService.getAllUserOverrides();
  const now = new Date();
  let activeOverrides = 0;
  let expiredOverrides = 0;
  for (const o of overrides) {
    if (!o.expiresAt || new Date(o.expiresAt) > now) activeOverrides += 1;
    else expiredOverrides += 1;
  }

  const sensitiveCount = permissions.filter((p) => p.isSensitive).length;
  const lines: string[] = [
    csvRow(['Section', 'Field', 'Value']),
    csvRow(['METADATA', 'Report', 'Access Governance Audit']),
    csvRow(['METADATA', 'Organization', EXPORT_BRAND.companyName]),
    csvRow(['METADATA', 'Generated At (UTC)', now.toISOString()]),
    csvRow(['METADATA', 'Exported By', input.exportedBy || 'Administrator']),
    csvRow(['METADATA', 'Application', EXPORT_BRAND.applicationLabel]),
    csvRow(['METADATA', 'Total Permission Rules', permissions.length]),
    csvRow(['METADATA', 'Sensitive Rules', sensitiveCount]),
    csvRow(['METADATA', 'System Roles', ROLE_IDS.length]),
    csvRow(['METADATA', 'Portal Users', input.users.length]),
    csvRow(['METADATA', 'Active User Overrides', activeOverrides]),
    csvRow(['METADATA', 'Expired User Overrides', expiredOverrides]),
    csvRow(['METADATA', 'Pending Override Requests', input.pendingRequests?.length ?? 0]),
    '',
  ];
  return lines;
}

function buildRoleMatrixSection(
  permissions: PermissionRecord[],
  matrix: Record<string, Record<string, string[]>>
): string[] {
  const header = csvRow([
    'Section',
    'Category',
    'Module',
    'Permission Key',
    'Permission Name',
    'Sensitive',
    'Description',
    'Admin',
    'HR',
    'Manager',
    'Staff',
  ]);

  const rows = permissions
    .slice()
    .sort((a, b) => {
      const ca = resolvePermissionCategory(a);
      const cb = resolvePermissionCategory(b);
      if (ca !== cb) return ca.localeCompare(cb);
      if (a.module !== b.module) return a.module.localeCompare(b.module);
      return a.key.localeCompare(b.key);
    })
    .map((perm) => {
      const cat = resolvePermissionCategory(perm);
      return csvRow([
        'ROLE_MATRIX',
        CATEGORY_META[cat].label,
        perm.module,
        perm.key,
        perm.name,
        perm.isSensitive ? 'Yes' : 'No',
        perm.description || '',
        roleGranted(matrix, 'admin', perm.key),
        roleGranted(matrix, 'hr', perm.key),
        roleGranted(matrix, 'manager', perm.key),
        roleGranted(matrix, 'employee', perm.key),
      ]);
    });

  return [header, ...rows, ''];
}

function buildOverridesSection(
  overrides: UserOverrideRecord[],
  users: Map<string, User>
): string[] {
  const header = csvRow([
    'Section',
    'Override Id',
    'User Id',
    'User Name',
    'Email',
    'Portal Role',
    'Permission Key',
    'Permission Name',
    'Module',
    'Sensitive',
    'Override Type',
    'Status',
    'Active',
    'Expires At (UTC)',
    'Reason',
    'Granted By',
    'Created At (UTC)',
  ]);

  const rows = overrides.map((o) => {
    const user = users.get(o.userId);
    const perm = o.permission;
    const active = permissionService.isOverrideActive(o);
    return csvRow([
      'USER_OVERRIDE',
      o.id,
      o.userId,
      user?.name || '',
      user?.email || '',
      user?.role || '',
      perm?.key || o.permissionId,
      perm?.name || '',
      perm?.module || '',
      perm?.isSensitive ? 'Yes' : 'No',
      o.overrideType,
      o.status,
      active ? 'Yes' : 'No',
      formatTs(o.expiresAt),
      o.reason,
      o.grantedByName || o.grantedBy || '',
      formatTs(o.createdAt),
    ]);
  });

  return [header, ...rows, ''];
}

function buildUserSummarySection(users: User[], permissions: PermissionRecord[]): string[] {
  const header = csvRow([
    'Section',
    'User Id',
    'Name',
    'Email',
    'Portal Role',
    'Role Baseline Grants',
    'Active Overrides',
    'Expired Overrides',
    'Active Grant Overrides',
    'Active Revoke Overrides',
    'Sensitive Permissions (Effective)',
  ]);

  const sensitiveKeys = permissions.filter((p) => p.isSensitive).map((p) => p.key);

  const rows = users.map((user) => {
    const roleId = permissionService.roleIdFromUserRole(user.role);
    const rolePerms = permissionService.getRolePermissions(roleId);
    const baselineGrants = Object.values(rolePerms).filter((v) => v === true).length;

    const overrides = permissionService.getUserOverrides(user.id);
    let active = 0;
    let expired = 0;
    let activeGrants = 0;
    let activeRevokes = 0;
    const effectiveSensitive: string[] = [];

    for (const o of overrides) {
      const isActive = permissionService.isOverrideActive(o);
      if (isActive) {
        active += 1;
        if (o.overrideType === 'GRANT') activeGrants += 1;
        else activeRevokes += 1;
      } else {
        expired += 1;
      }
    }

    for (const key of sensitiveKeys) {
      if (permissionService.canAccess(user.id, user.role, key)) {
        effectiveSensitive.push(key);
      }
    }

    return csvRow([
      'USER_ACCESS_SUMMARY',
      user.id,
      user.name,
      user.email,
      user.role,
      baselineGrants,
      active,
      expired,
      activeGrants,
      activeRevokes,
      effectiveSensitive.join('; '),
    ]);
  });

  return [header, ...rows, ''];
}

function buildRoleCatalogSection(): string[] {
  const header = csvRow(['Section', 'Role Id', 'Display Name', 'Level', 'Description']);
  const rows = SYSTEM_ROLES.map((r) =>
    csvRow(['ROLE_CATALOG', r.id, r.displayName, r.levelLabel, r.description])
  );
  return [header, ...rows, ''];
}

function buildPendingSection(requests: PendingPermissionRequestRow[]): string[] {
  const header = csvRow([
    'Section',
    'Request Id',
    'User Id',
    'User Name',
    'Email',
    'Permission Key',
    'Permission Name',
    'Sensitive',
    'Status',
    'Reason',
    'Requested At (UTC)',
  ]);

  const rows = requests.map((r) =>
    csvRow([
      'PENDING_REQUEST',
      r.id,
      r.userId || r.user?.id || '',
      r.user?.name || '',
      r.user?.email || '',
      r.permission?.key || r.permissionId || '',
      r.permission?.name || '',
      r.permission?.isSensitive ? 'Yes' : 'No',
      r.status || 'PENDING',
      r.reason || '',
      formatTs(r.createdAt),
    ])
  );

  return [header, ...rows, ''];
}

/** Build a single CSV workbook-style file with labeled sections for compliance review. */
export function buildAccessGovernanceAuditCsv(input: AccessGovernanceAuditInput): string {
  const permissions = permissionService.getAll();
  const matrix = permissionService.getMatrix();
  const overrides = permissionService.getAllUserOverrides();
  const userMap = userById(input.users);

  const parts = [
    ...buildMetaSection(input, permissions),
    ...buildRoleCatalogSection(),
    ...buildRoleMatrixSection(permissions, matrix),
    ...buildOverridesSection(overrides, userMap),
    ...buildUserSummarySection(input.users, permissions),
    ...(input.pendingRequests?.length
      ? buildPendingSection(input.pendingRequests)
      : [csvRow(['Section', 'Note']), csvRow(['PENDING_REQUEST', 'No pending override requests']), '']),
  ];

  const body = parts.join('\r\n');
  return `\uFEFF${body}`;
}

export function downloadAccessGovernanceAuditReport(input: AccessGovernanceAuditInput): void {
  exportAccessGovernanceAudit('csv', input);
}

export async function exportAccessGovernanceAudit(
  format: ExportFileExt,
  input: AccessGovernanceAuditInput
): Promise<boolean> {
  const branding = await loadDocumentBranding(true);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const csv = buildAccessGovernanceAuditCsv(input).replace(/^\uFEFF/, '');
  const fullCsv = appendReportFooterCsvLines(csv.split(/\r?\n/), branding).join('\r\n');

  if (format === 'csv') {
    downloadCsvContent(fullCsv, exportFilename('Access_Governance_Audit', [stamp], 'csv'));
    return true;
  }

  const aoa = csvStringToAoa(fullCsv);
  if (format === 'xlsx') {
    await downloadBrandedWorkbookAsXlsx({
      filename: exportFilename('Access_Governance_Audit', [stamp], 'xlsx'),
      reportTitle: 'Access Governance Audit',
      branding,
      fields: [
        { label: 'Document', value: 'Access Governance Audit' },
        { label: 'Exported by', value: input.exportedBy || 'Administrator' },
        { label: 'Users', value: String(input.users.length) },
        { label: 'Prepared by', value: '' },
      ],
      purpose: 'Role matrix, overrides, and access governance snapshot.',
      sheets: [
        {
          name: 'Access Audit',
          aoa,
          headerRows: [0],
        },
      ],
    });
    return true;
  }

  return openTabularPrintWindow(
    'Access Governance Audit',
    aoa,
    input.exportedBy ? `Exported by ${input.exportedBy}` : undefined,
    branding
  );
}

/** Admin/HR only — matches permission catalog access policy. */
export function canExportAccessGovernanceAudit(role?: Role | string): boolean {
  const r = String(role ?? '').toUpperCase();
  return r === 'ADMIN' || r === 'HR' || r === 'SUPER_ADMIN';
}
