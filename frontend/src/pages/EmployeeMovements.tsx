import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../hooks/useWorkspaceTabCache';
import { useNavigate } from 'react-router-dom';
import { ArrowRightLeft, Plus } from 'lucide-react';
import { Api } from '../services/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { PERM } from '../constants/permissionKeys';
import { Button } from '../components/ui/Button';
import { ExportFormatMenu } from '../components/ui/ExportFormatMenu';
import { PageLoading, ListSearchFilterBar } from '../components/ui/page';
import { FieldLabel } from '../components/employee-wizard/FieldLabel';
import { selectClass } from '../constants/designSystem';
import { Department } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { resolveDepartmentDisplayName } from '../utils/localizedEntityLabel';
import {
  FilterMenuDateRange,
  FilterMenuSelect,
  PageFilterMenu,
} from '../components/ui/PageFilterMenu';
import type { EmployeeMovementRow } from '../types/employeeMovement';
import {
  MovementListCard,
  movementTypeLabel,
} from '../components/employee/employeeMovementDisplay';
import { navigateToMovementView } from '../employeeMovement/movementNavigation';
import { EmployeeSensitiveChangesPanel } from '../components/employee/EmployeeSensitiveChangesPanel';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import type { ExportFileExt } from '../utils/export/exportDocumentStandard';
import { exportListTable } from '../utils/export/exportListTable';
import { countActiveFilters } from '../utils/filterActiveCount';
import {
  EMPTY_MOVEMENT_LIST_FILTERS,
  MOVEMENT_ORIGIN_FILTER_OPTIONS,
  MOVEMENT_STATUS_FILTER_OPTIONS,
  buildMovementTypeFilterOptions,
  collectMovementDepartmentOptions,
  hasMovementListConstraints,
  matchesMovementClientFilters,
  matchesMovementSearch,
  movementOriginFilterLabel,
  movementStatusFilterLabel,
  type MovementListFilterState,
} from '../employeeMovement/movementListFilters';
import { canActorResubmitReturnedMovement } from '../utils/movementResubmitAccess';

export type { EmployeeMovementRow };

type Props = {
  /** When set, list movements involving this department only. */
  departmentId?: string;
  embedded?: boolean;
};

export const EmployeeMovements: React.FC<Props> = ({ departmentId, embedded = false }) => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { confirm, ConfirmDialogHost } = useConfirmDialog();
  const { hasPermission, user } = useAuth();
  const { language } = useLanguage();
  const canReviewSensitiveChanges = ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(
    String(user?.role ?? '').toUpperCase()
  );
  const canCreate =
    hasPermission(PERM.EMPLOYEE_EDIT_WORK) ||
    hasPermission(PERM.EMPLOYEE_EDIT_FINANCIAL) ||
    hasPermission(PERM.EMPLOYEE_CREATE);

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<EmployeeMovementRow[]>([]);
  const [catalogRows, setCatalogRows] = useState<EmployeeMovementRow[]>([]);
  const [filters, setFilters] = useState<MovementListFilterState>(EMPTY_MOVEMENT_LIST_FILTERS);
  const [search, setSearch] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);

  useEffect(() => {
    void Api.departments
      .getAll()
      .then((data) => setDepartments(Array.isArray(data) ? data : []))
      .catch(() => setDepartments([]));
  }, []);

  const cacheKey = [
    departmentId ?? 'all',
    filters.movementType,
    filters.status,
    filters.department,
    filters.origin,
    filters.effectiveFrom,
    filters.effectiveTo,
  ].join('|');

  const tabCache = useWorkspaceTabCache<{
    rows: EmployeeMovementRow[];
    filters: MovementListFilterState;
    search: string;
  }>({
    slot: 'employees-movements-v4',
    cacheKey,
    getSnapshot: () => ({ rows, filters, search }),
    applySnapshot: (cached) => {
      setRows(cached.rows);
      setFilters(cached.filters);
      setSearch(cached.search);
      setLoading(false);
    },
    shouldPersist: (cached) => cached.rows.length > 0,
    persistDeps: [rows, filters, search],
  });

  const loadCatalog = useCallback(async () => {
    try {
      const data = await Api.employeeMovements.list({
        department_id: departmentId,
        limit: 500,
      });
      setCatalogRows(Array.isArray(data) ? (data as EmployeeMovementRow[]) : []);
    } catch {
      setCatalogRows([]);
    }
  }, [departmentId]);

  const load = useCallback(
    async (opts?: WorkspaceLoadOptions) => {
      try {
        if (!opts?.background) setLoading(true);
        const [data] = await Promise.all([
          Api.employeeMovements.list({
            department_id: departmentId,
            type: filters.movementType || undefined,
            status: filters.status || undefined,
            limit: 200,
          }),
          loadCatalog(),
        ]);
        setRows(Array.isArray(data) ? (data as EmployeeMovementRow[]) : []);
      } catch (e) {
        if (!opts?.background) {
          showToast(e instanceof Error ? e.message : 'Failed to load movements', 'error');
          setRows([]);
        }
      } finally {
        if (!opts?.background) setLoading(false);
      }
    },
    [departmentId, filters.movementType, filters.status, showToast, loadCatalog]
  );

  useWorkspaceTabMountLoad(load, [load], tabCache);

  const typeFilterOptions = useMemo(
    () => buildMovementTypeFilterOptions(catalogRows, filters.movementType),
    [catalogRows, filters.movementType]
  );

  const departmentFilterOptions = useMemo(() => {
    const names = new Set<string>();
    for (const department of departments) {
      const label = resolveDepartmentDisplayName(department, language);
      if (label) names.add(label);
    }
    for (const name of collectMovementDepartmentOptions(catalogRows)) {
      names.add(name);
    }
    if (filters.department) names.add(filters.department);
    return [
      { value: '', label: 'All departments' },
      ...[...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ value: name, label: name })),
    ];
  }, [catalogRows, departments, filters.department, language]);

  const filterActiveCount = countActiveFilters([
    { value: filters.movementType },
    { value: filters.status },
    ...(departmentId ? [] : [{ value: filters.department }]),
    { value: filters.origin },
    { value: filters.effectiveFrom },
    { value: filters.effectiveTo },
  ]);

  const filtered = useMemo(() => {
    return rows
      .filter((row) => matchesMovementClientFilters(row, filters))
      .filter((row) => matchesMovementSearch(row, search));
  }, [rows, filters, search]);

  const hasActiveConstraints = hasMovementListConstraints(search, filters);

  const handleCancel = async (id: string) => {
    const ok = await confirm({
      title: 'Cancel movement?',
      description: 'Cancel this scheduled movement?',
      variant: 'danger',
      confirmLabel: 'Cancel movement',
    });
    if (!ok) return;
    try {
      await Api.employeeMovements.cancel(id);
      showToast('Movement cancelled', 'success');
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not cancel', 'error');
    }
  };

  const handleExport = useCallback(
    async (format: ExportFileExt) => {
      await exportListTable(format, {
        module: 'Employee_Movements',
        reportTitle: 'Employee Movements',
        sheetName: 'Movements',
        rows: filtered,
        metadata: [
          { label: 'Rows', value: filtered.length },
          { label: 'Search', value: search || 'All movements' },
          { label: 'Type', value: filters.movementType ? movementTypeLabel(filters.movementType) : 'All types' },
          { label: 'Status', value: movementStatusFilterLabel(filters.status) },
          { label: 'Department', value: filters.department || 'All departments' },
          { label: 'Source', value: movementOriginFilterLabel(filters.origin) },
          { label: 'Effective from', value: filters.effectiveFrom || 'Any' },
          { label: 'Effective to', value: filters.effectiveTo || 'Any' },
        ],
        columns: [
          { header: 'ID', value: (row) => row.id, width: 16 },
          { header: 'Employee ID', value: (row) => row.employeeId ?? '', width: 14 },
          { header: 'Employee Name', value: (row) => row.employeeName ?? '', width: 24 },
          { header: 'Employee Email', value: (row) => row.employeeEmail ?? '', width: 28 },
          { header: 'Type', value: (row) => movementTypeLabel(row.movementType), width: 18 },
          { header: 'Effective Date', value: (row) => row.effectiveDate ?? '', width: 14 },
          { header: 'From Department', value: (row) => row.fromDepartmentName ?? '', width: 20 },
          { header: 'To Department', value: (row) => row.toDepartmentName ?? '', width: 20 },
          { header: 'From Position', value: (row) => row.fromPositionTitle ?? '', width: 20 },
          { header: 'To Position', value: (row) => row.toPositionTitle ?? '', width: 20 },
          { header: 'From Base Salary', value: (row) => row.fromBaseSalary ?? '', width: 16 },
          { header: 'To Base Salary', value: (row) => row.toBaseSalary ?? '', width: 16 },
          { header: 'Status', value: (row) => row.canonicalStatus ?? row.status ?? '', width: 16 },
          { header: 'Created By', value: (row) => row.createdByName ?? '', width: 20 },
          { header: 'Created At', value: (row) => row.createdAt ?? '', width: 18 },
        ],
      });
    },
    [filtered, filters, search]
  );

  const emptyMessage = hasActiveConstraints
    ? 'No movements match your search or filters.'
    : 'No movements recorded yet.';

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-6'}>
      <ConfirmDialogHost />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {!embedded && (
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-primary-600" />
              Employee movements
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Record transfers, promotions, and pay changes. Approvals are handled in Approvals.
            </p>
          </div>
        )}
        {embedded && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Transfers, promotions, and pay changes linked to this department.
          </p>
        )}
        {canCreate && (
          <Button
            onClick={() =>
              navigate(
                departmentId
                  ? `/employees/movements/wizard?departmentId=${encodeURIComponent(departmentId)}`
                  : '/employees/movements/wizard'
              )
            }
            className="shrink-0"
          >
            <Plus className="w-4 h-4 mr-2" />
            New movement
          </Button>
        )}
      </div>

      {canReviewSensitiveChanges && <EmployeeSensitiveChangesPanel />}

      <div className="surface-card p-4 sm:p-5 space-y-3">
        {!departmentId ? (
          <div className="max-w-xs sm:max-w-sm">
            <FieldLabel>Department</FieldLabel>
            <select
              value={filters.department}
              onChange={(e) => setFilters((prev) => ({ ...prev, department: e.target.value }))}
              className={`${selectClass} w-full`}
              aria-label="Select department"
            >
              {departmentFilterOptions.map((opt) => (
                <option key={opt.value || '__all'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <ListSearchFilterBar
          leading={
            <ExportFormatMenu
              formats={['csv', 'xlsx']}
              disabled={loading || filtered.length === 0}
              onExport={handleExport}
            />
          }
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search name, email, employee ID, department..."
          filter={
            <PageFilterMenu
              title="Filters"
              activeCount={filterActiveCount}
              onClear={() => setFilters(EMPTY_MOVEMENT_LIST_FILTERS)}
            >
              <FilterMenuSelect
                label="Type"
                value={filters.movementType}
                onChange={(movementType) =>
                  setFilters((prev) => ({
                    ...prev,
                    movementType: movementType as MovementListFilterState['movementType'],
                  }))
                }
                options={typeFilterOptions}
              />
              <FilterMenuSelect
                label="Status"
                value={filters.status}
                onChange={(status) =>
                  setFilters((prev) => ({
                    ...prev,
                    status: status as MovementListFilterState['status'],
                  }))
                }
                options={MOVEMENT_STATUS_FILTER_OPTIONS}
              />
              <FilterMenuSelect
                label="Source"
                value={filters.origin}
                onChange={(origin) =>
                  setFilters((prev) => ({
                    ...prev,
                    origin: origin as MovementListFilterState['origin'],
                  }))
                }
                options={MOVEMENT_ORIGIN_FILTER_OPTIONS}
              />
              <FilterMenuDateRange
                from={filters.effectiveFrom}
                to={filters.effectiveTo}
                onChange={({ from, to }) =>
                  setFilters((prev) => ({ ...prev, effectiveFrom: from, effectiveTo: to }))
                }
                fromLabel="Effective from"
                toLabel="Effective to"
                hint="Filter by movement effective date."
              />
            </PageFilterMenu>
          }
        />
      </div>

      {loading ? (
        <PageLoading layout="list" />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 py-12 text-center text-sm text-slate-500">
          {emptyMessage}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((r) => {
            const canResubmitReturned = canCreate && canActorResubmitReturnedMovement(r, user);
            const canCancelScheduled =
              (r.status === 'scheduled' || r.canonicalStatus === 'approved') && canCreate;

            return (
              <MovementListCard
                key={r.id}
                row={r}
                onOpenDetail={() => navigateToMovementView(navigate, r)}
                actions={
                  canResubmitReturned || canCancelScheduled ? (
                    <div className="flex flex-wrap items-center gap-3 justify-end">
                      {canResubmitReturned ? (
                        <button
                          type="button"
                          onClick={() => navigateToMovementView(navigate, r, 1)}
                          className="font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
                        >
                          Edit & resubmit
                        </button>
                      ) : null}
                      {canCancelScheduled ? (
                        <button
                          type="button"
                          onClick={() => void handleCancel(r.id)}
                          className="font-medium text-red-600 hover:text-red-700 dark:text-red-400"
                        >
                          Cancel
                        </button>
                      ) : null}
                    </div>
                  ) : undefined
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
