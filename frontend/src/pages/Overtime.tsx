import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../hooks/useWorkspaceTabCache';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { isManageScope, isSelfServiceScope } from '../utils/selfServiceScope';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';
import { PERM } from '../constants/permissionKeys';
import { Api } from '../services/api';
import { OvertimeRequest, OvertimeType, Role, User, type OvertimeRequestConfig } from '../types';
import { MyOvertimeTable } from '../components/overtime/MyOvertimeTable';
import { OvertimeRequestViewModal } from '../components/overtime/OvertimeRequestViewModal';
import { OvertimeApprovalTable } from '../components/overtime/OvertimeApprovalTable';
import {
  OvertimeTypeConfig,
  type OvertimeTypeInput,
} from '../components/overtime/OvertimeTypeConfig';
import {
  OvertimeRequestForm,
  emptyOvertimeForm,
  overtimeRequestToForm,
  type OvertimeFormState,
} from '../components/overtime/OvertimeRequestForm';
import { ApproverApprovalField } from '../components/workflow/ApproverApprovalField';
import type { WorkflowApproverCandidate } from '../components/workflow/ApproverSelectPanel';
import { approverCandidateFromAssigned } from '../utils/approverCandidateFromAssigned';
import { activeOvertimeTypes, defaultOvertimeRequestConfig, findOvertimeType } from '../utils/overtimeConfig';
import { normalizeOvertimeRequest } from '../utils/overtimeLabels';
import { PageShell, PageHeader, RestrictedAccess, ContentSkeleton } from '../components/ui/page';
import { useRoutePageMeta, useSyncDocumentTitle } from '../hooks/useRoutePageMeta';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { formatDateOnlyDisplay } from '../utils/formatDisplayDate';
import { Plus } from 'lucide-react';

type TabId = 'my_overtime' | 'requests' | 'config';

const OVERTIME_MANAGE_TAB_ALIASES: Record<string, TabId> = {
  approvals: 'requests',
  all: 'requests',
};

const SUPER_ADMIN = 'SUPER_ADMIN';
const OVERTIME_CACHE_SLOT = 'overtime-v1';

type OvertimeTabCache = {
  allRequests: OvertimeRequest[];
  usersMap: Record<string, User>;
  otConfig: OvertimeRequestConfig;
  otTypes: OvertimeType[];
  activeTab: TabId;
};

export const Overtime: React.FC = () => {
  const { user, hasRole, hasPermission } = useAuth();
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const selfService = isSelfServiceScope(searchParams);
  const manageScope = isManageScope(searchParams);

  const isSuperAdmin = (user?.role as string) === SUPER_ADMIN;
  const isHrOtOps = useMemo(
    () => isSuperAdmin || hasRole([Role.ADMIN, Role.HR]),
    [isSuperAdmin, hasRole]
  );
  const isManagerOnly = useMemo(
    () => hasRole([Role.MANAGER]) && !isHrOtOps,
    [hasRole, isHrOtOps]
  );
  const canSubmitOT = useMemo(
    () =>
      selfService
        ? true
        : (hasPermission(PERM.OVERTIME_VIEW) ||
            hasPermission(PERM.LEAVE_REQUEST) ||
            hasPermission(PERM.LEAVE_CREATE)) &&
          !hasPermission(PERM.OVERTIME_MANAGE),
    [selfService, hasPermission]
  );
  const canApprove =
    manageScope && hasPermission(PERM.OVERTIME_MANAGE);
  const canConfig =
    manageScope && (isSuperAdmin || hasPermission(PERM.OVERTIME_CONFIG));
  const canView =
    selfService ||
    hasPermission(PERM.OVERTIME_VIEW) ||
    hasPermission(PERM.ATTENDANCE_VIEW) ||
    hasPermission(PERM.OVERTIME_MANAGE) ||
    hasPermission(PERM.OVERTIME_CONFIG) ||
    canSubmitOT;

  const canManageOvertimeRequests = canApprove;

  const defaultTab: TabId = selfService
    ? 'my_overtime'
    : canManageOvertimeRequests
      ? 'requests'
      : 'my_overtime';
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);
  const [loading, setLoading] = useState(true);
  const [allRequests, setAllRequests] = useState<OvertimeRequest[]>([]);
  const [usersMap, setUsersMap] = useState<Record<string, User>>({});
  const [otConfig, setOtConfig] = useState<OvertimeRequestConfig>(defaultOvertimeRequestConfig());
  const [otTypes, setOtTypes] = useState<OvertimeType[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<OvertimeRequest | null>(null);
  const [viewRequest, setViewRequest] = useState<OvertimeRequest | null>(null);
  const [cancelTarget, setCancelTarget] = useState<OvertimeRequest | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<OvertimeFormState>(() => emptyOvertimeForm());
  const [approverUserIds, setApproverUserIds] = useState<string[]>([]);
  const [approverCandidates, setApproverCandidates] = useState<WorkflowApproverCandidate[]>([]);
  const deepLinkedOtIdRef = useRef<string | null>(null);

  const scopeKey = selfService ? 'self' : 'manage';
  const tabCache = useWorkspaceTabCache<OvertimeTabCache>({
    slot: OVERTIME_CACHE_SLOT,
    cacheKey: scopeKey,
    getSnapshot: () => ({
      allRequests,
      usersMap,
      otConfig,
      otTypes,
      activeTab,
    }),
    applySnapshot: (cached) => {
      setAllRequests(cached.allRequests);
      setUsersMap(cached.usersMap);
      setOtConfig(cached.otConfig);
      setOtTypes(cached.otTypes);
      setActiveTab(cached.activeTab);
      setLoading(false);
    },
    shouldPersist: (cached) => cached.allRequests.length > 0 || cached.otTypes.length > 0,
    persistDeps: [allRequests, usersMap, otConfig, otTypes, activeTab],
  });

  const openCreateModal = () => {
    setEditingRequest(null);
    const first = activeOvertimeTypes(otConfig)[0];
    setForm(emptyOvertimeForm(first?.id ?? '', first?.rateTier ?? 'daytime_150'));
    setApproverUserIds([]);
    setApproverCandidates([]);
    setModalOpen(true);
  };

  const openEditModal = (request: OvertimeRequest) => {
    if (request.status !== 'PENDING' && request.status !== 'RETURNED') return;
    setEditingRequest(request);
    setForm(overtimeRequestToForm(request));
    const chain = request.assignedApprovers ?? [];
    if (request.status === 'RETURNED') {
      if (chain.length) {
        setApproverUserIds(chain.map((a) => a.userId));
        setApproverCandidates(
          chain.map((a) => approverCandidateFromAssigned(a, usersMap, language))
        );
      } else if (request.assignedApproverUserIds?.length) {
        setApproverUserIds([...request.assignedApproverUserIds]);
        setApproverCandidates(
          request.assignedApproverUserIds.map((userId) =>
            approverCandidateFromAssigned({ userId, name: null }, usersMap, language)
          )
        );
      } else {
        setApproverUserIds([]);
        setApproverCandidates([]);
      }
    } else {
      setApproverUserIds([]);
      setApproverCandidates([]);
    }
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingRequest(null);
    setApproverUserIds([]);
    setApproverCandidates([]);
  };

  const loadData = useCallback(async (opts?: WorkspaceLoadOptions) => {
    if (!opts?.background) setLoading(true);
    try {
      const [requests, users, config, types] = await Promise.all([
        Api.overtime.getAll(),
        Api.users.getAll(),
        Api.overtime.getConfig(),
        Api.overtime.getTypes({ includeInactive: true }),
      ]);
      setAllRequests(
        Array.isArray(requests) ? requests.map((row) => normalizeOvertimeRequest(row)) : []
      );
      const map: Record<string, User> = {};
      (Array.isArray(users) ? users : []).forEach((u: User) => {
        map[u.id] = u;
      });
      setUsersMap(map);
      setOtConfig(config);
      setOtTypes(Array.isArray(types) ? types : []);
      if (!modalOpen) {
        const first = activeOvertimeTypes(config)[0];
        setForm(emptyOvertimeForm(first?.id ?? '', first?.rateTier ?? 'daytime_150'));
      }
    } catch (e) {
      console.error(e);
      if (!opts?.background) showToast('Failed to load overtime data', 'error');
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, [showToast, modalOpen]);

  useWorkspaceTabMountLoad(loadData, [loadData], tabCache);

  const navigate = useNavigate();

  useEffect(() => {
    const requestId = searchParams.get('requestId')?.trim() ?? '';
    const withRequestId = (path: string) =>
      requestId
        ? `${path}${path.includes('?') ? '&' : '?'}requestId=${encodeURIComponent(requestId)}`
        : path;

    if (selfService) {
      setActiveTab('my_overtime');
      if (searchParams.get('tab') && searchParams.get('tab') !== 'my_overtime') {
        navigate(withRequestId('/overtime?scope=self'), { replace: true });
      }
      return;
    }
    const rawTab = searchParams.get('tab');
    const tab = (OVERTIME_MANAGE_TAB_ALIASES[rawTab ?? ''] ?? rawTab) as TabId | null;
    const allowed: TabId[] = [];
    if (!canManageOvertimeRequests) allowed.push('my_overtime');
    if (canManageOvertimeRequests) allowed.push('requests');
    if (canConfig) allowed.push('config');
    if (!tab || !allowed.includes(tab)) {
      navigate(withRequestId(`/overtime?scope=manage&tab=${defaultTab}`), { replace: true });
      return;
    }
    if (rawTab && rawTab !== tab) {
      navigate(withRequestId(`/overtime?scope=manage&tab=${tab}`), { replace: true });
      return;
    }
    setActiveTab(tab);
  }, [
    searchParams,
    selfService,
    canManageOvertimeRequests,
    canConfig,
    navigate,
    defaultTab,
  ]);

  useEffect(() => {
    const requestId = searchParams.get('requestId')?.trim();
    if (!requestId || loading) return;
    if (deepLinkedOtIdRef.current === requestId) return;
    const request = allRequests.find((r) => String(r.id) === requestId);
    if (!request) return;
    deepLinkedOtIdRef.current = requestId;
    if (request.status === 'RETURNED' && (canSubmitOT || request.userId === user?.id)) {
      openEditModal(request);
      return;
    }
    setViewRequest(request);
  }, [searchParams, allRequests, loading, canSubmitOT, user?.id]);

  const myRequests = useMemo(
    () => (user ? allRequests.filter((r) => r.userId === user.id) : []),
    [allRequests, user]
  );

  /** Requests visible on the manage tab (all for HR/admin; dept-scoped + chain-assigned for managers). */
  const manageRequests = useMemo(() => {
    if (isManagerOnly && user?.id) {
      return allRequests.filter(
        (r) =>
          usersMap[r.userId]?.departmentId === user.departmentId ||
          (r.assignedApprovers ?? []).some((a) => String(a.userId) === String(user.id))
      );
    }
    return allRequests;
  }, [allRequests, user, usersMap, isManagerOnly]);

  const pendingManageCount = useMemo(
    () => manageRequests.filter((r) => r.status === 'PENDING').length,
    [manageRequests]
  );

  const handleCancelOvertime = useCallback(async () => {
    if (!cancelTarget) return;
    setCancelBusy(true);
    try {
      await Api.overtime.cancel(cancelTarget.id);
      showToast(
        'Overtime request cancelled. It remains visible for your records and approvers.',
        'success'
      );
      setCancelTarget(null);
      await loadData({ background: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to cancel request';
      showToast(msg, 'error');
    } finally {
      setCancelBusy(false);
    }
  }, [cancelTarget, showToast, loadData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) return;
    const hours = Number(form.hours);
    if (!Number.isFinite(hours) || hours <= 0) {
      showToast('Enter valid hours', 'warning');
      return;
    }
    const selectedType = findOvertimeType(otConfig, form.otTypeId);
    if (!selectedType) {
      showToast('Select an overtime category', 'warning');
      return;
    }
    const payload = {
      workDate: form.workDate,
      hours,
      rateTier: selectedType.rateTier,
      reason: form.reason.trim(),
      otTypeId: form.otTypeId,
      startTime: form.startTime || undefined,
      endTime: form.endTime || undefined,
      clockIn: form.clockIn || undefined,
      clockOut: form.clockOut || undefined,
    };
    const isResubmit = editingRequest?.status === 'RETURNED';
    if ((!editingRequest || isResubmit) && approverUserIds.length === 0) {
      showToast('Please select at least one approver to review your request', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      if (editingRequest) {
        await Api.overtime.update(editingRequest.id, {
          ...payload,
          ...(isResubmit ? { assignedApproverUserIds: approverUserIds } : {}),
        });
        showToast(
          isResubmit ? 'Overtime request resubmitted for approval' : 'Overtime request updated',
          'success'
        );
      } else {
        await Api.overtime.create({
          userId: user.id,
          ...payload,
          assignedApproverUserIds: approverUserIds,
        });
        showToast('Overtime request submitted', 'success');
      }
      closeModal();
      const first = activeOvertimeTypes(otConfig)[0];
      setForm(emptyOvertimeForm(first?.id ?? '', first?.rateTier ?? 'daytime_150'));
      await loadData();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : editingRequest
            ? 'Failed to update request'
            : 'Failed to submit request';
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (id: string, notes: string) => {
    try {
      await Api.overtime.updateStatus(id, 'APPROVED', notes);
      showToast('Overtime approved', 'success');
      await loadData();
    } catch (err) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : 'Failed to approve overtime';
      showToast(msg, 'error');
    }
  };

  const handleReturn = async (id: string, notes: string) => {
    try {
      await Api.overtime.updateStatus(id, 'RETURNED', notes);
      showToast('Overtime returned to submitter for revision', 'info');
      await loadData();
    } catch (err) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : 'Failed to return overtime';
      showToast(msg, 'error');
    }
  };

  const handleReject = async (id: string, rejectionReason: string) => {
    try {
      await Api.overtime.updateStatus(id, 'REJECTED', rejectionReason);
      showToast('Overtime rejected', 'info');
      await loadData();
    } catch (err) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : 'Failed to reject overtime';
      showToast(msg, 'error');
    }
  };

  const refreshOtConfig = async () => {
    const [config, types] = await Promise.all([
      Api.overtime.getConfig(),
      Api.overtime.getTypes({ includeInactive: true }),
    ]);
    setOtConfig(config);
    setOtTypes(Array.isArray(types) ? types : []);
  };

  const handleCreateType = async (type: OvertimeTypeInput) => {
    await Api.overtime.createType(type);
    await refreshOtConfig();
    showToast('Overtime type added successfully', 'success');
  };

  const handleUpdateType = async (id: string, type: OvertimeTypeInput) => {
    await Api.overtime.updateType(id, type);
    await refreshOtConfig();
    showToast('Overtime type updated successfully', 'success');
  };

  const handleDeleteType = async (id: string, opts?: { effectiveFrom?: string }) => {
    await Api.overtime.deleteType(id, opts);
    await refreshOtConfig();
    showToast('Overtime type deleted successfully', 'success');
  };

  const handleUpdateGlobalMax = async (globalMaxHoursPerMonth: number) => {
    await Api.overtime.updateSettings({ globalMaxHoursPerMonth });
    await refreshOtConfig();
    showToast('Monthly cap updated', 'success');
  };

  const routeMeta = useRoutePageMeta();
  useSyncDocumentTitle(routeMeta?.title);

  const pageHeaderActions = useMemo(() => {
    if ((selfService || activeTab === 'my_overtime') && canSubmitOT) {
      return (
        <Button onClick={openCreateModal} className="shadow-lg shadow-primary-500/20">
          <Plus className="w-4 h-4 mr-2" />
          {t('overtime.requestOvertime') || 'Request overtime'}
        </Button>
      );
    }
    return undefined;
  }, [activeTab, canSubmitOT, openCreateModal, selfService, t]);

  if (!canView) {
    return <RestrictedAccess message="You do not have permission to access overtime." />;
  }

  if (manageScope && !canApprove && !canConfig) {
    return <Navigate to="/overtime?scope=self" replace />;
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
          {(selfService || activeTab === 'my_overtime') && (
            <div className="space-y-4">
              <MyOvertimeTable
                requests={myRequests}
                usersMap={usersMap}
                onRequest={canSubmitOT ? openCreateModal : undefined}
                onEdit={(request) => {
                  if (
                    canSubmitOT ||
                    (request.userId === user?.id &&
                      (request.status === 'PENDING' || request.status === 'RETURNED'))
                  ) {
                    openEditModal(request);
                  }
                }}
                onCancel={
                  canSubmitOT || myRequests.some((r) => r.userId === user?.id)
                    ? setCancelTarget
                    : undefined
                }
                onView={setViewRequest}
              />
            </div>
          )}
          {!selfService && activeTab === 'requests' && canManageOvertimeRequests && (
              <OvertimeApprovalTable
                requests={manageRequests}
                usersMap={usersMap}
                onApprove={handleApprove}
                onReturn={handleReturn}
                onReject={handleReject}
                title={t('nav.modules.ot-requests') || 'OT Approval'}
                hideTitle
                defaultFilterMode="all"
                pendingCount={pendingManageCount}
                currentUserId={user?.id}
                currentUserRole={user?.role}
                help="overtime.approval"
              />
          )}
          {!selfService && activeTab === 'config' && canConfig && (
            <OvertimeTypeConfig
              types={otTypes}
              globalMaxHoursPerMonth={otConfig.globalMaxHoursPerMonth}
              loading={loading}
              hideTypesHeader
              onCreate={handleCreateType}
              onUpdate={handleUpdateType}
              onDelete={handleDeleteType}
              onUpdateGlobalMax={handleUpdateGlobalMax}
            />
          )}
        </>
      )}

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={
          editingRequest?.status === 'RETURNED'
            ? 'Edit & resubmit overtime'
            : editingRequest
              ? 'Edit overtime request'
              : 'Request overtime'
        }
        description="Provide overtime details for manager and HR approval."
      >
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 sm:space-y-4 min-w-0 max-w-full">
          {editingRequest?.status === 'RETURNED' && (
            <p className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2">
              This request was <strong>returned</strong> for revision
              {editingRequest.rejectionReason ? `: ${editingRequest.rejectionReason}` : '.'} Update
              the details, choose approvers, and resubmit for approval.
            </p>
          )}
          {editingRequest?.status === 'PENDING' && (
            <p className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2">
              Only <strong>pending</strong> or <strong>returned</strong> requests can be edited.
            </p>
          )}
          <OvertimeRequestForm
            config={otConfig}
            value={form}
            userId={user?.id}
            onChange={setForm}
          />
          {(!editingRequest || editingRequest.status === 'RETURNED') && (
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
              modalTitle="Select overtime approvers"
            />
          )}
          <div className="hcms-modal-actions hcms-modal-actions--end gap-2">
            <Button type="button" variant="ghost" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting
                ? 'Saving…'
                : editingRequest?.status === 'RETURNED'
                  ? 'Resubmit request'
                  : editingRequest
                    ? 'Save changes'
                    : 'Submit request'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!cancelTarget}
        onClose={() => !cancelBusy && setCancelTarget(null)}
        title="Cancel overtime request"
        description={
          cancelTarget
            ? `Withdraw your ${cancelTarget.hours}h overtime request for ${formatDateOnlyDisplay(cancelTarget.workDate)}? Approvers will no longer see it as pending. The record stays on both lists as Cancelled.`
            : ''
        }
        variant="danger"
        confirmLabel="Cancel request"
        loading={cancelBusy}
        onConfirm={handleCancelOvertime}
      />

      <OvertimeRequestViewModal
        isOpen={Boolean(viewRequest)}
        onClose={() => setViewRequest(null)}
        request={viewRequest}
        usersMap={usersMap}
        onEdit={
          viewRequest &&
          (canSubmitOT || viewRequest.userId === user?.id) &&
          (viewRequest.status === 'PENDING' || viewRequest.status === 'RETURNED')
            ? openEditModal
            : undefined
        }
      />
    </PageShell>
  );
};

export default Overtime;
