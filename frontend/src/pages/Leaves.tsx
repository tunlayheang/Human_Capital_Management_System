import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../hooks/useWorkspaceTabCache';
import { useRegisterPullToRefresh } from '../context/PullToRefreshContext';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useLanguage } from '../context/LanguageContext';
import { resolveLeaveTypeDisplayName } from '../utils/localizedEntityLabel';
import { PERM } from '../constants/permissionKeys';
import { Api } from '../services/api';
import { filterEmployeesWithAssignedDisplayId } from '../utils/employeeDirectoryEligibility';
import {
  LeaveRequest,
  LeaveStatus,
  LeaveType,
  LeaveBalanceEntry,
  Role,
  User,
} from '../types';
import { ApproverApprovalField } from '../components/workflow/ApproverApprovalField';
import type { WorkflowApproverCandidate } from '../components/workflow/ApproverSelectPanel';
import { approverCandidateFromAssigned } from '../utils/approverCandidateFromAssigned';
import {
  calculateLeaveDays,
  formatLeaveDateRange,
  formatLeaveDurationLabel,
  type LeaveHalfDayPeriod,
} from '../utils/leaveDays';
import { parseLeaveTypeRow } from '../utils/leaveTypeCategory';
import { isManageScope, isSelfServiceScope } from '../utils/selfServiceScope';
import { filterLeavesForManagerQueue, normalizeLeaveRequest } from '../utils/leaveWorkflow';
import { ApprovalTable } from '../components/leaves/ApprovalTable';
import { MyLeavesTable } from '../components/leaves/MyLeavesTable';
import { LeaveRequestViewModal } from '../components/leaves/LeaveRequestViewModal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { LeaveBalanceList } from '../components/leaves/LeaveBalanceList';
import {
  LeaveRequestBalancePanel,
  formatLeaveBalanceDays,
  remainingForLeaveTypeName,
} from '../components/leaves/LeaveRequestBalancePanel';
import { LeaveTypeConfig } from '../components/leaves/LeaveTypeConfig';
import { PlanningCalendar } from '../components/leaves/PlanningCalendar';
import { RosterModal } from '../components/leaves/RosterModal';
import { normalizePlanningRoster, normalizePlanningRosterList } from '../utils/planningRoster';
import { MonthlyFixedRoster } from '../types/roster';
import { PageShell, PageHeader, RestrictedAccess, ContentSkeleton } from '../components/ui/page';
import { useRoutePageMeta, useSyncDocumentTitle } from '../hooks/useRoutePageMeta';
import { inputClass } from '../constants/designSystem';
import { DatePickerInput } from '../components/ui/shadcn/date-picker-input';
import { orderInclusiveStartEnd } from '../utils/dateRangeFilter';
import {
  Plus,
  Settings,
  Calendar as CalendarIcon,
  ChevronDown,
  CheckCircle2,
  CalendarRange,
  SlidersHorizontal,
} from 'lucide-react';

type TabId = 'my_leaves' | 'requests' | 'planning' | 'config';

/** Legacy URLs from the old two-page leave manage UI. */
const LEAVE_MANAGE_TAB_ALIASES: Record<string, TabId> = {
  request_list: 'requests',
  approvals: 'requests',
};

const SUPER_ADMIN = 'SUPER_ADMIN';
const LEAVES_CACHE_SLOT = 'leaves-v1';

type LeaveDurationKind = 'full' | 'half';

type LeavesTabCache = {
  allLeaves: LeaveRequest[];
  leaveTypes: LeaveType[];
  usersMap: Record<string, User>;
  departmentNames: Record<string, string>;
  usersList: User[];
  fixedRosters: MonthlyFixedRoster[];
  rosterEmployees: Array<{ id: string; name: string; department?: string }>;
  leaveBalances: LeaveBalanceEntry[];
  balanceYear: number;
  activeTab: TabId;
};

type LeaveFormData = {
  type: string;
  durationKind: LeaveDurationKind;
  startDate: string;
  endDate: string;
  halfDayPeriod: LeaveHalfDayPeriod;
  reason: string;
  assignedDepartmentId: string;
  assignedManagerId: string;
};

function normalizeLeaveTypes(raw: unknown): LeaveType[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((row) => {
      const t = (row ?? {}) as Record<string, unknown>;
      const name = String(t.name ?? '').trim();
      const id = String(t.id ?? '').trim();
      if (!id || !name) return null;
      return parseLeaveTypeRow(t) as LeaveType;
    })
    .filter((x): x is LeaveType => x !== null);
}

function defaultLeaveForm(types: LeaveType[]): LeaveFormData {
  return {
    type: types[0]?.name ?? '',
    durationKind: 'full',
    startDate: '',
    endDate: '',
    halfDayPeriod: 'AM',
    reason: '',
    assignedDepartmentId: '',
    assignedManagerId: '',
  };
}

function leaveFormFromRequest(leave: LeaveRequest): LeaveFormData {
  const isHalf = Boolean(leave.isHalfDay);
  return {
    type: leave.type,
    durationKind: isHalf ? 'half' : 'full',
    startDate: String(leave.startDate ?? '').slice(0, 10),
    endDate: String(leave.endDate ?? '').slice(0, 10),
    halfDayPeriod: (leave.halfDayPeriod as LeaveHalfDayPeriod) ?? 'AM',
    reason: leave.reason ?? '',
    assignedDepartmentId: '',
    assignedManagerId: leave.assignedManagerId ?? '',
  };
}

export const Leaves: React.FC = () => {
  const { user, hasRole, hasPermission } = useAuth();
  const { showToast } = useToast();
  const { t, language } = useLanguage();
  const [searchParams] = useSearchParams();
  const selfService = isSelfServiceScope(searchParams);
  const manageScope = isManageScope(searchParams);

  const isSuperAdmin = (user?.role as string) === SUPER_ADMIN;
  const isHrLeaveOps = useMemo(
    () => isSuperAdmin || hasRole([Role.ADMIN, Role.HR]),
    [isSuperAdmin, hasRole]
  );
  const isManagerOnly = useMemo(
    () => hasRole([Role.MANAGER]) && !isHrLeaveOps,
    [hasRole, isHrLeaveOps]
  );
  const canSubmitLeave = useMemo(
    () =>
      selfService
        ? true
        : hasPermission(PERM.LEAVE_CREATE) && !hasPermission(PERM.LEAVE_APPROVE),
    [selfService, hasPermission]
  );
  const canPlanningAndConfig = useMemo(
    () => manageScope && hasPermission(PERM.LEAVE_EDIT),
    [manageScope, hasPermission]
  );
  const canViewLeaves =
    selfService ||
    hasPermission(PERM.LEAVE_VIEW) ||
    hasPermission(PERM.LEAVE_APPROVE) ||
    hasPermission(PERM.LEAVE_EDIT) ||
    hasPermission(PERM.LEAVE_CREATE);

  /** Approve/act on team leave requests — matrix only (no Admin role bypass). */
  const canManageLeaveRequests =
    manageScope && hasPermission(PERM.LEAVE_APPROVE);

  const defaultTab: TabId = selfService
    ? 'my_leaves'
    : canManageLeaveRequests
      ? 'requests'
      : 'my_leaves';
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);

  const [loading, setLoading] = useState(true);
  const [allLeaves, setAllLeaves] = useState<LeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [usersMap, setUsersMap] = useState<Record<string, User>>({});
  const [departmentNames, setDepartmentNames] = useState<Record<string, string>>({});
  const [usersList, setUsersList] = useState<User[]>([]);
  const [fixedRosters, setFixedRosters] = useState<MonthlyFixedRoster[]>([]);
  const [rosterEmployees, setRosterEmployees] = useState<
    Array<{ id: string; name: string; department?: string }>
  >([]);
  const [rosterModalOpen, setRosterModalOpen] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLeaveId, setEditingLeaveId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<LeaveFormData>(defaultLeaveForm([]));
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalanceEntry[]>([]);
  const [balanceYear, setBalanceYear] = useState(() => new Date().getFullYear());
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [approverUserIds, setApproverUserIds] = useState<string[]>([]);
  const [approverCandidates, setApproverCandidates] = useState<WorkflowApproverCandidate[]>([]);
  const [viewLeave, setViewLeave] = useState<LeaveRequest | null>(null);
  const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  const scopeKey = selfService ? 'self' : 'manage';
  const tabCache = useWorkspaceTabCache<LeavesTabCache>({
    slot: LEAVES_CACHE_SLOT,
    cacheKey: scopeKey,
    getSnapshot: () => ({
      allLeaves,
      leaveTypes,
      usersMap,
      departmentNames,
      usersList,
      fixedRosters,
      rosterEmployees,
      leaveBalances,
      balanceYear,
      activeTab,
    }),
    applySnapshot: (cached) => {
      setAllLeaves(cached.allLeaves);
      setLeaveTypes(cached.leaveTypes);
      setUsersMap(cached.usersMap);
      setDepartmentNames(cached.departmentNames);
      setUsersList(cached.usersList);
      setFixedRosters(cached.fixedRosters);
      setRosterEmployees(cached.rosterEmployees);
      setLeaveBalances(cached.leaveBalances);
      setBalanceYear(cached.balanceYear);
      setActiveTab(cached.activeTab);
      setLoading(false);
    },
    shouldPersist: (cached) =>
      cached.leaveTypes.length > 0 || cached.allLeaves.length > 0,
    persistDeps: [
      allLeaves,
      leaveTypes,
      usersMap,
      departmentNames,
      usersList,
      fixedRosters,
      rosterEmployees,
      leaveBalances,
      balanceYear,
      activeTab,
    ],
  });

  const activeLeaveTypes = useMemo(
    () => leaveTypes.filter((t) => t.isActive === true),
    [leaveTypes]
  );

  const openRequestModal = useCallback(() => {
    setEditingLeaveId(null);
    setFormData(defaultLeaveForm(activeLeaveTypes));
    setApproverUserIds([]);
    setApproverCandidates([]);
    setIsModalOpen(true);
  }, [activeLeaveTypes]);

  const loadCoreData = useCallback(async (opts?: WorkspaceLoadOptions) => {
    if (!opts?.background) setLoading(true);
    try {
      const [types, leaves, users, depts] = await Promise.all([
        Api.leaves.getTypes({ includeInactive: true }),
        Api.leaves.getAll(),
        Api.users.getDirectory(),
        Api.departments.getAll(),
      ]);
      setLeaveTypes(normalizeLeaveTypes(types));
      setAllLeaves(
        Array.isArray(leaves) ? leaves.map((row) => normalizeLeaveRequest(row)) : []
      );
      const deptMap: Record<string, string> = {};
      (Array.isArray(depts) ? depts : []).forEach((d: { id?: string; name?: string }) => {
        if (d?.id) deptMap[String(d.id)] = String(d.name ?? d.id);
      });
      setDepartmentNames(deptMap);
      const list = Array.isArray(users) ? users : [];
      setUsersList(list);
      const map: Record<string, User> = {};
      list.forEach((u) => {
        map[u.id] = u;
      });
      setUsersMap(map);
    } catch (e) {
      console.error(e);
      if (!opts?.background) {
        showToast(t('messages.loadError') || 'Failed to load data', 'error');
      }
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, [showToast, t]);

  useWorkspaceTabMountLoad(loadCoreData, [loadCoreData], tabCache);

  useRegisterPullToRefresh(
    useCallback(() => loadCoreData({ background: true }), [loadCoreData])
  );

  const loadLeaveBalances = useCallback(async () => {
    if (!user) return;
    setBalancesLoading(true);
    try {
      const res = await Api.leaves.getBalances(user.id, balanceYear);
      setLeaveBalances(Array.isArray(res?.balances) ? res.balances : []);
      if (res?.year) setBalanceYear(res.year);
    } catch (e) {
      console.error(e);
      setLeaveBalances([]);
    } finally {
      setBalancesLoading(false);
    }
  }, [user, balanceYear]);

  useEffect(() => {
    if (!user || loading) return;
    void loadLeaveBalances();
  }, [user, loading, allLeaves, loadLeaveBalances]);

  const loadPlanningRosters = useCallback(async () => {
    try {
      const rows = await Api.leaves.getPlanningRosters();
      setFixedRosters(normalizePlanningRosterList(rows));
    } catch (e) {
      console.error(e);
      showToast('Failed to load planning rosters', 'error');
    }
  }, [showToast]);

  useEffect(() => {
    if (!canPlanningAndConfig) return;
    void loadPlanningRosters();
  }, [canPlanningAndConfig, loadPlanningRosters]);

  useEffect(() => {
    if (!canPlanningAndConfig) return;
    void Api.employees
      .getAll({ page: 1, limit: 500, status: 'active', assigned_id_only: '1' })
      .then((res: { employees?: Array<Record<string, unknown>> }) => {
        const list = filterEmployeesWithAssignedDisplayId(
          Array.isArray(res?.employees) ? res.employees : []
        );
        setRosterEmployees(
          list.map((e) => {
            const first = String(e.first_name ?? e.firstName ?? '').trim();
            const last = String(e.last_name ?? e.lastName ?? '').trim();
            const dept = e.department as { name?: string } | undefined;
            return {
              id: String(e.id),
              employeeCode: String(e.employee_id ?? e.employeeId ?? '').trim() || undefined,
              name:
                [first, last].filter(Boolean).join(' ') ||
                String(e.employee_id ?? e.employeeId ?? e.id),
              department: dept?.name
                ? String(dept.name)
                : e.department_name
                  ? String(e.department_name)
                  : undefined,
            };
          })
        );
      })
      .catch(() => setRosterEmployees([]));
  }, [canPlanningAndConfig]);

  const navigate = useNavigate();

  useEffect(() => {
    const leaveId = searchParams.get('leaveId')?.trim() ?? '';
    const withLeaveId = (path: string) =>
      leaveId ? `${path}${path.includes('?') ? '&' : '?'}leaveId=${encodeURIComponent(leaveId)}` : path;

    if (selfService) {
      setActiveTab('my_leaves');
      if (searchParams.get('tab') && searchParams.get('tab') !== 'my_leaves') {
        navigate(withLeaveId('/leaves?scope=self'), { replace: true });
      }
    } else {
      const rawTab = searchParams.get('tab');
      const tab = (LEAVE_MANAGE_TAB_ALIASES[rawTab ?? ''] ?? rawTab) as TabId | null;
      const allowed: TabId[] = [];
      if (canManageLeaveRequests) allowed.push('requests');
      if (canPlanningAndConfig) allowed.push('planning', 'config');
      if (!tab || !allowed.includes(tab)) {
        navigate(withLeaveId(`/leaves?scope=manage&tab=${defaultTab}`), { replace: true });
        return;
      }
      if (rawTab && rawTab !== tab) {
        navigate(withLeaveId(`/leaves?scope=manage&tab=${tab}`), { replace: true });
        return;
      }
      setActiveTab(tab);
    }
    if (searchParams.get('action') === 'new' && canSubmitLeave) openRequestModal();
  }, [
    searchParams,
    selfService,
    canManageLeaveRequests,
    canPlanningAndConfig,
    canSubmitLeave,
    openRequestModal,
    navigate,
    defaultTab,
    isManagerOnly,
  ]);

  /** Keep type in sync when modal opens before types finished loading. */
  useEffect(() => {
    if (!isModalOpen || !activeLeaveTypes.length) return;
    setFormData((prev) => {
      if (prev.type && activeLeaveTypes.some((lt) => lt.name === prev.type)) return prev;
      return { ...prev, type: activeLeaveTypes[0].name };
    });
  }, [isModalOpen, activeLeaveTypes]);

  /** Refresh balances when opening the request form so remaining days are current. */
  useEffect(() => {
    if (!isModalOpen || !user) return;
    void loadLeaveBalances();
  }, [isModalOpen, user, loadLeaveBalances]);

  const myLeaves = useMemo(
    () => (user ? allLeaves.filter((l) => l.userId === user.id) : []),
    [allLeaves, user]
  );

  const managerNameForLeave = useCallback(
    (leave: LeaveRequest | null) => {
      if (!leave?.assignedManagerId) return undefined;
      const mgr = usersMap[leave.assignedManagerId];
      return mgr?.name || mgr?.email || leave.assignedManagerId;
    },
    [usersMap]
  );

  const handleViewLeave = useCallback((leave: LeaveRequest) => {
    setViewLeave(leave);
  }, []);

  const handleCancelLeave = useCallback(async () => {
    if (!cancelTarget) return;
    try {
      setCancelBusy(true);
      await Api.leaves.cancel(cancelTarget.id);
      showToast('Leave request cancelled. It remains visible for your records and approvers.', 'success');
      setCancelTarget(null);
      await loadCoreData();
      await loadLeaveBalances();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to cancel request';
      showToast(msg, 'error');
    } finally {
      setCancelBusy(false);
    }
  }, [cancelTarget, showToast, loadCoreData, loadLeaveBalances]);

  const handleRequestAgain = useCallback((leave: LeaveRequest) => {
    setViewLeave(null);
    const isReturned = String(leave.status).toUpperCase() === LeaveStatus.RETURNED;
    setEditingLeaveId(isReturned ? leave.id : null);
    setFormData(leaveFormFromRequest(leave));
    const chain = leave.assignedApprovers ?? [];
    if (chain.length) {
      setApproverUserIds(chain.map((a) => a.userId));
      setApproverCandidates(
        chain.map((a) => approverCandidateFromAssigned(a, usersMap, language))
      );
    } else if (leave.assignedManagerId) {
      const userId = String(leave.assignedManagerId);
      setApproverUserIds([userId]);
      setApproverCandidates([
        approverCandidateFromAssigned({ userId, name: null }, usersMap, language),
      ]);
    } else {
      setApproverUserIds([]);
      setApproverCandidates([]);
    }
    setIsModalOpen(true);
  }, [usersMap, language]);

  const handleEditReturned = useCallback(
    (leave: LeaveRequest) => {
      handleRequestAgain(leave);
    },
    [handleRequestAgain]
  );

  const deepLinkedLeaveIdRef = useRef<string | null>(null);
  useEffect(() => {
    const leaveId = searchParams.get('leaveId')?.trim();
    if (!leaveId || loading) return;
    if (deepLinkedLeaveIdRef.current === leaveId) return;
    const leave = allLeaves.find((l) => String(l.id) === leaveId);
    if (!leave) return;
    deepLinkedLeaveIdRef.current = leaveId;
    if (String(leave.status).toUpperCase() === LeaveStatus.RETURNED) {
      handleEditReturned(leave);
      return;
    }
    setViewLeave(leave);
  }, [searchParams, allLeaves, loading, handleEditReturned]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) {
      showToast('User not authenticated', 'error');
      return;
    }
    const { startDate, endDate, reason, durationKind, halfDayPeriod } = formData;
    const type = (formData.type || activeLeaveTypes[0]?.name || '').trim();
    const isHalfDay = durationKind === 'half';

    if (!activeLeaveTypes.length) {
      showToast('No leave types are configured. Contact HR.', 'warning');
      return;
    }
    if (!type) {
      showToast('Please select a leave type', 'warning');
      return;
    }
    if (!startDate) {
      showToast(isHalfDay ? 'Please select a date' : 'Please select start and end dates', 'warning');
      return;
    }
    if (!isHalfDay && !endDate) {
      showToast('Please select start and end dates', 'warning');
      return;
    }
    if (!reason.trim()) {
      showToast('Please enter a reason for your leave', 'warning');
      return;
    }
    if (approverUserIds.length === 0) {
      showToast('Please select at least one approver to review your request', 'warning');
      return;
    }
    const effectiveEnd = isHalfDay ? startDate : endDate;
    if (new Date(startDate) > new Date(effectiveEnd)) {
      showToast('End date must be on or after start date', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        userId: user.id,
        type,
        startDate,
        endDate: effectiveEnd,
        isHalfDay,
        halfDayPeriod: isHalfDay ? halfDayPeriod : null,
        reason: reason.trim(),
        assignedApproverUserIds: approverUserIds,
      };
      if (editingLeaveId) {
        await Api.leaves.update(editingLeaveId, payload);
        showToast('Leave request resubmitted for approval', 'success');
      } else {
        await Api.leaves.create(payload);
        showToast('Leave request submitted successfully', 'success');
      }
      setIsModalOpen(false);
      setEditingLeaveId(null);
      setFormData(defaultLeaveForm(activeLeaveTypes));
      setApproverUserIds([]);
      setApproverCandidates([]);
      await loadCoreData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to submit leave request';
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (id: string, step: 'manager' | 'hr', notes: string) => {
    try {
      const nextStatus =
        step === 'manager' ? LeaveStatus.MANAGER_APPROVED : LeaveStatus.APPROVED;
      const updated = await Api.leaves.updateStatus(id, nextStatus, notes);
      const normalized = normalizeLeaveRequest(updated);
      setAllLeaves((prev) =>
        prev.map((l) => (l.id === id ? { ...l, ...normalized } : l))
      );
      const finalStatus = String(normalized.status).toUpperCase();
      if (finalStatus === LeaveStatus.APPROVED) {
        showToast('Leave approved and applied to the planning roster', 'success');
        if (canPlanningAndConfig) await loadPlanningRosters();
      } else if (finalStatus === LeaveStatus.MANAGER_APPROVED) {
        showToast('Approved — forwarded to HR for final approval', 'success');
      } else {
        showToast('Approval recorded — sent to the next approver', 'success');
      }
      await loadCoreData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to approve leave';
      showToast(msg, 'error');
    }
  };

  const handleReturn = async (id: string, notes: string) => {
    try {
      await Api.leaves.updateStatus(id, LeaveStatus.RETURNED, notes);
      showToast('Leave returned to submitter for revision', 'info');
      await loadCoreData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to return leave';
      showToast(msg, 'error');
    }
  };

  const handleReject = async (id: string, rejectionReason: string) => {
    try {
      await Api.leaves.updateStatus(id, LeaveStatus.REJECTED, rejectionReason);
      showToast('Leave rejected', 'info');
      await loadCoreData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to reject leave';
      showToast(msg, 'error');
    }
  };

  const refreshLeaveTypes = async () => {
    setLeaveTypes(normalizeLeaveTypes(await Api.leaves.getTypes({ includeInactive: true })));
  };

  const handleCreateType = async (type: Omit<LeaveType, 'id'>) => {
    await Api.leaves.createType(type);
    await refreshLeaveTypes();
    showToast('Leave type added successfully', 'success');
  };

  const handleUpdateType = async (id: string, type: Omit<LeaveType, 'id'>) => {
    await Api.leaves.updateType(id, type);
    await refreshLeaveTypes();
    showToast('Leave type updated successfully', 'success');
  };

  const handleDeleteType = async (id: string, opts?: { effectiveFrom?: string }) => {
    await Api.leaves.deleteType(id, opts);
    await refreshLeaveTypes();
    showToast('Leave type deleted successfully', 'success');
  };

  const handleSaveRoster = async (
    roster: MonthlyFixedRoster,
    isEdit: boolean
  ): Promise<boolean> => {
    const name = roster.name?.trim();
    if (!name) {
      showToast('Roster name is required', 'warning');
      return false;
    }
    try {
      const payload = {
        month: roster.month,
        year: roster.year,
        name,
        entries: roster.entries ?? [],
      };
      if (isEdit) {
        if (!roster.id || roster.id.startsWith('fr-')) {
          showToast('Invalid roster id — reload the roster list and try again', 'error');
          return false;
        }
        const updated = await Api.leaves.updatePlanningRoster(roster.id, payload);
        if (!updated) {
          showToast('Roster not found — it may have been deleted', 'error');
          return false;
        }
        const normalized = normalizePlanningRoster(updated);
        if (normalized) {
          setFixedRosters((prev) =>
            prev.map((r) => (r.id === normalized.id ? normalized : r))
          );
        }
      } else {
        const created = await Api.leaves.createPlanningRoster(payload);
        const normalized = normalizePlanningRoster(created);
        if (normalized) {
          setFixedRosters((prev) => [normalized, ...prev.filter((r) => r.id !== normalized.id)]);
        }
      }
      await loadPlanningRosters();
      const n = payload.entries.length;
      showToast(
        n > 0
          ? `Roster saved (${n} day${n === 1 ? '' : 's'} in database)`
          : 'Roster saved (no day-off cells — paint the grid before saving)',
        n > 0 ? 'success' : 'warning'
      );
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save roster';
      showToast(msg, 'error');
      return false;
    }
  };

  const handleDeleteRoster = async (id: string) => {
    try {
      await Api.leaves.deletePlanningRoster(id);
      await loadPlanningRosters();
      showToast('Roster deleted successfully', 'success');
    } catch {
      showToast('Failed to delete roster', 'error');
    }
  };

  const managerAssignedLeaves = useMemo(
    () => filterLeavesForManagerQueue(allLeaves, user?.id),
    [allLeaves, user?.id]
  );

  const approvalTableLabels = useMemo(
    () => ({
      employee: t('leaves.employee'),
      employeeId: t('leaves.employeeId') || 'Employee ID',
      department: t('leaves.department') || 'Department',
      type: t('leaves.type'),
      dates: t('leaves.dates'),
      day: t('time.day') || 'day',
      days: t('time.days') || 'days',
      reason: t('leaves.reason'),
      status: t('leaves.status'),
      actions: t('leaves.actions'),
      noRequests: t('leaves.noRequests'),
      to: 'to',
      searchPlaceholder: 'Search name, employee ID, type, reason…',
      filterPending: 'Pending only',
      filterAll: 'All requests',
      filterThisMonth: 'This month',
      rejectTitle: 'Reject Leave Request',
      rejectPlaceholder: 'Please provide a reason for rejecting this leave request...',
      rejectConfirm: 'Reject Request',
      cancel: t('common.cancel'),
    }),
    [t]
  );

  const isHalfDayForm = formData.durationKind === 'half';
  const previewEnd = isHalfDayForm ? formData.startDate : formData.endDate;
  const dayPreview =
    formData.startDate && previewEnd && previewEnd >= formData.startDate
      ? calculateLeaveDays({
          startDate: formData.startDate,
          endDate: previewEnd,
          isHalfDay: isHalfDayForm,
          halfDayPeriod: isHalfDayForm ? formData.halfDayPeriod : null,
        })
      : null;

  const selectedTypeName = formData.type || activeLeaveTypes[0]?.name || '';
  const selectedRemaining = remainingForLeaveTypeName(leaveBalances, selectedTypeName);

  const routeMeta = useRoutePageMeta();
  useSyncDocumentTitle(routeMeta?.title);

  const pageHeaderActions = useMemo(() => {
    if (selfService || activeTab === 'my_leaves') {
      return canSubmitLeave ? (
        <Button onClick={openRequestModal} className="shadow-lg shadow-primary-500/20">
          <Plus className="w-4 h-4 mr-2" />
          {t('leaves.requestLeave')}
        </Button>
      ) : undefined;
    }
    if (activeTab === 'planning') {
      return (
        <Button
          className="bg-primary-600 hover:bg-primary-700 text-white shadow-lg shadow-primary-500/20"
          onClick={() => setRosterModalOpen(true)}
        >
          {t('leaves.manageRoster') || 'Manage roster'}
        </Button>
      );
    }
    return undefined;
  }, [activeTab, canSubmitLeave, openRequestModal, selfService, t]);

  if (!canViewLeaves) {
    return <RestrictedAccess message="You do not have permission to access leave management." />;
  }

  if (manageScope && !canManageLeaveRequests && !canPlanningAndConfig) {
    return <Navigate to="/leaves?scope=self" replace />;
  }

  return (
    <PageShell>
      {routeMeta && (
        <PageHeader
          title={routeMeta.title}
          subtitle={routeMeta.subtitle}
          iconComponent={routeMeta.icon}
          actions={pageHeaderActions}
        />
      )}

      {loading ? (
        <ContentSkeleton layout="list" rows={5} showChrome={false} />
      ) : (
        <>
          {(selfService || activeTab === 'my_leaves') && (
            <div className="space-y-4 sm:space-y-5 w-full min-w-0">
              <LeaveBalanceList
                balances={leaveBalances}
                year={balanceYear}
                loading={balancesLoading || loading}
                labels={{
                  title: t('leaves.balanceTitle') || 'Leave balance',
                  remaining: t('leaves.remaining') || 'remaining',
                  used: t('leaves.used') || 'Used',
                  of: t('leaves.of') || 'of',
                  days: t('time.days') || 'days',
                  unpaid: t('leaves.unpaid') || 'Unpaid',
                  empty: t('leaves.noBalance') || 'No leave types configured.',
                }}
              />
              <MyLeavesTable
              leaves={myLeaves}
              usersMap={usersMap}
              labels={{
                type: t('leaves.type'),
                dates: t('leaves.dates'),
                day: t('time.day') || 'day',
                days: t('time.days') || 'days',
                reason: t('leaves.reason'),
                status: t('leaves.status'),
                actions: t('leaves.actions') || 'Actions',
                noRequests: t('leaves.noRequests'),
                noData: t('common.noData') || 'No data found',
                to: 'to',
                view: 'View request',
                cancel: 'Cancel request',
                edit: 'Edit & resubmit',
              }}
              onView={handleViewLeave}
              onCancel={(leave) => setCancelTarget(leave)}
              onEdit={handleEditReturned}
            />
            </div>
          )}

          {!selfService && activeTab === 'requests' && canManageLeaveRequests && (
            <ApprovalTable
              leaves={isManagerOnly ? managerAssignedLeaves : allLeaves}
              usersMap={usersMap}
              leaveTypes={leaveTypes}
              departmentNames={departmentNames}
              currentUserId={user?.id}
              currentUserRole={user?.role}
              onApprove={handleApprove}
              onReturn={handleReturn}
              onReject={handleReject}
              title={t('leaves.leaveRequests') || 'Leave Approval'}
              hideTitle
              defaultFilterMode="all"
              pendingFilterKind={isManagerOnly ? 'actionable' : 'open'}
              labels={{
                ...approvalTableLabels,
                filterPending: isManagerOnly ? 'Needs my action' : 'Open (pending)',
                filterAll: isManagerOnly ? 'All assigned to me' : 'All requests',
                noRequests: isManagerOnly
                  ? 'No leave approvals assigned to you'
                  : t('leaves.noApprovals') || t('leaves.noRequests') || 'No leave approvals found',
              }}
            />
          )}

          {!selfService && activeTab === 'planning' && canPlanningAndConfig && (
            <div className="space-y-6">
              <PlanningCalendar
                leaves={allLeaves}
                usersMap={usersMap}
                rosterEmployees={rosterEmployees}
                fixedRosters={fixedRosters}
              />
              <RosterModal
                isOpen={rosterModalOpen}
                onClose={() => setRosterModalOpen(false)}
                fixedRosters={fixedRosters}
                rosterEmployees={rosterEmployees}
                leaveTypes={activeLeaveTypes}
                onSave={handleSaveRoster}
                onDelete={handleDeleteRoster}
              />
            </div>
          )}

          {!selfService && activeTab === 'config' && canPlanningAndConfig && (
            <LeaveTypeConfig
              types={leaveTypes}
              loading={loading}
              hideHeader
              onCreate={handleCreateType}
              onUpdate={handleUpdateType}
              onDelete={handleDeleteType}
            />
          )}
        </>
      )}

      <Modal
        isOpen={isModalOpen}
        size="lg"
        onClose={() => {
          if (!submitting) {
            setIsModalOpen(false);
            setEditingLeaveId(null);
            setFormData(defaultLeaveForm(activeLeaveTypes));
            setApproverUserIds([]);
            setApproverCandidates([]);
          }
        }}
        title={
          editingLeaveId
            ? t('leaves.resubmitLeave') || 'Resubmit leave request'
            : t('leaves.requestLeave')
        }
        description={
          editingLeaveId
            ? 'Update the returned request and resubmit it for approval.'
            : 'Check your leave balances, then submit dates, approvers, and reason.'
        }
      >
        <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-5 min-w-0 max-w-full">
          {editingLeaveId &&
          myLeaves.find((l) => l.id === editingLeaveId)?.rejectionReason ? (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
              <p className="font-semibold">Returned for revision</p>
              <p className="mt-1 whitespace-pre-wrap">
                {myLeaves.find((l) => l.id === editingLeaveId)?.rejectionReason}
              </p>
            </div>
          ) : null}
          <LeaveRequestBalancePanel
            balances={leaveBalances}
            year={balanceYear}
            loading={balancesLoading}
            selectedTypeName={selectedTypeName}
            requestedDays={dayPreview}
            labels={{
              title: t('leaves.balanceTitle') || 'Leave balance',
              remaining: t('leaves.remaining') || 'remaining',
              used: t('leaves.used') || 'Used',
              of: t('leaves.of') || 'of',
              days: t('time.days') || 'days',
              unpaid: t('leaves.unpaid') || 'Unpaid',
              empty: t('leaves.noBalance') || 'No leave types configured.',
              afterRequest: t('leaves.afterRequest') || 'Remaining after this request',
              insufficient:
                t('leaves.insufficientBalance') ||
                'This request exceeds your remaining balance for the selected leave type.',
            }}
          />
          <ApproverApprovalField
            required
            value={approverUserIds}
            selected={approverCandidates}
            defaultExpandedDepartmentId={user?.departmentId ?? null}
            onChange={(userIds, candidates) => {
              setApproverUserIds(userIds);
              setApproverCandidates(candidates);
            }}
            label="Approvers"
            hint="Assign one or more reviewers in order. Each person approves in turn, and the request is finalized after the last approver signs off."
            buttonLabel="Select approvers"
            modalTitle="Select leave approvers"
          />
          <div>
            <label className="block text-sm font-semibold mb-1.5">{t('leaves.type')}</label>
            <div className="relative">
              <select
                required
                value={formData.type || activeLeaveTypes[0]?.name || ''}
                className={`${inputClass} pr-10 appearance-none`}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                disabled={activeLeaveTypes.length === 0}
              >
                {activeLeaveTypes.length === 0 ? (
                  <option value="">No leave types configured</option>
                ) : (
                  activeLeaveTypes.map((lt) => {
                    const rem = remainingForLeaveTypeName(leaveBalances, lt.name);
                    const label = resolveLeaveTypeDisplayName(lt, language);
                    return (
                      <option key={lt.id} value={lt.name}>
                        {rem != null
                          ? `${label} · ${formatLeaveBalanceDays(rem)} ${t('leaves.remaining') || 'remaining'}`
                          : label}
                      </option>
                    );
                  })
                )}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
            {selectedRemaining != null ? (
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                {resolveLeaveTypeDisplayName(
                  activeLeaveTypes.find((lt) => lt.name === selectedTypeName) || {
                    name: selectedTypeName,
                  },
                  language
                )}
                :{' '}
                <span className="font-semibold tabular-nums text-primary-600 dark:text-primary-400">
                  {formatLeaveBalanceDays(selectedRemaining)} {t('time.days') || 'days'}{' '}
                  {t('leaves.remaining') || 'remaining'}
                </span>
              </p>
            ) : null}
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1.5">Duration</label>
            <div className="flex flex-wrap gap-2 min-w-0">
              <button
                type="button"
                className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl text-xs sm:text-sm font-semibold border transition-colors ${
                  formData.durationKind === 'full'
                    ? 'bg-primary-50 border-primary-300 text-primary-700 dark:bg-primary-900/30 dark:border-primary-700 dark:text-primary-300'
                    : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
                onClick={() =>
                  setFormData((prev) => ({
                    ...prev,
                    durationKind: 'full',
                    endDate: prev.endDate || prev.startDate,
                  }))
                }
              >
                Full day(s)
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl text-xs sm:text-sm font-semibold border transition-colors ${
                  formData.durationKind === 'half'
                    ? 'bg-primary-50 border-primary-300 text-primary-700 dark:bg-primary-900/30 dark:border-primary-700 dark:text-primary-300'
                    : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
                onClick={() =>
                  setFormData((prev) => ({
                    ...prev,
                    durationKind: 'half',
                    endDate: prev.startDate,
                  }))
                }
              >
                Half day
              </button>
            </div>
          </div>
          {isHalfDayForm ? (
            <>
              <div>
                <label className="block text-sm font-semibold mb-1.5">Date</label>
                <DatePickerInput
                  required
                  value={formData.startDate}
                  className={inputClass}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      startDate: e.target.value,
                      endDate: e.target.value,
                    })
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1.5">Part of day</label>
                <div className="flex gap-2">
                  {(['AM', 'PM'] as const).map((period) => (
                    <button
                      key={period}
                      type="button"
                      className={`flex-1 px-3 py-2 sm:px-4 sm:py-2.5 rounded-lg sm:rounded-xl text-xs sm:text-sm font-semibold border transition-colors ${
                        formData.halfDayPeriod === period
                          ? 'bg-primary-50 border-primary-300 text-primary-700 dark:bg-primary-900/30 dark:border-primary-700 dark:text-primary-300'
                          : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400'
                      }`}
                      onClick={() => setFormData({ ...formData, halfDayPeriod: period })}
                    >
                      {period === 'AM' ? 'Morning' : 'Afternoon'}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="responsive-form-grid">
              <div>
                <label className="block text-sm font-semibold mb-1.5">Start date</label>
                <DatePickerInput
                  required
                  value={formData.startDate}
                  max={formData.endDate || undefined}
                  className={inputClass}
                  onChange={(e) => {
                    const next = orderInclusiveStartEnd(
                      e.target.value,
                      formData.endDate,
                      'startDate'
                    );
                    setFormData({ ...formData, startDate: next.startDate, endDate: next.endDate });
                  }}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1.5">End date</label>
                <DatePickerInput
                  required
                  value={formData.endDate}
                  min={formData.startDate || undefined}
                  className={inputClass}
                  onChange={(e) => {
                    const next = orderInclusiveStartEnd(
                      formData.startDate,
                      e.target.value,
                      'endDate'
                    );
                    setFormData({ ...formData, startDate: next.startDate, endDate: next.endDate });
                  }}
                />
              </div>
            </div>
          )}
          {dayPreview != null && (
            <p className="text-sm text-primary-600 font-semibold">
              Duration:{' '}
              {formatLeaveDurationLabel(dayPreview, {
                day: t('time.day') || 'day',
                days: t('time.days') || 'days',
                halfDay: '½ day',
              })}
              {!isHalfDayForm ? ' (inclusive)' : ''}
            </p>
          )}
          <div>
            <label className="block text-sm font-semibold mb-1.5">{t('leaves.reason')}</label>
            <textarea
              required
              rows={4}
              value={formData.reason}
              className={`${inputClass} resize-none`}
              onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
            />
          </div>
          <div className="hcms-modal-actions hcms-modal-actions--end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => setIsModalOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="min-w-[6rem]"
            >
              {submitting ? '...' : t('leaves.submit')}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!cancelTarget}
        onClose={() => !cancelBusy && setCancelTarget(null)}
        title="Cancel leave request"
        description={
          cancelTarget
            ? `Withdraw your ${cancelTarget.type} request for ${formatLeaveDateRange(cancelTarget)}? Approvers will no longer see it as pending. The record stays on both lists as Cancelled.`
            : ''
        }
        variant="danger"
        confirmLabel="Cancel request"
        loading={cancelBusy}
        onConfirm={handleCancelLeave}
      />

      <LeaveRequestViewModal
        isOpen={!!viewLeave}
        onClose={() => setViewLeave(null)}
        leave={viewLeave}
        usersMap={usersMap}
        departmentNames={departmentNames}
        managerName={managerNameForLeave(viewLeave)}
        labels={{
          title: 'Leave request details',
          type: t('leaves.type'),
          dates: t('leaves.dates'),
          days: t('time.days') || 'days',
          day: t('time.day') || 'day',
          reason: t('leaves.reason'),
          status: t('leaves.status'),
          manager: 'Approving manager',
          close: t('common.close') || 'Close',
          requestAgain:
            viewLeave && String(viewLeave.status).toUpperCase() === LeaveStatus.RETURNED
              ? t('leaves.editResubmit') || 'Edit & resubmit'
              : viewLeave && String(viewLeave.status).toUpperCase() === LeaveStatus.CANCELLED
                ? 'Submit new request'
                : undefined,
        }}
        onRequestAgain={
          viewLeave &&
          (String(viewLeave.status).toUpperCase() === LeaveStatus.CANCELLED ||
            String(viewLeave.status).toUpperCase() === LeaveStatus.RETURNED)
            ? handleRequestAgain
            : undefined
        }
      />
    </PageShell>
  );
};
