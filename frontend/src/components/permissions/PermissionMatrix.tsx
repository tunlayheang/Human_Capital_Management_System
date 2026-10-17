import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Edit2,
  SlidersHorizontal,
  Save,
  X,
} from 'lucide-react';
import {
  permissionService,
  type PermissionRecord,
  type RoleId,
} from '../../services/permissionService';
import { Button } from '../ui/Button';
import { LoadingState } from '../common/LoadingState';
import { SegmentTabs, ListSearchFilterBar } from '../ui/page';
import { FilterMenuSelect, PageFilterMenu } from '../ui/PageFilterMenu';
import { WizardFooterLayout } from '../workflow/WizardFooterLayout';
import { countActiveFilters } from '../../utils/filterActiveCount';
import { inputClass } from '../../constants/designSystem';
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  defaultCategoryExpanded,
  groupPermissionsByCategory,
  SIDEBAR_SECTION_META,
  SIDEBAR_SECTIONS,
  type CategoryKey,
} from './permissionCategories';
import { getSystemRole, SYSTEM_ROLES } from './permissionRoles';
import { useToast } from '../../context/ToastContext';
import { useStickyActionBarActive } from '../../hooks/useStickyActionBarActive';
import { ensureWizardFooterRoot } from '../../utils/overlayPortal';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { localTodayIsoDate } from '../../utils/leaveCalendar';
import { getMatrixLinkedKeys } from '../../constants/permissionLinkGroups';

interface PermissionMatrixProps {
  selectedRole: RoleId;
  onRoleChange: (roleId: RoleId) => void;
  footerExtras?: React.ReactNode;
  /** Called after a role matrix save so the session picks up Grant/Deny immediately. */
  onRoleSaved?: () => void | Promise<void>;
}

function MetricItem({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${accent ?? 'text-slate-900 dark:text-white'}`}>
        {value}
      </span>
    </div>
  );
}

function GrantStateControl({
  granted,
  onGrant,
  onDeny,
  disabled = false,
}: {
  granted: boolean;
  onGrant: () => void;
  onDeny: () => void;
  disabled?: boolean;
}) {
  const base =
    'px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 disabled:opacity-50 disabled:cursor-not-allowed';
  return (
    <div
      role="group"
      aria-label="Permission access"
      className="inline-flex rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/80 overflow-hidden"
    >
      <button
        type="button"
        onClick={onDeny}
        disabled={disabled}
        aria-pressed={!granted}
        className={`${base} border-r border-slate-200 dark:border-slate-600 ${
          !granted
            ? 'bg-red-600 text-white'
            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
        }`}
      >
        Deny
      </button>
      <button
        type="button"
        onClick={onGrant}
        disabled={disabled}
        aria-pressed={granted}
        className={`${base} ${
          granted
            ? 'bg-primary-600 text-white'
            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
        }`}
      >
        Grant
      </button>
    </div>
  );
}

const PermissionMatrix: React.FC<PermissionMatrixProps> = ({
  selectedRole,
  onRoleChange,
  footerExtras,
  onRoleSaved,
}) => {
  const { showToast } = useToast();
  const { confirmEffectiveDate, ConfirmDialogHost } = useConfirmDialog();
  const [editMode, setEditMode] = useState(false);
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [expanded, setExpanded] = useState<Record<CategoryKey, boolean>>(defaultCategoryExpanded);
  const moduleFilterActiveCount = useMemo(
    () => countActiveFilters([{ value: moduleFilter, defaultValue: '' }]),
    [moduleFilter]
  );

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    return permissionService.subscribe(bump);
  }, [bump]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await permissionService.reloadPermissionsFromServer();
        if (!cancelled) bump();
      } catch (error) {
        console.error('Failed to load permissions', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bump]);

  useEffect(() => {
    permissionService.getRolePermissions(selectedRole);
    setEditMode(false);
    setBulkEditMode(false);
    setHasUnsavedChanges(false);
    setEffectiveDate('');
    setSaveMessage('');
    bump();
  }, [selectedRole, bump]);

  const permissions = useMemo(() => permissionService.getAll(), [version, loading]);

  const moduleOptions = useMemo(() => {
    const modules = new Set<string>();
    for (const p of permissions) {
      const moduleName = String(p.module ?? '').trim();
      if (moduleName) modules.add(moduleName);
    }
    return [...modules].sort((a, b) => a.localeCompare(b));
  }, [permissions]);

  const filteredPermissions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return permissions.filter((p) => {
      if (moduleFilter && String(p.module ?? '') !== moduleFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.key.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        (p.module || '').toLowerCase().includes(q)
      );
    });
  }, [permissions, searchQuery, moduleFilter]);

  const grouped = useMemo(
    () => groupPermissionsByCategory(filteredPermissions),
    [filteredPermissions]
  );

  const roleSummary = useMemo(() => {
    let granted = 0;
    let denied = 0;
    for (const p of permissions) {
      const state = permissionService.getPermissionState(selectedRole, p.id);
      if (state === true) granted += 1;
      else denied += 1;
    }
    return { granted, denied };
  }, [permissions, selectedRole, version]);

  const handleRoleChange = (roleId: string) => {
    onRoleChange(roleId as RoleId);
    permissionService.getRolePermissions(roleId as RoleId);
    bump();
  };

  const expandAll = () => {
    const next = {} as Record<CategoryKey, boolean>;
    for (const key of CATEGORY_ORDER) next[key] = true;
    setExpanded(next);
  };

  const collapseAll = () => {
    const next = {} as Record<CategoryKey, boolean>;
    for (const key of CATEGORY_ORDER) next[key] = false;
    setExpanded(next);
  };

  const applyAccessChange = (permId: string, granted: boolean) => {
    if (!editMode) return;
    const source = permissionService.getAll().find((p) => p.id === permId);
    if (!source) return;

    const linkedKeys = getMatrixLinkedKeys(source.key);
    const catalog = permissionService.getAll();
    const linkedPerms = linkedKeys
      .map((key) => catalog.find((p) => p.key === key))
      .filter((p): p is PermissionRecord => Boolean(p));

    const changedOthers = linkedPerms.filter((p) => {
      if (p.id === permId) return false;
      const wasGranted = permissionService.getPermissionState(selectedRole, p.id) === true;
      return wasGranted !== granted;
    });

    permissionService.updateRolePermissionsBatch(
      selectedRole,
      linkedPerms.map((p) => p.id),
      granted
    );
    setHasUnsavedChanges(true);

    if (changedOthers.length > 0) {
      const names = changedOthers.map((p) => `"${p.name}"`).join(', ');
      showToast(
        granted
          ? `Also granted ${names} — linked permissions stay in sync (legacy and modern keys).`
          : `Also denied ${names} — linked permissions stay in sync (legacy and modern keys).`,
        'info'
      );
    }
  };

  const grant = (permId: string) => {
    applyAccessChange(permId, true);
  };

  const deny = (permId: string) => {
    applyAccessChange(permId, false);
  };

  const grantBundle = (perms: PermissionRecord[]) => {
    if (!editMode) return;
    const catalog = permissionService.getAll();
    const idSet = new Set<string>();
    for (const perm of perms) {
      for (const key of getMatrixLinkedKeys(perm.key)) {
        const linked = catalog.find((p) => p.key === key);
        if (linked) idSet.add(linked.id);
      }
    }
    permissionService.updateRolePermissionsBatch(selectedRole, [...idSet], true);
    setHasUnsavedChanges(true);
  };

  const denyBundle = (perms: PermissionRecord[]) => {
    if (!editMode) return;
    const catalog = permissionService.getAll();
    const idSet = new Set<string>();
    for (const perm of perms) {
      for (const key of getMatrixLinkedKeys(perm.key)) {
        const linked = catalog.find((p) => p.key === key);
        if (linked) idSet.add(linked.id);
      }
    }
    if (idSet.size === 0) return;
    permissionService.updateRolePermissionsBatch(selectedRole, [...idSet], false);
    setHasUnsavedChanges(true);
  };

  const saveRole = async () => {
    if (!editMode) {
      showToast('Click Edit before changing role permissions.', 'warning');
      return;
    }
    if (!hasUnsavedChanges) {
      showToast('There are no pending role permission changes to save.', 'warning');
      return;
    }
    const confirmedEffectiveDate = await confirmEffectiveDate({
      title: 'Save role permissions',
      description: `Apply the ${getSystemRole(selectedRole).displayName} permission changes on the selected effective date.`,
      confirmLabel: 'Save role',
      effectiveDateLabel: 'Effective date',
      defaultEffectiveDate: effectiveDate || localTodayIsoDate(),
      variant: 'success',
    });
    if (!confirmedEffectiveDate) return;

    setSaving(true);
    setSaveMessage('');
    try {
      await permissionService.saveRoleToBackend(selectedRole);
      setEffectiveDate(confirmedEffectiveDate);
      setHasUnsavedChanges(false);
      setEditMode(false);
      setBulkEditMode(false);
      setSaveMessage(`Role permissions saved. Effective ${confirmedEffectiveDate}.`);
      showToast('Role permissions saved successfully.', 'success');
      bump();
      try {
        await onRoleSaved?.();
      } catch (syncErr) {
        console.error('Failed to sync session after role permission save', syncErr);
      }
    } catch (error) {
      console.error('Failed to save role permissions', error);
      setSaveMessage('Could not save role permissions. Try again.');
      showToast('Failed to save role permissions.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const startEditing = () => {
    setEditMode(true);
    setBulkEditMode(false);
    setSaveMessage('');
    setEffectiveDate((prev) => prev || localTodayIsoDate());
  };

  const cancelEditing = async () => {
    await permissionService.reloadPermissionsFromServer();
    permissionService.getRolePermissions(selectedRole);
    setEditMode(false);
    setBulkEditMode(false);
    setHasUnsavedChanges(false);
    setEffectiveDate('');
    setSaveMessage('Changes discarded.');
    bump();
  };

  const toggleCategory = (key: CategoryKey) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const roleTabs = useMemo(
    () =>
      SYSTEM_ROLES.map((role) => ({
        id: role.id,
        label: role.shortLabel,
      })),
    []
  );

  const footerRef = useStickyActionBarActive(true);
  const [footerRoot, setFooterRoot] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined' ? ensureWizardFooterRoot() : null
  );

  useLayoutEffect(() => {
    setFooterRoot(ensureWizardFooterRoot());
  }, []);

  const roleMeta = getSystemRole(selectedRole);

  const footerBar = (
    <div
      ref={footerRef}
      role="toolbar"
      aria-label="Role permissions actions"
      className="hcms-action-sticky-footer hcms-sticky-footer max-lg:py-2.5 max-lg:px-3 py-2.5 px-3 sm:px-4 flex flex-row items-center max-lg:rounded-none max-lg:rounded-t-2xl max-lg:border-x-0 lg:rounded-t-2xl lg:rounded-b-none"
    >
      <WizardFooterLayout
        left={
          <SegmentTabs
            tabs={roleTabs}
            activeId={selectedRole}
            onChange={handleRoleChange}
            size="sm"
            fullWidth
            ariaLabel="Select role"
            className="w-full max-w-[min(100%,22rem)]"
          />
        }
        hint={
          loading
            ? 'Loading permissions…'
            : saveMessage ||
              (editMode
                ? `${roleMeta.displayName} — choose access, set effective date, then save`
                : `${roleMeta.displayName} — click Edit to change permissions`)
        }
        right={
          <>
            {footerExtras ? <div className="flex items-center gap-2">{footerExtras}</div> : null}
            <button
              type="button"
              onClick={() => setBulkEditMode((v) => !v)}
              disabled={loading || !editMode || saving}
              className={`inline-flex items-center gap-1.5 shrink-0 h-9 px-3 rounded-lg text-sm font-medium border transition-colors ${
                bulkEditMode
                  ? 'border-primary-600 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-500'
                  : 'border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span className="hidden sm:inline">Bulk edit</span>
            </button>
            {editMode ? (
              <>
                <Button size="sm" variant="ghost" className="h-9" icon={<X className="w-3.5 h-3.5" />} onClick={() => void cancelEditing()} disabled={saving}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-9"
                  icon={<Save className="w-3.5 h-3.5" />}
                  onClick={saveRole}
                  isLoading={saving}
                  disabled={!hasUnsavedChanges}
                >
                  Save role
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" className="h-9" icon={<Edit2 className="w-3.5 h-3.5" />} onClick={startEditing} disabled={loading || saving}>
                Edit
              </Button>
            )}
          </>
        }
      />
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-5 hcms-wizard-mobile-scroll-pad">
        <LoadingState variant="panel" layout="table" label="Loading permission matrix…" />
        {footerRoot ? createPortal(footerBar, footerRoot) : footerBar}
      </div>
    );
  }

  return (
    <div className="space-y-5 hcms-wizard-mobile-scroll-pad">
      <div className="rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 sm:p-4 space-y-3">
        <dl className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <MetricItem label="Granted" value={roleSummary.granted} accent="text-emerald-600 dark:text-emerald-400" />
          <MetricItem label="Denied" value={roleSummary.denied} accent="text-red-600 dark:text-red-400" />
        </dl>

        <ListSearchFilterBar
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder={`Search ${roleMeta.shortLabel} permissions…`}
          filter={
            <PageFilterMenu
              activeCount={moduleFilterActiveCount}
              onClear={() => setModuleFilter('')}
            >
              <FilterMenuSelect
                label="Module"
                value={moduleFilter}
                onChange={setModuleFilter}
                options={[
                  { value: '', label: 'All modules' },
                  ...moduleOptions.map((moduleName) => ({
                    value: moduleName,
                    label: moduleName,
                  })),
                ]}
              />
            </PageFilterMenu>
          }
          trailing={
            <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="outline" icon={<ChevronsDownUp className="w-4 h-4" />} onClick={expandAll}>
                Expand all
              </Button>
              <Button size="sm" variant="outline" icon={<ChevronsUpDown className="w-4 h-4" />} onClick={collapseAll}>
                Collapse
              </Button>
            </div>
          }
        />
      </div>

      {selectedRole === 'admin' ? (
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 px-3 py-2">
          Grant/Deny on this matrix is enforced at runtime for Administrators too. Every catalog
          permission can be granted or denied. Avoid denying Permissions → Manage or core shell
          access (dashboard, profile, account settings) on Admin unless you have another way to
          restore access.
        </p>
      ) : null}

      {filteredPermissions.length === 0 ? (
        <p className="text-center py-16 text-slate-500 dark:text-slate-400 text-sm">
          No permissions match your search.
        </p>
      ) : (
        <div className="space-y-6">
          {SIDEBAR_SECTIONS.map((section) => {
            const sectionCategories = section.categories.filter(
              (categoryKey) => grouped[categoryKey].length > 0
            );
            if (sectionCategories.length === 0) return null;

            const sectionMeta = SIDEBAR_SECTION_META[section.key];
            const sectionPermCount = sectionCategories.reduce(
              (sum, categoryKey) => sum + grouped[categoryKey].length,
              0
            );

            return (
              <div key={section.key} className="space-y-3">
                <div
                  className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border ${sectionMeta.headerClass}`}
                >
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    {section.label}
                  </h4>
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                    {sectionPermCount} permission{sectionPermCount === 1 ? '' : 's'}
                  </span>
                </div>

                {sectionCategories.map((categoryKey) => {
                  const perms = grouped[categoryKey];
                  const meta = CATEGORY_META[categoryKey];
                  const Icon = meta.icon;
                  const isOpen = expanded[categoryKey];

                  return (
                    <section
                      key={categoryKey}
                      className="surface-card overflow-hidden rounded-xl"
                    >
                      <div
                        className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b ${meta.headerClass}`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleCategory(categoryKey)}
                          className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                        >
                          {isOpen ? (
                            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                          <Icon className={`w-4 h-4 shrink-0 ${meta.iconClass}`} />
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">
                            {meta.label}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                            {perms.length}
                          </span>
                        </button>

                        {bulkEditMode && isOpen && (
                          <div className="flex flex-wrap gap-1.5 shrink-0">
                            <Button size="sm" variant="outline" onClick={() => grantBundle(perms)}>
                              Grant all
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => denyBundle(perms)}>
                              Deny all
                            </Button>
                          </div>
                        )}
                      </div>

                      {isOpen && (
                        <div className="divide-y divide-slate-100 dark:divide-slate-700/80">
                          <div className="hidden lg:grid lg:grid-cols-[1fr_auto] gap-4 px-4 py-2 bg-slate-50/80 dark:bg-slate-900/40 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            <span>Permission</span>
                            <span className="text-right pr-1">Access</span>
                          </div>
                          {perms.map((perm) => (
                            <PermissionRow
                              key={perm.id}
                              perm={perm}
                              roleId={selectedRole}
                              version={version}
                              controlsDisabled={loading || saving || !editMode}
                              onGrant={() => grant(perm.id)}
                              onDeny={() => deny(perm.id)}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialogHost />
      {footerRoot ? createPortal(footerBar, footerRoot) : footerBar}
    </div>
  );
};

interface PermissionRowProps {
  perm: PermissionRecord;
  roleId: RoleId;
  version: number;
  controlsDisabled?: boolean;
  onGrant: () => void;
  onDeny: () => void;
}

const PermissionRow: React.FC<PermissionRowProps> = ({
  perm,
  roleId,
  version,
  controlsDisabled = false,
  onGrant,
  onDeny,
}) => {
  void version;
  const granted = permissionService.getPermissionState(roleId, perm.id) === true;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 lg:gap-6 px-4 py-3.5 hover:bg-slate-50/60 dark:hover:bg-slate-900/20 transition-colors items-start lg:items-center">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-medium text-slate-900 dark:text-white">{perm.name}</p>
          {perm.isSensitive && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60 rounded px-1.5 py-0.5">
              Sensitive
            </span>
          )}
        </div>
        <p className="text-xs font-mono text-slate-500 dark:text-slate-400">{perm.key}</p>
        {perm.description && (
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-2xl">
            {perm.description}
          </p>
        )}
      </div>

      <div className="lg:justify-self-end shrink-0">
        <GrantStateControl
          granted={granted}
          onGrant={onGrant}
          onDeny={onDeny}
          disabled={controlsDisabled}
        />
      </div>
    </div>
  );
};

export default PermissionMatrix;
