import React, { useCallback, useMemo, useState } from 'react';
import {
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../hooks/useWorkspaceTabCache';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { PageShell } from '../components/ui/page';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Api } from '../services/api';
import { Department, Position, Role, User } from '../types';
import { useToast } from '../context/ToastContext';
import {
  ArrowLeft,
  Ban,
  Briefcase,
  DollarSign,
  Edit2,
  RotateCcw,
  Settings,
  Trash2,
  Users,
  UserCircle,
} from 'lucide-react';
import { ContentSkeleton } from '../components/common/ContentSkeleton';
import { formatPositionSalaryRange } from '../utils/positionSalary';
import { Badge } from '../components/ui/Badge';
import {
  POSITION_ACCESS_ROLE_OPTIONS,
  positionAccessRoleLabel,
  positionLevelLabel,
} from '../constants/positionCatalog';
import { usePositionLevels } from '../hooks/usePositionLevels';
import { DepartmentSettingsModal } from '../components/departments/DepartmentSettingsModal';
import { useLanguage } from '../context/LanguageContext';
import {
  localizedLabelUsesKhmerFont,
  resolveDepartmentDisplayName,
  resolvePositionTitle,
} from '../utils/localizedEntityLabel';
import {
  isDepartmentManagerAssigned,
  NO_MANAGER_ASSIGNED_LABEL,
  resolveDepartmentManagerName,
} from '../utils/departmentDisplay';
import { cn } from '../utils';
import { useWorkspaceTabTitle } from '../hooks/useWorkspaceTabTitle';
import { useAuth } from '../context/AuthContext';
import { PERM } from '../constants/permissionKeys';
import { WizardKhmerSubsection } from '../components/employee-wizard/wizardKhmerSection';
import { EmployeeDetailModal } from '../components/employee/EmployeeDetailModal';
import {
  EmployeeListIdentityBlock,
  employeeListIdentityFromEmployeeRow,
} from '../components/employee/EmployeeListIdentity';

import { formatAccessRoleLabel } from '../utils/accessRole';

function roleLabelFromApi(name: string): string {
  const upper = name?.toUpperCase();
  if (upper === 'HR') return 'Humanresource';
  return formatAccessRoleLabel(name) || name || '';
}

type DepartmentEmployeeRow = {
  employee_id: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  first_name_kh?: string | null;
  last_name_kh?: string | null;
  email?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
  position?: { title?: string | null } | null;
  job_position?: string | null;
  position_title?: string | null;
};

const inputClass =
  'w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900 text-slate-900 dark:text-white';

function isActiveFlag(value: unknown): boolean {
  if (value === false || value === 0 || value === '0') return false;
  return true;
}

export const DepartmentDetail: React.FC = () => {
  const { t, language } = useLanguage();
  const { hasPermission } = useAuth();
  const canEditEmployee =
    hasPermission(PERM.EMPLOYEE_EDIT_PERSONAL) ||
    hasPermission(PERM.EMPLOYEE_EDIT_FINANCIAL) ||
    hasPermission(PERM.EMPLOYEE_EDIT_WORK);
  const { options: positionLevelOptions } = usePositionLevels();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [department, setDepartment] = useState<Department | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  const [showPositionModal, setShowPositionModal] = useState(false);
  const [editingPosition, setEditingPosition] = useState<Position | null>(null);
  const [newPosition, setNewPosition] = useState({
    title: '',
    titleKh: '',
    level: '',
    accessRole: Role.EMPLOYEE,
    salaryMin: '',
    salaryMax: '',
  });
  const [savingPosition, setSavingPosition] = useState(false);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [deletingPositionId, setDeletingPositionId] = useState<string | null>(null);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showEmployeesModal, setShowEmployeesModal] = useState(false);
  const [detailEmployeeId, setDetailEmployeeId] = useState<string | null>(null);
  const [departmentEmployees, setDepartmentEmployees] = useState<DepartmentEmployeeRow[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  useWorkspaceTabTitle(department?.name);

  const tabCache = useWorkspaceTabCache<{
    department: Department | null;
    positions: Position[];
    users: User[];
    allDepartments: Department[];
  }>({
    slot: 'department-detail-v2',
    cacheKey: id ?? '',
    getSnapshot: () => ({ department, positions, users, allDepartments }),
    applySnapshot: (cached) => {
      setDepartment(cached.department);
      setPositions(cached.positions);
      setUsers(cached.users);
      setAllDepartments(cached.allDepartments);
      setLoading(false);
    },
    shouldPersist: (cached) => cached.department != null,
    persistDeps: [department, positions, users, allDepartments, id],
  });

  const loadData = useCallback(async (opts?: WorkspaceLoadOptions) => {
    if (!id) return;
    if (!opts?.background) setLoading(true);
    try {
      const [deptData, posData, userData, depts] = await Promise.all([
        Api.departments.getById(id),
        Api.positions.getByDepartment(id),
        Api.users.getAll(),
        Api.departments.getAll(),
      ]);
      setDepartment(deptData as Department);
      setPositions(Array.isArray(posData) ? posData : []);
      setUsers(Array.isArray(userData) ? userData : []);
      setAllDepartments(Array.isArray(depts) ? depts : []);
    } catch (e) {
      console.error(e);
      if (!opts?.background) {
        showToast('Failed to load department details', 'error');
        setDepartment(null);
      }
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, [id, showToast]);

  useWorkspaceTabMountLoad(loadData, [loadData, id], tabCache, Boolean(id));

  const selectedManagerName = useMemo(() => {
    if (!department) return NO_MANAGER_ASSIGNED_LABEL;
    return resolveDepartmentManagerName(department, users);
  }, [department, users]);
  const hasManagerAssigned = useMemo(
    () => (department ? isDepartmentManagerAssigned(department, users) : false),
    [department, users]
  );

  const handleSettingsSaved = (updated: Department) => {
    setDepartment(updated);
    setAllDepartments((prev) => prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)));
  };

  const handleSettingsDeleted = (_id: string, updated?: Department) => {
    if (updated) {
      setDepartment(updated);
      setAllDepartments((prev) => prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)));
      return;
    }
    setShowSettingsModal(false);
    navigate('/departments');
  };

  const openCreatePosition = () => {
    setEditingPosition(null);
    setNewPosition({
      title: '',
      titleKh: '',
      level: '',
      accessRole: Role.EMPLOYEE,
      salaryMin: '',
      salaryMax: '',
    });
    setShowPositionModal(true);
  };

  const parseSalaryField = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const readPositionSalaryFields = (
    editing: Position | null,
    draft: typeof newPosition
  ): { salaryMin: number; salaryMax: number } | null => {
    const minRaw = editing
      ? String(editing.salaryMin ?? '')
      : draft.salaryMin;
    const maxRaw = editing
      ? String(editing.salaryMax ?? '')
      : draft.salaryMax;
    const salaryMin = parseSalaryField(minRaw);
    const salaryMax = parseSalaryField(maxRaw);
    if (salaryMin == null || salaryMax == null) return null;
    return { salaryMin, salaryMax };
  };

  const normalizePositionForEdit = (pos: Position): Position => ({
    ...pos,
    accessRole: (pos.accessRole ?? Role.EMPLOYEE) as Role,
    level: pos.level ?? '',
    titleKh: pos.titleKh ?? '',
  });

  const openEditPosition = (pos: Position) => {
    setEditingPosition(normalizePositionForEdit(pos));
    setShowPositionModal(true);
  };

  const handleSavePosition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    const title = (editingPosition ? editingPosition.title : newPosition.title).trim();
    const titleKh = (editingPosition ? editingPosition.titleKh : newPosition.titleKh)?.trim() ?? '';
    const level = editingPosition ? editingPosition.level : newPosition.level;
    const accessRole = (
      editingPosition
        ? editingPosition.accessRole ?? Role.EMPLOYEE
        : newPosition.accessRole || Role.EMPLOYEE
    );
    if (!title) {
      showToast('Position name is required', 'error');
      return;
    }
    if (!titleKh) {
      showToast('Position name (Khmer) is required', 'error');
      return;
    }
    if (!level) {
      showToast('Please select a level', 'error');
      return;
    }
    if (!accessRole) {
      showToast('Please select an access role', 'error');
      return;
    }
    const salaryRange = readPositionSalaryFields(editingPosition, newPosition);
    if (!salaryRange) {
      showToast('Enter a valid minimum and maximum salary', 'error');
      return;
    }
    if (salaryRange.salaryMax < salaryRange.salaryMin) {
      showToast('Maximum salary must be greater than or equal to minimum', 'error');
      return;
    }
    if (salaryRange.salaryMin <= 0 || salaryRange.salaryMax <= 0) {
      showToast('Salary range values must be greater than zero', 'error');
      return;
    }
    setSavingPosition(true);
    try {
      if (editingPosition) {
        await Api.positions.update({
          ...editingPosition,
          title,
          titleKh,
          level,
          accessRole,
          salaryMin: salaryRange.salaryMin,
          salaryMax: salaryRange.salaryMax,
        });
        showToast('Position updated successfully', 'success');
      } else {
        await Api.positions.create({
          title,
          titleKh,
          level,
          accessRole,
          departmentId: id,
          salaryMin: salaryRange.salaryMin,
          salaryMax: salaryRange.salaryMax,
        });
        showToast('Position added successfully', 'success');
      }
      setShowPositionModal(false);
      setEditingPosition(null);
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save position', 'error');
    } finally {
      setSavingPosition(false);
    }
  };

  const openEmployeesModal = useCallback(async () => {
    if (!id) return;
    setShowEmployeesModal(true);
    setLoadingEmployees(true);
    try {
      const data = await Api.employees.getAll({
        department_id: id,
        page: 1,
        limit: 200,
        sort_by: 'first_name',
        sort_order: 'ASC',
        status: 'active',
        assigned_id_only: '1',
      });
      setDepartmentEmployees((data.employees ?? []) as DepartmentEmployeeRow[]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load employees', 'error');
      setDepartmentEmployees([]);
    } finally {
      setLoadingEmployees(false);
    }
  }, [id, showToast]);

  const handleDeactivatePosition = async () => {
    if (!deactivatingId) return;
    setIsDeleting(true);
    try {
      await Api.positions.deactivate(deactivatingId);
      showToast('Position is now inactive', 'success');
      setDeactivatingId(null);
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to deactivate position', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeletePosition = async () => {
    if (!deletingPositionId) return;
    setIsDeleting(true);
    try {
      await Api.positions.delete(deletingPositionId);
      showToast('Position deleted', 'success');
      setDeletingPositionId(null);
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete position', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleReactivatePosition = async (positionId: string) => {
    setReactivatingId(positionId);
    try {
      const result = (await Api.positions.reactivate(positionId)) as Position & {
        parentDepartmentActive?: boolean;
      };
      const deptActive = isActiveFlag(department?.isActive);
      showToast(
        !deptActive || result.parentDepartmentActive === false
          ? 'Position is active again. Reactivate the department so it can appear in Onboarding.'
          : 'Position is active again',
        'success'
      );
      await loadData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to reactivate position', 'error');
    } finally {
      setReactivatingId(null);
    }
  };

  if (loading) {
    return (
      <ContentSkeleton layout="form" label="Loading department…" />
    );
  }

  if (!department) {
    return (
      <div className="text-center py-20">
        <p className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-4">Department not found</p>
        <Button onClick={() => navigate('/departments')}>Back to Departments</Button>
      </div>
    );
  }

  const headPct = Math.min((department.headCount / 20) * 100, 100);

  const scrollToPositions = () => {
    document.getElementById('department-positions')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <PageShell className="space-y-5 sm:space-y-6">
      {/* Compact page header */}
      <div className="surface-card p-5 sm:p-6">
        <button
          type="button"
          onClick={() => navigate('/departments')}
          className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-primary-600 dark:text-slate-400 dark:hover:text-primary-400 transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" aria-hidden />
          Back to departments
        </button>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1
                className={cn(
                  'text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight truncate',
                  localizedLabelUsesKhmerFont(department.name, department.nameKh, language) &&
                    'font-khmer'
                )}
              >
                {resolveDepartmentDisplayName(department, language)}
              </h1>
              <Badge variant={isActiveFlag(department.isActive) ? 'success' : 'neutral'}>
                {isActiveFlag(department.isActive) ? 'Active' : 'Inactive'}
              </Badge>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowSettingsModal(true)}
            icon={<Settings className="w-4 h-4" />}
            className="shrink-0"
          >
            Settings
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 mt-5">
          <button
            type="button"
            onClick={openEmployeesModal}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 px-3.5 py-2 text-sm hover:border-primary-300 dark:hover:border-primary-700 hover:bg-primary-50/50 dark:hover:bg-primary-950/20 transition-colors"
          >
            <Users className="w-4 h-4 text-primary-600 dark:text-primary-400 shrink-0" aria-hidden />
            <span className="text-slate-500 dark:text-slate-400">Employees</span>
            <span className="font-semibold text-slate-900 dark:text-white tabular-nums">{department.headCount}</span>
          </button>
          <button
            type="button"
            onClick={scrollToPositions}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 px-3.5 py-2 text-sm hover:border-primary-300 dark:hover:border-primary-700 hover:bg-primary-50/50 dark:hover:bg-primary-950/20 transition-colors"
          >
            <Briefcase className="w-4 h-4 text-primary-600 dark:text-primary-400 shrink-0" aria-hidden />
            <span className="text-slate-500 dark:text-slate-400">Positions</span>
            <span className="font-semibold text-slate-900 dark:text-white tabular-nums">{positions.length}</span>
          </button>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 px-3.5 py-2 text-sm min-w-0 max-w-full">
            <UserCircle className="w-4 h-4 text-primary-600 dark:text-primary-400 shrink-0" aria-hidden />
            <span className="text-slate-500 dark:text-slate-400 shrink-0">Head</span>
            <span
              className={`font-semibold truncate ${
                hasManagerAssigned
                  ? 'text-slate-900 dark:text-white'
                  : 'text-slate-500 dark:text-slate-400 italic'
              }`}
              title={selectedManagerName}
            >
              {selectedManagerName}
            </span>
          </div>
        </div>

        {department.headCount > 0 ? (
          <div className="mt-4 max-w-xs">
            <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
              <span>Team size</span>
              <span className="tabular-nums">{Math.round(headPct)}%</span>
            </div>
            <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-500 rounded-full transition-all"
                style={{ width: `${headPct}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* Positions workspace */}
      <div id="department-positions" className="surface-card overflow-hidden scroll-mt-4">
        <div className="p-5 sm:p-6">
          <div className="flex flex-row flex-wrap items-center justify-between gap-2 sm:gap-4 mb-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Job roles</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Positions available for assignment in this unit
              </p>
            </div>
            <Button
              onClick={openCreatePosition}
              className="w-auto shrink-0"
              disabled={!isActiveFlag(department.isActive)}
              title={
                !isActiveFlag(department.isActive)
                  ? 'Reactivate the department before adding positions'
                  : undefined
              }
            >
              <Briefcase className="w-4 h-4 mr-2" aria-hidden />
              Add position
            </Button>
          </div>

          {positions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 py-14 px-6 text-center">
              <Briefcase className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-3" aria-hidden />
              <p className="text-slate-600 dark:text-slate-400 font-medium">No positions yet</p>
              <p className="text-sm text-slate-500 dark:text-slate-500 mt-1 mb-4">
                Create roles employees can be assigned to during onboarding.
              </p>
              <Button variant="outline" onClick={openCreatePosition}>
                Create first position
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {positions.map((pos) => {
                const posActive = isActiveFlag(pos.isActive);
                return (
                <article
                  key={pos.id}
                  className={cn(
                    'group relative rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 p-5 hover:border-primary-200 dark:hover:border-primary-800 hover:shadow-sm transition-all',
                    !posActive && 'opacity-80'
                  )}
                >
                  <div className="absolute top-3 right-3 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => openEditPosition(pos)}
                      className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400"
                      aria-label={`Edit ${resolvePositionTitle(pos, language)}`}
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    {posActive ? (
                      <button
                        type="button"
                        onClick={() => setDeactivatingId(pos.id)}
                        className="p-2 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/30 text-amber-700 dark:text-amber-300"
                        aria-label={`Deactivate ${resolvePositionTitle(pos, language)}`}
                        title="Deactivate — hide from new assignments"
                      >
                        <Ban className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleReactivatePosition(pos.id)}
                        disabled={reactivatingId === pos.id}
                        className="p-2 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-emerald-600 disabled:opacity-50"
                        aria-label={`Reactivate ${resolvePositionTitle(pos, language)}`}
                        title={
                          isActiveFlag(department.isActive)
                            ? 'Reactivate position'
                            : 'Reactivate position (department is still inactive for Onboarding)'
                        }
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDeletingPositionId(pos.id)}
                      disabled={(pos.assignedStaff ?? 0) > 0}
                      className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 disabled:opacity-40 disabled:pointer-events-none"
                      aria-label={`Delete ${resolvePositionTitle(pos, language)}`}
                      title={
                        (pos.assignedStaff ?? 0) > 0
                          ? `Cannot delete — ${pos.assignedStaff} employee(s) still assigned. Use Deactivate instead.`
                          : 'Delete permanently (only if no staff assigned)'
                      }
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="w-10 h-10 rounded-lg bg-primary-50 dark:bg-primary-950/40 text-primary-600 dark:text-primary-400 flex items-center justify-center mb-3">
                    <Briefcase className="w-5 h-5" aria-hidden />
                  </div>
                  <h3
                    className={cn(
                      'text-base font-semibold text-slate-900 dark:text-white pr-14',
                      localizedLabelUsesKhmerFont(pos.title, pos.titleKh, language) && 'font-khmer'
                    )}
                  >
                    {resolvePositionTitle(pos, language)}
                  </h3>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    <Badge variant={posActive ? 'success' : 'neutral'}>
                      {posActive ? 'Active' : 'Inactive'}
                    </Badge>
                    {pos.level ? <Badge variant="info">{positionLevelLabel(pos.level)}</Badge> : null}
                    {pos.accessRole ? (
                      <Badge variant="neutral">{positionAccessRoleLabel(pos.accessRole)}</Badge>
                    ) : null}
                  </div>
                  <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400">
                    <DollarSign className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                    <span>{formatPositionSalaryRange(pos)}</span>
                  </p>
                </article>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <DepartmentSettingsModal
        isOpen={showSettingsModal}
        department={department}
        departments={allDepartments}
        users={users}
        onClose={() => setShowSettingsModal(false)}
        onSaved={handleSettingsSaved}
        onDeleted={handleSettingsDeleted}
      />

      {showPositionModal && (
        <Modal
          isOpen
          size="lg"
          title={editingPosition ? 'Edit Position' : 'Create Position'}
          description="Define the job title, level, salary range, and default portal access role."
          onClose={() => {
            setShowPositionModal(false);
            setEditingPosition(null);
          }}
        >
          <form onSubmit={handleSavePosition} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold mb-2">Position</label>
              <input
                required
                value={editingPosition ? editingPosition.title : newPosition.title}
                onChange={(e) =>
                  editingPosition
                    ? setEditingPosition({ ...editingPosition, title: e.target.value })
                    : setNewPosition({ ...newPosition, title: e.target.value })
                }
                placeholder="e.g. Software Engineer"
                className={inputClass}
              />
            </div>
            <WizardKhmerSubsection
              titleKey="departments.khmer.sectionTitle"
              descriptionKey="departments.khmer.sectionDescription"
            >
              <div>
                <label className="block text-sm font-semibold mb-2" htmlFor="pos-title-kh">
                  {t('departments.khmer.positionTitle')}
                  <span className="text-red-500 ml-0.5">*</span>
                </label>
                <input
                  id="pos-title-kh"
                  required
                  value={editingPosition ? editingPosition.titleKh ?? '' : newPosition.titleKh}
                  onChange={(e) =>
                    editingPosition
                      ? setEditingPosition({ ...editingPosition, titleKh: e.target.value })
                      : setNewPosition({ ...newPosition, titleKh: e.target.value })
                  }
                  placeholder="ឧ. វិស្វករកម្មវិធី"
                  className={inputClass}
                />
              </div>
            </WizardKhmerSubsection>
            <div>
              <label className="block text-sm font-semibold mb-2">Level</label>
              <select
                required
                value={editingPosition ? editingPosition.level ?? '' : newPosition.level}
                onChange={(e) =>
                  editingPosition
                    ? setEditingPosition({ ...editingPosition, level: e.target.value })
                    : setNewPosition({ ...newPosition, level: e.target.value })
                }
                className={inputClass}
              >
                <option value="" disabled hidden>Select level</option>
                {positionLevelOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-2">Role</label>
              <select
                required
                value={editingPosition ? editingPosition.accessRole : newPosition.accessRole}
                onChange={(e) =>
                  editingPosition
                    ? setEditingPosition({
                        ...editingPosition,
                        accessRole: e.target.value as Role,
                      })
                    : setNewPosition({
                        ...newPosition,
                        accessRole: e.target.value as Role,
                      })
                }
                className={inputClass}
              >
                {POSITION_ACCESS_ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1">
                Default portal access when employees are assigned this position.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold mb-2">Minimum salary (USD)</label>
                <input
                  type="number"
                  required
                  min={0}
                  step="1"
                  value={
                    editingPosition
                      ? editingPosition.salaryMin ?? ''
                      : newPosition.salaryMin
                  }
                  onChange={(e) =>
                    editingPosition
                      ? setEditingPosition({
                          ...editingPosition,
                          salaryMin: e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      : setNewPosition({ ...newPosition, salaryMin: e.target.value })
                  }
                  placeholder="e.g. 400"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">Maximum salary (USD)</label>
                <input
                  type="number"
                  required
                  min={0}
                  step="1"
                  value={
                    editingPosition
                      ? editingPosition.salaryMax ?? ''
                      : newPosition.salaryMax
                  }
                  onChange={(e) =>
                    editingPosition
                      ? setEditingPosition({
                          ...editingPosition,
                          salaryMax: e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      : setNewPosition({ ...newPosition, salaryMax: e.target.value })
                  }
                  placeholder="e.g. 600"
                  className={inputClass}
                />
              </div>
            </div>
            <p className="text-xs text-slate-500 -mt-2">
              Onboarding base salary must fall within this range for employees assigned to this position.
            </p>
            <div className="hcms-modal-actions hcms-modal-actions--end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowPositionModal(false)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={savingPosition}>
                {editingPosition ? 'Update Position' : 'Create Position'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmDialog
        open={!!deactivatingId}
        onClose={() => setDeactivatingId(null)}
        title="Deactivate Position?"
        description="The position becomes Inactive and is hidden from Onboarding and movement dropdowns. Existing employees stay assigned for history. You can reactivate later."
        variant="danger"
        confirmLabel="Deactivate"
        loading={isDeleting}
        onConfirm={handleDeactivatePosition}
      />

      <ConfirmDialog
        open={!!deletingPositionId}
        onClose={() => setDeletingPositionId(null)}
        title="Delete Position?"
        description="Permanently removes this position. Only allowed when no employees are assigned. Prefer Deactivate if you need to keep history."
        variant="danger"
        confirmLabel="Delete permanently"
        loading={isDeleting}
        onConfirm={handleDeletePosition}
      />

      <EmployeeDetailModal
        employeeId={detailEmployeeId}
        onClose={() => setDetailEmployeeId(null)}
        roleLabelFromApi={roleLabelFromApi}
        canEdit={canEditEmployee}
        onEdit={(employeeId) => {
          setDetailEmployeeId(null);
          navigate(`/employees/${employeeId}/edit`);
        }}
      />

      <Modal
        isOpen={showEmployeesModal}
        onClose={() => setShowEmployeesModal(false)}
        title={`Employees — ${resolveDepartmentDisplayName(department, language)}`}
        description={
          department.headCount > 0
            ? `${department.headCount} active member${department.headCount === 1 ? '' : 's'}`
            : 'No employees in this department'
        }
        size="md"
      >
        {loadingEmployees ? (
          <ContentSkeleton layout="list" rows={4} label="Loading employees…" />
        ) : departmentEmployees.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
            No employees are assigned to this department.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[min(60vh,28rem)] overflow-y-auto -mx-1 px-1">
            {departmentEmployees.map((emp) => (
              <li key={emp.employee_id}>
                <button
                  type="button"
                  onClick={() => {
                    setShowEmployeesModal(false);
                    setDetailEmployeeId(emp.employee_id);
                  }}
                  className="w-full text-left px-2 py-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                  aria-label={`View profile — ${emp.full_name || emp.employee_id}`}
                >
                  <EmployeeListIdentityBlock
                    data={employeeListIdentityFromEmployeeRow(emp)}
                    showPhone={false}
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </PageShell>
  );
};
