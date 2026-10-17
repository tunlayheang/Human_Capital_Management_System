import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Shield,
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  User as UserIcon,
  X,
} from 'lucide-react';
import { User, Role } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import {
  permissionService,
  type PermissionRecord,
  type UserOverrideRecord,
} from '../../services/permissionService';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { ListSearchFilterBar } from '../ui/page';
import { FilterMenuSelect, PageFilterMenu } from '../ui/PageFilterMenu';
import { countActiveFilters } from '../../utils/filterActiveCount';
import { inputClass } from '../../constants/designSystem';
import { userDisplayName } from '../../utils/userProfile';
import { useLanguage } from '../../context/LanguageContext';
import { LoadingState } from '../common/LoadingState';
import { PermissionOverridePicker } from './PermissionOverridePicker';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';
import { formatAccessRoleLabel } from '../../utils/accessRole';
import { getMatrixLinkedKeys } from '../../constants/permissionLinkGroups';
import { WizardFooterLayout } from '../workflow/WizardFooterLayout';
import { useStickyActionBarActive } from '../../hooks/useStickyActionBarActive';
import { ensureWizardFooterRoot } from '../../utils/overlayPortal';

const AVATAR_COLORS = [
  'bg-indigo-500',
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-violet-500',
  'bg-cyan-500',
  'bg-orange-500',
];

function avatarColor(name: string): string {
  const code = name.charCodeAt(0) || 65;
  return AVATAR_COLORS[code % AVATAR_COLORS.length];
}

function roleBadgeVariant(role: Role): 'danger' | 'info' | 'success' | 'neutral' {
  switch (role) {
    case Role.ADMIN:
      return 'danger';
    case Role.HR:
      return 'info';
    case Role.MANAGER:
      return 'success';
    default:
      return 'neutral';
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function expiryBadge(override: UserOverrideRecord) {
  if (override.expiresAt == null) {
    return <Badge variant="neutral">Permanent</Badge>;
  }
  const exp = new Date(override.expiresAt);
  const now = new Date();
  if (exp > now) {
    return (
      <Badge variant="success">
        Until {formatDateOnlyDisplay(exp)}
      </Badge>
    );
  }
  return (
    <Badge variant="danger">
      Expired {formatDateOnlyDisplay(exp)}
    </Badge>
  );
}

type OverrideFilter = 'active' | 'expired' | 'all';

const EXPIRY_PRESETS = [
  { id: 'none', label: 'No expiry' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'custom', label: 'Custom' },
] as const;

function presetToExpiresAt(preset: (typeof EXPIRY_PRESETS)[number]['id'], custom: string): string {
  if (preset === 'none') return '';
  if (preset === 'custom') return custom;
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface UserOverrideManagerProps {
  filteredUsers: User[];
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  permissions: PermissionRecord[];
  usersLoading?: boolean;
  loading?: boolean;
  onOverridesChanged?: () => void;
  /** Sync / Audit actions — rendered in the sticky lower bar (same pattern as Permission Matrix). */
  footerExtras?: React.ReactNode;
}

const UserOverrideManager: React.FC<UserOverrideManagerProps> = ({
  filteredUsers,
  searchTerm,
  onSearchTermChange,
  permissions,
  usersLoading = false,
  loading: pageLoading = false,
  onOverridesChanged,
  footerExtras,
}) => {
  const { user: currentUser } = useAuth();
  const { language } = useLanguage();
  const { showToast } = useToast();
  const { confirm, ConfirmDialogHost } = useConfirmDialog();
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [overrideFilter, setOverrideFilter] = useState<OverrideFilter>('all');
  const [roleFilter, setRoleFilter] = useState('');
  const roleFilterActiveCount = useMemo(
    () => countActiveFilters([{ value: roleFilter, defaultValue: '' }]),
    [roleFilter]
  );
  const displayedUsers = useMemo(() => {
    if (!roleFilter) return filteredUsers;
    return filteredUsers.filter(
      (u) => String(u.role ?? '').toUpperCase() === roleFilter.toUpperCase()
    );
  }, [filteredUsers, roleFilter]);
  const roleOptions = useMemo(() => {
    const roles = new Set<string>();
    for (const u of filteredUsers) {
      if (u.role) roles.add(String(u.role).toUpperCase());
    }
    return [...roles].sort().map((role) => ({
      value: role,
      label: formatAccessRoleLabel(role),
    }));
  }, [filteredUsers]);

  const [permIds, setPermIds] = useState<string[]>([]);
  const [overrideType, setOverrideType] = useState<'GRANT' | 'REVOKE'>('GRANT');
  const [reason, setReason] = useState('');
  const [expiryPreset, setExpiryPreset] = useState<(typeof EXPIRY_PRESETS)[number]['id']>('none');
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const lastEffectiveRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    return permissionService.subscribe(() => setVersion((v) => v + 1));
  }, []);

  const userOverrides = selectedUser
    ? permissionService.getUserOverrides(selectedUser.id)
    : [];

  const filteredOverrides = useMemo(() => {
    const now = new Date();
    return userOverrides.filter((o) => {
      const expired = o.expiresAt != null && new Date(o.expiresAt) <= now;
      if (overrideFilter === 'active') return !expired;
      if (overrideFilter === 'expired') return expired;
      return true;
    });
  }, [userOverrides, overrideFilter]);

  const existingOverridePermIds = useMemo(() => {
    const now = new Date();
    const ids = new Set<string>();
    for (const o of userOverrides) {
      if (o.expiresAt == null || new Date(o.expiresAt) > now) {
        ids.add(o.permissionId);
      }
    }
    return ids;
  }, [userOverrides]);

  const miniStats = selectedUser
    ? permissionService.getUserOverrideStats(selectedUser.id, selectedUser.role)
    : null;

  // Keep last good Effective count while a soft-refresh is in flight (empty catalog).
  const stableMiniStats = useMemo(() => {
    if (!selectedUser || !miniStats) return null;
    if (miniStats.effectivePermissions === 0 && permissions.length === 0) {
      return {
        ...miniStats,
        effectivePermissions: lastEffectiveRef.current.get(selectedUser.id) ?? 0,
      };
    }
    lastEffectiveRef.current.set(selectedUser.id, miniStats.effectivePermissions);
    return miniStats;
  }, [selectedUser, miniStats, permissions.length, version]);

  void version;

  const resetForm = () => {
    setOverrideType('GRANT');
    setReason('');
    setExpiryPreset('none');
    setExpiresAt('');
    setPermIds([]);
  };

  const handleApplyOverride = async () => {
    if (!selectedUser || permIds.length === 0 || !reason.trim()) return;
    const resolvedExpiry = presetToExpiresAt(expiryPreset, expiresAt);
    const grantedBy = currentUser
      ? { id: currentUser.id, name: currentUser.name }
      : { id: 'system', name: 'Administrator' };
    const expiresIso = resolvedExpiry ? new Date(resolvedExpiry).toISOString() : null;

    setSubmitting(true);
    try {
      let saved = 0;
      const failures: string[] = [];
      const catalog = permissionService.getAll();
      const expandedIds = new Set<string>();
      const autoLinkedNames: string[] = [];
      for (const permId of permIds) {
        expandedIds.add(permId);
        const source = catalog.find((p) => p.id === permId);
        if (!source) continue;
        for (const key of getMatrixLinkedKeys(source.key)) {
          const linked = catalog.find((p) => p.key === key);
          if (!linked || linked.id === permId) continue;
          if (!expandedIds.has(linked.id)) {
            expandedIds.add(linked.id);
            autoLinkedNames.push(linked.name);
          }
        }
      }

      for (const permId of expandedIds) {
        try {
          await permissionService.addUserOverride(
            selectedUser.id,
            permId,
            overrideType,
            reason.trim(),
            expiresIso,
            grantedBy
          );
          saved += 1;
        } catch {
          const perm = permissions.find((p) => p.id === permId);
          failures.push(perm?.name || permId);
        }
      }

      if (saved === 0) {
        showToast(
          failures.length
            ? `Failed to save exceptions: ${failures.join(', ')}`
            : 'Failed to save exceptions',
          'error'
        );
        return;
      }

      setFormOpen(false);
      resetForm();
      const name = userDisplayName(selectedUser, language);
      if (failures.length) {
        showToast(
          `Saved ${saved} exception${saved === 1 ? '' : 's'} for ${name}. Failed: ${failures.join(', ')}`,
          'info'
        );
      } else if (autoLinkedNames.length) {
        showToast(
          `Saved ${saved} exception${saved === 1 ? '' : 's'} for ${name}. Also included linked: ${autoLinkedNames
            .map((n) => `"${n}"`)
            .join(', ')}.`,
          'info'
        );
      } else {
        showToast(
          `Saved ${saved} exception${saved === 1 ? '' : 's'} for ${name}.`,
          'success'
        );
      }
      onOverridesChanged?.();
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Failed to save exception', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (overrideId: string) => {
    if (!selectedUser) return;
    const ok = await confirm({
      title: 'Remove exception?',
      description:
        'Remove this exception? The user will fall back to their role permissions.',
      variant: 'danger',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await permissionService.removeUserOverride(selectedUser.id, overrideId);
      showToast('Exception removed.', 'success');
      onOverridesChanged?.();
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Failed to remove exception', 'error');
    }
  };

  const lookupPerm = (override: UserOverrideRecord) => {
    return (
      override.permission ||
      permissions.find((p) => p.id === override.permissionId)
    );
  };

  const loading = usersLoading;
  const footerRef = useStickyActionBarActive(true);
  const [footerRoot, setFooterRoot] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined' ? ensureWizardFooterRoot() : null
  );

  useLayoutEffect(() => {
    setFooterRoot(ensureWizardFooterRoot());
  }, []);

  const toggleExceptionForm = () => {
    if (!selectedUser) return;
    setFormOpen((v) => !v);
    if (!formOpen) resetForm();
  };

  const footerHint = selectedUser
    ? formOpen
      ? `${userDisplayName(selectedUser, language)} — fill the form, then save`
      : `${userDisplayName(selectedUser, language)} — add or review exceptions`
    : 'Select a user to manage permission exceptions';

  const footerBar = (
    <div
      ref={footerRef}
      role="toolbar"
      aria-label="User override actions"
      className="hcms-action-sticky-footer hcms-sticky-footer max-lg:py-2.5 max-lg:px-3 py-2.5 px-3 sm:px-4 flex flex-row items-center max-lg:rounded-none max-lg:rounded-t-2xl max-lg:border-x-0 lg:rounded-t-2xl lg:rounded-b-none"
    >
      <WizardFooterLayout
        left={<div className="text-xs text-slate-500 dark:text-slate-400">User exceptions</div>}
        hint={footerHint}
        right={
          <>
            {footerExtras ? <div className="flex items-center gap-2">{footerExtras}</div> : null}
            {formOpen ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-9"
                icon={<X className="w-3.5 h-3.5" />}
                onClick={() => {
                  setFormOpen(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-9"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={toggleExceptionForm}
                disabled={!selectedUser}
              >
                Add exception
              </Button>
            )}
          </>
        }
      />
    </div>
  );

  return (
    <div className="surface-card overflow-hidden shadow-sm border border-slate-200 dark:border-slate-700">
      <ConfirmDialogHost />
      {footerRoot ? createPortal(footerBar, footerRoot) : footerBar}
      <div className="grid min-w-0 lg:grid-cols-[minmax(280px,340px)_1fr] lg:grid-rows-1 lg:h-[min(820px,85vh)] lg:max-h-[85vh] overflow-hidden">
        {/* User list — matches workspace height; scrolls internally */}
        <aside className="border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-700 flex flex-col min-h-0 h-[min(420px,50vh)] lg:h-full min-w-0 overflow-hidden bg-slate-50/40 dark:bg-slate-900/20">
          <div className="p-3 sm:p-4 border-b border-slate-200 dark:border-slate-700 shrink-0 space-y-2">
            <ListSearchFilterBar
              searchValue={searchTerm}
              onSearchChange={onSearchTermChange}
              searchPlaceholder="Search users…"
              filter={
                <PageFilterMenu
                  activeCount={roleFilterActiveCount}
                  onClear={() => setRoleFilter('')}
                >
                  <FilterMenuSelect
                    label="Role"
                    value={roleFilter}
                    onChange={setRoleFilter}
                    options={[
                      { value: '', label: 'All roles' },
                      ...roleOptions,
                    ]}
                  />
                </PageFilterMenu>
              }
            />
            {!loading && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums px-0.5">
                {displayedUsers.length} user{displayedUsers.length === 1 ? '' : 's'}
              </p>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain custom-scrollbar p-2 space-y-0.5">
            {loading ? (
              <LoadingState variant="panel" layout="list" label="Loading users…" />
            ) : displayedUsers.length === 0 ? (
              <p className="text-center py-10 text-sm text-slate-500">No users found</p>
            ) : (
              displayedUsers.map((user) => {
                const isSelected = selectedUser?.id === user.id;
                const overrideCount = permissionService.getUserOverrides(user.id).length;
                const label = userDisplayName(user, language);
                const initial = (label.trim()[0] || '?').toUpperCase();
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => {
                      setSelectedUser(user);
                      setFormOpen(false);
                      resetForm();
                    }}
                    className={`w-full text-left rounded-lg px-2.5 py-2 transition-colors flex items-center gap-2.5 ${
                      isSelected
                        ? 'bg-primary-50 dark:bg-primary-900/30 ring-1 ring-primary-500/30'
                        : 'hover:bg-white dark:hover:bg-slate-800/70'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-xs shrink-0 ${avatarColor(label)}`}
                    >
                      {initial}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 dark:text-white truncate font-khmer">
                        {label}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {formatAccessRoleLabel(user.role)}
                      </p>
                    </div>
                    {overrideCount > 0 && (
                      <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                        {overrideCount}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Workspace */}
        <main className="flex flex-col min-h-0 min-w-0 overflow-hidden bg-white dark:bg-slate-900/40">
          {!selectedUser ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                <UserIcon className="w-6 h-6 text-slate-400" />
              </div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Select a user
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                Role defaults apply automatically. Add an exception only when someone needs extra
                access or a restriction.
              </p>
            </div>
          ) : (
            <>
              <div className="shrink-0 px-4 py-3 sm:px-5 sm:py-4 border-b border-slate-200 dark:border-slate-700">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate font-khmer">
                      {userDisplayName(selectedUser, language)}
                    </h3>
                    <Badge variant={roleBadgeVariant(selectedUser.role)}>
                      {formatAccessRoleLabel(selectedUser.role)}
                    </Badge>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {selectedUser.email}
                  </p>
                </div>

                {stableMiniStats && (
                  <dl className="grid grid-cols-3 gap-2 mt-3">
                    <StatPill label="Active" value={stableMiniStats.activeOverrides} tone="amber" />
                    <StatPill label="Expired" value={stableMiniStats.expiredRules} tone="rose" />
                    <StatPill
                      label="Effective"
                      value={stableMiniStats.effectivePermissions}
                      tone="emerald"
                    />
                  </dl>
                )}
              </div>

              {formOpen && (
                <div className="shrink-0 border-b border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40 p-4 sm:p-5 space-y-4">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    New exception
                  </p>

                  <div>
                    <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                      Action
                    </span>
                    <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden">
                      {(['GRANT', 'REVOKE'] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setOverrideType(type)}
                          className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                            overrideType === type
                              ? type === 'GRANT'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-red-600 text-white'
                              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                          }`}
                        >
                          {type === 'GRANT' ? 'Grant' : 'Revoke'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                      Permissions
                    </span>
                    <PermissionOverridePicker
                      permissions={permissions}
                      value={permIds}
                      onChange={setPermIds}
                      existingOverrideIds={existingOverridePermIds}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                      Reason <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      required
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Why is this exception needed?"
                      rows={2}
                      className={`${inputClass} resize-y min-h-[3.5rem]`}
                    />
                  </div>

                  <div>
                    <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                      Duration
                    </span>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {EXPIRY_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setExpiryPreset(preset.id)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                            expiryPreset === preset.id
                              ? 'bg-primary-600 text-white'
                              : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    {expiryPreset === 'custom' && (
                      <input
                        type="datetime-local"
                        value={expiresAt}
                        onChange={(e) => setExpiresAt(e.target.value)}
                        className={inputClass}
                      />
                    )}
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFormOpen(false);
                        resetForm();
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleApplyOverride}
                      disabled={!reason.trim() || permIds.length === 0 || submitting}
                      isLoading={submitting}
                    >
                      {permIds.length > 1
                        ? `Save ${permIds.length} exceptions`
                        : 'Save exception'}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex-1 flex flex-col min-h-0">
                <div className="shrink-0 px-4 sm:px-5 py-2.5 flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Exceptions ({filteredOverrides.length})
                  </span>
                  <div className="flex rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden text-xs">
                    {(
                      [
                        ['active', 'Active'],
                        ['expired', 'Expired'],
                        ['all', 'All'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setOverrideFilter(id)}
                        className={`px-2.5 py-1 font-medium ${
                          overrideFilter === id
                            ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white'
                            : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-5">
                  {filteredOverrides.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-500 dark:text-slate-400">
                      <Shield className="w-9 h-9 mb-3 opacity-40" />
                      <p className="text-sm font-medium">
                        {overrideFilter === 'active'
                          ? 'No active exceptions'
                          : overrideFilter === 'expired'
                            ? 'No expired exceptions'
                            : 'No exceptions yet'}
                      </p>
                      {!formOpen && overrideFilter !== 'expired' && (
                        <button
                          type="button"
                          onClick={() => setFormOpen(true)}
                          className="mt-2 text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
                        >
                          Add the first exception
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredOverrides.map((override) => {
                        const perm = lookupPerm(override);
                        const isGrant = override.overrideType === 'GRANT';
                        return (
                          <div
                            key={override.id}
                            className="flex gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 bg-white dark:bg-slate-800/50"
                          >
                            <div
                              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                                isGrant
                                  ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                              }`}
                            >
                              {isGrant ? (
                                <ArrowUp className="w-4 h-4" />
                              ) : (
                                <ArrowDown className="w-4 h-4" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium text-slate-900 dark:text-white">
                                  {perm?.name || override.permissionId}
                                </p>
                                <Badge variant={isGrant ? 'success' : 'danger'}>
                                  {isGrant ? 'Grant' : 'Revoke'}
                                </Badge>
                                {expiryBadge(override)}
                              </div>
                              {perm?.description && (
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                  {perm.description}
                                </p>
                              )}
                              <p className="text-sm text-slate-600 dark:text-slate-300 mt-1.5">
                                {override.reason}
                              </p>
                              <p className="text-xs text-slate-400 mt-1.5">
                                By {override.grantedByName || 'Unknown'} ·{' '}
                                {formatDateTime(override.createdAt)}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleDelete(override.id)}
                              className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0 self-start"
                              aria-label="Remove exception"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
};

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'amber' | 'rose' | 'emerald';
}) {
  const tones = {
    amber: 'text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/25 border-amber-200/70 dark:border-amber-800/50',
    rose: 'text-rose-800 dark:text-rose-200 bg-rose-50 dark:bg-rose-900/25 border-rose-200/70 dark:border-rose-800/50',
    emerald:
      'text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-900/25 border-emerald-200/70 dark:border-emerald-800/50',
  };
  return (
    <div className={`rounded-lg border px-2.5 py-1.5 ${tones[tone]}`}>
      <dt className="text-[10px] uppercase tracking-wide opacity-80">{label}</dt>
      <dd className="text-base font-bold tabular-nums leading-tight">{value}</dd>
    </div>
  );
}

export default UserOverrideManager;
