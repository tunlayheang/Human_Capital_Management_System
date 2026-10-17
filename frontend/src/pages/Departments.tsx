import React, { useCallback, useMemo, useState } from 'react';
import {
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../hooks/useWorkspaceTabCache';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { ExportFormatMenu } from '../components/ui/ExportFormatMenu';
import { Modal } from '../components/ui/Modal';
import {
  DepartmentUnitForm,
  EMPTY_DEPARTMENT_UNIT_FORM,
  buildDepartmentPayload,
  type DepartmentUnitFormValues,
} from '../components/departments/DepartmentUnitForm';
import { DepartmentSettingsModal } from '../components/departments/DepartmentSettingsModal';
import { Api } from '../services/api';
import { Department, User } from '../types';
import {
  isDepartmentManagerAssigned,
  NO_MANAGER_ASSIGNED_LABEL,
  resolveDepartmentManagerName,
} from '../utils/departmentDisplay';
import { useToast } from '../context/ToastContext';
import { useLanguage } from '../context/LanguageContext';
import {
  localizedLabelUsesKhmerFont,
  resolveDepartmentDisplayName,
} from '../utils/localizedEntityLabel';
import { cn } from '../utils';
import { Building2, Plus, Settings, Users } from 'lucide-react';
import { PageShell, ListSearchFilterBar, ContentSkeleton } from '../components/ui/page';
import { FilterMenuSelect, PageFilterMenu } from '../components/ui/PageFilterMenu';
import { countActiveFilters } from '../utils/filterActiveCount';
import type { ExportFileExt } from '../utils/export/exportDocumentStandard';
import { exportListTable } from '../utils/export/exportListTable';

const DEPARTMENTS_CACHE_SLOT = 'departments-list-v1';

type DepartmentsTabCache = {
  departments: Department[];
  searchTerm: string;
  managerFilter: string;
};

export const Departments: React.FC = () => {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [managerFilter, setManagerFilter] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [settingsDepartment, setSettingsDepartment] = useState<Department | null>(null);
  const [createForm, setCreateForm] = useState<DepartmentUnitFormValues>(EMPTY_DEPARTMENT_UNIT_FORM);

  const filterActiveCount = useMemo(
    () => countActiveFilters([{ value: managerFilter, defaultValue: '' }]),
    [managerFilter]
  );

  const tabCache = useWorkspaceTabCache<DepartmentsTabCache>({
    slot: DEPARTMENTS_CACHE_SLOT,
    cacheKey: 'list',
    getSnapshot: () => ({ departments, searchTerm, managerFilter }),
    applySnapshot: (cached) => {
      setDepartments(cached.departments);
      setSearchTerm(cached.searchTerm);
      setManagerFilter(cached.managerFilter ?? '');
      setListLoading(false);
    },
    shouldPersist: (cached) => cached.departments.length > 0,
    persistDeps: [departments, searchTerm, managerFilter],
  });

  const loadDepartments = useCallback(async (options?: { silent?: boolean; background?: boolean }) => {
    if (!options?.silent && !options?.background) setListLoading(true);
    try {
      const deptData = await Api.departments.getAll();
      setDepartments(Array.isArray(deptData) ? deptData : []);
    } catch (e) {
      console.error(e);
      showToast('Failed to load departments', 'error');
    } finally {
      if (!options?.silent && !options?.background) setListLoading(false);
    }
  }, [showToast]);

  const mountLoadDepartments = useCallback(
    (opts?: WorkspaceLoadOptions) => loadDepartments({ background: opts?.background }),
    [loadDepartments]
  );

  useWorkspaceTabMountLoad(mountLoadDepartments, [mountLoadDepartments], tabCache);

  const ensureUsersLoaded = useCallback(async () => {
    if (users.length > 0 || usersLoading) return;
    setUsersLoading(true);
    try {
      const userData = await Api.users.getAll();
      setUsers(Array.isArray(userData) ? userData : []);
    } catch (e) {
      console.error(e);
      showToast('Failed to load manager accounts', 'error');
    } finally {
      setUsersLoading(false);
    }
  }, [users.length, usersLoading, showToast]);

  const openCreate = () => {
    void ensureUsersLoaded();
    setCreateForm(EMPTY_DEPARTMENT_UNIT_FORM);
    setShowCreate(true);
  };

  const openSettings = (dept: Department) => {
    void ensureUsersLoaded();
    setSettingsDepartment(dept);
  };

  const handleSettingsSaved = (updated: Department) => {
    setDepartments((prev) => prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)));
    setSettingsDepartment(null);
  };

  const handleSettingsDeleted = (id: string, updated?: Department) => {
    if (updated) {
      // Deactivate / reactivate — keep card, refresh status
      setDepartments((prev) => prev.map((d) => (d.id === id ? { ...d, ...updated } : d)));
    } else {
      // Permanent delete — remove from list
      setDepartments((prev) => prev.filter((d) => d.id !== id));
    }
    setSettingsDepartment(null);
  };

  const filteredDepartments = departments.filter((dept) => {
    const hasManager = isDepartmentManagerAssigned(dept, users);
    if (managerFilter === 'with' && !hasManager) return false;
    if (managerFilter === 'without' && hasManager) return false;
    const q = searchTerm.toLowerCase();
    if (!q) return true;
    const managerLabel = resolveDepartmentManagerName(dept, users).toLowerCase();
    return (
      dept.name.toLowerCase().includes(q) ||
      (dept.nameKh?.toLowerCase().includes(q) ?? false) ||
      (hasManager && managerLabel.includes(q))
    );
  });

  const validateForm = (values: DepartmentUnitFormValues): string | null => {
    if (!values.name.trim()) return 'Department name is required';
    if (!values.nameKh.trim()) return 'Department name (Khmer) is required';
    return null;
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const error = validateForm(createForm);
    if (error) {
      showToast(error, 'error');
      return;
    }
    setLoading(true);
    try {
      await Api.departments.create(buildDepartmentPayload(createForm));
      setShowCreate(false);
      setCreateForm(EMPTY_DEPARTMENT_UNIT_FORM);
      await loadDepartments({ silent: true });
      showToast('Department created', 'success');
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : 'Failed to create department', 'error');
    } finally {
      setLoading(false);
    }
  };

  const managerInitial = (name?: string, assigned?: boolean) => {
    if (!assigned) return '?';
    return (name?.trim()?.[0] || '?').toUpperCase();
  };

  const modalFooter = (onCancel: () => void, submitLabel: string) => (
    <div className="hcms-modal-actions hcms-modal-actions--between mt-2">
      <button
        type="button"
        onClick={onCancel}
        className="text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
      >
        Discard changes
      </button>
      <Button type="submit" isLoading={loading}>
        {submitLabel}
      </Button>
    </div>
  );

  const handleExport = useCallback(
    async (format: ExportFileExt) => {
      await exportListTable(format, {
        module: 'Departments',
        reportTitle: 'Departments',
        sheetName: 'Departments',
        rows: filteredDepartments,
        metadata: [
          { label: 'Rows', value: filteredDepartments.length },
          { label: 'Search', value: searchTerm || 'All departments' },
          {
            label: 'Manager filter',
            value:
              managerFilter === 'with' ? 'Has manager' : managerFilter === 'without' ? 'No manager' : 'All departments',
          },
        ],
        columns: [
          { header: 'ID', value: (dept) => dept.id, width: 16 },
          { header: 'Code', value: (dept) => dept.code ?? '', width: 14 },
          { header: 'Name', value: (dept) => dept.name, width: 24 },
          { header: 'Name (KH)', value: (dept) => dept.nameKh ?? '', width: 24 },
          { header: 'Manager Name', value: (dept) => resolveDepartmentManagerName(dept, users), width: 24 },
          { header: 'Manager Assigned', value: (dept) => (isDepartmentManagerAssigned(dept, users) ? 'Yes' : 'No'), width: 16 },
          { header: 'Head Count', value: (dept) => dept.headCount ?? 0, width: 14 },
          { header: 'Status', value: (dept) => (dept.isActive === false ? 'Inactive' : 'Active'), width: 12 },
        ],
      });
    },
    [filteredDepartments, managerFilter, searchTerm, users]
  );

  return (
    <PageShell>
      <ListSearchFilterBar
            searchValue={searchTerm}
            onSearchChange={setSearchTerm}
            searchPlaceholder="Search departments..."
            leading={
              <ExportFormatMenu
                formats={['csv', 'xlsx']}
                disabled={listLoading || filteredDepartments.length === 0}
                onExport={handleExport}
              />
            }
            filter={
              <PageFilterMenu
                activeCount={filterActiveCount}
                onClear={() => setManagerFilter('')}
              >
                <FilterMenuSelect
                  label="Manager"
                  value={managerFilter}
                  onChange={setManagerFilter}
                  options={[
                    { value: '', label: 'All departments' },
                    { value: 'with', label: 'Has manager' },
                    { value: 'without', label: 'No manager' },
                  ]}
                />
              </PageFilterMenu>
            }
            trailing={
              <Button onClick={openCreate} className="w-auto shrink-0">
                <Plus className="w-4 h-4 mr-2" /> Add New Department
              </Button>
            }
          />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {listLoading && <ContentSkeleton layout="cards" rows={3} className="col-span-full" />}
        {!listLoading &&
        filteredDepartments.map((dept) => {
          const hasManager = isDepartmentManagerAssigned(dept, users);
          const managerName = resolveDepartmentManagerName(dept, users);
          const detailPath = `/departments/${dept.id}`;
          const openDetail = () => navigate(detailPath);
          return (
          <article
            key={dept.id}
            role="link"
            tabIndex={0}
            aria-label={`View positions — ${resolveDepartmentDisplayName(dept, language)}`}
            onClick={openDetail}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openDetail();
              }
            }}
            className={`group relative surface-card shadow-sm hover:shadow-2xl hover:-translate-y-2 transition-all duration-300 overflow-hidden flex flex-col cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${
              dept.isActive === false ? 'opacity-80' : ''
            }`}
          >
            <div className="h-1 bg-gradient-to-r from-primary-500 to-indigo-500 scale-x-0 group-hover:scale-x-100 transition-transform duration-700 origin-left" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openSettings(dept);
              }}
              className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-500 hover:text-primary-600 hover:border-primary-300 dark:hover:border-primary-700 shadow-sm opacity-100 transition-all"
              aria-label={`Settings — ${resolveDepartmentDisplayName(dept, language)}`}
              title="Department settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <div className="p-6 flex-1 flex flex-col">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-14 h-14 rounded-2xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center text-primary-600 group-hover:scale-110 transition-transform">
                  <Building2 className="w-7 h-7" />
                </div>
                <div className="min-w-0 pr-8">
                  <h3
                    className={cn(
                      'text-2xl font-black group-hover:text-primary-600 truncate',
                      localizedLabelUsesKhmerFont(dept.name, dept.nameKh, language) && 'font-khmer'
                    )}
                  >
                    {resolveDepartmentDisplayName(dept, language)}
                  </h3>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-primary-50 text-primary-700 inline-flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" /> {dept.headCount} Members
                    </span>
                    <span
                      className={`text-xs font-bold px-2.5 py-1 rounded-lg inline-flex items-center ${
                        dept.isActive === false
                          ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                          : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                      }`}
                    >
                      {dept.isActive === false ? 'Inactive' : 'Active'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border bg-slate-50 dark:bg-slate-900/40 p-3 mb-4 flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-full text-white flex items-center justify-center font-bold ${
                    hasManager ? 'bg-primary-600' : 'bg-slate-400 dark:bg-slate-600'
                  }`}
                >
                  {managerInitial(managerName, hasManager)}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase text-slate-500">Department Head</p>
                  <p
                    className={`text-sm font-semibold truncate ${
                      hasManager
                        ? 'text-slate-900 dark:text-white'
                        : 'text-slate-500 dark:text-slate-400 italic'
                    }`}
                    title={managerName}
                  >
                    {hasManager ? managerName : NO_MANAGER_ASSIGNED_LABEL}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full mt-auto pointer-events-none"
                tabIndex={-1}
                aria-hidden
              >
                {t('departments.viewPositions')}
              </Button>
            </div>
          </article>
          );
        })}
      </div>

      <DepartmentSettingsModal
        isOpen={settingsDepartment != null}
        department={settingsDepartment}
        departments={departments}
        users={users}
        onClose={() => setSettingsDepartment(null)}
        onSaved={handleSettingsSaved}
        onDeleted={handleSettingsDeleted}
      />

      {showCreate && (
        <Modal
          isOpen
          size="lg"
          title="Initialize Business Unit"
          description="Set up a new department with leadership and organizational context."
          onClose={() => setShowCreate(false)}
        >
          <form onSubmit={handleCreate}>
            <DepartmentUnitForm
              key="create-department"
              values={createForm}
              onChange={setCreateForm}
              departments={departments}
              users={users}
            />
            {modalFooter(() => setShowCreate(false), 'Create department')}
          </form>
        </Modal>
      )}

    </PageShell>
  );
};
