import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../hooks/useWorkspaceTabCache';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Api } from '../services/api';
import { User } from '../types';
import {
  Shield,
  RefreshCw,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { PageShell, PageHeader } from '../components/ui/page';
import { permissionService, type RoleId } from '../services/permissionService';
import RoleManagement from '../components/permissions/RoleManagement';
import PermissionMatrix from '../components/permissions/PermissionMatrix';
import UserOverrideManager from '../components/permissions/UserOverrideManager';
import type { SystemRoleId } from '../components/permissions/permissionRoles';
import {
  exportAccessGovernanceAudit,
  type PendingPermissionRequestRow,
} from '../utils/accessGovernanceAuditReport';
import type { ExportFileExt } from '../utils/export/exportDocumentStandard';
import { ExportFormatMenu } from '../components/ui/ExportFormatMenu';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { WizardFooterLayout } from '../components/workflow/WizardFooterLayout';
import { useStickyActionBarActive } from '../hooks/useStickyActionBarActive';
import { ensureWizardFooterRoot } from '../utils/overlayPortal';

type TabId = 'roles' | 'matrix' | 'overrides';

type OverrideStats = {
  systemRules: number;
  activeExceptions: number;
  expiredBounds: number;
};

const VALID_TABS: TabId[] = ['roles', 'matrix', 'overrides'];

function computeOverrideStats(): OverrideStats {
  const now = new Date();
  const overrides = permissionService.getAllUserOverrides();
  let activeExceptions = 0;
  let expiredBounds = 0;

  for (const override of overrides) {
    if (!override.expiresAt || new Date(override.expiresAt) > now) {
      activeExceptions += 1;
    } else if (new Date(override.expiresAt) <= now) {
      expiredBounds += 1;
    }
  }

  return {
    systemRules: permissionService.getAll().length,
    activeExceptions,
    expiredBounds,
  };
}

/** Prefer previous stats when a soft-refresh momentarily yields an empty catalog. */
function mergeStats(prev: OverrideStats, next: OverrideStats): OverrideStats {
  if (next.systemRules === 0 && prev.systemRules > 0 && permissionService.getAll().length === 0) {
    return {
      systemRules: prev.systemRules,
      activeExceptions: next.activeExceptions,
      expiredBounds: next.expiredBounds,
    };
  }
  return next;
}

export const PermissionManagement: React.FC = () => {
  const { showToast } = useToast();
  const { user: currentUser, refreshUser, hasPermission } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tabParam = searchParams.get('tab');
  const activeTab: TabId =
    tabParam && VALID_TABS.includes(tabParam as TabId) ? (tabParam as TabId) : 'roles';
  const [matrixRole, setMatrixRole] = useState<RoleId>('admin');
  const [syncing, setSyncing] = useState(false);
  const [exportingAudit, setExportingAudit] = useState(false);
  const [stats, setStats] = useState<OverrideStats>({
    systemRules: 0,
    activeExceptions: 0,
    expiredBounds: 0,
  });
  const [statsLoading, setStatsLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [permissions, setPermissions] = useState(permissionService.getAll());
  const hasLoadedOnceRef = useRef(false);
  const canLoadCatalogRef = useRef(false);

  const canLoadCatalog =
    hasPermission('permissions.view') || hasPermission('permissions.manage');
  canLoadCatalogRef.current = canLoadCatalog;

  const filteredUsers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }, [users, searchTerm]);

  const [usersLoading, setUsersLoading] = useState(true);

  const tabCache = useWorkspaceTabCache<{
    permissions: ReturnType<typeof permissionService.getAll>;
    stats: OverrideStats;
    users: User[];
    searchTerm: string;
    matrixRole: RoleId;
    activeTab: TabId;
  }>({
    slot: 'permissions-v2',
    cacheKey: activeTab,
    getSnapshot: () => ({
      permissions,
      stats,
      users,
      searchTerm,
      matrixRole,
      activeTab,
    }),
    applySnapshot: (cached) => {
      setPermissions(cached.permissions);
      setStats(cached.stats);
      setUsers(cached.users);
      setSearchTerm(cached.searchTerm);
      setMatrixRole(cached.matrixRole);
      setStatsLoading(false);
      setUsersLoading(false);
      if (cached.permissions.length > 0 || cached.users.length > 0) {
        hasLoadedOnceRef.current = true;
      }
    },
    shouldPersist: (cached) => cached.permissions.length > 0 || cached.users.length > 0,
    persistDeps: [permissions, stats, users, searchTerm, matrixRole, activeTab],
  });

  const fetchPermissions = useCallback(async (opts?: WorkspaceLoadOptions) => {
    const isBackground = Boolean(opts?.background) || hasLoadedOnceRef.current;
    if (!isBackground) setStatsLoading(true);
    try {
      if (!canLoadCatalogRef.current) {
        setPermissions([]);
        setStats({ systemRules: 0, activeExceptions: 0, expiredBounds: 0 });
        return;
      }
      await permissionService.refresh();
      const nextPerms = permissionService.getAll();
      setPermissions((prev) => (nextPerms.length === 0 && prev.length > 0 ? prev : nextPerms));
      setStats((prev) => mergeStats(prev, computeOverrideStats()));
      hasLoadedOnceRef.current = true;
    } catch (error) {
      console.error('Failed to load permission stats', error);
    } finally {
      if (!isBackground) setStatsLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async (opts?: WorkspaceLoadOptions) => {
    const isBackground = Boolean(opts?.background) || hasLoadedOnceRef.current;
    if (!isBackground) setUsersLoading(true);
    try {
      const data = await Api.users.getAll();
      setUsers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load users for overrides', error);
    } finally {
      if (!isBackground) setUsersLoading(false);
    }
  }, []);

  const mountLoad = useCallback(
    async (opts?: WorkspaceLoadOptions) => {
      await Promise.all([fetchPermissions(opts), loadUsers(opts)]);
    },
    [fetchPermissions, loadUsers]
  );

  useWorkspaceTabMountLoad(mountLoad, [mountLoad], tabCache);

  const syncSessionPermissions = useCallback(async () => {
    try {
      const { invalidateApiCache } = await import('../services/apiCache');
      invalidateApiCache('/users/');
      invalidateApiCache('/permissions');
      if (permissionService.isReady()) {
        try {
          await permissionService.reloadPermissionsFromServer();
        } catch (reloadErr) {
          console.error('Failed to reload permission catalog after save', reloadErr);
        }
      }
      await refreshUser();
    } catch (error) {
      console.error('Failed to refresh session permissions', error);
    }
  }, [refreshUser]);

  useEffect(() => {
    if (!tabParam || !VALID_TABS.includes(tabParam as TabId)) {
      navigate('/permissions?tab=roles', { replace: true });
    }
  }, [tabParam, navigate]);

  useEffect(() => {
    return permissionService.subscribe(() => {
      const nextPerms = permissionService.getAll();
      setPermissions((prev) => (nextPerms.length === 0 && prev.length > 0 ? prev : nextPerms));
      setStats((prev) => mergeStats(prev, computeOverrideStats()));
    });
  }, []);

  const openMatrixForRole = useCallback(
    (roleId: SystemRoleId) => {
      setMatrixRole(roleId);
      navigate('/permissions?tab=matrix');
    },
    [navigate]
  );

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const added = Number((await Api.system.syncPermissions({
        reapplyDefaults: true,
        backfillProjects: true,
      }))?.sync?.added ?? 0);
      await permissionService.reloadPermissionsFromServer();
      setPermissions(permissionService.getAll());
      setStats(computeOverrideStats());
      const total = permissionService.getAll().length;
      showToast(
        `Permission defaults restored — ${total} rules loaded${added ? ` (${added} catalog keys)` : ''}.`,
        'success'
      );
    } catch {
      showToast('Failed to sync permissions', 'error');
    } finally {
      setSyncing(false);
    }
  }, [showToast]);

  const handleAuditReport = useCallback(
    async (format: ExportFileExt) => {
      setExportingAudit(true);
      try {
        if (!canLoadCatalogRef.current) {
          showToast('You do not have permission to export the access governance audit.', 'error');
          return;
        }
        await permissionService.refresh();
        setPermissions(permissionService.getAll());
        setStats((prev) => mergeStats(prev, computeOverrideStats()));

        let pendingRequests: PendingPermissionRequestRow[] = [];
        try {
          const pending = await Api.system.getPendingPermissionRequests();
          pendingRequests = Array.isArray(pending) ? pending : [];
        } catch {
          /* optional section */
        }

        let exportUsers = users;
        if (!exportUsers.length) {
          const data = await Api.users.getAll();
          exportUsers = Array.isArray(data) ? data : [];
        }

        const input = {
          users: exportUsers,
          pendingRequests,
          exportedBy: currentUser?.name || currentUser?.email || 'Administrator',
        };
        const ok = await exportAccessGovernanceAudit(format, input);
        if (format === 'pdf' && !ok) {
          showToast('Please allow popups to export PDF', 'warning');
          return;
        }
        showToast(
          `Access governance audit exported as ${format === 'xlsx' ? 'Excel' : format.toUpperCase()}.`,
          'success'
        );
      } catch (error) {
        console.error('Audit report export failed', error);
        showToast('Failed to generate audit report', 'error');
      } finally {
        setExportingAudit(false);
      }
    },
    [users, currentUser?.name, currentUser?.email, showToast]
  );

  const footerRef = useStickyActionBarActive(activeTab !== 'matrix' && activeTab !== 'overrides');
  const [footerRoot, setFooterRoot] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined' ? ensureWizardFooterRoot() : null
  );

  useLayoutEffect(() => {
    setFooterRoot(ensureWizardFooterRoot());
  }, []);

  const systemActions = (
    <>
      <Button
        variant="outline"
        size="sm"
        icon={<RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />}
        onClick={handleSync}
        disabled={syncing}
      >
        {syncing ? 'Syncing…' : 'Sync System'}
      </Button>
      <ExportFormatMenu
        variant="button"
        buttonLabel={exportingAudit ? 'Exporting…' : 'Audit Report'}
        loading={exportingAudit}
        disabled={statsLoading && stats.systemRules === 0}
        onExport={handleAuditReport}
        formats={['csv', 'xlsx']}
      />
    </>
  );

  const footerBar = (
    <div
      ref={footerRef}
      role="toolbar"
      aria-label="Permission actions"
      className="hcms-action-sticky-footer hcms-sticky-footer max-lg:py-2.5 max-lg:px-3 py-2.5 px-3 sm:px-4 flex flex-row items-center max-lg:rounded-none max-lg:rounded-t-2xl max-lg:border-x-0 lg:rounded-t-2xl lg:rounded-b-none"
    >
      <WizardFooterLayout
        left={<div className="text-xs text-slate-500">System actions</div>}
        right={systemActions}
      />
    </div>
  );

  return (
    <PageShell className="animate-none">
      <PageHeader
        variant="compact"
        title="Access Governance"
        subtitle="Role grants and per-user exceptions. Changes apply immediately."
        icon={<Shield className="w-5 h-5" />}
      />

      <div className="min-h-[560px]">
        {activeTab === 'roles' && <RoleManagement onOpenMatrix={openMatrixForRole} />}
        {activeTab === 'matrix' && (
          <PermissionMatrix
            selectedRole={matrixRole}
            onRoleChange={setMatrixRole}
            footerExtras={systemActions}
            onRoleSaved={syncSessionPermissions}
          />
        )}
        {activeTab === 'overrides' && (
          <UserOverrideManager
            filteredUsers={filteredUsers}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            permissions={permissions}
            usersLoading={usersLoading && users.length === 0}
            loading={false}
            footerExtras={systemActions}
            onOverridesChanged={async () => {
              // Overrides already updated in the service; refresh stats without wiping the catalog.
              setStats((prev) => mergeStats(prev, computeOverrideStats()));
              await syncSessionPermissions();
            }}
          />
        )}
      </div>

      {activeTab === 'roles'
        ? footerRoot
          ? createPortal(footerBar, footerRoot)
          : footerBar
        : null}
    </PageShell>
  );
};

export default PermissionManagement;
