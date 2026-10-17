import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  createWorkspaceShellCache,
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../hooks/useWorkspaceTabCache';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Edit,
  Users,
  UserCheck,
  UserCog,
  UserPen,
  FileText,
  CreditCard,
  UserMinus,
  ChevronDown,
  ChevronRight,
  ArrowRightLeft,
  Trash2,
  Upload,
} from 'lucide-react';
import { ResponsiveRowActions } from '../components/ui/ResponsiveRowActions';
import { ExportFormatMenu } from '../components/ui/ExportFormatMenu';
import { Api } from '../services/api';
import {
  EmployeeListIdentityBlock,
  EmployeeListIdentityCells,
  employeeListIdentityFromEmployeeRow,
} from '../components/employee/EmployeeListIdentity';
import { EmployeeDetailModal } from '../components/employee/EmployeeDetailModal';
import { EmployeeCardModal } from '../components/employee/EmployeeCardModal';
import { EmployeeImportModal } from '../components/employee/EmployeeImportModal';
import { EMPLOYEE_LIST_TABULAR_COLUMNS } from '../utils/importEmployees';
import { listToolbarIconPillClass } from '../constants/designSystem';
import { StatCard, ListToolbarIconButton, listToolbarGlyphClass } from '../components/ui/page';
import { PageLoading, ListSearchFilterBar } from '../components/ui/page';
import {
  FilterMenuDateRange,
  FilterMenuSelect,
  PageFilterMenu,
} from '../components/ui/PageFilterMenu';
import { countActiveFilters } from '../utils/filterActiveCount';
import { EMPTY_DATE_RANGE, countDateRangeFilters } from '../utils/dateRangeFilter';
import { ListPagination } from '../components/ui/ListPagination';
import { DEFAULT_LIST_PAGE_SIZE, visiblePages } from '../utils/visiblePages';
import { EmployeeMovementHistoryTable } from '../components/employee/EmployeeMovementHistoryTable';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';
import { useConfirmDialog, asPromptReason } from '../hooks/useConfirmDialog';
import { PERM } from '../constants/permissionKeys';
import { formatEmployeeAge } from '../utils/employeeAge';
import { formatDateOnlyDisplay } from '../utils/formatDisplayDate';
import { isRestorableEmployeeStatus } from '../utils/employeeRestore';
import { isEmployeeDraftStatus } from '../utils/employeePortalStatus';
import { offboardingHubUrl } from '../offboarding/offboardingRoutes';
import { OFFBOARDING_SETTLEMENT_STEP } from '../offboarding/offboardingWizardSteps';
import { StatusLabel } from '../components/ui/StatusLabel';
import { formatStatusCodeLabel } from '../constants/statusPalette';
import { resolveDepartmentRowName, resolveLocalizedLabel } from '../utils/localizedEntityLabel';
import { positionLevelLabel } from '../constants/positionCatalog';
import { usePositionLevels } from '../hooks/usePositionLevels';
import {
  aoaToCsvLines,
  buildTabularMetadataAoa,
  downloadBrandedWorkbookAsXlsx,
  downloadCsvLines,
  exportFilename,
  type ExportFileExt,
} from '../utils/export/exportDocumentStandard';
import { SortIcon, getSortIconState, type SortOrder } from '../utils/listColumnSort';

interface Employee {
  employee_id: string;
  first_name: string;
  last_name: string;
  avatar_url?: string | null;
  email: string;
  phone: string;
  department_id: string;
  position_id: string;
  status: string;
  join_date: string;
  birth_date?: string | null;
  probation_period_months?: number | null;
  termination_reason?: string | null;
  department?: {
    name: string;
    name_kh?: string;
    nameKh?: string;
    officeLocationName?: string;
  };
  officeLocationId?: string | null;
  officeLocationName?: string | null;
  position?: { title: string; title_kh?: string; titleKh?: string; level?: string | null };
  role?: string | null;
  allow_login?: boolean;
  offboarding_in_progress?: boolean;
  offboarding_settlement_status?: string | null;
  placement_pending?: boolean;
  placement_effective_date?: string | null;
  gender?: string | null;
  nationality?: string | null;
  religion?: string | null;
  street_address?: string | null;
  city?: string | null;
  country?: string | null;
  employment_type?: string | null;
  work_days?: number | null;
  time_in?: string | null;
  time_out?: string | null;
  work_hours?: number | null;
  break_duration_minutes?: number | null;
  grace_period_minutes?: number | null;
  base_salary?: number | string | null;
  currency?: string | null;
  payment_method?: string | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_relationship?: string | null;
  emergency_contact_phone?: string | null;
  marital_status?: string | null;
  spouse_name?: string | null;
  spouse_phone?: string | null;
}

interface RoleRow {
  id: string;
  name: string;
  description?: string;
}

interface DepartmentRow {
  id: string;
  name: string;
  nameKh?: string;
  name_kh?: string;
  officeLocationId?: string;
  officeLocationName?: string;
}

export type EmployeeRowPermissionFlags = {
  canEdit: boolean;
  canDelete: boolean;
};

export type SortableEmployeeColumn =
  | 'employee_id'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'department_id'
  | 'join_date'
  | 'status'
  | 'created_at';

const PAGE_LIMIT = DEFAULT_LIST_PAGE_SIZE;
const EMPLOYEE_LIST_CACHE_SLOT = 'employees-list-v3';

const employeeListMetaCache = createWorkspaceShellCache<{
  departments: DepartmentRow[];
  roles: RoleRow[];
}>();

type EmployeeListTabCache = {
  employees: Employee[];
  searchTerm: string;
  debouncedSearch: string;
  selectedRole: string;
  selectedGender: string;
  selectedDepartment: string;
  selectedStatus: string;
  movementFilter: string;
  joinDateRange: typeof EMPTY_DATE_RANGE;
  currentPage: number;
  totalPages: number;
  totalCount: number;
  summaryCounts: {
    total: number;
    active: number;
    draft: number;
    inactive: number;
    probation: number;
  };
  sortBy: SortableEmployeeColumn | null;
  sortOrder: SortOrder;
  movementHistoryIds: string[];
};

function formatJoinShort(raw: string | undefined): string {
  return formatDateOnlyDisplay(raw);
}

/** Shorter date for the desktop table (saves horizontal space). */
function formatJoinCompact(raw: string | undefined): string {
  return formatDateOnlyDisplay(raw);
}

function employeeOffboardingActionUrl(employeeId: string, status: string | undefined): string {
  if (isRestorableEmployeeStatus(status)) {
    return offboardingHubUrl({ employeeId });
  }
  return offboardingHubUrl({
    wizard: true,
    employeeId,
    step: OFFBOARDING_SETTLEMENT_STEP,
  });
}

function shouldIgnoreEmployeeRowToggle(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return true;
  return Boolean(
    el.closest(
      '[data-employee-actions-menu], [data-stop-row-toggle], a, button, input, select, textarea, label'
    )
  );
}

function formatPlacementEffective(raw?: string | null): string {
  if (!raw) return '';
  return formatDateOnlyDisplay(raw, String(raw));
}

function PlacementPendingLabel({ pending, effectiveDate }: { pending?: boolean; effectiveDate?: string | null }) {
  if (!pending) return null;
  const label = effectiveDate ? `Effective ${formatPlacementEffective(effectiveDate)}` : 'Scheduled';
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-amber-50 text-amber-800 dark:bg-amber-950/45 dark:text-amber-200 px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-amber-200/70 dark:ring-amber-800/50">
      {label}
    </span>
  );
}

function MovementHistoryNotice({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      className="inline-flex items-center justify-center shrink-0 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/45 dark:text-amber-200 p-1"
      title="Has movement history — click row to view"
      aria-label="Has movement history"
    >
      <ArrowRightLeft className="w-3 h-3" aria-hidden />
    </span>
  );
}

const DEFAULT_EMPLOYEE_SORT: SortableEmployeeColumn = 'created_at';
const DEFAULT_EMPLOYEE_SORT_ORDER: SortOrder = 'DESC';

export interface EmployeeListProps {
  roleLabelFromApi: (name: string) => string;
  rowPermissions: EmployeeRowPermissionFlags;
}

export const EmployeeList: React.FC<EmployeeListProps> = ({ roleLabelFromApi, rowPermissions }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { hasPermission, user } = useAuth();
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const { prompt, ConfirmDialogHost } = useConfirmDialog();
  usePositionLevels();
  const canCancelMovement =
    hasPermission(PERM.EMPLOYEE_EDIT_WORK) ||
    hasPermission(PERM.EMPLOYEE_EDIT_FINANCIAL) ||
    hasPermission(PERM.EMPLOYEE_CREATE);
  const canImportStaff = hasPermission(PERM.EMPLOYEE_CREATE);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedGender, setSelectedGender] = useState(
    () => searchParams.get('gender')?.trim() || ''
  );
  const [selectedDepartment, setSelectedDepartment] = useState(
    () => searchParams.get('department_id')?.trim() || ''
  );
  const [selectedStatus, setSelectedStatus] = useState(() => {
    const fromUrl = searchParams.get('status')?.trim().toLowerCase() || '';
    if (
      fromUrl === 'active' ||
      fromUrl === 'inactive' ||
      fromUrl === 'draft' ||
      fromUrl === 'probation'
    ) {
      return fromUrl;
    }
    return 'active';
  });
  const [movementFilter, setMovementFilter] = useState('');
  const [joinDateRange, setJoinDateRange] = useState(EMPTY_DATE_RANGE);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  /** Org-wide counts for stat cards (not tied to the active stat filter). */
  const [summaryCounts, setSummaryCounts] = useState({
    total: 0,
    active: 0,
    draft: 0,
    inactive: 0,
    probation: 0,
  });
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [emailToRole, setEmailToRole] = useState<Record<string, string>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [sortBy, setSortBy] = useState<SortableEmployeeColumn | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('ASC');

  const [detailEmployeeId, setDetailEmployeeId] = useState<string | null>(null);
  const [cardModal, setCardModal] = useState<{ employeeId: string; cardId?: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [movementHistoryIds, setMovementHistoryIds] = useState<Set<string>>(() => new Set());

  const toggleMovementHistory = (employeeId: string) => {
    setExpandedHistoryId((prev) => (prev === employeeId ? null : employeeId));
  };

  const handleEmployeeRowActivate = (
    employeeId: string,
    e: React.MouseEvent | React.KeyboardEvent
  ) => {
    if ('key' in e && e.key !== 'Enter' && e.key !== ' ') return;
    if ('key' in e) e.preventDefault();
    if (shouldIgnoreEmployeeRowToggle(e.target)) return;
    toggleMovementHistory(employeeId);
  };

  const handleSearchValueChange = useCallback((value: string) => {
    setSearchTerm(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value.trim());
      setCurrentPage(1);
    }, 300);
  }, []);

  const inProbationOnly = selectedStatus === 'probation';
  const statusForApi =
    selectedStatus && selectedStatus !== 'probation' ? selectedStatus : '';

  const tabCache = useWorkspaceTabCache<EmployeeListTabCache>({
    slot: EMPLOYEE_LIST_CACHE_SLOT,
    getSnapshot: () => ({
      employees,
      searchTerm,
      debouncedSearch,
      selectedRole,
      selectedGender,
      selectedDepartment,
      selectedStatus,
      movementFilter,
      joinDateRange,
      currentPage,
      totalPages,
      totalCount,
      summaryCounts,
      sortBy,
      sortOrder,
      movementHistoryIds: [...movementHistoryIds],
    }),
    applySnapshot: (cached) => {
      setEmployees(cached.employees);
      setSearchTerm(cached.searchTerm);
      setDebouncedSearch(cached.debouncedSearch);
      setSelectedRole(cached.selectedRole);
      setSelectedGender(cached.selectedGender);
      setSelectedDepartment(cached.selectedDepartment);
      setSelectedStatus(cached.selectedStatus);
      setMovementFilter(cached.movementFilter);
      setJoinDateRange(cached.joinDateRange);
      setCurrentPage(cached.currentPage);
      setTotalPages(cached.totalPages);
      setTotalCount(cached.totalCount);
      setSummaryCounts({
        total: cached.summaryCounts?.total ?? 0,
        active: cached.summaryCounts?.active ?? 0,
        draft: cached.summaryCounts?.draft ?? 0,
        inactive: cached.summaryCounts?.inactive ?? 0,
        probation: cached.summaryCounts?.probation ?? 0,
      });
      setSortBy(cached.sortBy);
      setSortOrder(cached.sortOrder);
      setMovementHistoryIds(new Set(cached.movementHistoryIds));
      setLoading(false);
    },
    shouldPersist: (cached) => cached.employees.length > 0,
    persistDeps: [
      employees,
      searchTerm,
      debouncedSearch,
      selectedRole,
      selectedGender,
      selectedDepartment,
      selectedStatus,
      movementFilter,
      joinDateRange,
      currentPage,
      totalPages,
      totalCount,
      summaryCounts,
      sortBy,
      sortOrder,
      movementHistoryIds,
    ],
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [
    selectedRole,
    selectedGender,
    selectedDepartment,
    selectedStatus,
    movementFilter,
    joinDateRange,
    sortBy,
    sortOrder,
  ]);

  // Dashboard "Team Size" deep-link: ?department_id=… or ?filter=myteam; optional ?status=
  useEffect(() => {
    const genderFromUrl = searchParams.get('gender')?.trim();
    const deptFromUrl = searchParams.get('department_id')?.trim();
    const statusFromUrl = searchParams.get('status')?.trim().toLowerCase() || '';
    setSelectedGender(genderFromUrl || '');
    if (
      statusFromUrl === 'active' ||
      statusFromUrl === 'inactive' ||
      statusFromUrl === 'draft' ||
      statusFromUrl === 'probation'
    ) {
      setSelectedStatus(statusFromUrl);
      setCurrentPage(1);
    }
    if (deptFromUrl) {
      setSelectedDepartment(deptFromUrl);
      return;
    }
    if (searchParams.get('filter') !== 'myteam') return;
    let cancelled = false;
    void Api.dashboard
      .getTeamStats()
      .then((res) => {
        if (cancelled) return;
        const ids = Array.isArray((res as { departmentIds?: string[] })?.departmentIds)
          ? (res as { departmentIds: string[] }).departmentIds.filter(Boolean)
          : [];
        if (ids[0]) setSelectedDepartment(ids[0]);
      })
      .catch(() => {
        /* non-fatal — list stays unfiltered */
      });
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  const loadSummaryCounts = useCallback(async () => {
    try {
      // Summary cards always show org-wide totals — never scoped to the active
      // search / department / role filters, so they stay fixed while filtering.
      const counts = await Api.employees.getSummaryCounts({});
      const active = counts.active ?? 0;
      const draft = counts.draft ?? 0;
      const inactive = counts.inactive ?? 0;
      setSummaryCounts({
        // Prefer API total (Active + Draft + Inactive); fall back to sum if older servers omit it.
        total: counts.total ?? active + draft + inactive,
        active,
        draft,
        inactive,
        probation: counts.probation ?? 0,
      });
    } catch (error) {
      console.error('Error loading employee summary counts:', error);
    }
  }, []);

  useEffect(() => {
    const meta = employeeListMetaCache.get();
    if (meta) {
      setDepartments(meta.departments);
      setRoles(meta.roles);
    }
    let cancelled = false;
    (async () => {
      try {
        const [depts, roleRows] = await Promise.all([
          Api.departments.getAll(),
          Api.roles.getAll(),
        ]);
        if (cancelled) return;
        const deptList = Array.isArray(depts) ? depts : [];
        const roleList = Array.isArray(roleRows) ? roleRows : [];
        setDepartments(deptList);
        setRoles(roleList);
        employeeListMetaCache.set({
          departments: deptList,
          roles: roleList,
        });
      } catch {
        if (!cancelled) {
          setDepartments([]);
          setRoles([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Legacy fallback only — used if the backend omits `role` entirely (older API).
  // Do NOT treat `role: null` as missing: employees without a linked User legitimately have null role.
  useEffect(() => {
    let cancelled = false;
    const needsLegacyMap = employees.some((e) => e.role === undefined);
    if (!needsLegacyMap || employees.length === 0) return;
    (async () => {
      try {
        const users = await Api.users.getAll();
        if (cancelled) return;
        const map: Record<string, string> = {};
        if (Array.isArray(users)) {
          for (const u of users as { email?: string; role?: string }[]) {
            if (u.email) map[u.email.toLowerCase()] = u.role || 'EMPLOYEE';
          }
        }
        setEmailToRole(map);
      } catch {
        /* swallow — list will show EMPLOYEE for unknown rows */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employees]);

  useEffect(() => {
    const ids = employees.map((e) => e.employee_id).filter(Boolean);
    if (!ids.length) {
      setMovementHistoryIds(new Set());
      return;
    }
    let cancelled = false;
    const fetchFlags = () => {
      void Api.employeeMovements
        .historyFlags(ids)
        .then((res) => {
          if (cancelled) return;
          const list = Array.isArray(res?.employeeIds) ? res.employeeIds : [];
          setMovementHistoryIds(new Set(list.map(String)));
        })
        .catch(() => {
          if (!cancelled) setMovementHistoryIds(new Set());
        });
    };
    const idleId =
      typeof requestIdleCallback !== 'undefined'
        ? requestIdleCallback(() => {
            if (!cancelled) fetchFlags();
          }, { timeout: 2500 })
        : window.setTimeout(fetchFlags, 200);
    return () => {
      cancelled = true;
      if (typeof cancelIdleCallback !== 'undefined' && typeof idleId === 'number') {
        cancelIdleCallback(idleId);
      } else {
        clearTimeout(idleId as number);
      }
    };
  }, [employees]);

  const loadEmployees = useCallback(async (opts?: WorkspaceLoadOptions) => {
    try {
      if (!opts?.background) setLoading(true);
      const params = {
        page: currentPage,
        limit: PAGE_LIMIT,
        sort_by: sortBy ?? DEFAULT_EMPLOYEE_SORT,
        sort_order: sortBy ? sortOrder : DEFAULT_EMPLOYEE_SORT_ORDER,
        ...(debouncedSearch && { search: debouncedSearch }),
        ...(selectedDepartment && { department_id: selectedDepartment }),
        ...(inProbationOnly && { in_probation: '1' }),
        ...(statusForApi && !inProbationOnly && { status: statusForApi }),
        ...(selectedRole && { role: selectedRole }),
        ...(selectedGender && { gender: selectedGender }),
        ...(joinDateRange.from && { join_date_from: joinDateRange.from }),
        ...(joinDateRange.to && { join_date_to: joinDateRange.to }),
        ...(movementFilter === 'with_movement' && { has_movement: '1' }),
      };

      const data = await Api.employees.getAll(params);
      setEmployees(data.employees ?? []);
      const tc = typeof data.total === 'number' ? data.total : 0;
      const tpagesRaw = typeof data.total_pages === 'number' ? data.total_pages : 0;
      setTotalCount(tc);
      setTotalPages(tc === 0 ? 1 : Math.max(1, tpagesRaw));
    } catch (error) {
      console.error('Error loading employees:', error);
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, [
    currentPage,
    debouncedSearch,
    selectedDepartment,
    statusForApi,
    inProbationOnly,
    selectedRole,
    selectedGender,
    joinDateRange,
    movementFilter,
    sortBy,
    sortOrder,
  ]);

  const loadPageData = useCallback(
    async (opts?: WorkspaceLoadOptions) => {
      await Promise.all([loadEmployees(opts), loadSummaryCounts()]);
    },
    [loadEmployees, loadSummaryCounts]
  );

  useWorkspaceTabMountLoad(
    loadPageData,
    [
      currentPage,
      debouncedSearch,
      selectedRole,
      selectedGender,
      selectedDepartment,
      statusForApi,
      inProbationOnly,
      sortBy,
      sortOrder,
      joinDateRange.from,
      joinDateRange.to,
      movementFilter,
      loadPageData,
    ],
    tabCache
  );

  const handleDeleteDraft = useCallback(
    async (employee: Employee) => {
      if (!isEmployeeDraftStatus(employee.status)) return;
      const name = `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || employee.employee_id;
      const reason = asPromptReason(
        await prompt({
          title: 'Delete draft employee?',
          description: `Permanently delete draft “${name}” (${employee.employee_id}). This cannot be undone.`,
          variant: 'danger',
          confirmLabel: 'Delete draft',
          reasonPlaceholder: 'Why are you deleting this draft?',
          reasonRequired: true,
        })
      );
      if (reason === null) return;
      try {
        await Api.employees.delete(employee.employee_id, {
          reason: reason.trim(),
          deleted_by: user?.id,
        });
        showToast('Draft employee deleted', 'success');
        await Promise.all([loadEmployees({ background: true }), loadSummaryCounts()]);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not delete draft employee', 'error');
      }
    },
    [prompt, showToast, user?.id, loadEmployees, loadSummaryCounts]
  );

  const showingFrom = totalCount === 0 ? 0 : (currentPage - 1) * PAGE_LIMIT + 1;
  const showingTo = totalCount === 0 ? 0 : showingFrom + employees.length - 1;

  const pagesWindow = useMemo(
    () => visiblePages(currentPage, totalPages, 5),
    [currentPage, totalPages]
  );

  const handleExport = useCallback(
    async (format: ExportFileExt) => {
      const exportParams = {
        page: 1,
        limit: 200,
        sort_by: sortBy ?? DEFAULT_EMPLOYEE_SORT,
        sort_order: sortBy ? sortOrder : DEFAULT_EMPLOYEE_SORT_ORDER,
        include_compensation: '1',
        ...(searchTerm.trim() && { search: searchTerm.trim() }),
        ...(selectedDepartment && { department_id: selectedDepartment }),
        ...(inProbationOnly && { in_probation: '1' }),
        ...(statusForApi && !inProbationOnly && { status: statusForApi }),
        ...(selectedRole && { role: selectedRole }),
        ...(selectedGender && { gender: selectedGender }),
        ...(joinDateRange.from && { join_date_from: joinDateRange.from }),
        ...(joinDateRange.to && { join_date_to: joinDateRange.to }),
        ...(movementFilter === 'with_movement' && { has_movement: '1' }),
      } as const;

      const firstPage = await Api.employees.getAll(exportParams);
      const totalPagesForExport = Math.max(1, Number(firstPage?.total_pages || 1));
      const allEmployees: Employee[] = Array.isArray(firstPage?.employees) ? [...firstPage.employees] : [];

      for (let page = 2; page <= totalPagesForExport; page += 1) {
        const nextPage = await Api.employees.getAll({ ...exportParams, page });
        if (Array.isArray(nextPage?.employees)) {
          allEmployees.push(...nextPage.employees);
        }
      }

      const headers = [...EMPLOYEE_LIST_TABULAR_COLUMNS];
      const rows = allEmployees.map((employee) => [
        employee.employee_id,
        `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
        employee.first_name || '',
        employee.last_name || '',
        employee.email || '',
        employee.phone || '',
        employee.department_id || '',
        resolveDepartmentRowName(employee.department, language),
        employee.officeLocationId || '',
        employee.officeLocationName || employee.department?.officeLocationName || '',
        employee.position_id || '',
        resolveLocalizedLabel(
          employee.position?.title,
          employee.position?.titleKh ?? employee.position?.title_kh,
          language
        ),
        positionLevelLabel(employee.position?.level) || '',
        employee.birth_date ? formatDateOnlyDisplay(employee.birth_date) : '',
        formatEmployeeAge(employee.birth_date),
        formatDateOnlyDisplay(employee.join_date),
        employee.probation_period_months ?? '',
        employee.role || '',
        formatStatusCodeLabel(String(employee.status || '')),
        employee.allow_login == null ? '' : employee.allow_login ? 'Yes' : 'No',
        employee.offboarding_in_progress ? 'Yes' : 'No',
        employee.offboarding_settlement_status || '',
        employee.placement_pending ? 'Yes' : 'No',
        employee.placement_effective_date
          ? formatDateOnlyDisplay(employee.placement_effective_date)
          : '',
        employee.termination_reason || '',
        employee.gender || '',
        employee.nationality || '',
        employee.religion || '',
        employee.street_address || '',
        employee.city || '',
        employee.country || '',
        employee.employment_type || '',
        employee.work_days ?? '',
        employee.time_in ? String(employee.time_in).slice(0, 5) : '',
        employee.time_out ? String(employee.time_out).slice(0, 5) : '',
        employee.work_hours ?? '',
        employee.break_duration_minutes ?? '',
        employee.grace_period_minutes ?? '',
        employee.base_salary ?? '',
        employee.currency || '',
        employee.payment_method || '',
        employee.bank_name || '',
        employee.bank_account_number || '',
        employee.emergency_contact_name || '',
        employee.emergency_contact_relationship || '',
        employee.emergency_contact_phone || '',
        employee.marital_status || '',
        employee.spouse_name || '',
        employee.spouse_phone || '',
      ]);
      const metadata = buildTabularMetadataAoa('Employee List', [
        { label: 'Exported rows', value: String(rows.length) },
        { label: 'Search', value: searchTerm.trim() || 'All employees' },
        { label: 'Role', value: selectedRole || 'All roles' },
        { label: 'Gender', value: selectedGender || 'All genders' },
        {
          label: 'Department',
          value:
            departments.find((department) => department.id === selectedDepartment)?.name ||
            'All departments',
        },
        { label: 'Status', value: selectedStatus || 'All statuses' },
        {
          label: 'Movement history',
          value: movementFilter === 'with_movement' ? 'With movement history' : 'All employees',
        },
        {
          label: 'Joined from',
          value: joinDateRange.from || 'Any',
        },
        {
          label: 'Joined to',
          value: joinDateRange.to || 'Any',
        },
      ]);
      const aoa = [...metadata, headers, ...rows];
      const filename = exportFilename('Employee_List', [new Date().toISOString().slice(0, 10)], format);
      if (format === 'csv') {
        downloadCsvLines(aoaToCsvLines(aoa), filename);
        return;
      }
      await downloadBrandedWorkbookAsXlsx({
        filename,
        reportTitle: 'Employee List',
        fields: [
          { label: 'Document', value: 'Employee List' },
          { label: 'Exported rows', value: String(rows.length) },
          {
            label: 'Department',
            value:
              departments.find((department) => department.id === selectedDepartment)?.name ||
              'All departments',
          },
          { label: 'Status', value: selectedStatus || 'All statuses' },
          { label: 'Prepared by', value: '' },
        ],
        period:
          joinDateRange.from || joinDateRange.to
            ? { from: joinDateRange.from || 'Any', to: joinDateRange.to || 'Any' }
            : undefined,
        purpose: 'Employee directory export / import template for onboarding.',
        sheets: [
          {
            name: 'Employees',
            aoa,
            headerRows: [metadata.length],
            columnWidths: headers.map(() => 16),
          },
        ],
      });
    },
    [
      departments,
      inProbationOnly,
      joinDateRange.from,
      joinDateRange.to,
      language,
      movementFilter,
      searchTerm,
      selectedDepartment,
      selectedGender,
      selectedRole,
      selectedStatus,
      sortBy,
      sortOrder,
      statusForApi,
    ]
  );

  const toggleSort = (col: SortableEmployeeColumn) => {
    if (sortBy !== col) {
      setSortBy(col);
      setSortOrder('ASC');
      setCurrentPage(1);
      return;
    }
    if (sortOrder === 'ASC') {
      setSortOrder('DESC');
      setCurrentPage(1);
      return;
    }
    setSortBy(null);
    setSortOrder('ASC');
    setCurrentPage(1);
  };

  const getStatusBadge = useCallback((employee: Employee & { offboarding_in_progress?: boolean }) => {
    // In-progress offboarding uses the same list status as terminated/resigned.
    if (employee.offboarding_in_progress) {
      return (
        <StatusLabel
          status="INACTIVE"
          context="employee"
          label="Inactive"
          size="sm"
        />
      );
    }
    const status = employee.status;
    const normalized =
      status === 'profile_incomplete'
        ? 'PROFILE_INCOMPLETE'
        : String(status || '')
            .trim()
            .toUpperCase()
            .replace(/[\s-]+/g, '_');
    const labelMap: Record<string, string> = {
      ACTIVE: 'Active',
      DRAFT: 'Draft',
      PROFILE_INCOMPLETE: 'Draft',
      INACTIVE: 'Inactive',
      PENDING_APPROVAL: 'Pending',
      TERMINATED: 'Inactive',
      RESIGNED: 'Inactive',
      OFFBOARDING: 'Inactive',
    };
    const label = labelMap[normalized] ?? formatStatusCodeLabel(normalized);
    const badgeStatus = label === 'Inactive' ? 'INACTIVE' : normalized;

    return <StatusLabel status={badgeStatus} context="employee" label={label} size="sm" />;
  }, []);

  const roleForEmployee = useCallback(
    (employee: Employee) => {
      const direct = employee.role && String(employee.role).trim();
      if (direct) return roleLabelFromApi(direct);
      const key = employee.email?.toLowerCase();
      const r = key ? emailToRole[key] : undefined;
      return roleLabelFromApi(r || 'EMPLOYEE');
    },
    [emailToRole, roleLabelFromApi]
  );

  const positionTitleForEmployee = useCallback(
    (employee: Employee) =>
      resolveLocalizedLabel(
        employee.position?.title,
        employee.position?.titleKh ?? employee.position?.title_kh,
        language
      ),
    [language]
  );

  const positionLevelForEmployee = useCallback(
    (employee: Employee) => positionLevelLabel(employee.position?.level) || '—',
    []
  );

  const filterActiveCount = useMemo(
    () =>
      countActiveFilters([
        { value: selectedRole, defaultValue: '' },
        { value: selectedGender, defaultValue: '' },
        { value: selectedDepartment, defaultValue: '' },
        {
          value: selectedStatus,
          defaultValue: '',
        },
        { value: movementFilter, defaultValue: '' },
      ]) + countDateRangeFilters(joinDateRange),
    [
      selectedRole,
      selectedGender,
      selectedDepartment,
      selectedStatus,
      movementFilter,
      joinDateRange,
    ]
  );

  const clearFilters = useCallback(() => {
    setSearchTerm('');
    setDebouncedSearch('');
    setSelectedRole('');
    setSelectedGender('');
    setSelectedDepartment('');
    setSelectedStatus('');
    setMovementFilter('');
    setJoinDateRange(EMPTY_DATE_RANGE);
    setSortBy(null);
    setSortOrder('ASC');
    setCurrentPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);


  const thClass =
    'px-2 py-1.5 sm:px-3 sm:py-2 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider';

  const sortableHeader = (
    label: string,
    col: SortableEmployeeColumn,
    align: 'left' | 'center' = 'left'
  ) => (
    <th className={`${thClass} ${align === 'center' ? 'text-center' : ''}`}>
      <button
        type="button"
        onClick={() => toggleSort(col)}
        className={`inline-flex items-center max-w-full font-semibold hover:text-primary-600 dark:hover:text-primary-400 truncate ${
          align === 'center' ? 'justify-center w-full' : ''
        }`}
      >
        <span className="truncate">{label}</span>
        <SortIcon state={getSortIconState(sortBy, sortOrder, col)} />
      </button>
    </th>
  );

  const tdClass = 'px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm text-slate-900 dark:text-white align-middle';
  const tdCenter = `${tdClass} text-center`;

  const buildEmployeeActions = useCallback(
    (employee: Employee) => {
      return [
        {
          key: 'id-card',
          label: 'ID card',
          icon: <CreditCard className="w-4 h-4" />,
          onClick: () => setCardModal({ employeeId: employee.employee_id }),
        },
        {
          key: 'view',
          label: 'View details',
          icon: <FileText className="w-4 h-4" />,
          onClick: () => setDetailEmployeeId(employee.employee_id),
        },
        ...(rowPermissions.canEdit
          ? [
              {
                key: 'edit',
                label: 'Edit employee',
                icon: <Edit className="w-4 h-4" />,
                onClick: () => navigate(`/employees/${employee.employee_id}/edit`),
              },
            ]
          : []),
        ...(rowPermissions.canDelete && isEmployeeDraftStatus(employee.status)
          ? [
              {
                key: 'delete-draft',
                label: 'Delete draft',
                icon: <Trash2 className="w-4 h-4" />,
                destructive: true as const,
                onClick: () => void handleDeleteDraft(employee),
              },
            ]
          : []),
        ...(rowPermissions.canDelete && !isEmployeeDraftStatus(employee.status)
          ? [
              {
                key: 'offboarding',
                label: 'Offboarding',
                icon: <UserMinus className="w-4 h-4" />,
                onClick: () =>
                  navigate(employeeOffboardingActionUrl(employee.employee_id, employee.status)),
              },
            ]
          : []),
      ];
    },
    [
      handleDeleteDraft,
      navigate,
      rowPermissions.canDelete,
      rowPermissions.canEdit,
    ]
  );

  return (
    <div className="space-y-6">
      <ConfirmDialogHost />
      <EmployeeDetailModal
        employeeId={detailEmployeeId}
        onClose={() => setDetailEmployeeId(null)}
        roleLabelFromApi={roleLabelFromApi}
        canEdit={rowPermissions.canEdit}
        onEdit={(id) => {
          setDetailEmployeeId(null);
          navigate(`/employees/${id}/edit`);
        }}
      />

      <EmployeeCardModal
        isOpen={cardModal != null}
        employeeId={cardModal?.employeeId ?? null}
        initialCardId={cardModal?.cardId ?? null}
        onClose={() => setCardModal(null)}
      />

      {canImportStaff ? (
        <EmployeeImportModal
          isOpen={importOpen}
          onClose={() => setImportOpen(false)}
          onImported={async () => {
            await loadEmployees({ force: true });
            await loadSummaryCounts();
          }}
        />
      ) : null}

      <div className="stat-card-grid-5">
        <StatCard
          label="Total Employees"
          value={summaryCounts.total}
          icon={Users}
          variant="primary"
          active={!selectedStatus}
          onClick={() => {
            setSelectedStatus('');
            setCurrentPage(1);
          }}
        />
        <StatCard
          label="Active Employees"
          value={summaryCounts.active}
          icon={UserCheck}
          variant="success"
          active={selectedStatus === 'active'}
          onClick={() => {
            setSelectedStatus((prev) => (prev === 'active' ? '' : 'active'));
            setCurrentPage(1);
          }}
        />
        <StatCard
          label="In Probation"
          value={summaryCounts.probation}
          icon={UserCog}
          variant="neutral"
          active={selectedStatus === 'probation'}
          onClick={() => {
            setSelectedStatus((prev) => (prev === 'probation' ? '' : 'probation'));
            setCurrentPage(1);
          }}
        />
        <StatCard
          label="Draft"
          value={summaryCounts.draft}
          icon={UserPen}
          variant="warning"
          active={selectedStatus === 'draft'}
          onClick={() => {
            setSelectedStatus((prev) => (prev === 'draft' ? '' : 'draft'));
            setCurrentPage(1);
          }}
        />
        <StatCard
          label="Inactive"
          value={summaryCounts.inactive}
          icon={UserMinus}
          variant="neutral"
          active={selectedStatus === 'inactive'}
          onClick={() => {
            setSelectedStatus((prev) => (prev === 'inactive' ? '' : 'inactive'));
            setCurrentPage(1);
          }}
        />
      </div>

      <div className="surface-card p-6">
        <ListSearchFilterBar
          leading={
            <div className="flex items-center gap-2">
              {canImportStaff ? (
                <ListToolbarIconButton
                  onClick={() => setImportOpen(true)}
                  icon={<Upload className={listToolbarGlyphClass} />}
                  title={t('employees.importAction')}
                  aria-label={t('employees.importAction')}
                />
              ) : null}
              <ExportFormatMenu
                formats={['csv', 'xlsx']}
                disabled={loading || employees.length === 0}
                onExport={handleExport}
                className={listToolbarIconPillClass}
              />
            </div>
          }
          searchValue={searchTerm}
          onSearchChange={handleSearchValueChange}
          searchPlaceholder="Search name (EN/KH), EmpID, phone, or email..."
          filter={
          <PageFilterMenu activeCount={filterActiveCount} onClear={clearFilters}>
            <FilterMenuDateRange
              from={joinDateRange.from}
              to={joinDateRange.to}
              onChange={setJoinDateRange}
              fromLabel="Joined from"
              toLabel="Joined to"
            />
            <FilterMenuSelect
              label="Role"
              value={selectedRole}
              onChange={setSelectedRole}
              options={[
                { value: '', label: 'All roles' },
                ...roles
                  .filter((r) => {
                    const n = String(r.name || '').toUpperCase();
                    return n !== 'ADMIN' && n !== 'SUPER_ADMIN';
                  })
                  .map((r) => ({
                    value: r.name,
                    label: roleLabelFromApi(r.name),
                  })),
              ]}
            />
            <FilterMenuSelect
              label="Gender"
              value={selectedGender}
              onChange={setSelectedGender}
              options={[
                { value: '', label: 'All genders' },
                { value: 'Male', label: 'Male' },
                { value: 'Female', label: 'Female' },
              ]}
            />
            <FilterMenuSelect
              label="Department"
              value={selectedDepartment}
              onChange={setSelectedDepartment}
              options={[
                { value: '', label: 'All departments' },
                ...departments.map((d) => ({
                  value: d.id,
                  label: resolveLocalizedLabel(d.name, d.nameKh ?? d.name_kh, language),
                })),
              ]}
            />
            <FilterMenuSelect
              label="Status"
              value={selectedStatus}
              onChange={setSelectedStatus}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'active', label: 'Active' },
                { value: 'probation', label: 'In probation' },
                { value: 'draft', label: 'Draft' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
            <FilterMenuSelect
              label="Movement history"
              value={movementFilter}
              onChange={setMovementFilter}
              options={[
                { value: '', label: 'All employees' },
                { value: 'with_movement', label: 'With movement history' },
              ]}
            />
          </PageFilterMenu>
          }
        />
      </div>

      <div className="surface-card overflow-hidden min-w-0">
        {loading ? (
          <PageLoading layout="list" label={t('common.retrievingData')} />
        ) : employees.length === 0 ? (
          <div className="hcms-empty-state">
            <p className="text-slate-700 dark:text-slate-300 font-medium">No employees found matching your filters.</p>
            <button
              type="button"
              onClick={clearFilters}
              className="mt-3 text-sm text-primary-600 dark:text-primary-400 hover:underline font-medium"
            >
              Clear all filters
            </button>
          </div>
        ) : (
          <>
            {/* Phone / tablet: stacked cards (full table needs wide viewport). */}
            <div className="block lg:hidden">
              <div className="divide-y divide-slate-200 dark:divide-slate-700">
                {employees.map((employee) => {
                  const historyOpen = expandedHistoryId === employee.employee_id;
                  const hasMovementHistory = movementHistoryIds.has(employee.employee_id);
                  const positionTitle = positionTitleForEmployee(employee);
                  const positionLevel = positionLevelForEmployee(employee);
                  return (
                  <div key={employee.employee_id} className="divide-y divide-slate-100 dark:divide-slate-800">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => handleEmployeeRowActivate(employee.employee_id, e)}
                    onKeyDown={(e) => handleEmployeeRowActivate(employee.employee_id, e)}
                    className={`p-3 sm:p-4 cursor-pointer transition-colors ${
                      historyOpen
                        ? 'bg-slate-50 dark:bg-slate-800/60 ring-1 ring-inset ring-primary-200/50 dark:ring-primary-500/20'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                    aria-expanded={historyOpen}
                  >
                    <EmployeeListIdentityBlock
                      className="min-w-0"
                      avatarClassName={`h-9 w-9 sm:h-10 sm:w-10 shrink-0 ${hasMovementHistory ? 'ring-2 ring-amber-400/80 ring-offset-1 sm:ring-offset-2 ring-offset-white dark:ring-offset-slate-900' : ''}`}
                      data={{
                        ...employeeListIdentityFromEmployeeRow(employee),
                        subtitle: undefined,
                        subtitleKh: undefined,
                      }}
                      compactOnMobile
                      nameExtra={<MovementHistoryNotice show={hasMovementHistory} />}
                      subtitleExtra={
                        employee.placement_pending ? (
                          <span className="text-amber-600 dark:text-amber-400">· pending</span>
                        ) : null
                      }
                    />
                    <div className="mt-2.5 flex items-center justify-between gap-2 min-w-0">
                      <div className="min-w-0">{getStatusBadge(employee)}</div>
                      <div data-employee-actions-menu data-stop-row-toggle className="shrink-0">
                        <ResponsiveRowActions
                          mode="menu"
                          menuLabel="Employee actions"
                          actions={buildEmployeeActions(employee)}
                        />
                      </div>
                    </div>
                    <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      <div className="min-w-0">
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                          Role
                        </dt>
                        <dd className="mt-0.5 break-words text-slate-700 dark:text-slate-200" title={roleForEmployee(employee)}>
                          {roleForEmployee(employee)}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                          Department
                        </dt>
                        <dd
                          className="mt-0.5 break-words text-slate-700 dark:text-slate-200"
                          title={resolveDepartmentRowName(employee.department, language)}
                        >
                          {resolveDepartmentRowName(employee.department, language)}
                        </dd>
                        <PlacementPendingLabel
                          pending={employee.placement_pending}
                          effectiveDate={employee.placement_effective_date}
                        />
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                          Position
                        </dt>
                        <dd className="mt-0.5 break-words text-slate-700 dark:text-slate-200" title={positionTitle}>
                          {positionTitle}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                          Level
                        </dt>
                        <dd className="mt-0.5 break-words text-slate-700 dark:text-slate-200" title={positionLevel}>
                          {positionLevel}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                          Age
                        </dt>
                        <dd className="mt-0.5 text-slate-700 dark:text-slate-200 tabular-nums">
                          {formatEmployeeAge(employee.birth_date)}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                          Joined
                        </dt>
                        <dd
                          className="mt-0.5 break-words text-slate-700 dark:text-slate-200"
                          title={formatJoinShort(employee.join_date)}
                        >
                          {formatJoinShort(employee.join_date)}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                      {historyOpen ? (
                        <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                      )}
                      {hasMovementHistory ? 'Tap to view history' : 'Tap to expand'}
                    </p>
                  </div>
                  {historyOpen && (
                    <div className="px-3 sm:px-4 pb-4 pt-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40">
                      <EmployeeMovementHistoryTable
                        employeeId={employee.employee_id}
                        canCancelScheduled={canCancelMovement}
                        variant="compact"
                        embedded
                      />
                    </div>
                  )}
                  </div>
                );
                })}
              </div>
            </div>

            {/* Desktop wide: full table with horizontal scroll fallback. */}
            <div className="hidden lg:block w-full min-w-0 overflow-x-auto">
              <table className="w-full min-w-[980px] table-fixed">
                <colgroup>
                  <col className="w-[3%]" />
                  <col className="w-[8%]" />
                  <col className="w-[18%]" />
                  <col className="w-[8%]" />
                  <col className="w-[12%]" />
                  <col className="w-[13%]" />
                  <col className="w-[9%]" />
                  <col className="w-[5%]" />
                  <col className="w-[8%]" />
                  <col className="w-[8%]" />
                  <col className="w-[8%]" />
                </colgroup>
                <thead className="bg-slate-50 dark:bg-slate-700">
                  <tr>
                    <th className={`${thClass} w-10 px-2`}>
                      <span className="sr-only">History</span>
                    </th>
                    {sortableHeader('ID', 'employee_id')}
                    {sortableHeader('Employee', 'first_name')}
                    <th className={thClass}>Role</th>
                    {sortableHeader('Department', 'department_id')}
                    <th className={thClass}>Position</th>
                    <th className={thClass}>Level</th>
                    <th className={`${thClass} text-center`}>Age</th>
                    {sortableHeader('Joined', 'join_date', 'center')}
                    {sortableHeader('Status', 'status', 'center')}
                    <th className={`${thClass} text-center`}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/30 dark:divide-white/10">
                  {employees.map((employee) => {
                    const historyOpen = expandedHistoryId === employee.employee_id;
                    const hasMovementHistory = movementHistoryIds.has(employee.employee_id);
                    const positionTitle = positionTitleForEmployee(employee);
                    const positionLevel = positionLevelForEmployee(employee);
                    return (
                    <React.Fragment key={employee.employee_id}>
                    <tr
                      role="button"
                      tabIndex={0}
                      onClick={(e) => handleEmployeeRowActivate(employee.employee_id, e)}
                      onKeyDown={(e) => handleEmployeeRowActivate(employee.employee_id, e)}
                      aria-expanded={historyOpen}
                      className={`cursor-pointer transition-colors ${
                        historyOpen
                          ? 'bg-slate-50/80 dark:bg-slate-800/50 ring-1 ring-inset ring-primary-200/60 dark:ring-primary-500/20'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-700/80'
                      }`}
                    >
                      <td className={`${tdClass} px-2 w-10`}>
                        <span className="inline-flex items-center justify-center p-1 text-slate-500" aria-hidden>
                          {historyOpen ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </span>
                      </td>
                      <EmployeeListIdentityCells
                        data={{
                          ...employeeListIdentityFromEmployeeRow(employee),
                          subtitle: undefined,
                          subtitleKh: undefined,
                        }}
                        idCellClassName={`${tdClass} font-mono text-sm font-medium`}
                        identityCellClassName={tdClass}
                        avatarClassName={`h-10 w-10 sm:h-11 sm:w-11 shrink-0 ${hasMovementHistory ? 'ring-2 ring-amber-400/80 ring-offset-1 ring-offset-white dark:ring-offset-slate-800' : ''}`}
                        nameExtra={<MovementHistoryNotice show={hasMovementHistory} />}
                        subtitleExtra={
                          employee.placement_pending ? (
                            <span className="text-amber-600 dark:text-amber-400">· pending</span>
                          ) : null
                        }
                      />
                      <td className={tdClass}>
                        <span className="block truncate text-sm" title={roleForEmployee(employee)}>
                          {roleForEmployee(employee)}
                        </span>
                      </td>
                      <td className={tdClass}>
                        <div className="min-w-0">
                          <span
                            className="block truncate text-sm"
                            title={resolveDepartmentRowName(employee.department, language)}
                          >
                            {resolveDepartmentRowName(employee.department, language)}
                          </span>
                          <PlacementPendingLabel
                            pending={employee.placement_pending}
                            effectiveDate={employee.placement_effective_date}
                          />
                        </div>
                      </td>
                      <td className={tdClass}>
                        <span className="block truncate text-sm" title={positionTitle}>
                          {positionTitle}
                        </span>
                      </td>
                      <td className={tdClass}>
                        <span className="block truncate text-sm" title={positionLevel}>
                          {positionLevel}
                        </span>
                      </td>
                      <td className={`${tdCenter} text-slate-600 dark:text-slate-300 tabular-nums`}>
                        {formatEmployeeAge(employee.birth_date)}
                      </td>
                      <td className={`${tdCenter} text-slate-600 dark:text-slate-300`}>
                        <span className="block truncate" title={formatJoinShort(employee.join_date)}>
                          {formatJoinCompact(employee.join_date)}
                        </span>
                      </td>
                      <td className={tdCenter}>
                        <div className="flex justify-center">{getStatusBadge(employee)}</div>
                      </td>
                      <td className={tdCenter} data-stop-row-toggle>
                        <div className="inline-flex" data-employee-actions-menu>
                          <ResponsiveRowActions
                            mode="menu"
                            menuLabel="Employee actions"
                            actions={buildEmployeeActions(employee)}
                          />
                        </div>
                      </td>
                    </tr>
                    {historyOpen && (
                      <tr className="bg-slate-50/50 dark:bg-slate-900/30">
                        <td colSpan={11} className="px-3 py-3 border-t border-slate-100/80 dark:border-slate-700/80">
                          <EmployeeMovementHistoryTable
                            employeeId={employee.employee_id}
                            canCancelScheduled={canCancelMovement}
                            variant="compact"
                            embedded
                          />
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ListPagination
              from={showingFrom}
              to={showingTo}
              total={totalCount}
              itemLabel="employees"
              currentPage={currentPage}
              totalPages={totalPages}
              pagesWindow={pagesWindow}
              onPageChange={setCurrentPage}
              hideWhenEmpty={false}
              footerNote={
                totalCount > 60 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl">
                    Profile photos load as you scroll (lazy). Keeping images under the 5 MB cap keeps the list fast;
                    very large files or slow networks may feel slightly heavier.
                  </p>
                ) : undefined
              }
            />
          </>
        )}
      </div>
    </div>
  );
};
