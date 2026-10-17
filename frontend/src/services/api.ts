
import {
  MOCK_USERS,
  MOCK_DEPARTMENTS,
  MOCK_ATTENDANCE,
  MOCK_LEAVES,
  MOCK_PROJECTS,
  MOCK_PAYSLIPS,
  MOCK_PAYROLL_RUNS,
  MOCK_PAYROLL_SCHEDULE,
  MOCK_PAYROLL_TAX_BRACKETS,
  MOCK_PAYROLL_NSSF_WAGE_BRACKETS,
  MOCK_PAYROLL_COMPLIANCE_RULES,
  MOCK_NOTIFICATIONS,
  MOCK_MESSAGES,
  MOCK_TASKS,
  MOCK_LEAVE_TYPES,
  MOCK_PERMISSIONS,
  MOCK_JOBS,
  MOCK_CANDIDATES,
} from './mockData';
import { getCambodiaPublicHolidays } from '../constants/cambodiaPublicHolidays';
import {
  User,
  AttendanceRecord,
  LeaveRequest,
  LeaveBalanceEntry,
  AttendanceStatus,
  LeaveStatus,
  Project,
  Payslip,
  Department,
  Position,
  ProjectStatus,
  PayrollRun,
  PayrollSchedule,
  PayrollCalendarYear,
  PayrollTaxBracket,
  PayrollNssfWageBracket,
  PayrollComplianceRule,
  CreatePayrollRunPayload,
  SalaryBreakdown,
  Notification,
  NotificationType,
  Message,
  Task,
  TaskStatus,
  Role,
  LeaveType,
  FixedRoster,
  OvertimeRequest,
  OvertimeRateTier,
  OvertimeRequestConfig,
  OvertimeType,
  FeaturePermission,
  Job,
  Candidate,
  ApplicationStatus,
} from '../types';
import type { MonthlyFixedRoster } from '../types/roster';
import type { PositionLevelRecord } from '../types/positionLevels';
import { calculatePayrollForUser, countUnpaidLeaveDaysForMonth } from './cambodiaTax';
import { PAYROLL_EXCHANGE_RATE_FALLBACK_KHR_PER_USD } from '../constants/payrollExchangeRate';
import { complianceRulesToEngineConfig } from '../utils/payrollEngineConfig';
import { normalizePayrollTaxBrackets } from '../utils/payrollTaxRate';
import { normalizePayslip } from '../pages/payroll/payrollUtils';
import { buildPayrollEmployeeProfiles } from '../pages/payroll/payrollEmployeeDisplay';
import {
  isEmployeeStatusPayrollEligible,
  isPortalUserExcludedFromPayroll,
} from '../utils/payrollEligibility';
import { keysToCamel, keysToSnake, normalizeEmployeeDisplayId } from '../utils';
import { normalizePhone, phonesMatch } from '../utils/phone';
import { getDeviceAuthPayload, getOrCreateDeviceId, syncDeviceIdWithSession } from '../utils/device';
import { clearPortalSessionStorage } from '../utils/portalSession';
import {
  invalidateApiCache,
  invalidateApiCacheForMutation,
  readApiCache,
  shouldCacheGet,
  writeApiCache,
} from './apiCache';
import { mockNotifyRoles, mockPushNotification } from '../utils/mockNotifications';
import {
  normalizeAttendanceRecord,
  normalizeAttendanceRecordList,
  pickAttendanceForDate,
} from '../utils/attendanceRecordApi';
import { resolveRenderBackendOrigin } from '../config/deployOrigins';

/** Production builds use relative `/api` when same-origin rewrites work. Render static sites call the backend origin directly. */
function resolveApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim()?.replace(/\/$/, '');
  if (configured) {
    return configured.endsWith('/api') ? configured : `${configured}/api`;
  }
  const renderBackend = resolveRenderBackendOrigin();
  if (renderBackend) {
    return `${renderBackend}/api`;
  }
  if (import.meta.env.DEV) {
    const devBackend = import.meta.env.VITE_DEV_BACKEND_URL?.trim()?.replace(/\/$/, '');
    if (devBackend) return `${devBackend}/api`;
  }
  return '/api';
}

/** Mock adapter is permanently disabled — all modules use the live API only. */
export const USE_MOCK_ADAPTER = false as const;
export const API_BASE_URL = resolveApiBaseUrl();

/** Poll /api/health until the HR API accepts connections (dev startup / free-tier wake). */
export async function waitForBackendReady(options?: { maxWaitMs?: number }): Promise<boolean> {
  const maxWaitMs = options?.maxWaitMs ?? (import.meta.env.DEV ? 60_000 : 90_000);
  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const controller = new AbortController();
      const perTryMs = attempt === 1 ? 4_000 : 6_000;
      const timer = setTimeout(() => controller.abort(), perTryMs);
      const res = await fetch(`${API_BASE_URL}/health`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) return true;
      // 503 = API up, DB still initializing — keep polling
    } catch {
      /* API still starting or Render DNS waking up */
    }
    await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 600 : 1_200));
  }
  return false;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const MOCK_DELAY = 10; // Minimal delay for snappy UX

// Helper function to calculate work hours
const calculateWorkHours = (clockIn: string, clockOut?: string): string => {
    if (!clockIn) return '0.0';
    if (!clockOut) {
        // If not clocked out yet, calculate hours from clock in to now
        const now = new Date();
        const inTime = new Date(clockIn);
        const hours = (now.getTime() - inTime.getTime()) / (1000 * 60 * 60);
        return Math.max(0, Math.min(hours, 12)).toFixed(1); // Cap at 12 hours
    }
    const inTime = new Date(clockIn);
    const outTime = new Date(clockOut);
    const hours = (outTime.getTime() - inTime.getTime()) / (1000 * 60 * 60);
    return Math.max(0, Math.min(hours, 12)).toFixed(1); // Cap at 12 hours
};

// --- PERSISTENCE LAYER ---
// This mimics a database by saving MOCK data to LocalStorage
const memoryCache: Record<string, any> = {};

/** Legacy mock/seed payroll run ids — excluded from demo storage. */
const DEMO_PAYROLL_RUN_IDS = new Set(['run-1', 'run-2', 'run-3']);

function nextOrgUnitId(values: string[], prefix: string): string {
  const max = values.reduce((highest, value) => {
    const match = String(value || '').match(new RegExp(`^${prefix}(\\d+)$`, 'i'));
    return match ? Math.max(highest, Number(match[1] || 0)) : highest;
  }, 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

function nextMockPositionId(): string {
  const key = 'hcms_db_mock_position_counter';
  const raw = Number(localStorage.getItem(key) || '0');
  const next = Number.isFinite(raw) ? raw + 1 : 1;
  localStorage.setItem(key, String(next));
  return `POS${String(next).padStart(3, '0')}`;
}

function migrateMockOrgUnitIds(): void {
  const departments = DB.depts;
  const needsDepartmentMigration = departments.some((department) => !/^DEPT\d{3,}$/i.test(String(department.id || '')));
  if (!needsDepartmentMigration) return;

  const departmentMap = new Map<string, string>();
  const migratedDepartments = departments.map((department, index) => {
    const nextId = `DEPT${String(index + 1).padStart(3, '0')}`;
    departmentMap.set(String(department.id), nextId);
    return { ...department, id: nextId };
  });
  DB.depts = migratedDepartments;

  DB.users = DB.users.map((user) => ({
    ...user,
    departmentId: departmentMap.get(String(user.departmentId || '')) ?? user.departmentId,
  }));
  DB.jobs = DB.jobs.map((job) => ({
    ...job,
    departmentId: departmentMap.get(String(job.departmentId || '')) ?? job.departmentId,
  }));
  DB.projects = DB.projects.map((project) => ({
    ...project,
    departmentId: departmentMap.get(String(project.departmentId || '')) ?? project.departmentId,
  }));
}

function withoutDemoPayrollRuns(runs: PayrollRun[]): PayrollRun[] {
  return runs.filter((r) => !DEMO_PAYROLL_RUN_IDS.has(r.id));
}

function withoutDemoPayslips(slips: Payslip[]): Payslip[] {
  return slips.filter((p) => !DEMO_PAYROLL_RUN_IDS.has(p.payrollRunId));
}

export const DB = {
    getItem: <T>(key: string, initial: T): T => {
        if (memoryCache[key]) return memoryCache[key];

        const saved = localStorage.getItem(`hcms_db_${key}`);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                memoryCache[key] = parsed;
                return parsed;
            } catch (e) {
                console.error("Failed to parse DB item", key, e);
            }
        }
        localStorage.setItem(`hcms_db_${key}`, JSON.stringify(initial));
        memoryCache[key] = initial;
        return initial;
    },
    setItem: (key: string, data: any) => {
        memoryCache[key] = data;
        localStorage.setItem(`hcms_db_${key}`, JSON.stringify(data));
    },
    // Collections
    get users(): User[] { return this.getItem('users', MOCK_USERS); },
    set users(v: User[]) { this.setItem('users', v); },
    
    get depts(): Department[] { return this.getItem('depts', MOCK_DEPARTMENTS); },
    set depts(v: Department[]) { this.setItem('depts', v); },

    get attendance(): AttendanceRecord[] { return this.getItem('attendance', MOCK_ATTENDANCE); },
    set attendance(v: AttendanceRecord[]) { this.setItem('attendance', v); },


    get leaves(): LeaveRequest[] { return this.getItem('leaves', MOCK_LEAVES); },
    set leaves(v: LeaveRequest[]) { this.setItem('leaves', v); },

    get projects(): Project[] { return this.getItem('projects', MOCK_PROJECTS); },
    set projects(v: Project[]) { this.setItem('projects', v); },

    get tasks(): Task[] { return this.getItem('tasks', MOCK_TASKS); },
    set tasks(v: Task[]) { this.setItem('tasks', v); },

    get payrollRuns(): PayrollRun[] {
      const runs = this.getItem('payrollRuns', MOCK_PAYROLL_RUNS);
      const cleaned = withoutDemoPayrollRuns(runs);
      if (cleaned.length !== runs.length) {
        this.setItem('payrollRuns', cleaned);
        this.setItem('payslips', withoutDemoPayslips(this.getItem('payslips', MOCK_PAYSLIPS)));
      }
      return cleaned;
    },
    set payrollRuns(v: PayrollRun[]) { this.setItem('payrollRuns', v); },

    get payslips(): Payslip[] {
      return withoutDemoPayslips(this.getItem('payslips', MOCK_PAYSLIPS));
    },
    set payslips(v: Payslip[]) { this.setItem('payslips', v); },

    getPayslipBreakdownMap(): Record<string, SalaryBreakdown> {
      return this.getItem('payslipBreakdowns', {}) as Record<string, SalaryBreakdown>;
    },
    setPayslipBreakdown(payslipId: string, breakdown: SalaryBreakdown) {
      const map = this.getPayslipBreakdownMap();
      map[payslipId] = breakdown;
      this.setItem('payslipBreakdowns', map);
    },
    getPayslipBreakdown(payslipId: string): SalaryBreakdown | undefined {
      return this.getPayslipBreakdownMap()[payslipId];
    },

    get notifications(): Notification[] { return this.getItem('notifications', MOCK_NOTIFICATIONS); },
    set notifications(v: Notification[]) { this.setItem('notifications', v); },

    get overtimeRequests(): OvertimeRequest[] {
      return this.getItem('overtimeRequests', []);
    },
    set overtimeRequests(v: OvertimeRequest[]) {
      this.setItem('overtimeRequests', v);
    },

    get messages(): Message[] { return this.getItem('messages', MOCK_MESSAGES); },
    set messages(v: Message[]) { this.setItem('messages', v); },

    get jobs(): Job[] { return this.getItem('jobs', MOCK_JOBS); },
    set jobs(v: Job[]) { this.setItem('jobs', v); },

    get candidates(): Candidate[] { return this.getItem('candidates', MOCK_CANDIDATES); },
    set candidates(v: Candidate[]) { this.setItem('candidates', v); },
};

migrateMockOrgUnitIds();

/** Path after `/api` from the response URL (robust when callers omit endpoint metadata). */
function resolvedApiEndpoint(response: Response, fallback?: string): string {
    try {
        const { pathname } = new URL(response.url);
        if (pathname.startsWith('/api/')) return pathname.slice('/api'.length);
        if (pathname === '/api') return '/';
    } catch {
        /* ignore */
    }
    return fallback || '';
}

/** 401 on these routes means wrong credentials/OTP, not an expired session. */
const AUTH_401_NO_SESSION_REDIRECT = [
    '/auth/login',
    '/auth/verify-otp',
    '/auth/request-otp',
    '/auth/forgot-password',
    '/auth/verify-reset-otp',
    '/auth/reset-password',
    '/auth/change-password',
];

/** Careers landing calls these without a session — never treat 401 as “session expired”. */
const PUBLIC_API_401_NO_SESSION_REDIRECT: string[] = [
  '/public/payroll/exchange-rate',
  '/public/employees/',
];

const isAuthFailure401Route = (endpoint?: string) =>
    !!endpoint &&
    (AUTH_401_NO_SESSION_REDIRECT.some((p) => endpoint === p || endpoint.startsWith(`${p}?`)) ||
        /** Wrong PIN / OTP / lockout — not an expired login session */
        endpoint.startsWith('/auth/pin') ||
        /\/pin\/reset$/.test(endpoint));

const isPublicAnonymous401Route = (endpoint?: string) =>
    !!endpoint &&
    PUBLIC_API_401_NO_SESSION_REDIRECT.some((p) => endpoint === p || endpoint.startsWith(`${p}?`));

type ApiRequestOptions = {
    omitAuth?: boolean;
    /** When true, 401 does not clear session or redirect (used during session bootstrap). */
    skipSessionRedirect?: boolean;
    /** Alias for skipSessionRedirect — used during security bootstrap. */
    skipAuthRedirect?: boolean;
    /** Bypass browser HTTP cache for this request. */
    noCache?: boolean;
    /** Override per-request fetch abort timeout (ms). */
    timeoutMs?: number;
    /** Override retry count for requestWithRetry (network errors only). */
    retries?: number;
};

class ApiClient {
    private isTransientNetworkError(err: unknown): boolean {
        if (!(err instanceof Error)) return false;
        const msg = String(err.message || '').toLowerCase();
        const name = String((err as { name?: string }).name || '').toLowerCase();
        return (
            msg.includes('failed to fetch') ||
            msg.includes('networkerror') ||
            msg.includes('load failed') ||
            msg.includes('connection refused') ||
            msg.includes('err_connection_refused') ||
            msg.includes('err_name_not_resolved') ||
            msg.includes('name not resolved') ||
            msg.includes('network request failed') ||
            name.includes('typeerror')
        );
    }

    /** Dev: a few retries while HR API is still starting — keep low so a dead API cannot hang the boot splash. */
    private defaultRetryCount(init: RequestInit): number {
        const method = String(init.method ?? 'GET').toUpperCase();
        const isRead = method === 'GET' || method === 'HEAD';
        if (import.meta.env.DEV) return isRead ? 3 : 2;
        return isRead ? 6 : 2;
    }

    private async requestWithRetry(
        input: RequestInfo | URL,
        init: RequestInit,
        retries?: number,
        timeoutMsOverride?: number
    ): Promise<Response> {
        const maxRetries = retries ?? this.defaultRetryCount(init);
        let attempt = 0;
        // Dead local API / hung Vite proxy must not leave the UI on AuthBootSplash forever.
        const timeoutMs =
            typeof timeoutMsOverride === 'number' && timeoutMsOverride > 0
                ? timeoutMsOverride
                : import.meta.env.DEV
                  ? 8_000
                  : 45_000;
        while (true) {
            const controller = new AbortController();
            const externalSignal = init.signal;
            const onExternalAbort = () => controller.abort();
            if (externalSignal) {
                if (externalSignal.aborted) controller.abort();
                else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
            }
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                return await fetch(input, { ...init, signal: controller.signal });
            } catch (err) {
                if (!this.isTransientNetworkError(err) || attempt >= maxRetries) {
                    throw err;
                }
                const backoffMs = Math.min(4000, 400 * 2 ** attempt);
                await new Promise((resolve) => setTimeout(resolve, backoffMs));
                attempt += 1;
            } finally {
                clearTimeout(timer);
                if (externalSignal) {
                    externalSignal.removeEventListener('abort', onExternalAbort);
                }
            }
        }
    }

    private getHeaders(isMultipart = false, options?: { omitAuth?: boolean }) {
        const headers: Record<string, string> = {
            'Accept': 'application/json',
        };
        if (!options?.omitAuth) {
            let token = '';
            let storedDeviceId = '';
            try {
                const userStr = localStorage.getItem('hcms_user');
                if (userStr) {
                    const parsed = JSON.parse(userStr) as { token?: string; deviceId?: string };
                    token = parsed.token || '';
                    storedDeviceId = String(parsed.deviceId || '').trim();
                }
            } catch {
                /* ignore corrupt session */
            }
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
                // Keep X-Device-Id aligned with the session — never mint a new id mid-session.
                headers['X-Device-Id'] = syncDeviceIdWithSession({
                    deviceId: storedDeviceId,
                    token,
                });
            }
        }
        if (!isMultipart) {
            headers['Content-Type'] = 'application/json';
        }
        return headers;
    }

    private resolveRequestOpts(requestOpts?: ApiRequestOptions): ApiRequestOptions | undefined {
        if (!requestOpts) return requestOpts;
        if (requestOpts.skipAuthRedirect && !requestOpts.skipSessionRedirect) {
            return { ...requestOpts, skipSessionRedirect: true };
        }
        return requestOpts;
    }

    private async handleResponse(
        response: Response,
        endpoint?: string,
        requestOpts?: ApiRequestOptions
    ) {
        requestOpts = this.resolveRequestOpts(requestOpts);
        const isJson = response.headers.get('content-type')?.includes('application/json');
        const data = isJson ? await response.json().catch(() => null) : null;
        const routeKey = resolvedApiEndpoint(response, endpoint);

        if (response.status === 401) {
            if (isAuthFailure401Route(routeKey) || isPublicAnonymous401Route(routeKey)) {
                const loginErr = new Error(data?.message || data?.error || 'Unauthorized') as Error & {
                    status?: number;
                    code?: string;
                };
                loginErr.status = 401;
                if (data?.code != null) loginErr.code = String(data.code);
                throw loginErr;
            }
            // Mid-restore the users/sessions tables are wiped; do not kick the UI to login
            // until the restore poll finishes (caller shows success + asks to sign in again).
            if (!requestOpts?.skipSessionRedirect && !isBackupRestoreSessionGuarded()) {
                clearPortalSessionStorage();
                window.location.href = '/#/login';
            }
            const expiredMsg =
                data?.code === 'DEVICE_LIMIT'
                    ? data?.message ||
                      'This device was signed out because your account is active on too many other devices.'
                    : data?.code === 'ACCOUNT_DISABLED'
                      ? data?.message ||
                        'This account is inactive or frozen. Please contact an administrator.'
                    : data?.code === 'SESSION_EXPIRED'
                      ? data?.message || 'Your session has expired. Please sign in again.'
                      : data?.message || data?.error || 'Session expired';
            const sessionErr = new Error(expiredMsg) as Error & {
                status?: number;
                code?: string;
                data?: Record<string, unknown>;
            };
            sessionErr.status = 401;
            if (data && typeof data === 'object') sessionErr.data = data as Record<string, unknown>;
            if (data?.code != null) sessionErr.code = String(data.code);
            throw sessionErr;
        }

        if (!response.ok) {
            const base = data?.message || data?.error || `Error ${response.status}`;
            const detail = data?.detail ? String(data.detail) : '';
            const hint = data?.hint ? ` ${data.hint}` : '';
            const message =
              detail && !base.includes(detail) ? `${base}: ${detail}` : `${base}${hint}`;
            const err = new Error(message) as Error & {
                status?: number;
                data?: Record<string, unknown>;
                code?: string;
            };
            err.status = response.status;
            if (data && typeof data === 'object') err.data = data as Record<string, unknown>;
            if (data?.code != null) err.code = String(data.code);
            throw err;
        }
        return data;
    }

    private async isTransientServiceUnavailable(res: Response): Promise<boolean> {
        if (res.status !== 503) return false;
        try {
            const data = (await res.clone().json()) as {
                status?: string;
                message?: string;
            };
            const message = String(data?.message ?? '').toLowerCase();
            return (
                data?.status === 'unavailable' ||
                message.includes('not reachable') ||
                message.includes('service unavailable')
            );
        } catch {
            return true;
        }
    }

    private async fetchGet(endpoint: string, requestOpts?: ApiRequestOptions) {
        // Production free-tier cold start: DB may still be initializing — retry 503s.
        const maxAttempts = import.meta.env.DEV ? 2 : 4;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            const res = await this.requestWithRetry(
                `${API_BASE_URL}${endpoint}`,
                {
                    headers: this.getHeaders(false, requestOpts),
                    cache: 'no-store',
                },
                requestOpts?.retries,
                requestOpts?.timeoutMs
            );
            if (
                attempt < maxAttempts - 1 &&
                (await this.isTransientServiceUnavailable(res))
            ) {
                await new Promise((resolve) =>
                    setTimeout(resolve, Math.min(4_000, 800 * (attempt + 1)))
                );
                continue;
            }
            return this.handleResponse(res, endpoint, requestOpts);
        }
        throw new Error('HR API not reachable');
    }

    /** Mutations: retry only while the API reports DB still waking up (safe — request not applied yet). */
    private async fetchMutating(
        method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        endpoint: string,
        init: RequestInit,
        requestOpts?: ApiRequestOptions
    ) {
        const maxAttempts = requestOpts?.retries === 0 ? 1 : 3;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            const res = await this.requestWithRetry(
                `${API_BASE_URL}${endpoint}`,
                { ...init, method },
                requestOpts?.retries ?? 2,
                requestOpts?.timeoutMs
            );
            if (
                attempt < maxAttempts - 1 &&
                (await this.isTransientServiceUnavailable(res))
            ) {
                await new Promise((resolve) =>
                    setTimeout(resolve, Math.min(4_000, 900 * (attempt + 1)))
                );
                continue;
            }
            const data = await this.handleResponse(res, endpoint, requestOpts);
            invalidateApiCacheForMutation(endpoint);
            return data;
        }
        throw new Error('HR API not reachable');
    }

    async get<T = any>(endpoint: string, requestOpts?: ApiRequestOptions): Promise<T> {
        if (!shouldCacheGet(endpoint, requestOpts)) {
            return deduplicatedRequest(`GET:${endpoint}`, () => this.fetchGet(endpoint, requestOpts));
        }
        return deduplicatedRequest(`GET:${endpoint}`, async () => {
            const cached = readApiCache<unknown>(endpoint);
            if (cached && !cached.stale) return cached.data;
            if (cached?.stale) {
                void this.fetchGet(endpoint, requestOpts)
                    .then((data) => writeApiCache(endpoint, data))
                    .catch(() => {});
                return cached.data;
            }
            const data = await this.fetchGet(endpoint, requestOpts);
            writeApiCache(endpoint, data);
            return data;
        });
    }

    async post<T = any>(endpoint: string, body: any, requestOpts?: ApiRequestOptions): Promise<T> {
        const isFormData = body instanceof FormData;
        return this.fetchMutating(
            'POST',
            endpoint,
            {
                headers: this.getHeaders(isFormData, requestOpts),
                body: isFormData ? body : JSON.stringify(body),
            },
            requestOpts
        );
    }

    async put<T = any>(endpoint: string, body: any, requestOpts?: ApiRequestOptions): Promise<T> {
        return this.fetchMutating(
            'PUT',
            endpoint,
            {
                headers: this.getHeaders(false, requestOpts),
                body: JSON.stringify(body),
            },
            requestOpts
        );
    }

    async patch<T = any>(endpoint: string, body: any, requestOpts?: ApiRequestOptions): Promise<T> {
        return this.fetchMutating(
            'PATCH',
            endpoint,
            {
                headers: this.getHeaders(false, requestOpts),
                body: JSON.stringify(body),
            },
            requestOpts
        );
    }

    async delete<T = any>(endpoint: string, body?: unknown, requestOpts?: ApiRequestOptions): Promise<T> {
        return this.fetchMutating(
            'DELETE',
            endpoint,
            {
                headers: this.getHeaders(false, requestOpts),
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            },
            requestOpts
        );
    }

    async getBlob(endpoint: string, requestOpts?: ApiRequestOptions): Promise<Blob> {
        const headers = this.getHeaders(false, requestOpts);
        delete headers['Content-Type'];
        const res = await this.requestWithRetry(`${API_BASE_URL}${endpoint}`, { headers }, 2);
        const routeKey = resolvedApiEndpoint(res, endpoint);

        if (res.status === 401) {
            const isJson = res.headers.get('content-type')?.includes('application/json');
            const data = isJson ? await res.json().catch(() => null) : null;
            if (isAuthFailure401Route(routeKey) || isPublicAnonymous401Route(routeKey)) {
                const loginErr = new Error(data?.message || data?.error || 'Unauthorized') as Error & {
                    status?: number;
                };
                loginErr.status = 401;
                throw loginErr;
            }
            if (!requestOpts?.skipSessionRedirect) {
                clearPortalSessionStorage();
                window.location.href = '/#/login';
            }
            const expiredMsg =
                data?.code === 'DEVICE_LIMIT'
                    ? data?.message ||
                      'This device was signed out because your account is active on too many other devices.'
                    : data?.code === 'ACCOUNT_DISABLED'
                      ? data?.message ||
                        'This account is inactive or frozen. Please contact an administrator.'
                    : data?.code === 'SESSION_EXPIRED'
                      ? data?.message || 'Your session has expired. Please sign in again.'
                      : data?.message || data?.error || 'Session expired';
            const sessionErr = new Error(expiredMsg) as Error & { status?: number; code?: string };
            sessionErr.status = 401;
            if (data?.code != null) sessionErr.code = String(data.code);
            throw sessionErr;
        }

        if (!res.ok) {
            const isJson = res.headers.get('content-type')?.includes('application/json');
            const data = isJson ? await res.json().catch(() => null) : null;
            throw new Error(data?.message || data?.error || `Error ${res.status}`);
        }
        return res.blob();
    }
}

const client = new ApiClient();

/** While > 0, 401 responses must not clear the portal session (DB wipe mid-restore). */
let backupRestoreSessionGuard = 0;

export function beginBackupRestoreSessionGuard(): void {
  backupRestoreSessionGuard += 1;
}

export function endBackupRestoreSessionGuard(): void {
  backupRestoreSessionGuard = Math.max(0, backupRestoreSessionGuard - 1);
}

export function isBackupRestoreSessionGuarded(): boolean {
  return backupRestoreSessionGuard > 0;
}

type BackupRestoreJobStatus = {
  jobId: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  error?: string | null;
  result?: { statementsExecuted?: number; safetyBackupFileName?: string } | null;
  success?: boolean;
};

/** Poll async restore until finished (Render cannot keep one HTTP request open for a full DB import). */
async function pollBackupRestoreJob(
  jobId: string,
  pollToken: string
): Promise<{
  success: boolean;
  statementsExecuted?: number;
  safetyBackupFileName?: string;
}> {
  const deadline = Date.now() + 30 * 60_000;
  let delayMs = 1500;
  const tokenQs = `?token=${encodeURIComponent(pollToken)}`;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(5000, delayMs + 500);
    try {
      const status = (await client.get(
        `/settings/backup/restore-status/${encodeURIComponent(jobId)}${tokenQs}`,
        {
          noCache: true,
          timeoutMs: 60_000,
          skipSessionRedirect: true,
          omitAuth: true,
        }
      )) as BackupRestoreJobStatus;
      if (status.status === 'success') {
        return {
          success: true,
          statementsExecuted: status.result?.statementsExecuted,
          safetyBackupFileName: status.result?.safetyBackupFileName,
        };
      }
      if (status.status === 'failed') {
        throw new Error(status.error || 'Restore failed');
      }
    } catch (err) {
      // Mid-restore the API may briefly return 503 while the schema is rebuilt.
      const status = (err as { status?: number })?.status;
      const msg = err instanceof Error ? err.message : String(err);
      if (status === 503 || /failed to fetch|network|aborted/i.test(msg)) {
        continue;
      }
      // 401 without a valid poll token is a real failure; with token it should not happen.
      if (status === 401) {
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    'Restore is still running after 30 minutes. Keep this page open and check again, or inspect server logs.'
  );
}

// Request deduplication - prevents duplicate concurrent requests
const pendingRequests = new Map<string, Promise<any>>();

function deduplicatedRequest<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (pendingRequests.has(key)) {
    return pendingRequests.get(key)!;
  }
  const promise = fn().finally(() => pendingRequests.delete(key));
  pendingRequests.set(key, promise);
  return promise;
}

function normalizeTaxBracketRows(
  rows: PayrollTaxBracket[] | Array<{ minIncome: number; maxIncome: number | null; rate: number; baseTax?: number; deduction?: number }>
): PayrollTaxBracket[] {
  if (!rows?.length) return [];
  if ('min' in rows[0]) {
    return normalizePayrollTaxBrackets(rows as PayrollTaxBracket[]);
  }
  return normalizePayrollTaxBrackets(
    (rows as Array<{ minIncome: number; maxIncome: number | null; rate: number; baseTax?: number; deduction?: number }>).map(
      (b) => {
        const min = Number(b.minIncome);
        const max = b.maxIncome == null ? 9_999_999_999 : Number(b.maxIncome);
        const deduction = Number(b.deduction ?? b.baseTax ?? 0);
        return {
          min,
          max,
          rate: Number(b.rate),
          deduction,
          range:
            max >= 9_999_999_999
              ? `> ${min.toLocaleString()} KHR`
              : `${min.toLocaleString()} – ${max.toLocaleString()} KHR`,
          currency: 'KHR' as const,
        };
      }
    )
  );
}

export const Api = {
  public: {
    verifyStaff: async (employeeDisplayId: string) => {
      const id = String(employeeDisplayId || '').trim();
      if (!id) throw new Error('Staff ID is required');
      return client.get(`/public/employees/${encodeURIComponent(id)}/verify`, {
        omitAuth: true,
      });
    },
  },

  auth: {
    login: async (employeeId: string, password?: string, deviceId?: string, deviceLabel?: string) => {
        if (USE_MOCK_ADAPTER) {
            throw new Error('Mock login is disabled. Use the real API for authentication.');
        }
        const device = getDeviceAuthPayload();
        return client.post(
            '/auth/login',
            {
                employeeId: normalizeEmployeeDisplayId(employeeId),
                password,
                deviceId: deviceId || device.deviceId,
                deviceLabel: deviceLabel || device.deviceLabel,
                userAgent: device.userAgent,
            },
            { omitAuth: true }
        );
    },

    changePassword: async (
        currentPassword: string,
        newPassword: string,
        options?: { forceChange?: boolean }
    ) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            if (!newPassword) {
                throw new Error('New password is required');
            }
            
            if (newPassword.length < 6) {
                throw new Error('New password must be at least 6 characters long');
            }
            
            return { success: true, message: 'Password changed successfully', mustChangePassword: false };
        }
        return client.post('/auth/change-password', {
            ...(currentPassword ? { currentPassword } : {}),
            newPassword,
            ...(options?.forceChange ? { forceChange: true } : {}),
        });
    },
    requestOtp: async (employeeId: string) => {
        const id = normalizeEmployeeDisplayId(employeeId);
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            let user = DB.users.find(u => String(u.employeeId || '').toUpperCase() === id);
            if (!user) {
                const mockUser = MOCK_USERS.find(u => String(u.employeeId || '').toUpperCase() === id);
                if (mockUser) {
                    const currentUsers = DB.users;
                    if (!currentUsers.find(u => u.id === mockUser.id)) {
                        DB.users = [...currentUsers, mockUser];
                        user = mockUser;
                    }
                }
            }
            if (!user) throw new Error('User not found');
            const email = String(user.email || 'user@example.com');
            const maskedEmail = email.replace(/^(.{2}).+(@.+)$/, '$1*****$2');
            return { message: 'OTP sent successfully', devOtp: '123456', maskedEmail };
        }
        return client.post('/auth/request-otp', { employeeId: id }, { omitAuth: true });
    },
    otpEmailPreview: async (employeeId: string) => {
        const id = normalizeEmployeeDisplayId(employeeId);
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const user = DB.users.find(u => String(u.employeeId || '').toUpperCase() === id)
                || MOCK_USERS.find(u => String(u.employeeId || '').toUpperCase() === id);
            if (!user) throw new Error('No active account found for this Employee ID.');
            const email = String(user.email || 'user@example.com');
            return { maskedEmail: email.replace(/^(.{2}).+(@.+)$/, '$1*****$2'), emailDelivery: true };
        }
        return client.post('/auth/otp-email-preview', { employeeId: id }, { omitAuth: true });
    },
    verifyOtp: async (employeeId: string, otp: string, deviceId?: string, deviceLabel?: string) => {
        const id = normalizeEmployeeDisplayId(employeeId);
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            let user = DB.users.find(u => String(u.employeeId || '').toUpperCase() === id);
            if (!user) throw new Error('User not found');
            if (otp !== '123456') throw new Error('Invalid OTP');
            return { user: user, token: 'mock-token-123' };
        }
        const device = getDeviceAuthPayload();
        return client.post(
            '/auth/verify-otp',
            {
                employeeId: id,
                otp,
                deviceId: deviceId || device.deviceId,
                deviceLabel: deviceLabel || device.deviceLabel,
                userAgent: device.userAgent,
            },
            { omitAuth: true }
        );
    },
    forgotPassword: async (employeeId: string) => {
        const id = normalizeEmployeeDisplayId(employeeId);
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            let user = DB.users.find(u => String(u.employeeId || '').toUpperCase() === id);
            if (!user) throw new Error('User not found');
            const email = String(user.email || 'user@example.com');
            const maskedEmail = email.replace(/^(.{2}).+(@.+)$/, '$1*****$2');
            return { message: 'OTP sent successfully', devOtp: '123456', maskedEmail };
        }
        return client.post('/auth/forgot-password', { employeeId: id }, { omitAuth: true });
    },
    verifyResetPasswordOtp: async (employeeId: string, otp: string) => {
        const id = normalizeEmployeeDisplayId(employeeId);
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const user = DB.users.find(u => String(u.employeeId || '').toUpperCase() === id);
            if (!user) throw new Error('User not found');
            if (otp !== '123456') throw new Error('Invalid OTP');
            return { message: 'Email verified', resetPasswordReady: true };
        }
        return client.post('/auth/verify-reset-otp', { employeeId: id, otp }, { omitAuth: true });
    },
    resetPassword: async (employeeId: string, newPassword: string) => {
        const id = normalizeEmployeeDisplayId(employeeId);
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const user = DB.users.find(u => String(u.employeeId || '').toUpperCase() === id);
            if (!user) throw new Error('User not found');
            return { message: 'Password reset successfully' };
        }
        return client.post('/auth/reset-password', { employeeId: id, newPassword }, { omitAuth: true });
    },
    otpConfig: async () => {
        if (USE_MOCK_ADAPTER) {
            return { mode: 'local', smsEnabled: false, emailConfigured: false };
        }
        return client.get('/auth/otp-config', { omitAuth: true });
    },
    getPasswordPolicy: async () => {
        return client.get('/auth/password-policy', {
            omitAuth: true,
            skipAuthRedirect: true,
            skipSessionRedirect: true,
        }) as Promise<{
            policy?: {
                minLength?: number;
                maxLength?: number;
                requireLower?: boolean;
                requireUpper?: boolean;
                requireDigit?: boolean;
                requireSpecial?: boolean;
            };
        }>;
    },
    me: async (opts?: { skipSessionRedirect?: boolean }) => {
        if (USE_MOCK_ADAPTER) return null;
        return client.get('/user', opts);
    },
    updatePreferences: async (body: { preferredCurrency: 'KHR' | 'USD' }) => {
        if (USE_MOCK_ADAPTER) return body;
        return client.patch('/user/preferences', body);
    },
    getSession: async (opts?: { skipSessionRedirect?: boolean }) => {
        if (USE_MOCK_ADAPTER) {
            return {
                inactivityDays: 7,
                sessionTimeoutMinutes: 30,
                sessionExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            };
        }
        return client.get('/auth/session', { ...opts, noCache: true });
    },
    getDevices: async () => {
        if (USE_MOCK_ADAPTER) {
            return { maxDevices: 2, currentDeviceId: getOrCreateDeviceId(), devices: [] };
        }
        return client.get('/auth/devices', { noCache: true });
    },
    getMyAuditLog: async (params?: {
        action?: string;
        startDate?: string;
        endDate?: string;
        limit?: number;
    }) => {
        if (USE_MOCK_ADAPTER) {
            return [];
        }
        const q = new URLSearchParams();
        if (params?.action) q.set('action', params.action);
        if (params?.startDate) q.set('startDate', params.startDate);
        if (params?.endDate) q.set('endDate', params.endDate);
        if (typeof params?.limit === 'number') q.set('limit', String(params.limit));
        const query = q.toString();
        return client.get(`/auth/my-audit-log${query ? `?${query}` : ''}`, { noCache: true });
    },
    revokeDeviceSession: async (deviceId: string) => {
        if (USE_MOCK_ADAPTER) return { message: 'Device session ended', revokedDeviceId: deviceId, isCurrent: false };
        return client.delete(`/auth/devices/${encodeURIComponent(deviceId)}`);
    },
    createHandoff: async () => {
        if (USE_MOCK_ADAPTER) {
            return { handoffToken: 'mock', expiresInMinutes: 15, openPath: '/login?handoff=mock' };
        }
        return client.post('/auth/handoff', getDeviceAuthPayload());
    },
    redeemHandoff: async (handoffToken: string) => {
        if (USE_MOCK_ADAPTER) return null;
        return client.post(
            '/auth/handoff/redeem',
            { handoffToken, ...getDeviceAuthPayload() },
            { omitAuth: true }
        );
    },
    logout: async () => {
        if (USE_MOCK_ADAPTER) return { message: 'Logged out' };
        return client.post('/auth/logout', {});
    },
    getSecurity: async () => {
        if (USE_MOCK_ADAPTER) {
            return { pinRequired: false, pinSet: false, pinAutoLockMinutes: 15, maxDevices: 2, inactivityDays: 7, sessionTimeoutMinutes: 30 };
        }
        return client.get('/auth/security', { skipSessionRedirect: true, skipAuthRedirect: true });
    },
    verifyPin: async (pin: string) => client.post('/auth/pin/verify', { pin }),
    setPin: async (pin: string, currentPin?: string, autoLockMinutes?: number) =>
        client.post('/auth/pin/set', { pin, currentPin, autoLockMinutes }),
    sendPinRecoveryOtp: async () => client.post('/auth/pin/recovery/send-otp', {}),
    verifyPinRecoveryOtp: async (otp: string) =>
        client.post('/auth/pin/recovery/verify-otp', { otp }),
    updatePinSettings: async (settings: { autoLockMinutes?: number; pinLockEnabled?: boolean }) =>
        client.put('/auth/pin/settings', settings),
    resetUserPin: async (userId: string, adminPin: string) =>
        client.post(`/users/${userId}/pin/reset`, { adminPin }),
  },
  
  users: {
    getAll: async (options?: { view?: 'directory' | 'full' }) => {
        if (USE_MOCK_ADAPTER) { await delay(MOCK_DELAY); return [...DB.users]; }
        const view = options?.view === 'directory' ? 'directory' : '';
        return client.get(view ? `/users?view=${view}` : '/users');
    },
    /** Lean directory for list joins (Attendance / Leaves) — skips salary structures. */
    getDirectory: async () => {
        if (USE_MOCK_ADAPTER) { await delay(MOCK_DELAY); return [...DB.users]; }
        return client.get('/users?view=directory');
    },
    getById: async (id: string) => {
        if (USE_MOCK_ADAPTER) { await delay(MOCK_DELAY); return DB.users.find(u => u.id === id); }
        return client.get(`/users/${id}`);
    },
    getNextId: async () => {
        if (USE_MOCK_ADAPTER) {
            await delay(100);
            const ids = DB.users.map(u => {
                const match = String(u.id || '').match(/^u-(\d+)$/i);
                return match ? parseInt(match[1], 10) : 0;
            });
            const maxId = Math.max(0, ...ids);
            return `u-${maxId + 1}`;
        }
        return client.get('/users/next-id');
    },
    create: async (user: Partial<User> & { password?: string; email: string; name: string; role: Role }) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const newId = (user as any).id || `u-${Date.now()}`;
            const newUser = { ...user, id: newId } as User;
            const current = DB.users;
            DB.users = [newUser, ...current];
            return newUser;
        }
        return client.post('/users', user);
    },
    /** Next portal-only admin EmpID (ADM00001) — not an employees badge. */
    getNextAdminLoginId: async (): Promise<{ loginId: string }> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const used = new Set(
                DB.users
                    .map((u: any) => String(u.loginId || u.displayEmployeeId || '').toUpperCase())
                    .filter((v) => /^ADM\d+$/.test(v))
            );
            let n = 1;
            while (used.has(`ADM${String(n).padStart(5, '0')}`)) n += 1;
            return { loginId: `ADM${String(n).padStart(5, '0')}` };
        }
        return client.get('/users/next-admin-login-id');
    },
    /** Portal-only system administrators (Settings → Create Admin). */
    listSystemAdmins: async () => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return DB.users.filter(
                (u: any) =>
                    String(u.role || '').toUpperCase() === Role.ADMIN &&
                    (u.accountType === 'system' || !u.employeeId)
            );
        }
        return client.get('/users/system-admins');
    },
    /** System administrator — no employee record (Settings → Create Admin). */
    createSystemAdmin: async (body: {
        email: string;
        phone: string;
        password: string;
        displayName: string;
        isActive?: boolean;
        loginId?: string;
    }) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const loginId = body.loginId || `ADM${String(Date.now()).slice(-5)}`;
            const newUser = {
                id: `u-${Date.now()}`,
                email: body.email,
                phone: body.phone,
                name: body.displayName,
                role: Role.ADMIN,
                accountType: 'system',
                employeeId: null,
                displayEmployeeId: loginId,
                loginId,
                isActive: body.isActive !== false,
                departmentId: '',
                position: 'System Administrator',
                avatarUrl: '',
                joinDate: new Date().toISOString().slice(0, 10),
            } as User;
            DB.users = [newUser, ...DB.users];
            return newUser;
        }
        return client.post('/users/system-admin', body);
    },
    update: async (user: Partial<User> & { id: string; password?: string }) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const current = DB.users;
            const idx = current.findIndex(u => u.id === user.id);
            if (idx !== -1) {
                current[idx] = { ...current[idx], ...user } as User;
                DB.users = current;
            }
            return current[idx] || user;
        }
        return client.put(`/users/${user.id}`, user);
    },
    freeze: async (id: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const current = DB.users;
            const idx = current.findIndex((u) => u.id === id);
            if (idx !== -1) {
                current[idx] = {
                    ...current[idx],
                    isActive: false,
                    status: 'INACTIVE',
                } as User;
                DB.users = current;
                return current[idx];
            }
            return null;
        }
        return client.post(`/users/${id}/freeze`, {});
    },
    unfreeze: async (id: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const current = DB.users;
            const idx = current.findIndex((u) => u.id === id);
            if (idx !== -1) {
                current[idx] = {
                    ...current[idx],
                    isActive: true,
                    status: 'ACTIVE',
                } as User;
                DB.users = current;
                return current[idx];
            }
            return null;
        }
        return client.post(`/users/${id}/unfreeze`, {});
    },
    delete: async (id: string) => {
        if (USE_MOCK_ADAPTER) { 
            await delay(MOCK_DELAY); 
            const current = DB.users;
            DB.users = current.filter(u => u.id !== id);
            return true; 
        }
        return client.delete(`/users/${id}`);
    },
    getEffectivePermissions: async (userId: string) => {
        try {
            // Always hit the network — stale grants make saves look like they "didn't stick".
            return await client.get(`/users/${userId}/permissions`, { noCache: true });
        } catch (error) {
            const status = (error as { status?: number } | null)?.status;
            // Legacy/local databases can temporarily miss this user row.
            // Keep app bootstrap stable instead of surfacing hard 404 noise.
            if (status === 404) return {};
            throw error;
        }
    }
  },

  departments: {
    getAll: async (options?: { activeOnly?: boolean; noCache?: boolean }) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const users = DB.users;
            const rows = DB.depts.map((d) => ({
                ...d,
                isActive: !(d.isActive === false || d.isActive === 0 || d.isActive === '0'),
                managerName:
                    d.managerName?.trim() ||
                    users.find((u) => u.id === d.managerId)?.name ||
                    undefined,
            }));
            if (options?.activeOnly) return rows.filter((d) => d.isActive);
            return rows;
        }
        const qs = options?.activeOnly ? '?activeOnly=1' : '';
        return client.get(`/departments${qs}`, options?.noCache ? { noCache: true } : undefined);
    },
    getById: async (id: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const found = DB.depts.find((d) => d.id === id);
            if (!found) throw new Error('Department not found');
            return { ...found, isActive: found.isActive !== false };
        }
        return client.get(`/departments/${id}`, { noCache: true });
    },
    update: async (dept: Department) => {
        const managerId =
            dept.managerId != null && String(dept.managerId).trim() !== ''
                ? String(dept.managerId).trim()
                : null;
        const code = dept.code != null ? String(dept.code).trim().toUpperCase() : '';
        const payload = {
            id: dept.id,
            name: dept.name,
            nameKh: dept.nameKh?.trim() ?? '',
            ...(code ? { code } : { code: null }),
            managerId,
        };
        if (USE_MOCK_ADAPTER) { 
            await delay(MOCK_DELAY); 
            const current = DB.depts;
            const idx = current.findIndex(d => d.id === dept.id);
            const managerName = managerId
                ? DB.users.find((u) => u.id === managerId)?.name
                : undefined;
            const next = { ...dept, managerId: managerId ?? undefined, managerName, isActive: dept.isActive !== false };
            if(idx !== -1) {
                current[idx] = next;
                DB.depts = current;
            }
            return next; 
        }
        return client.put(`/departments/${dept.id}`, payload);
    },
    /** Permanent delete — only when no staff are assigned. */
    delete: async (id: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const dept = DB.depts.find((d) => d.id === id);
            if (!dept) throw new Error('Department not found');
            const assignedStaff = DB.users.filter((u) => u.departmentId === id).length;
            if (assignedStaff > 0) {
                throw new Error(
                    `Cannot delete this department while ${assignedStaff} employee(s) are still assigned.`
                );
            }
            DB.depts = DB.depts.filter((d) => d.id !== id);
            return { success: true, deleted: true };
        }
        return client.delete(`/departments/${id}`);
    },
    /** Soft-close — allowed with staff; hides unit from new assignment dropdowns. */
    deactivate: async (id: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const dept = DB.depts.find((d) => d.id === id);
            if (!dept) throw new Error('Department not found');
            if (dept.isActive === false) throw new Error('Department is already inactive.');
            const next = { ...dept, isActive: false };
            DB.depts = DB.depts.map((d) => (d.id === id ? next : d));
            return { success: true, deactivated: true, department: next };
        }
        return client.post(`/departments/${id}/deactivate`, {});
    },
    reactivate: async (id: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const dept = DB.depts.find((d) => d.id === id);
            if (!dept) throw new Error('Department not found');
            const next = { ...dept, isActive: true };
            DB.depts = DB.depts.map((d) => (d.id === id ? next : d));
            return next;
        }
        return client.post(`/departments/${id}/reactivate`, {});
    },
    create: async (dept: Omit<Department, 'id' | 'headCount' | 'managerName'>) => {
        if(USE_MOCK_ADAPTER) { 
            await delay(MOCK_DELAY); 
            const managerName = DB.users.find((u) => u.id === dept.managerId)?.name;
            const newDept = {
                ...dept,
                id: nextOrgUnitId(DB.depts.map((dept) => String(dept.id || '')), 'DEPT'),
                headCount: 0,
                managerName,
                isActive: true,
            } as Department;
            DB.depts = [...DB.depts, newDept];
            return newDept;
        }
        return client.post('/departments', dept);
    }
  },

  attendance: {
    getForUser: async (
        userId: string,
        options?: {
            /** Last N ICT days from join date — includes roster placeholders (self-service history). */
            historyDays?: number;
            historyRange?: { from: string; to: string };
            /** Materialize missing absence rows for this user only (explicit refresh). */
            reconcile?: boolean;
        }
    ) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return normalizeAttendanceRecordList(
              DB.attendance.filter((a) => a.userId === userId)
            );
        }
        const q = new URLSearchParams();
        if (options?.historyRange?.from && options?.historyRange?.to) {
            q.set('history_from', String(options.historyRange.from).slice(0, 10));
            q.set('history_to', String(options.historyRange.to).slice(0, 10));
        } else if (options?.historyDays && options.historyDays > 0) {
            q.set('history_days', String(Math.min(options.historyDays, 365)));
        } else {
            q.set('history_days', '90');
        }
        if (options?.reconcile) q.set('reconcile', '1');
        const qs = q.toString();
        const rows = await client.get(
            `/users/${userId}/attendance${qs ? `?${qs}` : ''}`,
            { noCache: true }
        );
        return normalizeAttendanceRecordList(rows);
    },
    getForUserOnDate: async (userId: string, date: string): Promise<AttendanceRecord | null> => {
        const day = date.slice(0, 10);
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const row = DB.attendance.find((a) => a.userId === userId && a.date === day) ?? null;
            return row ? normalizeAttendanceRecord(row) : null;
        }

        const loadHistory = async () => {
            const rows = await client.get(
                `/users/${userId}/attendance?history_days=90&reconcile=1`,
                { noCache: true }
            );
            return pickAttendanceForDate(normalizeAttendanceRecordList(rows), day);
        };

        try {
            const row = await client.get(
                `/users/${userId}/attendance?date=${encodeURIComponent(day)}&reconcile=1`,
                { noCache: true }
            );
            if (row && typeof row === 'object') {
                const normalized = normalizeAttendanceRecord(row);
                if (normalized.clockIn || normalized.clockOut) {
                    return normalized;
                }
                if (normalized.id && normalized.userId && normalized.date) {
                    const fromHistory = await loadHistory();
                    if (fromHistory?.clockIn || fromHistory?.clockOut) {
                        return fromHistory;
                    }
                    return normalized;
                }
            }
        } catch {
            /* fall through to history list */
        }

        return loadHistory();
    },
    getAll: async (options?: {
        refresh?: boolean;
        /** Materialize missing absence rows in DB before returning (slow; use on manual refresh). */
        reconcile?: boolean;
        /** ICT calendar day — use `today` for full staff roster grid. */
        date?: 'today' | string;
        /** Last N ICT days including today — full roster per day (max 14 days; use historyDays for longer). */
        gridRangeDays?: number;
        /** Inclusive ICT date range with full roster per day (switches to fast history mode when > 14 days). */
        gridRange?: { from: string; to: string };
        /** Last N days of stored attendancerecords only (fast; includes leave enrichment). */
        historyDays?: number;
        /** Inclusive date range of stored records only (fast). */
        historyRange?: { from: string; to: string };
    }) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return normalizeAttendanceRecordList([...DB.attendance]);
        }
        const params = new URLSearchParams();
        if (options?.refresh) params.set('_', String(Date.now()));
        if (options?.reconcile) params.set('reconcile', '1');
        if (options?.date) {
            params.set(
              'date',
              options.date === 'today' ? 'today' : String(options.date).slice(0, 10)
            );
        } else if (options?.historyDays && options.historyDays > 0) {
            params.set('history_days', String(Math.min(options.historyDays, 365)));
        } else if (options?.historyRange?.from && options?.historyRange?.to) {
            params.set('history_from', String(options.historyRange.from).slice(0, 10));
            params.set('history_to', String(options.historyRange.to).slice(0, 10));
        } else if (options?.gridRangeDays && options.gridRangeDays > 0) {
            params.set('grid_range_days', String(Math.min(options.gridRangeDays, 14)));
        } else if (options?.gridRange?.from && options?.gridRange?.to) {
            params.set('grid', 'range');
            params.set('from', String(options.gridRange.from).slice(0, 10));
            params.set('to', String(options.gridRange.to).slice(0, 10));
        } else {
            params.set('history_days', '30');
        }
        const qs = params.toString();
        const endpoint = `/attendance${qs ? `?${qs}` : ''}`;
        const useLiveGrid = Boolean(
          options?.date ||
            options?.gridRangeDays ||
            options?.gridRange ||
            options?.historyDays ||
            options?.historyRange
        );
        const rows = await client.get(endpoint, useLiveGrid ? { noCache: true } : undefined);
        return normalizeAttendanceRecordList(rows);
    },
    getFreezePolicy: async (date: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return {
                month: date.slice(0, 7),
                date: date.slice(0, 10),
                attendancePeriodStatus: 'OPEN',
                payPeriodStart: `${date.slice(0, 7)}-01`,
                payPeriodEnd: date.slice(0, 10),
                frozenThroughDate: date.slice(0, 10),
                inFrozenCutoffRange: false,
                payrollMonthLocked: false,
                reviewFrozen: false,
                cutoffReached: false,
                allowCreate: true,
                allowUpdate: true,
                readOnlyReason: null,
            };
        }
        return client.get(`/attendance/freeze-policy?date=${encodeURIComponent(date.slice(0, 10))}`);
    },
    clockIn: async (
        userId: string,
        location?: { lat: number; lng: number } | null
    ) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const newRec = { 
                id: `att-${Date.now()}`, 
                userId, 
                date: new Date().toISOString().split('T')[0], 
                status: AttendanceStatus.PRESENT,
                clockIn: new Date().toISOString(),
                ...(location ? { locationIn: location } : {}),
            } as AttendanceRecord;
            DB.attendance = [newRec, ...DB.attendance];
            return normalizeAttendanceRecord(newRec);
        }
        invalidateApiCache('attendance');
        const row = await client.post('/attendance/clock-in', {
            userId,
            ...(location ? { location } : {}),
        });
        return normalizeAttendanceRecord(row);
    },
    clockOut: async (
        recordId: string,
        location?: { lat: number; lng: number } | null
    ) => {
        if (USE_MOCK_ADAPTER) { 
            await delay(MOCK_DELAY); 
            const current = DB.attendance;
            const idx = current.findIndex(a => a.id === recordId);
            if(idx !== -1) {
                current[idx].clockOut = new Date().toISOString();
                if (location) current[idx].locationOut = location;
                DB.attendance = current;
                return normalizeAttendanceRecord(current[idx]);
            }
            return {} as AttendanceRecord;
        }
        invalidateApiCache('attendance');
        const row = await client.post(`/attendance/${recordId}/clock-out`, {
            ...(location ? { location } : {}),
        });
        return normalizeAttendanceRecord(row);
    },
    getWorksite: async (userId: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return { worksite: null };
        }
        return client.get(`/attendance/worksite/${userId}`);
    },
    validateLocation: async (latitude: number, longitude: number, userId?: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return { valid: true, withinRadius: true, distance: 0 };
        }
        return client.post('/attendance/validate-location', { latitude, longitude, userId });
    },
    updateStatus: async (recordId: string, status: AttendanceStatus) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const current = DB.attendance;
            const idx = current.findIndex((a) => a.id === recordId);
            if (idx !== -1) {
                current[idx].status = status;
                DB.attendance = current;
                return current[idx];
            }
            return {} as AttendanceRecord;
        }
        return client.patch(`/attendance/${recordId}`, { status });
    },
    updateTimes: async (
        recordId: string,
        payload: {
            userId?: string;
            date?: string;
            changeClockIn?: boolean;
            changeClockOut?: boolean;
            clockInTime?: string | null;
            clockOutTime?: string | null;
            clearClockIn?: boolean;
            clearClockOut?: boolean;
            reason: string;
        }
    ): Promise<AttendanceRecord> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const reason = String(payload.reason ?? '').trim();
            if (reason.length < 3) throw new Error('A reason is required (at least 3 characters)');
            const idx = DB.attendance.findIndex((a) => a.id === recordId);
            if (idx === -1) throw new Error('Attendance record not found');
            const rec = DB.attendance[idx];
            const day = rec.date.slice(0, 10);
            const toIso = (hm: string) => {
                const [h, m] = hm.split(':').map(Number);
                return new Date(
                  `${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+07:00`
                ).toISOString();
            };
            const userStr = localStorage.getItem('hcms_user');
            const correctorId = userStr ? JSON.parse(userStr).id : 'mock-hr';
            const prevIn = rec.clockIn;
            const prevOut = rec.clockOut;
            if (payload.changeClockIn) {
              if (payload.clearClockIn) rec.clockIn = undefined;
              else if (payload.clockInTime) rec.clockIn = toIso(payload.clockInTime);
            }
            if (payload.changeClockOut) {
              if (payload.clearClockOut) rec.clockOut = undefined;
              else if (payload.clockOutTime) rec.clockOut = toIso(payload.clockOutTime);
            }
            rec.correctionAt = new Date().toISOString();
            rec.correctionBy = correctorId;
            rec.correctionReason = reason;
            const lines: string[] = [];
            const fmt = (iso?: string) =>
              iso
                ? new Intl.DateTimeFormat(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                    timeZone: 'Asia/Phnom_Penh',
                  }).format(new Date(iso))
                : '—';
            if (payload.changeClockIn) {
              lines.push(
                `Check-in: ${fmt(prevIn)} → ${payload.clearClockIn ? '—' : fmt(rec.clockIn)}`
              );
            }
            if (payload.changeClockOut) {
              lines.push(
                `Check-out: ${fmt(prevOut)} → ${payload.clearClockOut ? '—' : fmt(rec.clockOut)}`
              );
            }
            rec.correctionSummary = lines.join(' | ');
            DB.attendance = [...DB.attendance];
            invalidateApiCache('attendance');
            return rec;
        }
        invalidateApiCache('attendance');
        const row = await client.put(`/attendance/${recordId}/times`, payload);
        return normalizeAttendanceRecord(row);
    },
    getOffices: async () => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return [];
        }
        return client.get('/attendance/offices');
    },
    generateQr: async (officeId?: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const token = 'mock-token';
            const payload = JSON.stringify({ type: 'hcms-attendance', officeId: officeId || 'off-mock', token });
            const checkInUrl =
              typeof window !== 'undefined'
                ? `${window.location.origin}${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/#/attendance/scan?t=${encodeURIComponent(token)}`
                : undefined;
            return { token, payload, checkInUrl, officeId: officeId || 'off-mock', officeName: 'Main Office', ttlSeconds: 60 };
        }
        return client.post('/attendance/qr/generate', { officeId });
    },
    scanQr: async (token: string, latitude: number, longitude: number, action?: 'in' | 'out') => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return { action: 'clock-in', record: {}, office: 'Main Office' };
        }
        invalidateApiCache('attendance');
        return client.post('/attendance/qr/scan', { token, latitude, longitude, action });
    },
    getSettings: async () => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const stored = DB.getItem<Record<string, unknown>>('attendanceSettings', null);
            if (stored && Array.isArray(stored.offices)) return stored;
            return {
                rules: {
                    requireGps: true,
                    requireInZoneToClockIn: true,
                    requireInZoneToClockOut: false,
                    requireGpsOnClockOut: true,
                    lateAfterHour: 8,
                    lateAfterMinute: 0,
                    gracePeriodMinutes: 15,
                },
                offices: [
                    {
                        id: 'off-mock',
                        name: 'Main Office',
                        latitude: 11.5564,
                        longitude: 104.9282,
                        radiusMeters: 20,
                        workingHoursStart: '08:00',
                        workingHoursEnd: '17:00',
                        isActive: true,
                    },
                ],
            };
        }
        return client.get('/attendance/settings');
    },
    updateSettings: async (config: Record<string, unknown>) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const offices = Array.isArray(config.offices)
                ? (config.offices as Record<string, unknown>[]).map((o, i) => ({
                      ...o,
                      id: String(o.id || `off-mock-${i}`),
                      isActive: true,
                  }))
                : [];
            const saved = {
              rules: config.rules,
              offices,
            };
            DB.setItem('attendanceSettings', saved);
            return saved;
        }
        return client.put('/attendance/settings', config);
    },
    importRows: async (
        rows: Array<{
            rowNumber?: number;
            employeeId: string;
            date: string;
            checkIn?: string | null;
            checkOut?: string | null;
            status?: string | null;
        }>,
        reason: string
    ): Promise<import('../types/attendance').AttendanceImportBatchResult> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return {
                total: rows.length,
                created: rows.length,
                updated: 0,
                skipped: 0,
                errors: [],
            };
        }
        invalidateApiCache('attendance');
        return client.post('/attendance/import', { rows, reason });
    },
  },

  leaves: {
    getAll: async () => {
        if (USE_MOCK_ADAPTER) { await delay(MOCK_DELAY); return [...DB.leaves]; }
        const { normalizeLeaveRequest } = await import('../utils/leaveWorkflow');
        const rows = await client.get('/leaves');
        return (Array.isArray(rows) ? rows : []).map((row) => normalizeLeaveRequest(row));
    },
    getApproverManagers: async (): Promise<import('../types').LeaveApproverManagersResponse> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const managers = DB.users
                .filter((u) => u.role === Role.MANAGER)
                .map((u) => {
                    const dept = DB.depts.find((d) => d.id === u.departmentId);
                    return {
                        id: u.id,
                        name: u.name,
                        email: u.email,
                        role: Role.MANAGER,
                        departmentId: u.departmentId,
                        departmentName: dept?.name,
                    };
                });
            const byDept = new Map<string, import('../types').LeaveApproverDepartment>();
            for (const m of managers) {
                const deptId = m.departmentId || 'unassigned';
                const deptName = m.departmentName || 'Other';
                if (!byDept.has(deptId)) {
                    byDept.set(deptId, { departmentId: deptId, departmentName: deptName, managers: [] });
                }
                byDept.get(deptId)!.managers.push(m);
            }
            const departments = [...byDept.values()].sort((a, b) =>
                a.departmentName.localeCompare(b.departmentName)
            );
            const suggested = managers[0]?.id ?? null;
            const suggestedDepartmentId = managers[0]?.departmentId ?? null;
            return {
                departments,
                managers,
                suggestedManagerId: suggested,
                suggestedDepartmentId,
            };
        }
        return client.get('/leaves/approver-managers');
    },
    create: async (request: Partial<LeaveRequest>) => {
        if (USE_MOCK_ADAPTER) { 
            await delay(MOCK_DELAY); 
            const newLeave = {
              ...request,
              id: `l-${Date.now()}`,
              status: LeaveStatus.PENDING,
            } as LeaveRequest;
            DB.leaves = [newLeave, ...DB.leaves];
            const requester = DB.users.find((u) => u.id === newLeave.userId);
            const mgrId = newLeave.assignedManagerId;
            if (mgrId) {
              mockPushNotification(DB, {
                id: `leave-pending-mgr-${newLeave.id}`,
                userId: mgrId,
                title: 'Leave needs your approval',
                message: `${requester?.name || 'Employee'} requested ${newLeave.type} leave.`,
                type: NotificationType.INFO,
                link: '/leaves',
              });
            } else {
              mockNotifyRoles(DB, DB.users, [Role.ADMIN, Role.HR, Role.MANAGER], {
                id: `leave-pending-${newLeave.id}`,
                title: 'Leave request pending',
                message: `${requester?.name || 'Employee'} requested ${newLeave.type} leave.`,
                type: NotificationType.INFO,
                link: '/leaves',
              });
            }
            return newLeave; 
        }
        return client.post('/leaves', request);
    },
    cancel: async (id: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const current = DB.leaves;
            const idx = current.findIndex((x) => x.id === id);
            if (idx === -1) throw new Error('Leave request not found');
            if (String(current[idx].status).toUpperCase() !== LeaveStatus.PENDING &&
                String(current[idx].status).toUpperCase() !== LeaveStatus.RETURNED) {
                throw new Error('Only pending or returned requests can be cancelled.');
            }
            current[idx] = { ...current[idx], status: LeaveStatus.CANCELLED };
            DB.leaves = current;
            const leave = current[idx];
            const mgrId = leave.assignedManagerId;
            if (mgrId) {
              mockPushNotification(DB, {
                id: `leave-cancel-${leave.id}`,
                userId: mgrId,
                title: 'Leave request cancelled',
                message: `${leave.type} leave was withdrawn by the employee.`,
                type: NotificationType.INFO,
                link: '/leaves',
              });
            }
            return leave;
        }
        return client.post(`/leaves/${id}/cancel`, {});
    },
    update: async (
        id: string,
        body: Partial<LeaveRequest> & { assignedApproverUserIds?: string[] }
    ) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const current = DB.leaves;
            const idx = current.findIndex((x) => x.id === id);
            if (idx === -1) throw new Error('Leave request not found');
            current[idx] = {
                ...current[idx],
                ...body,
                status: LeaveStatus.PENDING,
                rejectionReason: undefined,
            };
            DB.leaves = current;
            const { normalizeLeaveRequest } = await import('../utils/leaveWorkflow');
            return normalizeLeaveRequest(current[idx]);
        }
        const { normalizeLeaveRequest } = await import('../utils/leaveWorkflow');
        const res = await client.put(`/leaves/${id}`, body);
        return normalizeLeaveRequest(res);
    },
    updateStatus: async (id: string, status: LeaveStatus, rejectionReason?: string) => {
        if (USE_MOCK_ADAPTER) { 
            await delay(MOCK_DELAY); 
            const current = DB.leaves;
            const idx = current.findIndex(x => x.id === id);
            if(idx !== -1) {
                current[idx].status = status;
                current[idx].rejectionReason = rejectionReason;
                const actorId = (() => {
                  try {
                    const raw = localStorage.getItem('hcms_user');
                    if (!raw) return '';
                    const u = JSON.parse(raw) as { id?: string };
                    return String(u.id ?? '').trim();
                  } catch {
                    return '';
                  }
                })();
                if (status === LeaveStatus.MANAGER_APPROVED) {
                  current[idx].managerApprovedAt = new Date().toISOString();
                  if (actorId) current[idx].managerApprovedBy = actorId;
                }
                if (status === LeaveStatus.APPROVED) {
                  current[idx].hrApprovedAt = new Date().toISOString();
                  if (actorId) current[idx].hrApprovedBy = actorId;
                }
                DB.leaves = current;
                const leave = current[idx];
                if (status === LeaveStatus.MANAGER_APPROVED) {
                  mockNotifyRoles(DB, DB.users, [Role.ADMIN, Role.HR], {
                    id: `leave-pending-hr-${leave.id}`,
                    title: 'Leave awaiting HR approval',
                    message: `${leave.type} leave needs HR final approval.`,
                    type: NotificationType.INFO,
                    link: '/leaves',
                  });
                  mockPushNotification(DB, {
                    id: `leave-mgr-ok-${leave.id}`,
                    userId: leave.userId,
                    title: 'Manager approved your leave',
                    message: `Your ${leave.type} leave is pending HR approval.`,
                    type: NotificationType.INFO,
                    link: '/leaves',
                  });
                }
                if (status === LeaveStatus.APPROVED || status === LeaveStatus.REJECTED) {
                  mockPushNotification(DB, {
                    id: `leave-status-${leave.id}`,
                    userId: leave.userId,
                    title: status === LeaveStatus.APPROVED ? 'Leave approved' : 'Leave declined',
                    message:
                      status === LeaveStatus.APPROVED
                        ? `Your ${leave.type} leave was approved.`
                        : `Your ${leave.type} leave was declined.`,
                    type:
                      status === LeaveStatus.APPROVED
                        ? NotificationType.SUCCESS
                        : NotificationType.WARNING,
                    link: '/leaves',
                  });
                }
            }
            return current[idx] ?? { id, status };
        }
        const { normalizeLeaveRequest } = await import('../utils/leaveWorkflow');
        const res = await client.put(`/leaves/${id}/status`, { status, rejectionReason });
        return normalizeLeaveRequest(res);
    },
    getTypes: async (opts?: { includeInactive?: boolean }) => {
        if (USE_MOCK_ADAPTER) {
          await delay(MOCK_DELAY);
          const all = [...MOCK_LEAVE_TYPES];
          return opts?.includeInactive ? all : all.filter((t) => t.isActive !== false);
        }
        const q = opts?.includeInactive ? '?includeInactive=true' : '';
        return client.get(`/leaves/types${q}`);
    },
    getBalances: async (userId?: string, year?: number): Promise<{ year: number; balances: LeaveBalanceEntry[] }> => {
        const y = year ?? new Date().getFullYear();
        if (USE_MOCK_ADAPTER) {
          await delay(MOCK_DELAY);
          const uid = userId ?? DB.users[0]?.id;
          const { calculateLeaveDays } = await import('../utils/leaveDays');
          const matchType = (reqType: string, typeName: string) => {
            const a = reqType.trim().toLowerCase();
            const b = typeName.trim().toLowerCase();
            return a === b || b.includes(a) || a.includes(b) || a.split(/\s+/)[0] === b.split(/\s+/)[0];
          };
          const assignedKey = `leaveAssignments:${uid}:${y}`;
          let assignedMap: Record<string, boolean> = {};
          try {
            const raw = localStorage.getItem(assignedKey);
            if (raw) assignedMap = JSON.parse(raw) as Record<string, boolean>;
          } catch {
            assignedMap = {};
          }
          const balances: LeaveBalanceEntry[] = MOCK_LEAVE_TYPES.filter((lt) => assignedMap[lt.id] === true).map((lt) => {
            const used = DB.leaves
              .filter(
                (l) =>
                  l.userId === uid &&
                  (l.status === LeaveStatus.APPROVED || String(l.status).toUpperCase() === 'APPLIED') &&
                  matchType(l.type, lt.name) &&
                  (l.startDate.startsWith(String(y)) || l.endDate.startsWith(String(y)))
              )
              .reduce((sum, l) => sum + calculateLeaveDays(l), 0);
            const entitlement = lt.daysAllowed ?? 0;
            return {
              leaveTypeId: lt.id,
              leaveTypeName: lt.name,
              code: lt.name.toUpperCase().replace(/\s+/g, '_'),
              isPaid: lt.isPaid,
              year: y,
              entitlement,
              used,
              carriedOver: 0,
              remaining: Math.max(0, entitlement - used),
            };
          });
          return { year: y, balances };
        }
        const q = new URLSearchParams();
        if (userId) q.set('userId', userId);
        if (year != null) q.set('year', String(year));
        const qs = q.toString();
        return client.get(`/leaves/balances${qs ? `?${qs}` : ''}`);
    },
    createType: async (type: Omit<LeaveType, 'id'>) => {
        if (USE_MOCK_ADAPTER) {
          await delay(MOCK_DELAY);
          const row = { ...type, id: `lt-${Date.now()}` };
          MOCK_LEAVE_TYPES.push(row);
          return row;
        }
        return client.post('/leaves/types', type);
    },
    updateType: async (id: string, type: Omit<LeaveType, 'id'>) => {
        if (USE_MOCK_ADAPTER) {
          await delay(MOCK_DELAY);
          const idx = MOCK_LEAVE_TYPES.findIndex((t) => t.id === id);
          if (idx >= 0) MOCK_LEAVE_TYPES[idx] = { ...MOCK_LEAVE_TYPES[idx], ...type };
          return MOCK_LEAVE_TYPES[idx];
        }
        return client.put(`/leaves/types/${id}`, type);
    },
    deleteType: async (id: string, opts?: { effectiveFrom?: string }) => {
        if (USE_MOCK_ADAPTER) {
          await delay(MOCK_DELAY);
          const idx = MOCK_LEAVE_TYPES.findIndex((t) => t.id === id);
          if (idx >= 0) MOCK_LEAVE_TYPES.splice(idx, 1);
          return { message: 'ok' };
        }
        const effectiveFrom = String(opts?.effectiveFrom ?? '').trim().slice(0, 10);
        const q = effectiveFrom ? `?effectiveFrom=${encodeURIComponent(effectiveFrom)}` : '';
        return client.delete(`/leaves/types/${encodeURIComponent(id)}${q}`);
    },
    getRosters: async () => {
        if (USE_MOCK_ADAPTER) {
          await delay(MOCK_DELAY);
          return [] as FixedRoster[];
        }
        return client.get('/leaves/rosters');
    },
    createRoster: async (roster: Omit<FixedRoster, 'id'>) => {
        if (USE_MOCK_ADAPTER) {
          await delay(MOCK_DELAY);
          return { ...roster, id: `rost-${Date.now()}` } as FixedRoster;
        }
        return client.post('/leaves/rosters', roster);
    },
    updateRoster: async (roster: FixedRoster) => {
        if (USE_MOCK_ADAPTER) {
          await delay(MOCK_DELAY);
          return roster;
        }
        return client.put(`/leaves/rosters/${roster.id}`, roster);
    },
    deleteRoster: async (id: string) => {
        if (USE_MOCK_ADAPTER) {
          await delay(MOCK_DELAY);
          return { message: 'ok' };
        }
        return client.delete(`/leaves/rosters/${id}`);
    },
    getPlanningRosters: async (params?: { year?: number; month?: number }) => {
        if (USE_MOCK_ADAPTER) {
          await delay(MOCK_DELAY);
          const { normalizePlanningRosterList } = await import('../utils/planningRoster');
          let list = normalizePlanningRosterList(
            DB.getItem<MonthlyFixedRoster[]>('planningRosters', [])
          );
          if (params?.year != null) list = list.filter((r) => r.year === params.year);
          if (params?.month != null) list = list.filter((r) => r.month === params.month);
          return list;
        }
        const q = new URLSearchParams();
        if (params?.year != null) q.set('year', String(params.year));
        if (params?.month != null) q.set('month', String(params.month));
        const qs = q.toString();
        return client.get(`/leaves/planning-rosters${qs ? `?${qs}` : ''}`);
    },
    createPlanningRoster: async (body: {
      month: number;
      year: number;
      name: string;
      entries: Array<{ employeeId: string; day: number; leaveType: string; isLocked?: boolean }>;
    }) => {
        if (USE_MOCK_ADAPTER) {
          await delay(MOCK_DELAY);
          const now = new Date().toISOString();
          const row: MonthlyFixedRoster = {
            id: `mpr-${Date.now()}`,
            month: body.month,
            year: body.year,
            name: body.name,
            entries: body.entries ?? [],
            createdAt: now,
            updatedAt: now,
          };
          const list = DB.getItem<MonthlyFixedRoster[]>('planningRosters', []);
          DB.setItem('planningRosters', [row, ...list]);
          return row;
        }
        return client.post('/leaves/planning-rosters', body);
    },
    updatePlanningRoster: async (
      id: string,
      body: Partial<{
        month: number;
        year: number;
        name: string;
        entries: Array<{ employeeId: string; day: number; leaveType: string; isLocked?: boolean }>;
      }>
    ) => {
        if (USE_MOCK_ADAPTER) {
          await delay(MOCK_DELAY);
          const list = DB.getItem<MonthlyFixedRoster[]>('planningRosters', []);
          const idx = list.findIndex((r) => r.id === id);
          if (idx < 0) return null;
          const updated: MonthlyFixedRoster = {
            ...list[idx],
            ...body,
            entries: body.entries ?? list[idx].entries,
            updatedAt: new Date().toISOString(),
          };
          list[idx] = updated;
          DB.setItem('planningRosters', list);
          return updated;
        }
        return client.put(`/leaves/planning-rosters/${id}`, body);
    },
    deletePlanningRoster: async (id: string) => {
        if (USE_MOCK_ADAPTER) {
          await delay(MOCK_DELAY);
          const list = DB.getItem<MonthlyFixedRoster[]>('planningRosters', []);
          DB.setItem(
            'planningRosters',
            list.filter((r) => r.id !== id)
          );
          return { message: 'ok' };
        }
        return client.delete(`/leaves/planning-rosters/${id}`);
    },
    getPlanningRosterOffDays: async (params: {
      userId?: string;
      employeeId?: string;
      month: string;
    }) => {
        if (USE_MOCK_ADAPTER) {
          await delay(MOCK_DELAY);
          return { month: params.month, offDates: [] as string[] };
        }
        const q = new URLSearchParams();
        if (params.userId) q.set('userId', params.userId);
        if (params.employeeId) q.set('employeeId', params.employeeId);
        q.set('month', params.month.slice(0, 7));
        return client.get<{ month: string; offDates: string[] }>(
          `/leaves/planning-rosters/off-days?${q.toString()}`
        );
    },
  },

  overtime: {
    getConfig: async () => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        const { defaultOvertimeRequestConfig } = await import('../utils/overtimeConfig');
        return defaultOvertimeRequestConfig();
      }
      return client.get('/overtime/config');
    },
    saveConfig: async (config: OvertimeRequestConfig) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        return config;
      }
      return client.put('/overtime/config', config);
    },
    getTypes: async (opts?: { includeInactive?: boolean }) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        const { defaultOvertimeRequestConfig } = await import('../utils/overtimeConfig');
        const all = defaultOvertimeRequestConfig().types;
        return opts?.includeInactive ? all : all.filter((t) => t.isActive);
      }
      const q = opts?.includeInactive ? '?includeInactive=true' : '';
      return client.get(`/overtime/types${q}`) as Promise<OvertimeType[]>;
    },
    createType: async (type: {
      name: string;
      description?: string;
      rateTier: OvertimeRateTier;
      isActive: boolean;
      rules: OvertimeType['rules'];
    }) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        return { ...type, id: `ot-type-${Date.now()}` } as OvertimeType;
      }
      return client.post('/overtime/types', type);
    },
    updateType: async (
      id: string,
      type: {
        name: string;
        description?: string;
        rateTier: OvertimeRateTier;
        isActive: boolean;
        rules: OvertimeType['rules'];
      }
    ) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        return { ...type, id } as OvertimeType;
      }
      return client.put(`/overtime/types/${id}`, type);
    },
    deleteType: async (id: string, opts?: { effectiveFrom?: string }) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        return { message: 'ok' };
      }
      const effectiveFrom = String(opts?.effectiveFrom ?? '').trim().slice(0, 10);
      const q = effectiveFrom ? `?effectiveFrom=${encodeURIComponent(effectiveFrom)}` : '';
      return client.delete(`/overtime/types/${encodeURIComponent(id)}${q}`);
    },
    updateSettings: async (body: { globalMaxHoursPerMonth: number }) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        return body;
      }
      return client.put('/overtime/settings', body);
    },
    getAll: async () => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        return [...DB.overtimeRequests];
      }
      return client.get('/overtime');
    },
    create: async (body: {
      userId: string;
      workDate: string;
      hours: number;
      rateTier: OvertimeRateTier;
      reason: string;
      otTypeId: string;
      startTime?: string;
      endTime?: string;
      clockIn?: string;
      clockOut?: string;
      assignedApproverUserIds?: string[];
    }) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        const row = {
          id: `ot-${Date.now()}`,
          ...body,
          status: 'PENDING' as const,
          appliedOn: new Date().toISOString().slice(0, 10),
        };
        const requester = DB.users.find((u) => u.id === body.userId);
        mockNotifyRoles(DB, DB.users, [Role.ADMIN, Role.HR, Role.MANAGER], {
          id: `ot-pending-${row.id}`,
          title: 'Overtime request pending',
          message: `${requester?.name || 'Employee'} submitted ${body.hours}h OT for ${body.workDate}.`,
          type: NotificationType.INFO,
          link: '/overtime',
        });
        DB.overtimeRequests = [row as OvertimeRequest, ...DB.overtimeRequests];
        return row;
      }
      return client.post('/overtime', body);
    },
    update: async (
      id: string,
      body: {
        workDate: string;
        hours: number;
        rateTier: OvertimeRateTier;
        reason: string;
        otTypeId: string;
        startTime?: string;
        endTime?: string;
        clockIn?: string;
        clockOut?: string;
        assignedApproverUserIds?: string[];
      }
    ) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        return { id, ...body, status: 'PENDING' as const };
      }
      return client.put(`/overtime/${id}`, body);
    },
    cancel: async (id: string) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        const list = [...DB.overtimeRequests];
        const idx = list.findIndex((r) => r.id === id);
        if (idx < 0) throw new Error('Overtime request not found');
        const status = String(list[idx].status).toUpperCase();
        if (status !== 'PENDING' && status !== 'RETURNED') {
          throw new Error('Only pending or returned requests can be cancelled.');
        }
        list[idx] = { ...list[idx], status: 'CANCELLED' };
        DB.overtimeRequests = list;
        return list[idx];
      }
      return client.post(`/overtime/${id}/cancel`, {});
    },
    updateStatus: async (
      id: string,
      status: 'APPROVED' | 'REJECTED' | 'PENDING' | 'RETURNED',
      rejectionReason?: string
    ) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        const list = [...DB.overtimeRequests];
        const idx = list.findIndex((r) => r.id === id);
        if (idx >= 0) {
          list[idx] = {
            ...list[idx],
            status,
            ...(rejectionReason != null ? { rejectionReason } : {}),
          };
          DB.overtimeRequests = list;
          if (status === 'APPROVED' || status === 'REJECTED' || status === 'RETURNED') {
            mockPushNotification(DB, {
              id: `ot-status-${id}`,
              userId: list[idx].userId,
              title:
                status === 'APPROVED'
                  ? 'Overtime approved'
                  : status === 'RETURNED'
                    ? 'Overtime returned'
                    : 'Overtime declined',
              message:
                status === 'APPROVED'
                  ? 'Your overtime request was approved.'
                  : status === 'RETURNED'
                    ? 'Your overtime request was returned for revision.'
                    : 'Your overtime request was declined.',
              type: status === 'APPROVED' ? NotificationType.SUCCESS : NotificationType.WARNING,
              link: '/overtime',
            });
          }
        }
        return { id, status };
      }
      return client.put(`/overtime/${id}/status`, { status, rejectionReason });
    },
    getApprovedHours: async (userId: string, month: string) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        return { userId, month, hours150: 0, hours200: 0 };
      }
      const q = new URLSearchParams({ userId, month: month.slice(0, 7) });
      return client.get<{ userId: string; month: string; hours150: number; hours200: number }>(
        `/overtime/approved-hours?${q.toString()}`
      );
    },
  },

  menu: {
      getMyMenu: async () => client.get('/menu/me'),
  },

  system: {
      getPermissions: async () => {
          if(USE_MOCK_ADAPTER) { await delay(MOCK_DELAY); return [...MOCK_PERMISSIONS]; }
          return client.get('/permissions', { noCache: true });
      },
      syncPermissions: async (options?: {
          reapplyDefaults?: boolean;
          backfillProjects?: boolean;
      }) => {
          if (USE_MOCK_ADAPTER) {
              await delay(MOCK_DELAY);
              return { permissions: [...MOCK_PERMISSIONS], matrix: {}, sync: { added: 0, roleLinks: 0 } };
          }
          const qs = new URLSearchParams();
          if (options?.reapplyDefaults !== false) qs.set('reapplyDefaults', '1');
          if (options?.backfillProjects === false) qs.set('backfillProjects', '0');
          const q = qs.toString() ? `?${qs.toString()}` : '';
          return client.post(
              `/permissions/sync${q}`,
              {
                  reapplyDefaults: options?.reapplyDefaults !== false,
                  backfillProjects: options?.backfillProjects !== false,
              },
              { noCache: true }
          );
      },
      updatePermissions: async (permissions: FeaturePermission[]) => {
          if(USE_MOCK_ADAPTER) { await delay(MOCK_DELAY); return permissions; }
          return permissions;
      },
      updateRolePermissions: async (roleName: string, permissions: Record<string, string[]>) => {
          return client.put(`/permissions/roles/${roleName}`, { permissions });
      },
      getUserPermissions: async (userId: string) => {
          return client.get(`/users/${userId}/permissions`);
      },
      getAllUserOverrides: async () => {
          if (USE_MOCK_ADAPTER) {
              await delay(MOCK_DELAY);
              return [];
          }
          return client.get('/permissions/user-overrides', { noCache: true });
      },
      getPendingPermissionRequests: async () => {
          if (USE_MOCK_ADAPTER) {
              await delay(MOCK_DELAY);
              return [];
          }
          return client.get('/permissions/requests/pending');
      },
      getAuditLogs: async (params?: {
          entityType?: string;
          performedBy?: string;
          startDate?: string;
          endDate?: string;
          limit?: number;
      }) => {
          if (USE_MOCK_ADAPTER) {
              await delay(MOCK_DELAY);
              return [];
          }
          const q = new URLSearchParams();
          if (params?.entityType) q.set('entityType', params.entityType);
          if (params?.performedBy) q.set('performedBy', params.performedBy);
          if (params?.startDate) q.set('startDate', params.startDate);
          if (params?.endDate) q.set('endDate', params.endDate);
          if (typeof params?.limit === 'number') q.set('limit', String(params.limit));
          const query = q.toString();
          return client.get(`/audit/all${query ? `?${query}` : ''}`);
      },
      getAuditComplianceReport: async (startDate: string, endDate: string) => {
          if (USE_MOCK_ADAPTER) {
              await delay(MOCK_DELAY);
              return { logs: [], summary: null };
          }
          const q = new URLSearchParams({ startDate, endDate });
          return client.get(`/audit/compliance-report?${q.toString()}`);
      },
      getAuditLoginBehavior: async (params?: {
          userId?: string;
          action?: string;
          startDate?: string;
          endDate?: string;
          limit?: number;
      }) => {
          if (USE_MOCK_ADAPTER) {
              await delay(MOCK_DELAY);
              return [];
          }
          const q = new URLSearchParams();
          if (params?.userId) q.set('userId', params.userId);
          if (params?.action) q.set('action', params.action);
          if (params?.startDate) q.set('startDate', params.startDate);
          if (params?.endDate) q.set('endDate', params.endDate);
          if (typeof params?.limit === 'number') q.set('limit', String(params.limit));
          const query = q.toString();
          return client.get(`/audit/login-behavior${query ? `?${query}` : ''}`);
      },
      getAuditTrail: async (params?: {
          entityType?: string;
          entityId?: string;
          action?: string;
          performedBy?: string;
          startDate?: string;
          endDate?: string;
          limit?: number;
      }) => {
          if (USE_MOCK_ADAPTER) {
              await delay(MOCK_DELAY);
              return [];
          }
          const q = new URLSearchParams();
          if (params?.entityType) q.set('entityType', params.entityType);
          if (params?.entityId) q.set('entityId', params.entityId);
          if (params?.action) q.set('action', params.action);
          if (params?.performedBy) q.set('performedBy', params.performedBy);
          if (params?.startDate) q.set('startDate', params.startDate);
          if (params?.endDate) q.set('endDate', params.endDate);
          if (typeof params?.limit === 'number') q.set('limit', String(params.limit));
          const query = q.toString();
          return client.get(`/audit/trail${query ? `?${query}` : ''}`);
      },
      getUserOverrides: async (userId: string) => {
          return client.get(`/users/${userId}/overrides`);
      },
      createUserOverride: async (userId: string, data: { permissionId: string; overrideType: 'GRANT' | 'REVOKE'; reason: string; expiresAt?: string }) => {
          return client.post(`/users/${userId}/overrides`, data);
      },
      deleteUserOverride: async (userId: string, overrideId: string) => {
          return client.delete(`/users/${userId}/overrides/${overrideId}`);
      },
      getGlobalSettings: async () => {
          return client.get('/settings/global');
      },
      updateGlobalSetting: async (key: string, value: any, description?: string) => {
          return client.put('/settings/global', { key, value, description });
      },
      getCompanySettings: async () =>
          client.get('/settings/company') as Promise<{ settings: Record<string, unknown> }>,
      updateCompanySettings: async (payload: {
        key?: string;
        value?: unknown;
        settings?: Record<string, unknown>;
      }) => {
          const res = await client.put('/settings/company', payload);
          const tz =
            payload.key === 'company.timezone'
              ? payload.value
              : payload.settings?.['company.timezone'];
          if (tz != null) {
            const { setCompanyTimezone } = await import('../utils/companyCalendar');
            setCompanyTimezone(tz);
          }
          return res;
      },
      uploadBrandingAsset: async (
          file: File,
          kind: 'logo' | 'front_cover'
      ): Promise<{ url: string; filename: string; size: number; mime: string }> => {
          const fd = new FormData();
          fd.append('file', file);
          fd.append('kind', kind);
          return client.post('/settings/company/branding-asset', fd);
      },
      getSecurityPolicySettings: async () =>
          client.get('/settings/security-policy') as Promise<{ settings: Record<string, unknown> }>,
      updateSecurityPolicySettings: async (payload: { key?: string; value?: unknown; settings?: Record<string, unknown> }) =>
          client.put('/settings/security-policy', payload),
      getDefaultPassword: async () =>
          client.get('/settings/default-password') as Promise<{
              enabled?: boolean;
              isSet?: boolean;
              source?: 'settings' | 'env' | 'fallback';
              password?: string;
          }>,
      saveDefaultPassword: async (payload: {
          enabled?: boolean;
          password?: string;
          confirmPassword?: string;
      }) => client.put('/settings/default-password', payload),
      getOtpEmail: async () => client.get('/settings/otp-email'),
      getOtpEmailAppsScript: async (secret?: string) => {
          const q = secret ? `?secret=${encodeURIComponent(secret)}` : '';
          const res = (await client.get(`/settings/otp-email/apps-script${q}`)) as { source?: string };
          return String(res?.source || '');
      },
      saveOtpEmail: async (payload: {
          appsScriptUrl?: string;
          appsScriptSecret?: string;
          appPassword?: string;
          user?: string;
          from?: string;
      }) => client.post('/settings/otp-email', payload),
      testOtpEmail: async (to?: string) =>
          client.post('/settings/otp-email/test', to ? { to } : {}),
      getPositionLevels: async () => client.get('/settings/position-levels') as Promise<{ levels: PositionLevelRecord[] }>,
      savePositionLevels: async (levels: PositionLevelRecord[]) =>
          client.put('/settings/position-levels', { levels }) as Promise<{ success: boolean; levels: PositionLevelRecord[] }>,
      getBackups: async () => client.get('/settings/backup'),
      createBackup: async (payload?: { effectiveFrom?: string }) =>
          client.post('/settings/backup', payload ?? {}),
      saveBackupSettings: async (settings: {
          autoBackupEnabled?: boolean;
          retentionDays?: number;
          autoBackupHour?: number;
          frequency?: 'daily' | 'weekly' | 'monthly';
          weeklyDays?: number[];
          monthlyDay?: number;
          notifyOnFailure?: boolean;
          storageDestination?: 'local';
          departmentId?: string | null;
      }) => client.put('/settings/backup/settings', settings),
      downloadBackup: async (id: string) => client.getBlob(`/settings/backup/${encodeURIComponent(id)}/download`),
      deleteBackup: async (id: string) => client.delete(`/settings/backup/${encodeURIComponent(id)}`),
      restoreBackup: async (id: string) => {
          beginBackupRestoreSessionGuard();
          try {
              const started = (await client.post(
                  `/settings/backup/${encodeURIComponent(id)}/restore`,
                  { confirm: true },
                  { retries: 0, timeoutMs: 120_000 }
              )) as {
                  accepted?: boolean;
                  jobId?: string;
                  pollToken?: string;
                  success?: boolean;
                  safetyBackupFileName?: string;
                  statementsExecuted?: number;
              };
              // Must await: returning the Promise alone runs finally immediately and
              // drops the session guard while the DB wipe is still in progress.
              if (started?.jobId && started?.pollToken) {
                  return await pollBackupRestoreJob(started.jobId, started.pollToken);
              }
              if (started?.jobId) {
                  throw new Error('Restore started but poll token was missing. Refresh and try again.');
              }
              return started;
          } finally {
              endBackupRestoreSessionGuard();
          }
      },
      restoreBackupUpload: async (file: File) => {
          beginBackupRestoreSessionGuard();
          try {
              // Wake free-tier backend before a long upload (cold start otherwise kills chunk 0).
              await waitForBackendReady({ maxWaitMs: 90_000 });

              // JSON/base64 chunks — multipart FormData triggers Render HTTP/2 RST
              // (net::ERR_HTTP2_PROTOCOL_ERROR) even at 2MB.
              const CHUNK_SIZE = 256 * 1024;
              const totalBytes = file.size;
              const totalChunks = Math.max(1, Math.ceil(totalBytes / CHUNK_SIZE));
              const session = (await client.post(
                  '/settings/backup/restore-upload/session',
                  {
                      confirm: true,
                      fileName: file.name,
                      totalChunks,
                      totalBytes,
                  },
                  { retries: 2, timeoutMs: 90_000 }
              )) as {
                  uploadId?: string;
                  uploadToken?: string;
                  chunkSizeHint?: number;
              };
              const uploadId = session?.uploadId;
              const uploadToken = session?.uploadToken;
              if (!uploadId || !uploadToken) {
                  throw new Error('Could not start backup upload. Refresh and try again.');
              }

              const blobToBase64 = async (blob: Blob): Promise<string> => {
                  const buf = await blob.arrayBuffer();
                  const bytes = new Uint8Array(buf);
                  let binary = '';
                  const step = 0x8000;
                  for (let i = 0; i < bytes.length; i += step) {
                      binary += String.fromCharCode(...bytes.subarray(i, i + step));
                  }
                  return btoa(binary);
              };

              for (let i = 0; i < totalChunks; i += 1) {
                  const blob = file.slice(i * CHUNK_SIZE, Math.min(totalBytes, (i + 1) * CHUNK_SIZE));
                  const chunkBase64 = await blobToBase64(blob);
                  let lastErr: unknown;
                  for (let attempt = 0; attempt < 6; attempt += 1) {
                      try {
                          await client.post(
                              `/settings/backup/restore-upload/session/${encodeURIComponent(uploadId)}/chunk/${i}`,
                              { uploadToken, chunkBase64 },
                              {
                                  retries: 0,
                                  timeoutMs: 90_000,
                              }
                          );
                          lastErr = undefined;
                          break;
                      } catch (err) {
                          lastErr = err;
                          const status = (err as { status?: number })?.status;
                          if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
                              throw err;
                          }
                          if (attempt === 2 || attempt === 4) {
                              await waitForBackendReady({ maxWaitMs: 60_000 }).catch(() => false);
                          }
                          await new Promise((r) => setTimeout(r, Math.min(8_000, 700 * 2 ** attempt)));
                      }
                  }
                  if (lastErr) throw lastErr;
              }

              const started = (await client.post(
                  `/settings/backup/restore-upload/session/${encodeURIComponent(uploadId)}/complete`,
                  { confirm: true, uploadToken },
                  { retries: 1, timeoutMs: 120_000 }
              )) as {
                  accepted?: boolean;
                  jobId?: string;
                  pollToken?: string;
                  success?: boolean;
                  safetyBackupFileName?: string;
                  statementsExecuted?: number;
              };
              if (started?.jobId && started?.pollToken) {
                  return await pollBackupRestoreJob(started.jobId, started.pollToken);
              }
              if (started?.jobId) {
                  throw new Error('Restore started but poll token was missing. Refresh and try again.');
              }
              return started;
          } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              if (/failed to fetch|network|http2|ERR_HTTP2|aborted/i.test(msg)) {
                  throw new Error(
                      'Backup upload was interrupted. Wait for the API to wake, then try again with the repaired .sql file.'
                  );
              }
              throw err;
          } finally {
              endBackupRestoreSessionGuard();
          }
      },
      getBackupRestoreStatus: async (jobId: string, pollToken?: string) => {
          const qs = pollToken ? `?token=${encodeURIComponent(pollToken)}` : '';
          return client.get(`/settings/backup/restore-status/${encodeURIComponent(jobId)}${qs}`, {
              noCache: true,
              timeoutMs: 60_000,
              skipSessionRedirect: true,
              omitAuth: Boolean(pollToken),
          }) as Promise<{
              jobId: string;
              status: 'queued' | 'running' | 'success' | 'failed';
              error?: string | null;
              result?: { statementsExecuted?: number; safetyBackupFileName?: string } | null;
              success?: boolean;
          }>;
      },
  },

  catalog: {
    getPositionLevels: async () => client.get('/catalog/position-levels') as Promise<{ levels: PositionLevelRecord[] }>,
  },

  projects: {
    getAll: async (params?: { scope?: 'self'; deleted?: 'exclude' | 'only' | 'include' }) => {
        if (USE_MOCK_ADAPTER) { await delay(MOCK_DELAY); return [...DB.projects]; }
        const q = new URLSearchParams();
        if (params?.scope === 'self') q.set('scope', 'self');
        if (params?.deleted && params.deleted !== 'exclude') q.set('deleted', params.deleted);
        const qs = q.toString();
        return client.get(`/projects${qs ? `?${qs}` : ''}`);
    },
    getById: async (id: string, params?: { scope?: 'self'; deleted?: 'exclude' | 'only' | 'include' }) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return DB.projects.find((p) => p.id === id);
        }
        const q = new URLSearchParams();
        if (params?.scope === 'self') q.set('scope', 'self');
        if (params?.deleted && params.deleted !== 'exclude') q.set('deleted', params.deleted);
        const qs = q.toString();
        return client.get(`/projects/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`);
    },
    create: async (project: Omit<Project, 'id'>) => {
        if (USE_MOCK_ADAPTER) { 
            await delay(MOCK_DELAY); 
            const max = DB.projects.reduce((n, p) => {
                const m = String(p.id ?? '').match(/^P(\d{4,})$/i);
                return Math.max(n, m ? Number(m[1]) : 0);
            }, 0);
            const newProj = { ...project, id: `P${String(max + 1).padStart(4, '0')}` } as Project;
            DB.projects = [newProj, ...DB.projects];
            return newProj; 
        }
        return client.post('/projects', project);
    },
    update: async (project: Project) => {
        if (USE_MOCK_ADAPTER) { 
            await delay(MOCK_DELAY); 
            const current = DB.projects;
            const idx = current.findIndex(p => p.id === project.id);
            if (idx !== -1) {
                current[idx] = project;
                DB.projects = current;
            }
            return project; 
        }
        return client.put(`/projects/${project.id}`, project);
    },
    delete: async (id: string) => {
        if (USE_MOCK_ADAPTER) { 
            await delay(MOCK_DELAY); 
            const current = DB.projects;
            DB.projects = current.filter(p => p.id !== id);
            return true; 
        }
        return client.delete(`/projects/${id}`);
    },
    getTaskActivity: async (projectId: string, params?: { limit?: number; scope?: 'self' }) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return [];
        }
        const qs = new URLSearchParams();
        if (params?.limit) qs.set('limit', String(params.limit));
        if (params?.scope === 'self') qs.set('scope', 'self');
        const q = qs.toString() ? `?${qs.toString()}` : '';
        return client.get(`/projects/${encodeURIComponent(projectId)}/task-activity${q}`);
    },
  },

  tasks: {
    getAll: async (params?: { deleted?: 'exclude' | 'only' | 'include' }) => {
        if (USE_MOCK_ADAPTER) { await delay(MOCK_DELAY); return [...DB.tasks]; }
        const q =
          params?.deleted && params.deleted !== 'exclude'
            ? `?deleted=${encodeURIComponent(params.deleted)}`
            : '';
        return client.get(`/tasks${q}`);
    },
    create: async (task: any) => {
        if (USE_MOCK_ADAPTER) { 
            await delay(MOCK_DELAY); 
            const max = DB.tasks.reduce((n, t) => {
                const m = String(t.id ?? '').match(/^T(\d{1,6})$/i);
                return Math.max(n, m ? Number(m[1]) : 0);
            }, 0);
            const newTask = { ...task, id: `T${max + 1}`, createdAt: new Date().toISOString() };
            DB.tasks = [newTask, ...DB.tasks];
            return newTask; 
        }
        return client.post('/tasks', task);
    },
    update: async (task: Task) => {
        if (USE_MOCK_ADAPTER) { 
            await delay(MOCK_DELAY); 
            const current = DB.tasks;
            const idx = current.findIndex(t => t.id === task.id);
            if(idx !== -1) {
                current[idx] = task;
                DB.tasks = current;
            }
            return task; 
        }
        return client.put(`/tasks/${task.id}`, task);
    },
    delete: async (id: string) => {
        if (USE_MOCK_ADAPTER) { 
            await delay(MOCK_DELAY); 
            const current = DB.tasks;
            DB.tasks = current.filter(t => t.id !== id);
            return true; 
        }
        return client.delete(`/tasks/${id}`);
    }
  },

  payroll: {
    getRuns: async (): Promise<PayrollRun[]> => {
        if (USE_MOCK_ADAPTER) { await delay(MOCK_DELAY); return [...DB.payrollRuns]; }
        return client.get('/payroll/runs');
    },
    getWorkDayPolicy: async (): Promise<{
        method: string;
        companyBasisDays: number;
        prorationMethod?: string;
        effectiveFrom?: string | null;
        scheduledEffectiveFrom?: string | null;
        lastUpdatedAt?: string | null;
        lastUpdatedBy?: string | null;
    }> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return { method: 'fixed_employee_basis', companyBasisDays: 26, effectiveFrom: null, scheduledEffectiveFrom: null };
        }
        return client.get('/payroll/work-day-policy');
    },
    updateWorkDayPolicy: async (body: {
        method: string;
        companyBasisDays: number;
        effectiveFrom: string;
    }) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return { ...body, effectiveFrom: body.effectiveFrom };
        }
        return client.put('/payroll/work-day-policy', body);
    },
    getPreview: async (params: {
        year: number;
        month: number;
        /** When false (default), estimate only — no attendance-driven deductions. */
        includeAttendance?: boolean;
    }): Promise<{
        month: string;
        items: Payslip[];
        totalEmployees: number;
        totalGross: number;
        totalNetPay: number;
        eligibleEmployees?: number;
        failedEmployees?: number;
        generatedAt?: string;
        calculationEngine?: string;
        prorationMethod?: string;
        engineRulesSummary?: string;
        attendancePeriodStatus?: string;
        attendanceFinalized?: boolean;
        includeAttendance?: boolean;
        period?: {
            payPeriodStart: string;
            payPeriodEnd: string;
            attendanceCutoffDate: string | null;
        };
        globalWarnings?: Array<{ code: string; message: string }>;
        errors?: Array<{ userId: string; employeeId: string; message: string }>;
        anomalyEngine?: string;
        anomalySummary?: import('../types').PayrollAnomalySummary;
        disclaimer?: string;
    }> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const monthStr = `${params.year}-${String(params.month).padStart(2, '0')}`;
            const empRes = await Api.employees.getAll({
              page: 1,
              limit: 500,
              assigned_id_only: '1',
              include_compensation: '1',
            }).catch(() => ({
              employees: [] as Array<{
                employee_id?: string;
                email?: string;
                status?: string;
              }>,
            }));
            const employeeRows = Array.isArray(empRes)
              ? empRes
              : (empRes as { employees?: typeof empRes }).employees ?? [];
            const users = DB.users.filter((u) => {
              if (isPortalUserExcludedFromPayroll(u.role)) return false;
              const empRow = employeeRows.find(
                (e) =>
                  e.employee_id === u.id ||
                  (e.email &&
                    u.email &&
                    e.email.toLowerCase() === u.email.toLowerCase())
              );
              if (!empRow) return false;
              return isEmployeeStatusPayrollEligible(empRow.status);
            });
            const items = users.map((u) => {
                const attendance = DB.attendance.filter(
                    (a) => a.userId === u.id && a.date.startsWith(monthStr)
                );
                const breakdown = calculatePayrollForUser(
                    { ...u, salary: u.salary ?? 0 },
                    { attendanceRecords: attendance, monthPrefix: monthStr }
                );
                return {
                    id: `preview-${u.id}`,
                    userId: u.id,
                    employeeId: u.id,
                    month: monthStr,
                    status: 'active',
                    breakdown,
                } as unknown as Payslip;
            });
            const totalGross = items.reduce((s, i) => s + (i.breakdown?.grossSalary ?? 0), 0);
            const totalNetPay = items.reduce((s, i) => s + (i.breakdown?.netSalary ?? 0), 0);
            return {
                month: monthStr,
                items: items.map((p) => normalizePayslip(p, { monthPrefix: monthStr })),
                totalEmployees: items.length,
                totalGross,
                totalNetPay,
            };
        }
        return client.get(
            `/payroll/preview?year=${params.year}&month=${params.month}&includeAttendance=${params.includeAttendance === true ? 'true' : 'false'}`
        );
    },
    getRun: async (runId: string): Promise<PayrollRun> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const run = DB.payrollRuns.find((r) => r.id === runId);
            if (!run) throw new Error('Payroll run not found');
            const slips = DB.payslips.filter((p) => p.payrollRunId === runId);
            const totalGross = slips.reduce(
                (acc, s) => acc + (s.breakdown?.grossSalary ?? 0),
                0
            );
            return { ...run, totalGross };
        }
        return client.get(`/payroll/runs/${runId}`);
    },
    getRunDetails: async (runId: string): Promise<PayrollRun> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const run = DB.payrollRuns.find((r) => r.id === runId);
            if (!run) throw new Error('Payroll run not found');
            const slips = DB.payslips.filter((p) => p.payrollRunId === runId);
            const totalGross = slips.reduce(
                (acc, s) => acc + (s.breakdown?.grossSalary ?? 0),
                0
            );
            return { ...run, totalGross };
        }
        return client.get(`/payroll/runs/${runId}/details`);
    },
    getRunItems: async (runId: string): Promise<Payslip[]> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const run = DB.payrollRuns.find((r) => r.id === runId);
            const monthPrefix = String(run?.month ?? '').slice(0, 7);
            const complianceRules = DB.getItem<PayrollComplianceRule[]>(
                'payrollComplianceRules',
                MOCK_PAYROLL_COMPLIANCE_RULES
            );
            const compliance = complianceRulesToEngineConfig(complianceRules);
            const nssfBrackets = DB.getItem<PayrollNssfWageBracket[]>(
                'payrollNssfWageBrackets',
                MOCK_PAYROLL_NSSF_WAGE_BRACKETS
            );
            const taxBrackets = DB.getItem<PayrollTaxBracket[]>(
                'payrollTaxBrackets',
                MOCK_PAYROLL_TAX_BRACKETS
            );
            return DB.payslips
                .filter((p) => p.payrollRunId === runId)
                .map((p) => {
                    const user = DB.users.find((u) => u.id === p.userId);
                    if (!user) {
                      return normalizePayslip(p as Payslip, { monthPrefix });
                    }
                    const attendance = DB.attendance.filter(
                        (a) => a.userId === p.userId && a.date.startsWith(monthPrefix)
                    );
                    let hours150 = 0;
                    let hours200 = 0;
                    for (const ot of DB.overtimeRequests) {
                      if (ot.userId !== p.userId || ot.status !== 'APPROVED') continue;
                      if (!String(ot.workDate).startsWith(monthPrefix)) continue;
                      if (ot.rateTier === 'regular_100') {
                        /* 100% OT paid in live API; mock keeps 150/200 buckets only */
                      } else if (ot.rateTier === 'daytime_150') hours150 += Number(ot.hours) || 0;
                      else hours200 += Number(ot.hours) || 0;
                    }
                    const unpaidLeaveDays = countUnpaidLeaveDaysForMonth(
                      DB.leaves,
                      p.userId,
                      monthPrefix
                    );
                    const breakdown = calculatePayrollForUser(
                      { ...user, salary: user.salary ?? 0 },
                      {
                        attendanceRecords: attendance,
                        monthPrefix,
                        compliance,
                        nssfBrackets,
                        taxBrackets,
                        approvedOvertime: { hours150, hours200 },
                        unpaidLeaveDays,
                      }
                    );
                    DB.setPayslipBreakdown(p.id, breakdown);
                    return normalizePayslip({ ...p, breakdown } as Payslip, {
                      user,
                      monthPrefix,
                    });
                });
        }
        return client.get(`/payroll/runs/${runId}/items`);
    },
    getSchedules: async (): Promise<PayrollSchedule> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return { ...MOCK_PAYROLL_SCHEDULE };
        }
        return client.get('/payroll/schedule');
    },
    getHolidays: async (year: number) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return getCambodiaPublicHolidays(year);
        }
        return client.get(`/payroll/holidays?year=${year}`);
    },
    createAttendanceAmendment: async (body: {
        userId: string;
        workDate: string;
        description: string;
        proposedChanges: Record<string, unknown>;
        originalValues?: Record<string, unknown>;
        amountUsd?: number;
        payrollGroupId?: string;
    }) => client.post('/payroll/attendance-amendments', body),
    getCalendar: async (year: number): Promise<PayrollCalendarYear> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const key = `payrollCalendar_${year}`;
            const stored = DB.getItem<PayrollCalendarYear | null>(key, null);
            if (stored) return stored;
            const runDay = MOCK_PAYROLL_SCHEDULE.runDayOfMonth ?? 28;
            const runDates: string[] = [];
            for (let m = 0; m < 12; m++) {
                const last = new Date(year, m + 1, 0).getDate();
                const d = Math.min(runDay, last);
                runDates.push(
                    `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
                );
            }
            return {
                year,
                runDates,
                otDayTiers: {},
                defaultRunDayOfMonth: runDay,
                employerOtNote:
                    'Companies generally need approval from the Ministry of Labour for OT arrangements. Some newer regulations require advance submission through the labour management system (LACMS).',
                otRates: { daytimeMultiplier: 1.5, premiumMultiplier: 2 },
            };
        }
        return client.get(`/payroll/calendar?year=${year}`);
    },
    saveCalendar: async (payload: PayrollCalendarYear): Promise<PayrollCalendarYear> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            DB.setItem(`payrollCalendar_${payload.year}`, payload);
            return payload;
        }
        return client.put('/payroll/calendar', payload);
    },
    getTaxBracketPolicy: async (): Promise<import('../types').PayrollTaxBracketPolicy> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const brackets = DB.getItem<PayrollTaxBracket[]>('payrollTaxBrackets', MOCK_PAYROLL_TAX_BRACKETS);
            return { brackets, effectiveFrom: null, scheduledEffectiveFrom: null };
        }
        const raw = await client.get<
            import('../types').PayrollTaxBracketPolicy | PayrollTaxBracket[]
        >('/payroll/tax-brackets');
        if (Array.isArray(raw)) {
            return { brackets: normalizeTaxBracketRows(raw), effectiveFrom: null, scheduledEffectiveFrom: null };
        }
        return {
            brackets: normalizeTaxBracketRows(raw.brackets ?? []),
            effectiveFrom: raw.effectiveFrom ?? null,
            scheduledEffectiveFrom: raw.scheduledEffectiveFrom ?? null,
            lastUpdatedAt: raw.lastUpdatedAt ?? null,
            lastUpdatedBy: raw.lastUpdatedBy ?? null,
        };
    },
    getTaxBrackets: async (): Promise<PayrollTaxBracket[]> => {
        const policy = await Api.payroll.getTaxBracketPolicy();
        return policy.brackets;
    },
    saveTaxBrackets: async (brackets: PayrollTaxBracket[], effectiveFrom: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            DB.setItem('payrollTaxBrackets', brackets);
            return { success: true, brackets, effectiveFrom };
        }
        return client.put('/payroll/tax-brackets', { brackets, effectiveFrom });
    },
    getNssfWagePolicy: async (): Promise<import('../types').PayrollNssfWagePolicy> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const brackets = DB.getItem<PayrollNssfWageBracket[]>(
                'payrollNssfWageBrackets',
                MOCK_PAYROLL_NSSF_WAGE_BRACKETS
            );
            return { brackets, effectiveFrom: null, scheduledEffectiveFrom: null };
        }
        const raw = await client.get<
            import('../types').PayrollNssfWagePolicy | PayrollNssfWageBracket[]
        >('/payroll/nssf-assumed-wage-brackets');
        if (Array.isArray(raw)) {
            return { brackets: raw, effectiveFrom: null, scheduledEffectiveFrom: null };
        }
        return {
            brackets: raw.brackets ?? [],
            effectiveFrom: raw.effectiveFrom ?? null,
            scheduledEffectiveFrom: raw.scheduledEffectiveFrom ?? null,
            lastUpdatedAt: raw.lastUpdatedAt ?? null,
            lastUpdatedBy: raw.lastUpdatedBy ?? null,
        };
    },
    getNssfAssumedWageBrackets: async (): Promise<PayrollNssfWageBracket[]> => {
        const policy = await Api.payroll.getNssfWagePolicy();
        return policy.brackets;
    },
    saveNssfAssumedWageBrackets: async (brackets: PayrollNssfWageBracket[], effectiveFrom: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            DB.setItem('payrollNssfWageBrackets', brackets);
            return { success: true, brackets, effectiveFrom };
        }
        return client.put('/payroll/nssf-assumed-wage-brackets', { brackets, effectiveFrom });
    },

    getAllowanceTypes: async () => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return [] as import('../types').AllowanceType[];
        }
        return client.get('/allowances/types');
    },
    saveAllowanceType: async (payload: Partial<import('../types').AllowanceType>) => {
        if (payload.id) return client.put(`/allowances/types/${payload.id}`, payload);
        return client.post('/allowances/types', payload);
    },
    getAllowanceRules: async (allowanceTypeId?: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return [] as import('../types').AllowanceRule[];
        }
        const q = allowanceTypeId ? `?allowance_type_id=${encodeURIComponent(allowanceTypeId)}` : '';
        return client.get(`/allowances/rules${q}`);
    },
    saveAllowanceRule: async (payload: Partial<import('../types').AllowanceRule>) => {
        if (payload.id) return client.put(`/allowances/rules/${payload.id}`, payload);
        return client.post('/allowances/rules', payload);
    },
    deleteAllowanceRule: async (id: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return { success: true };
        }
        return client.delete(`/allowances/rules/${encodeURIComponent(id)}`);
    },
    getAllowanceTemplates: async () => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return [] as import('../types').AllowanceTemplate[];
        }
        return client.get('/allowances/templates');
    },
    saveAllowanceTemplate: async (payload: Partial<import('../types').AllowanceTemplate>) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            throw new Error('Allowance templates require the backend API.');
        }
        if (payload.id) return client.put(`/allowances/templates/${payload.id}`, payload);
        return client.post('/allowances/templates', payload);
    },
    deleteAllowanceTemplate: async (id: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return { success: true };
        }
        return client.delete(`/allowances/templates/${id}`);
    },
    getEmployeeAllowances: async (employeeId: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return [] as import('../types').EmployeeAllowanceAssignment[];
        }
        return client.get(`/employees/${encodeURIComponent(employeeId)}/allowances`);
    },
    saveEmployeeAllowance: async (
        employeeId: string,
        payload: Partial<import('../types').EmployeeAllowanceAssignment>
    ) => {
        return client.post(`/employees/${encodeURIComponent(employeeId)}/allowances`, payload);
    },
    simulatePayrollAllowances: async (params: {
        employeeId: string;
        month: string;
        salesAmount?: number;
        userId?: string;
    }): Promise<import('../types').AllowanceSimulationResult> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            throw new Error('Allowance simulation requires the backend API.');
        }
        return client.post('/payroll/simulate', params);
    },
    getMonthlySales: async (
        month: string
    ): Promise<{
        month: string;
        items: Array<{
            employeeInternalId: string;
            employeeId: string;
            employeeName: string;
            salesAmount: number;
            notes: string | null;
        }>;
    }> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return { month, items: [] };
        }
        return client.get(`/payroll/monthly-sales?month=${encodeURIComponent(month.slice(0, 7))}`);
    },
    upsertMonthlySales: async (payload: {
        month: string;
        items: Array<{ employeeId: string; salesAmount: number; notes?: string | null }>;
    }): Promise<{
        month: string;
        items: Array<{
            employeeInternalId: string;
            employeeId: string;
            employeeName: string;
            salesAmount: number;
            notes: string | null;
        }>;
    }> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return { month: payload.month, items: payload.items.map((it) => ({
                employeeInternalId: it.employeeId,
                employeeId: it.employeeId,
                employeeName: it.employeeId,
                salesAmount: Number(it.salesAmount) || 0,
                notes: it.notes ?? null,
            })) };
        }
        return client.put('/payroll/monthly-sales', payload);
    },
    previewAllowancePackage: async (params: {
        allowanceTemplateId?: string | null;
        baseSalary: number;
        joinDate?: string | null;
        departmentId?: string | null;
        positionId?: string | null;
        accessRole?: string | null;
        employeeId?: string;
        month?: string;
        workHours?: number;
        gracePeriodMinutes?: number;
    }): Promise<{ result: import('../types').AllowanceSimulationResult['result'] }> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            throw new Error('Allowance preview requires the backend API.');
        }
        return client.post('/payroll/allowances/preview', params);
    },
    assignEmployeeAllowancePackage: async (
        employeeId: string,
        allowanceTemplateId: string | null
    ) => {
        return client.put(`/employees/${encodeURIComponent(employeeId)}/allowance-package`, {
            allowanceTemplateId,
        });
    },

    getExchangeRateDetails: async (): Promise<import('../types').PayrollExchangeRateDetails> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const stored = DB.getItem<number>(
              'payrollExchangeRateKhrPerUsd',
              PAYROLL_EXCHANGE_RATE_FALLBACK_KHR_PER_USD
            );
            const rate =
              Number.isFinite(stored) && stored > 0
                ? stored
                : PAYROLL_EXCHANGE_RATE_FALLBACK_KHR_PER_USD;
            const allowance = Math.round((150_000 / rate) * 100) / 100;
            return {
                exchangeRateKhrPerUsd: rate,
                dependentAllowanceUsd: allowance,
                dependentAllowanceKhr: 150_000,
                isConfigured: DB.getItem<boolean>('payrollExchangeRateConfigured', false) === true,
            };
        }
        return client.get('/public/payroll/exchange-rate', { omitAuth: true });
    },

    getExchangeRate: async (): Promise<number> => {
        const d = await Api.payroll.getExchangeRateDetails();
        return d.exchangeRateKhrPerUsd;
    },

    saveExchangeRate: async (exchangeRateKhrPerUsd: number, effectiveFrom: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const rate = Math.round(Number(exchangeRateKhrPerUsd));
            if (!Number.isFinite(rate) || rate < 1000 || rate > 20000) {
                throw new Error('Exchange rate must be between 1,000 and 20,000 KHR per USD.');
            }
            DB.setItem('payrollExchangeRateKhrPerUsd', rate);
            DB.setItem('payrollExchangeRateConfigured', true);
            const allowance = Math.round((150_000 / rate) * 100) / 100;
            return {
                message: 'Exchange rate scheduled',
                exchangeRateKhrPerUsd: rate,
                dependentAllowanceUsd: allowance,
                dependentAllowanceKhr: 150_000,
                isConfigured: true,
                effectiveFrom,
            };
        }
        return client.put('/payroll/exchange-rate', { exchangeRateKhrPerUsd, effectiveFrom });
    },
    getComplianceRules: async (): Promise<PayrollComplianceRule[]> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return DB.getItem('payrollComplianceRules', MOCK_PAYROLL_COMPLIANCE_RULES);
        }
        return client.get('/payroll/compliance-rules');
    },
    saveComplianceRules: async (
        rules: Array<{
            ruleKey: string;
            name?: string;
            legalRef?: string;
            description?: string;
            config?: Record<string, number | string>;
        }>,
        effectiveFrom: string
    ) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const current = DB.getItem<PayrollComplianceRule[]>(
                'payrollComplianceRules',
                MOCK_PAYROLL_COMPLIANCE_RULES
            );
            const merged = current.map((row) => {
                const patch = rules.find((r) => r.ruleKey === row.ruleKey);
                if (!patch) return row;
                const config = { ...row.config, ...(patch.config ?? {}) };
                return {
                    ...row,
                    name: patch.name ?? row.name,
                    legalRef: patch.legalRef ?? row.legalRef,
                    description: patch.description ?? row.description,
                    config,
                };
            });
            DB.setItem('payrollComplianceRules', merged);
            return { success: true, rules: merged };
        }
        return client.put('/payroll/compliance-rules', { rules, effectiveFrom });
    },
    getUnifiedPayrollRules: async (opts?: {
        category?: string;
        templates?: boolean;
        active?: boolean;
    }) => {
        const q = new URLSearchParams();
        if (opts?.category) q.set('category', opts.category);
        if (opts?.templates) q.set('templates', '1');
        if (opts?.active) q.set('active', '1');
        const qs = q.toString();
        return client.get<import('../types/unifiedPayrollRules').UnifiedPayrollRule[]>(
            `/payroll/rules${qs ? `?${qs}` : ''}`
        );
    },
    saveUnifiedPayrollRule: async (
        payload: Partial<import('../types/unifiedPayrollRules').UnifiedPayrollRule>
    ) => {
        if (payload.id) return client.put(`/payroll/rules/${payload.id}`, payload);
        return client.post('/payroll/rules', payload);
    },
    deleteUnifiedPayrollRule: async (id: string) => client.delete(`/payroll/rules/${id}`),
    getUnifiedRuleConflicts: async () =>
        client.get<import('../types/unifiedPayrollRules').UnifiedRuleConflict[]>(
            '/payroll/rules/conflicts'
        ),
    previewUnifiedPayrollRules: async (body: Record<string, unknown>) =>
        client.post<import('../types/unifiedPayrollRules').UnifiedRulePreviewResult>(
            '/payroll/rules/preview',
            body
        ),
    evaluateUnifiedPayrollRules: async (body: Record<string, unknown>) =>
        client.post('/payroll/rules/evaluate', body),
    getUnifiedRuleLogs: async (employeeId: string, month?: string) => {
        const q = month ? `?month=${encodeURIComponent(month)}` : '';
        return client.get(`/payroll/rules/logs/${employeeId}${q}`);
    },
    getSeniorityRules: async () =>
        client.get<import('../types/seniority').SeniorityRule[]>('/seniority/rules'),
    saveSeniorityRule: async (payload: Partial<import('../types/seniority').SeniorityRule>) => {
        if (payload.id) return client.put(`/seniority/rules/${payload.id}`, payload);
        return client.post('/seniority/rules', payload);
    },
    deleteSeniorityRule: async (id: string) => client.delete(`/seniority/rules/${id}`),
    previewSeniority: async (body: Record<string, unknown>) =>
        client.post<import('../types/seniority').SeniorityPreview>('/seniority/preview', body),
    previewSeniorityIndemnity: async (body: Record<string, unknown>) =>
        client.post<import('../types/seniorityIndemnity').SeniorityIndemnityPreview>(
            '/seniority/indemnity/preview',
            body
        ),
    getSeniorityIndemnityPolicies: async () =>
        client.get<import('../types/seniorityIndemnityPolicy').SeniorityIndemnityPolicy[]>(
            '/seniority/indemnity/policies'
        ),
    saveSeniorityIndemnityPolicy: async (
        payload: Partial<import('../types/seniorityIndemnityPolicy').SeniorityIndemnityPolicy>
    ) => {
        if (payload.id) return client.put(`/seniority/indemnity/policies/${payload.id}`, payload);
        return client.post('/seniority/indemnity/policies', payload);
    },
    deleteSeniorityIndemnityPolicy: async (id: string) =>
        client.delete(`/seniority/indemnity/policies/${id}`),
    calculateSeniority: async (body: Record<string, unknown>) =>
        client.post<import('../types/seniority').SeniorityPreview>('/seniority/calculate', body),
    getSeniorityLedger: async (employeeId: string, month?: string) => {
        const q = month ? `?month=${encodeURIComponent(month)}` : '';
        return client.get<import('../types/seniority').SeniorityLedgerEntry[]>(
            `/seniority/ledger/${employeeId}${q}`
        );
    },
    payoutSeniority: async (body: { employeeId: string; amountUsd?: number; reason?: string }) =>
        client.post('/seniority/payout', body),
    getPayslipsForUser: async (userId: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return DB.payslips.filter(p => p.userId === userId);
        }
        return client.get(`/payroll/payslips/user/${userId}`);
    },
    createRun: async (payload: CreatePayrollRunPayload) => {
        if (USE_MOCK_ADAPTER) { 
            await delay(800); 
            const portalUsers = DB.users;
            const monthStr = `${payload.year}-${String(payload.month).padStart(2, '0')}`;
            const empDirectory = await Api.employees.getAll({
              page: 1,
              limit: 500,
              assigned_id_only: '1',
              include_compensation: '1',
            }).catch(() => ({
              employees: [],
            }));
            const profiles = buildPayrollEmployeeProfiles(portalUsers, empDirectory);
            const complianceRules = DB.getItem<PayrollComplianceRule[]>(
                'payrollComplianceRules',
                MOCK_PAYROLL_COMPLIANCE_RULES
            );
            const compliance = complianceRulesToEngineConfig(complianceRules);
            const nssfBrackets = DB.getItem<PayrollNssfWageBracket[]>(
                'payrollNssfWageBrackets',
                MOCK_PAYROLL_NSSF_WAGE_BRACKETS
            );
            const taxBrackets = DB.getItem<PayrollTaxBracket[]>(
                'payrollTaxBrackets',
                MOCK_PAYROLL_TAX_BRACKETS
            );
            const leaves = DB.leaves;

            let estimatedNet = 0;
            let estimatedGross = 0;
            const tempPayslips: Payslip[] = [];
            const pendingBreakdowns: Array<{ userId: string; breakdown: ReturnType<typeof calculatePayrollForUser> }> = [];
            
            const existingRuns = DB.payrollRuns ?? [];
            let maxPrroc = 0;
            for (const r of existingRuns) {
              const m = String(r.id ?? '').match(/^PRROC(\d+)$/i);
              if (m) maxPrroc = Math.max(maxPrroc, parseInt(m[1], 10) || 0);
            }
            const newRun = { 
                id: `PRROC${String(maxPrroc + 1).padStart(5, '0')}`, 
                month: monthStr,
                year: payload.year,
                runDate: payload.runDate,
                payDate: payload.payDate,
                status: 'PROCESSING' as const, 
                totalEmployees: 0, 
                totalNetPay: 0,
                totalGross: 0,
                createdAt: new Date().toISOString() 
            } as PayrollRun;

            const monthPrefix = monthStr.slice(0, 7);
            const employeeRows = Array.isArray(empDirectory)
                ? (empDirectory as { status?: string; email?: string; employee_id?: string }[])
                : ((empDirectory as { employees?: { status?: string; email?: string; employee_id?: string }[] })
                      ?.employees ?? []);
            portalUsers.forEach((u) => {
                if (isPortalUserExcludedFromPayroll(u.role)) return;
                const empRow = employeeRows.find(
                    (e) =>
                        e.employee_id === u.id ||
                        (e.email && u.email && e.email.toLowerCase() === u.email.toLowerCase())
                );
                if (!empRow || !isEmployeeStatusPayrollEligible(empRow.status)) return;
                const attendance = DB.attendance.filter(
                    (a) => a.userId === u.id && a.date.startsWith(monthPrefix)
                );
                const unpaidLeaveDays = countUnpaidLeaveDaysForMonth(leaves, u.id, monthPrefix);
                const breakdown = calculatePayrollForUser(u, {
                    attendanceRecords: attendance,
                    monthPrefix,
                    compliance,
                    nssfBrackets,
                    taxBrackets,
                    unpaidLeaveDays,
                });
                estimatedNet += breakdown.netSalary;
                estimatedGross += breakdown.grossSalary;
                const employeeId = profiles[u.id]?.employeeId ?? u.id;
                pendingBreakdowns.push({ userId: u.id, breakdown });
                tempPayslips.push({
                    id: '',
                    payrollRunId: newRun.id,
                    userId: u.id,
                    employeeId,
                    month: newRun.month,
                    status: 'DRAFT',
                    generatedAt: new Date().toISOString(),
                } as Payslip);
            });

            let maxPsroc = 0;
            for (const p of DB.payslips ?? []) {
              const m = String(p.id ?? '').match(/^PSROC(\d+)$/i);
              if (m) maxPsroc = Math.max(maxPsroc, parseInt(m[1], 10) || 0);
            }
            tempPayslips.forEach((slip, index) => {
              maxPsroc += 1;
              const payslipId = `PSROC${maxPsroc}`;
              slip.id = payslipId;
              const pending = pendingBreakdowns[index];
              if (pending) DB.setPayslipBreakdown(payslipId, pending.breakdown);
            });

            newRun.totalEmployees = tempPayslips.length;
            newRun.totalNetPay = estimatedNet;
            newRun.totalGross = estimatedGross;
            newRun.status = 'PENDING_APPROVAL';

            mockNotifyRoles(DB, DB.users, [Role.ADMIN, Role.HR], {
              id: `payroll-run-pending-${newRun.id}`,
              title: 'Payroll run ready for review',
              message: `Payroll run for ${monthStr} is pending approval.`,
              type: NotificationType.INFO,
              link: '/payroll',
            });
            
            DB.payrollRuns = [newRun, ...DB.payrollRuns];
            DB.payslips = [...DB.payslips, ...tempPayslips];
            
            return newRun; 
        }
        return client.post('/payroll/runs', payload);
    },
    updatePayslip: async (id: string, updates: Partial<Payslip>) => {
        if (USE_MOCK_ADAPTER) { 
            await delay(MOCK_DELAY); 
            const current = DB.payslips;
            const idx = current.findIndex(p => p.id === id);
            if(idx !== -1) {
                current[idx] = { ...current[idx], ...updates };
                DB.payslips = current;
                
                // Update run total
                const runId = current[idx].payrollRunId;
                const runPayslips = current.filter(p => p.payrollRunId === runId);
                const total = runPayslips.reduce((acc, curr) => acc + (curr.breakdown?.netSalary || 0), 0);
                
                const runs = DB.payrollRuns;
                const runIdx = runs.findIndex(r => r.id === runId);
                if(runIdx !== -1) {
                    runs[runIdx].totalNetPay = total;
                    DB.payrollRuns = runs;
                }
            }
            return updates; 
        }
        return client.put(`/payroll/payslips/${id}`, updates); 
    },
    getAttendancePeriod: async (month: string) => {
        return client.get(`/payroll/attendance-periods/${month.slice(0, 7)}`);
    },
    finalizeAttendancePeriod: async (month: string, notes?: string) => {
        return client.post(`/payroll/attendance-periods/${month.slice(0, 7)}/finalize`, { notes });
    },
    reopenAttendancePeriod: async (month: string) => {
        return client.post(`/payroll/attendance-periods/${month.slice(0, 7)}/reopen`, {});
    },
    listPendingMyApproval: async () =>
        client.get('/payroll/runs/pending-my-approval', { noCache: true }) as Promise<
            import('../types').PayrollApprovalsInboxResponse
        >,
    listApprovalBoard: async () =>
        client.get('/payroll/runs/approval-board', { noCache: true }) as Promise<
            import('../types').PayrollPendingApprovalItem[]
        >,
    listPaymentRuns: async () =>
        client.get('/payroll/payments/runs', { noCache: true }) as Promise<
            import('../types').PayrollPaymentRunOption[]
        >,
    listPaymentQueue: async (runId: string) =>
        client.get(`/payroll/payments/queue?runId=${encodeURIComponent(runId)}`, {
            noCache: true,
        }) as Promise<import('../types').PayrollPaymentQueueItem[]>,
    setPayslipDisbursement: async (
        payslipId: string,
        body: { status: 'PENDING' | 'PAID' | 'HOLDING'; holdNote?: string }
    ) => client.patch(`/payroll/payslips/${encodeURIComponent(payslipId)}/disbursement`, body),
    setRunApprovers: async (runId: string, assignedApproverUserIds: string[]) =>
        client.put(`/payroll/runs/${runId}/approvers`, { assignedApproverUserIds }),
    cancelRun: async (runId: string, options?: { reason?: string; notes?: string }) =>
        client.post(`/payroll/runs/${encodeURIComponent(runId)}/cancel`, {
            reason: options?.reason,
            notes: options?.notes,
        }),
    workflow: async (
        runId: string,
        action: 'approve' | 'reject' | 'return',
        options?: { notes?: string; reason?: string }
    ) =>
        client.post(`/payroll/runs/${runId}/workflow`, {
            action,
            notes: options?.notes,
            reason: options?.reason,
        }),
    listFinalSettlements: async (params?: { employeeId?: string; status?: string }) => {
        const q = new URLSearchParams();
        if (params?.employeeId) q.set('employeeId', params.employeeId);
        if (params?.status) q.set('status', params.status);
        const qs = q.toString();
        return client.get(`/payroll/final-settlements${qs ? `?${qs}` : ''}`);
    },
    prefillFinalSettlement: (employeeId: string, opts?: { lastWorkingDate?: string }) => {
        const q = opts?.lastWorkingDate?.trim()
            ? `?lastWorkingDate=${encodeURIComponent(opts.lastWorkingDate.trim())}`
            : '';
        return client.get(
            `/payroll/final-settlements/prefill/${encodeURIComponent(employeeId)}${q}`
        );
    },
    listFinalSettlementEligibleEmployees: () =>
        client.get('/payroll/final-settlements/eligible-employees'),
    historicalRecordsSummary: () => client.get('/payroll/records/summary'),
    listHistoricalFinalSettlements: (limit?: number) =>
        client.get(`/payroll/records/final-settlements${limit ? `?limit=${limit}` : ''}`),
    listHistoricalSalaryHistory: (limit?: number) =>
        client.get(`/payroll/records/salary-history${limit ? `?limit=${limit}` : ''}`),
    listHistoricalAttendancePeriods: (limit?: number) =>
        client.get(`/payroll/records/attendance-periods${limit ? `?limit=${limit}` : ''}`),
    listHistoricalOffboardingRecords: (limit?: number) =>
        client.get(`/payroll/records/offboarding${limit ? `?limit=${limit}` : ''}`),
    listHistoricalPayrollAudit: (limit?: number) =>
        client.get(`/payroll/records/audit${limit ? `?limit=${limit}` : ''}`),
    getFinalSettlement: (id: string) => client.get(`/payroll/final-settlements/${encodeURIComponent(id)}`),
    previewFinalSettlement: async (body: Record<string, unknown>) =>
        client.post('/payroll/final-settlements/preview', body),
    createFinalSettlement: async (body: Record<string, unknown>) =>
        client.post('/payroll/final-settlements', body),
    createSimplifiedOffboardingSettlement: async (body: Record<string, unknown>) =>
        client.post('/payroll/final-settlements/simplified', body),
    completeSimplifiedOffboardingPayment: async (
        id: string,
        body: { decision: 'PAY' | 'NO_PAY'; notes?: string }
    ) => client.post(`/payroll/final-settlements/${encodeURIComponent(id)}/simplified-payment`, body),
    updateFinalSettlement: (id: string, body: Record<string, unknown>) =>
        client.patch(`/payroll/final-settlements/${encodeURIComponent(id)}`, body),
    transitionFinalSettlement: async (
        id: string,
        action: string,
        options?: {
            reason?: string;
            clearance?: Record<string, unknown>;
            payment?: {
                method: string;
                paymentDate: string;
                reference?: string;
                amountUsd: number;
                notes?: string;
            };
            acknowledgePaymentVariance?: boolean;
        }
    ) =>
        client.post(`/payroll/final-settlements/${id}/transition`, {
            action,
            reason: options?.reason,
            clearance: options?.clearance,
            payment: options?.payment,
            acknowledgePaymentVariance: options?.acknowledgePaymentVariance,
        }),
  },

  notifications: {
    getAll: async (
      userId: string,
      params?: { page?: number; limit?: number; category?: string; read?: boolean }
    ): Promise<{
      notifications: Notification[];
      unreadCount: number;
      pagination?: { page: number; limit: number; hasMore: boolean };
    }> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const rows = DB.notifications.filter(n => n.userId === userId);
            return {
              notifications: rows,
              unreadCount: rows.filter((n) => !n.isRead).length,
            };
        }
        const qs = new URLSearchParams();
        if (params?.page) qs.set('page', String(params.page));
        if (params?.limit) qs.set('limit', String(params.limit));
        if (params?.category) qs.set('category', params.category);
        if (typeof params?.read === 'boolean') qs.set('read', String(params.read));
        const data = await client.get(`/notifications${qs.size ? `?${qs.toString()}` : ''}`, {
          skipSessionRedirect: true,
          noCache: true,
        });
        if (Array.isArray(data)) {
          const rows = data as Notification[];
          return {
            notifications: rows,
            unreadCount: rows.filter((n) => !n.isRead).length,
          };
        }
        const payload = data as {
          notifications?: Notification[];
          unreadCount?: number;
          pagination?: { page: number; limit: number; hasMore: boolean };
        };
        const rows = Array.isArray(payload.notifications) ? payload.notifications : [];
        const unreadCount =
          typeof payload.unreadCount === 'number'
            ? payload.unreadCount
            : rows.filter((n) => !n.isRead).length;
        return { notifications: rows, unreadCount, pagination: payload.pagination };
    },
    markRead: async (id: string) => {
        if (USE_MOCK_ADAPTER) {
            const current = DB.notifications;
            const idx = current.findIndex(x => x.id === id);
            if(idx !== -1) {
                current[idx].isRead = true;
                DB.notifications = current;
            }
            return;
        }
        return client.put(`/notifications/${id}/read`, {});
    },
    markAllRead: async (userId: string) => {
        if (USE_MOCK_ADAPTER) {
            const current = DB.notifications;
            current.forEach(n => { if(n.userId === userId) n.isRead = true; });
            DB.notifications = current;
            return;
        }
        return client.post(`/notifications/mark-all-read`, {});
    },
    delete: async (id: string) => client.delete(`/notifications/${id}`),
  },

  reports: {
    getAnalytics: async (params?: { startDate?: string; endDate?: string }) => {
        const qs = new URLSearchParams();
        if (params?.startDate) qs.set('startDate', params.startDate);
        if (params?.endDate) qs.set('endDate', params.endDate);
        const q = qs.toString();
        return client.get(`/reports/analytics${q ? `?${q}` : ''}`);
    },
    listCatalog: async () => client.get('/reports/catalog'),
    run: async (body: { reportId: string; filters?: Record<string, string> }) =>
      client.post('/reports/run', body),
    getStats: async (params?: { startDate?: string; endDate?: string }) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            
            // REAL TIME CALCULATION FROM DB
            const totalEmployees = DB.users.length;
            const presentToday = DB.attendance.filter(a => a.date === new Date().toISOString().split('T')[0] && a.status === 'PRESENT').length;
            const pendingLeaves = DB.leaves.filter(l => l.status === 'PENDING').length;
            
            // Dynamic Department Stats
            const deptDist = DB.depts.map(d => ({
                name: d.name,
                value: DB.users.filter(u => u.departmentId === d.id).length
            }));

            const leaveByType = new Map<string, number>();
            for (const leave of DB.leaves) {
                const type = String(leave.type || 'Other');
                leaveByType.set(type, (leaveByType.get(type) || 0) + 1);
            }
            const leaveDist = Array.from(leaveByType.entries())
                .map(([name, value]) => ({ name, value }))
                .filter((row) => row.value > 0);

            const today = new Date().toISOString().split('T')[0];
            const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const attendanceHistory: Array<{ day: string; present: number; absent: number }> = [];
            const cursor = new Date();
            let added = 0;
            while (added < 5) {
                const dow = cursor.getDay();
                if (dow >= 1 && dow <= 5) {
                    const dateStr = cursor.toISOString().split('T')[0];
                    const dayRows = DB.attendance.filter((a) => a.date === dateStr);
                    attendanceHistory.unshift({
                        day: weekdayLabels[dow],
                        present: dayRows.filter((a) => a.status === 'PRESENT').length,
                        absent: dayRows.filter((a) => a.status === 'ABSENT').length,
                    });
                    added++;
                }
                cursor.setDate(cursor.getDate() - 1);
            }

            const payrollByMonth = new Map<string, number>();
            for (const run of DB.payrollRuns) {
                if (String(run.status).toUpperCase() !== 'COMPLETED') continue;
                const month = String(run.month || '').slice(0, 7);
                if (!month) continue;
                payrollByMonth.set(
                    month,
                    (payrollByMonth.get(month) || 0) + Number(run.totalNetPay || 0)
                );
            }
            const payrollHistory = Array.from(payrollByMonth.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .slice(-6)
                .map(([month, amount]) => ({
                    month: new Date(`${month}-01`).toLocaleString('en-US', { month: 'short' }),
                    amount: Math.round(amount),
                }));

            return {
                summary: {
                    totalEmployees,
                    presentToday,
                    pendingLeaves,
                },
                headcountHistory: [],
                attendanceHistory,
                leaveDistribution: leaveDist,
                departmentDistribution: deptDist,
                payrollHistory,
            };
        }
        const qs = new URLSearchParams();
        if (params?.startDate) qs.set('startDate', params.startDate);
        if (params?.endDate) qs.set('endDate', params.endDate);
        const q = qs.toString();
        return client.get(`/reports/stats${q ? `?${q}` : ''}`);
    },
  },

  dashboard: {
    getAnalytics: async (params?: { startDate?: string; endDate?: string }) => {
        if (USE_MOCK_ADAPTER) {
            const [stats, charts] = await Promise.all([
                Api.dashboard.getStats(params),
                Api.reports.getStats(params),
            ]);
            return {
                period: {
                    startDate: params?.startDate,
                    endDate: params?.endDate,
                },
                stats,
                charts,
            };
        }
        const qs = new URLSearchParams();
        if (params?.startDate) qs.set('startDate', params.startDate);
        if (params?.endDate) qs.set('endDate', params.endDate);
        const q = qs.toString();
        return client.get(`/dashboard/analytics${q ? `?${q}` : ''}`);
    },
    getStats: async (params?: { startDate?: string; endDate?: string }) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const today = new Date().toISOString().split('T')[0];
            const presentToday = DB.attendance.filter(a => a.date === today && a.status === 'PRESENT').length;
            const absentToday = DB.attendance.filter(a => a.date === today && a.status === 'ABSENT').length;
            const lateToday = DB.attendance.filter(a => a.date === today && a.status === 'LATE').length;
            const pendingLeaves = DB.leaves.filter(l => l.status === 'PENDING').length;
            const activeProjects = DB.projects.filter(p => p.status === 'ACTIVE').length;
            const totalPayroll = DB.payslips.reduce((sum, p) => sum + (p.breakdown?.grossSalary || 0), 0);
            const inactive = DB.users.filter((u) =>
                ['inactive', 'terminated', 'resigned'].includes(String(u.status || '').toLowerCase())
            ).length;
            const active = DB.users.length - inactive;
            const headcountStart = active + inactive;
            const headcountEnd = active;
            const avgHeadcount = (headcountStart + headcountEnd) / 2;
            const turnoverRate =
                avgHeadcount > 0
                    ? Math.round((inactive / avgHeadcount) * 1000) / 10
                    : 0;
            return {
                totalEmployees: DB.users.length,
                totalDepartments: DB.depts.length,
                presentToday,
                absentToday,
                lateToday,
                pendingLeaveRequests: pendingLeaves,
                activeProjects,
                turnoverRate,
                payrollRun: { thisMonth: totalPayroll, lastMonth: totalPayroll * 0.95 },
            };
        }
        const qs = new URLSearchParams();
        if (params?.startDate) qs.set('startDate', params.startDate);
        if (params?.endDate) qs.set('endDate', params.endDate);
        const q = qs.toString();
        return client.get(`/dashboard/stats${q ? `?${q}` : ''}`);
    },
    getTeamStats: async (params?: { startDate?: string; endDate?: string }) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const teamSize = Math.floor(Math.random() * 8) + 3;
            const presentToday = Math.floor(teamSize * 0.8);
            const absentToday = Math.floor(teamSize * 0.1);
            const pendingLeaves = Math.floor(Math.random() * 5) + 1;
            const activeProjects = Math.floor(Math.random() * 4) + 2;
            
            const teamMembers = DB.users.slice(0, teamSize).map(u => ({ 
                ...u, 
                status: Math.random() > 0.3 ? 'present' : Math.random() > 0.5 ? 'absent' : 'late',
                performance: Math.floor(Math.random() * 30) + 70, // 70-100
                attendance: Math.floor(Math.random() * 20) + 80, // 80-100
                tasksCompleted: Math.floor(Math.random() * 15) + 5 // 5-20
            }));
            
            return { 
                teamSize, 
                presentToday, 
                absentToday, 
                pendingLeaveRequests: pendingLeaves, 
                activeProjects,
                teamMembers,
                teamPerformance: {
                    average: 87.6,
                    topPerformer: teamMembers[0]?.name || 'N/A',
                    improvementNeeded: teamMembers.filter(m => m.performance < 80).length
                },
                weeklyStats: {
                    tasksCompleted: 45,
                    tasksPending: 12,
                    productivityRate: 82
                }
            };
        }
        const qs = new URLSearchParams();
        if (params?.startDate) qs.set('startDate', params.startDate);
        if (params?.endDate) qs.set('endDate', params.endDate);
        const q = qs.toString();
        return client.get(`/dashboard/team-stats${q ? `?${q}` : ''}`);
    },
    getMyStats: async () => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const today = new Date().toISOString().split('T')[0];
            const todayAttendance = DB.attendance.find(a => a.date === today);
            const clockedIn = !!todayAttendance?.clockIn;
            
            return {
                clockInStatus: clockedIn ? 'Clocked In' : 'Not Clocked In',
                clockedIn: clockedIn,
                leaveBalance: { remaining: 15, used: 5, total: 20 },
                workHoursToday: clockedIn && todayAttendance?.clockIn ? 
                    calculateWorkHours(todayAttendance.clockIn, todayAttendance?.clockOut) : '0.0',
                pendingRequests: Math.floor(Math.random() * 3),
                monthlyAttendance: 92,
                tasksCompleted: 12,
                performanceScore: 'A-',
                recentActivity: [
                    { type: 'clock_in', title: 'Clocked in at 8:45 AM', date: 'Today, 8:45 AM' },
                    { type: 'leave', title: 'Leave request approved', date: 'Yesterday' },
                    { type: 'payslip', title: 'May 2026 payslip available', date: 'Jun 1, 2026' },
                    { type: 'task', title: 'Completed 5 tasks this week', date: '2 days ago' }
                ]
            };
        }
        return client.get('/dashboard/my-stats');
    }
  },

  approvals: {
    getSummary: async (): Promise<{
      actionRequired: number;
      totalAssigned: number;
      breakdown: {
        appraisalsAction: number;
        appraisalsTracking: number;
        movements: number;
        probationAction: number;
        probationTracking: number;
        payrollAction: number;
        payrollTracking: number;
        leaveRequests: number;
        overtimeRequests: number;
      };
    }> => client.get('/approvals/summary'),
  },

  actions: {
    getRequired: async (): Promise<{
      totalCount: number;
      groups: Array<{
        key: string;
        label: string;
        count: number;
        href: string;
        items: Array<{
          id: string;
          kind: string;
          module: string;
          title: string;
          subtitle: string;
          href: string;
          urgency: string;
          entityId?: string;
          employeeName?: string;
        }>;
      }>;
      items: Array<{
        id: string;
        kind: string;
        module: string;
        title: string;
        subtitle: string;
        href: string;
        urgency: string;
        entityId?: string;
        employeeName?: string;
      }>;
    }> => client.get('/actions/required'),
  },

  chat: {
    getColleagues: async () => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        const userStr = localStorage.getItem('hcms_user');
        const uid = userStr ? JSON.parse(userStr).id : '';
        return DB.users.filter((u) => u.id !== uid);
      }
      return client.get('/chat/colleagues');
    },
    getInbox: async () => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        const userStr = localStorage.getItem('hcms_user');
        const uid = userStr ? JSON.parse(userStr).id : '';
        const others = DB.users.filter((u) => u.id !== uid);
        return {
          direct: others.map((u) => ({
            kind: 'direct',
            partnerId: u.id,
            partner: u,
            lastMessage: '',
            unreadCount: 0,
          })),
          groups: [],
          all: others.map((u) => ({
            kind: 'direct',
            partnerId: u.id,
            partner: u,
            lastMessage: '',
            unreadCount: 0,
          })),
        };
      }
      return client.get('/chat/inbox');
    },
    getAnnouncements: async (scope?: 'chat' | 'dashboard') => {
      const q = scope === 'dashboard' ? '?scope=dashboard' : '';
      return client.get(`/chat/announcements${q}`);
    },
    postAnnouncement: async (payload: {
      title?: string;
      content: string;
      dashboardExpiresAt?: string | null;
    }) => client.post('/chat/announcements', payload),
    setAnnouncementDashboardExpiry: async (
      announcementId: string,
      dashboardExpiresAt: string | null
    ) =>
      client.patch(`/chat/announcements/${announcementId}/dashboard-expiry`, {
        dashboardExpiresAt,
      }),
    markAnnouncementsRead: async () => client.put('/chat/announcements/read', {}),
    getGroupMessages: async (groupId: string) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        return DB.messages.filter((m) => (m as any).groupId === groupId);
      }
      return client.get(`/chat/groups/${groupId}/messages`);
    },
    getGroupDetail: async (groupId: string) => {
      return client.get(`/chat/groups/${groupId}`);
    },
    updateGroupName: async (groupId: string, name: string) => {
      return client.patch(`/chat/groups/${groupId}`, { name });
    },
    leaveGroup: async (groupId: string) => {
      return client.post(`/chat/groups/${groupId}/leave`, {});
    },
    createGroup: async (name: string, memberIds: string[]) => {
      return client.post('/chat/groups', { name, memberIds });
    },
    inviteToGroup: async (groupId: string, memberIds: string[]) => {
      return client.post(`/chat/groups/${groupId}/invite`, { memberIds });
    },
    markGroupRead: async (groupId: string) => {
      return client.put(`/chat/groups/${groupId}/read`, {});
    },
    sendGroupMessage: async (
      groupId: string,
      content: string,
      attachment?: File,
      replyToId?: string
    ) => {
      if (!attachment) {
        return client.post(`/chat/groups/${groupId}/messages`, {
          content: content || undefined,
          replyToId,
        });
      }
      const formData = new FormData();
      if (content) formData.append('content', content);
      formData.append('attachment', attachment);
      if (replyToId) formData.append('replyToId', replyToId);
      return client.post(`/chat/groups/${groupId}/messages`, formData);
    },
    deleteMessage: async (messageId: string) => client.delete(`/chat/messages/${messageId}`),
    editMessage: async (messageId: string, content: string) =>
      client.patch(`/chat/messages/${messageId}`, { content }),
    forwardMessage: async (
      messageId: string,
      target: { receiverId?: string; groupId?: string }
    ) => client.post(`/chat/messages/${messageId}/forward`, target),
    getMuteSettings: async () => client.get('/chat/mute-settings'),
    setMuteAll: async (muted: boolean) => client.put('/chat/mute-all', { muted }),
    setDirectMute: async (partnerId: string, muted: boolean) =>
      client.put(`/chat/mute/direct/${partnerId}`, { muted }),
    setGroupMute: async (groupId: string, muted: boolean) =>
      client.put(`/chat/mute/group/${groupId}`, { muted }),
    presenceHeartbeat: async () => client.post('/chat/presence/heartbeat', {}),
    getContactProfile: async (userId: string) => client.get(`/chat/users/${userId}/contact`),
    getPins: async () => client.get('/chat/pins'),
    setDirectPin: async (partnerId: string, pinned: boolean) =>
      client.put(`/chat/pin/direct/${partnerId}`, { pinned }),
    setGroupPin: async (groupId: string, pinned: boolean) =>
      client.put(`/chat/pin/group/${groupId}`, { pinned }),
    getMessages: async (user1Id: string, user2Id: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return DB.messages.filter(m => 
                (m.senderId === user1Id && m.receiverId === user2Id) || 
                (m.senderId === user2Id && m.receiverId === user1Id)
            );
        }
        return client.get(`/chat/messages/${user2Id}`);
    },
    getUnreadCount: async (_userId?: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const userStr = localStorage.getItem('hcms_user');
            const uid = userStr ? JSON.parse(userStr).id : _userId;
            return DB.messages.filter(m => m.receiverId === uid && !m.isRead).length;
        }
        return client.get('/chat/unread-count', { skipSessionRedirect: true });
    },
    getUnreadBySender: async (): Promise<Record<string, number>> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const userStr = localStorage.getItem('hcms_user');
            const uid = userStr ? JSON.parse(userStr).id : '';
            const map: Record<string, number> = {};
            DB.messages.filter(m => m.receiverId === uid && !m.isRead).forEach(m => {
                map[m.senderId] = (map[m.senderId] || 0) + 1;
            });
            return map;
        }
        return client.get('/chat/unread-by-sender', { skipSessionRedirect: true });
    },
    markConversationRead: async (partnerId: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const userStr = localStorage.getItem('hcms_user');
            const uid = userStr ? JSON.parse(userStr).id : '';
            DB.messages = DB.messages.map(m =>
                m.senderId === partnerId && m.receiverId === uid ? { ...m, isRead: true } : m
            );
            return { success: true };
        }
        return client.put(`/chat/conversations/${partnerId}/read`, {});
    },
    getRecentContacts: async (userId: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const userMessages = DB.messages.filter(m => m.senderId === userId || m.receiverId === userId);
            const contactIds = new Set<string>();
            userMessages.forEach(m => {
                contactIds.add(m.senderId === userId ? m.receiverId : m.senderId);
            });
            return DB.users.filter(u => contactIds.has(u.id));
        }
        return client.get('/chat/recent-contacts');
    },
    sendMessage: async (
      receiverId: string,
      content: string,
      attachment?: File,
      replyToId?: string
    ) => {
        if (USE_MOCK_ADAPTER) { 
            await delay(MOCK_DELAY); 
            const userStr = localStorage.getItem('hcms_user');
            const senderId = userStr ? JSON.parse(userStr).id : 'unknown';
            
            const newMsg = {
                id: `msg-${Date.now()}`,
                senderId,
                receiverId,
                content,
                createdAt: new Date().toISOString(),
                isRead: false
            } as Message;
            
            DB.messages = [...DB.messages, newMsg];
            return newMsg; 
        }

        if (!attachment) {
            return client.post('/chat/messages', {
                receiverId,
                content: content || undefined,
                replyToId,
            });
        }
        const formData = new FormData();
        formData.append('receiverId', receiverId);
        if (content) formData.append('content', content);
        formData.append('attachment', attachment);
        if (replyToId) formData.append('replyToId', replyToId);
        return client.post('/chat/messages', formData);
    },
  },

  companyStructure: {
    get: async () => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        return {
          offices: [],
          unassigned: { manager: [], officer: [], staff: [] },
          totals: { offices: 0, departments: 0, employees: 0 },
        };
      }
      return client.get('/company-structure');
    },
  },

  positions: {
    getAll: async (options?: { activeOnly?: boolean; departmentId?: string }) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        return [
          { id: '1', title: 'CEO', departmentId: '', isActive: true },
          { id: '2', title: 'HR Manager', departmentId: '', isActive: true },
        ];
      }
      const qs = new URLSearchParams();
      if (options?.departmentId) qs.set('departmentId', options.departmentId);
      if (options?.activeOnly) qs.set('activeOnly', '1');
      const q = qs.toString();
      return client.get(`/positions${q ? `?${q}` : ''}`);
    },
    getByDepartment: async (departmentId: string, options?: { activeOnly?: boolean }) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        return [
          { id: 'POS001', title: 'Manager', departmentId, salaryMin: 0, salaryMax: 0, description: '', isActive: true },
        ];
      }
      const qs = new URLSearchParams({ departmentId });
      if (options?.activeOnly) qs.set('activeOnly', '1');
      return client.get(`/positions?${qs.toString()}`);
    },
    create: async (position: {
      title: string;
      titleKh: string;
      departmentId: string;
      level: string;
      accessRole: string;
      description?: string;
      salaryMin?: number;
      salaryMax?: number;
      salary?: number;
    }) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        const min = position.salaryMin ?? position.salary ?? 0;
        const max = position.salaryMax ?? position.salary ?? min;
        return { id: nextMockPositionId(), ...position, salaryMin: min, salaryMax: max, isActive: true };
      }
      return client.post('/positions', position);
    },
    update: async (position: Position) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        return position;
      }
      return client.put(`/positions/${position.id}`, position);
    },
    /** Permanent delete — only when no staff are assigned. */
    delete: async (id: string) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        return { success: true, deleted: true, message: 'ok' };
      }
      return client.delete(`/positions/${id}`);
    },
    /** Soft-close — allowed with staff; hides role from new assignment dropdowns. */
    deactivate: async (id: string) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        return { success: true, deactivated: true, message: 'ok', position: { id, isActive: false } };
      }
      return client.post(`/positions/${id}/deactivate`, {});
    },
    reactivate: async (id: string) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        return { id, isActive: true };
      }
      return client.post(`/positions/${id}/reactivate`, {});
    },
  },

  roles: {
    getAll: async () => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        return [
          { id: 'role-1', name: 'ADMIN', description: '' },
          { id: 'role-2', name: 'HR', description: '' },
          { id: 'role-3', name: 'MANAGER', description: '' },
          { id: 'role-4', name: 'EMPLOYEE', label: 'Staff', description: 'Basic staff access' },
        ];
      }
      return client.get('/roles');
    },
  },

  uploads: {
    /**
     * Upload a single image (JPG/PNG/WebP) as an avatar.
     *
     * Validation happens in two layers:
     *   - Caller (UI): size/type/dimensions check BEFORE sending, so the user
     *     gets immediate feedback without an HTTP round-trip.
     *   - Server: max 5 MB, mime allowlist, min ~2 KB sanity check.
     *
     * Returns `{ url: '/uploads/<file>' }`. The URL is short enough to fit in
     * the existing VARCHAR(255) `avatar_url` columns and is also served
     * through the Vite dev proxy for the dev preview to render correctly.
     */
    avatar: async (file: File): Promise<{ url: string; filename: string; size: number; mime: string }> => {
      const fd = new FormData();
      fd.append('avatar', file);
      return client.post('/uploads/avatar', fd);
    },
  },

  employees: {
    getAll: async (params?: {
      page?: number;
      limit?: number;
      search?: string;
      department_id?: string;
      office_location_id?: string;
      gender?: string;
      status?: string;
      in_probation?: string;
      has_movement?: string;
      role?: string;
      sort_by?: string;
      sort_order?: 'ASC' | 'DESC';
      join_date_from?: string;
      join_date_to?: string;
      assigned_id_only?: string;
      /** Include salary/bank/tax fields (payroll directory). Omit on the employee list for speed. */
      include_compensation?: string;
    }) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            let employees = DB.users.filter(
                (u) =>
                    u.role !== Role.ADMIN &&
                    (u as User).accountType !== 'system' &&
                    u.employeeId !== null &&
                    u.employeeId !== undefined
            );

            // Apply filters
            if (params?.search) {
                const search = params.search.toLowerCase();
                employees = employees.filter(u => 
                    u.name?.toLowerCase().includes(search) ||
                    u.email?.toLowerCase().includes(search) ||
                    u.id?.toLowerCase().includes(search)
                );
            }
            
            if (params?.department_id) {
                employees = employees.filter(u => u.departmentId === params.department_id);
            }

            if (params?.gender) {
                const wanted = String(params.gender).trim().toLowerCase();
                employees = employees.filter(
                  (u) => String((u as User).gender || '').trim().toLowerCase() === wanted
                );
            }
            
            if (params?.status) {
                employees = employees.filter(u => {
                    // Map user role to employee status for demo
                    const statusMap: Record<string, string> = {
                        'ADMIN': 'active',
                        'HR': 'active', 
                        'MANAGER': 'active',
                        'EMPLOYEE': 'active'
                    };
                    return statusMap[u.role || 'EMPLOYEE'] === params.status;
                });
            }

            if (params?.in_probation === '1' || params?.in_probation === 'true') {
                const { isEmployeeInProbation } = await import('../utils/employeeProbation');
                employees = employees.filter((u) =>
                    isEmployeeInProbation({
                        status: 'active',
                        email: u.email,
                        join_date: u.joinDate,
                        probation_period_months: 3,
                    })
                );
            }

            if (params?.role) {
                const roleName = String(params.role).trim().toUpperCase();
                employees = employees.filter((u) => (u.role || 'EMPLOYEE').toUpperCase() === roleName);
            }

            if (
              params?.assigned_id_only === '1' ||
              params?.assigned_id_only === 'true'
            ) {
              const { filterEmployeesWithAssignedDisplayId } = await import(
                '../utils/employeeDirectoryEligibility'
              );
              employees = filterEmployeesWithAssignedDisplayId(
                employees.map((u) => ({
                  employee_id: u.id,
                  email: u.email,
                  status: 'active',
                }))
              ).map((row) => employees.find((u) => u.id === row.employee_id)!)
                .filter(Boolean);
            }
            
            // Apply pagination
            const page = params?.page || 1;
            const limit = params?.limit || 20;
            const offset = (page - 1) * limit;
            const paginatedEmployees = employees.slice(offset, offset + limit);
            
            // Transform users to employee format
            const transformedEmployees = paginatedEmployees.map(u => ({
                employee_id: u.id,
                first_name: u.name?.split(' ')[0] || '',
                last_name: u.name?.split(' ')[1] || '',
                email: u.email || '',
                phone: u.phone || '',
                department_id: u.departmentId || '',
                position_id: u.position || '',
                status: 'active', // Default status for demo
                join_date: u.joinDate || new Date().toISOString().split('T')[0],
                department: DB.depts.find(d => d.id === u.departmentId),
                position: { title: u.position || 'Employee' }
            }));
            
            return {
                employees: transformedEmployees,
                total: employees.length,
                page: page,
                total_pages: Math.ceil(employees.length / limit)
            };
        }
        const queryString = new URLSearchParams(params as any).toString();
        return client.get(`/employees${queryString ? '?' + queryString : ''}`);
    },

    getSummaryCounts: async (params?: {
      search?: string;
      department_id?: string;
      role?: string;
    }) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        const active = await Api.employees.getAll({ ...params, page: 1, limit: 1, status: 'active' });
        const draft = await Api.employees.getAll({ ...params, page: 1, limit: 1, status: 'draft' });
        const inactive = await Api.employees.getAll({
          ...params,
          page: 1,
          limit: 1,
          status: 'inactive',
        });
        const probation = await Api.employees.getAll({
          ...params,
          page: 1,
          limit: 1,
          in_probation: '1',
        });
        const activeN = typeof active.total === 'number' ? active.total : 0;
        const draftN = typeof draft.total === 'number' ? draft.total : 0;
        const inactiveN = typeof inactive.total === 'number' ? inactive.total : 0;
        return {
          total: activeN + draftN + inactiveN,
          active: activeN,
          draft: draftN,
          inactive: inactiveN,
          probation: typeof probation.total === 'number' ? probation.total : 0,
        };
      }
      const qs = new URLSearchParams();
      if (params?.search) qs.set('search', params.search);
      if (params?.department_id) qs.set('department_id', params.department_id);
      if (params?.role) qs.set('role', params.role);
      const q = qs.toString();
      return client.get(`/employees/summary-counts${q ? `?${q}` : ''}`);
    },

    getOffboardedHub: async () => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        return {
          employees: [],
          inProgress: [],
          historyByEmployee: {} as Record<string, unknown[]>,
        };
      }
      return client.get('/employees/offboarded-hub');
    },

    checkContact: async (params: {
      email?: string;
      phone?: string;
      exclude_employee_id?: string;
    }) => {
      if (USE_MOCK_ADAPTER) {
        await delay(MOCK_DELAY);
        const { mockContactConflicts } = await import('../utils/checkEmployeeContact');
        const conflicts = mockContactConflicts(DB.users, {
          email: params.email,
          phone: params.phone,
          excludeEmployeeId: params.exclude_employee_id,
        });
        return { ok: conflicts.length === 0, conflicts };
      }
      const qs = new URLSearchParams();
      if (params.email) qs.set('email', params.email);
      if (params.phone) qs.set('phone', params.phone);
      if (params.exclude_employee_id) qs.set('exclude_employee_id', params.exclude_employee_id);
      return client.get(`/employees/check-contact?${qs.toString()}`);
    },
    
    getById: async (id: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const user = DB.users.find(u => u.id === id);
            if (!user) return null;
            
            let leave_assignments: Record<string, boolean> = {};
            try {
              const raw = localStorage.getItem(`leaveAssignments:${id}:${new Date().getFullYear()}`);
              if (raw) leave_assignments = JSON.parse(raw) as Record<string, boolean>;
            } catch {
              leave_assignments = {};
            }
            return {
                id: user.id,
                employee_id: user.id,
                first_name: user.name?.split(' ')[0] || '',
                last_name: user.name?.split(' ')[1] || '',
                email: user.email || '',
                phone: user.phone || '',
                department_id: user.departmentId || '',
                position_id: user.position || '',
                status: 'active',
                join_date: user.joinDate || new Date().toISOString().split('T')[0],
                department: DB.depts.find(d => d.id === user.departmentId),
                position: { title: user.position || 'Employee' },
                leave_assignments,
            };
        }
        return client.get(`/employees/${encodeURIComponent(id)}`);
    },

    listIssuedCards: async (employeeDisplayId: string) => {
        if (USE_MOCK_ADAPTER) return [];
        return client.get(`/employees/${encodeURIComponent(employeeDisplayId)}/cards`);
    },

    getIssuedCard: async (employeeDisplayId: string, cardId: string) => {
        if (USE_MOCK_ADAPTER) return null;
        return client.get(
            `/employees/${encodeURIComponent(employeeDisplayId)}/cards/${encodeURIComponent(cardId)}`
        );
    },

    issueIssuedCard: async (employeeDisplayId: string, body?: Record<string, unknown>) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            throw new Error('Issuing ID cards requires the real API.');
        }
        return client.post(`/employees/${encodeURIComponent(employeeDisplayId)}/cards`, body ?? {});
    },

    patchIssuedCard: async (
        employeeDisplayId: string,
        cardId: string,
        body: Record<string, unknown>
    ) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            throw new Error('Updating ID cards requires the real API.');
        }
        return client.patch(
            `/employees/${encodeURIComponent(employeeDisplayId)}/cards/${encodeURIComponent(cardId)}`,
            body
        );
    },

    listDocuments: async (employeeDisplayId: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return [] as import('../types/employeeDocument').EmployeeDocumentRow[];
        }
        const key = String(employeeDisplayId || '').trim();
        if (!key) return [] as import('../types/employeeDocument').EmployeeDocumentRow[];
        try {
            return await client.get(`/employees/${encodeURIComponent(key)}/documents`);
        } catch (e) {
            // Not saved yet / legacy EmpID — treat as no documents.
            if ((e as Error & { status?: number })?.status === 404) {
                return [] as import('../types/employeeDocument').EmployeeDocumentRow[];
            }
            throw e;
        }
    },

    uploadDocument: async (
        employeeDisplayId: string,
        file: File,
        documentType: string
    ): Promise<import('../types/employeeDocument').EmployeeDocumentRow> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            throw new Error('Document upload requires the real API.');
        }
        const fd = new FormData();
        fd.append('document', file);
        fd.append('documentType', documentType);
        const res = (await client.post(
            `/employees/${encodeURIComponent(employeeDisplayId)}/documents`,
            fd
        )) as { document: import('../types/employeeDocument').EmployeeDocumentRow };
        return res.document;
    },

    deleteDocument: async (employeeDisplayId: string, documentId: number) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return { message: 'ok' };
        }
        return client.delete(
            `/employees/${encodeURIComponent(employeeDisplayId)}/documents/${documentId}`
        );
    },

    fetchDocumentFile: async (employeeDisplayId: string, documentId: number): Promise<Blob> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            throw new Error('Document preview requires the real API.');
        }
        return client.getBlob(
            `/employees/${encodeURIComponent(employeeDisplayId)}/documents/${documentId}/file`
        );
    },

    create: async (employee: any) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            // For demo, create a user instead of separate employee
            const newUser = {
                id: `ROC${Date.now()}`,
                name: `${employee.last_name} ${employee.first_name}`.trim(),
                email: employee.email,
                phone: employee.phone,
                role: 'EMPLOYEE' as Role,
                departmentId: employee.department_id,
                position: employee.position_id,
                joinDate: employee.join_date || new Date().toISOString().split('T')[0],
                avatarUrl: '', // Add missing required property
                status: 'active'
            };
            
            DB.users = [newUser, ...DB.users];
            if (employee.leave_assignments && typeof employee.leave_assignments === 'object') {
              try {
                localStorage.setItem(
                  `leaveAssignments:${newUser.id}:${new Date().getFullYear()}`,
                  JSON.stringify(employee.leave_assignments)
                );
              } catch {
                /* ignore */
              }
            }
            return newUser;
        }
        return client.post('/employees', employee);
    },
    
    update: async (id: string, employee: any) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const userIndex = DB.users.findIndex(u => u.id === id);
            if (userIndex === -1) return null;
            
            DB.users[userIndex] = {
                ...DB.users[userIndex],
                name: `${employee.last_name} ${employee.first_name}`.trim(),
                email: employee.email,
                phone: employee.phone,
                departmentId: employee.department_id,
                position: employee.position_id
            };

            if (employee.leave_assignments && typeof employee.leave_assignments === 'object') {
              try {
                localStorage.setItem(
                  `leaveAssignments:${id}:${new Date().getFullYear()}`,
                  JSON.stringify(employee.leave_assignments)
                );
              } catch {
                /* ignore */
              }
            }
            
            return DB.users[userIndex];
        }
        return client.put(`/employees/${encodeURIComponent(id)}`, employee);
    },
    
    delete: async (id: string, body?: { deleted_by?: string; reason?: string }) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            DB.users = DB.users.filter(u => u.id !== id);
            return { success: true };
        }
        return client.delete(`/employees/${id}`, body);
    },

    offboard: async (
      id: string,
      body: {
        offboard_type: 'terminate' | 'resign';
        reason: string;
        offboarded_by?: string;
        resignation_submitted_at?: string;
        resignation_approved_at?: string;
        last_working_date?: string;
        final_settlement_date?: string;
      }
    ) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return { message: `Employee ${body.offboard_type}d successfully.` };
        }
        return client.post(`/employees/${id}/offboard`, body);
    },

    restore: async (id: string, body?: { restored_by?: string; restore_reason?: string }) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return { message: 'Employee restored successfully' };
        }
        return client.post(`/employees/${id}/restore`, body ?? {});
    },

    getHistory: async (id: string) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return [] as Array<Record<string, unknown>>;
        }
        return client.get(`/employees/${id}/history`);
    },

    listArchive: async (limit = 100) => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return { archives: [], total: 0 };
        }
        return client.get(`/employees/archive?limit=${limit}`);
    },

    listSensitiveChanges: async (params?: {
      status?: string;
      employeeId?: string;
      limit?: number;
    }): Promise<{ changes: import('../types').EmployeeSensitiveChange[]; total: number }> => {
      const q = new URLSearchParams();
      if (params?.status) q.set('status', params.status);
      if (params?.employeeId) q.set('employeeId', params.employeeId);
      if (params?.limit) q.set('limit', String(params.limit));
      const qs = q.toString();
      return client.get(`/employees/sensitive-changes${qs ? `?${qs}` : ''}`);
    },

    approveSensitiveChange: async (id: string, reviewNotes?: string) =>
      client.post(`/employees/sensitive-changes/${encodeURIComponent(id)}/approve`, {
        reviewNotes,
      }),

    rejectSensitiveChange: async (id: string, reviewNotes?: string) =>
      client.post(`/employees/sensitive-changes/${encodeURIComponent(id)}/reject`, {
        reviewNotes,
      }),

    getArchiveDetail: async (employeeId: string): Promise<import('../types').EmployeeArchiveDetail> => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return {
                employeeId,
                employeePk: employeeId,
                currentStatus: 'terminated',
                isOffboarded: true,
                retention: {
                    attendanceRecords: 0,
                    leaveRequests: 0,
                    payslips: 0,
                    overtimeRequests: 0,
                    documents: 0,
                    movements: 0,
                    statusHistory: 0,
                },
                archives: [],
                dataRetained: true,
                retentionNote: 'Historical records are retained in mock mode.',
            };
        }
        return client.get(`/employees/${encodeURIComponent(employeeId)}/archive-detail`);
    },

    generateNextId: async () => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            let max = 0;
            for (const u of DB.users) {
                const m = String((u as any).id || '').match(/^(?:IROC|ROC|EMP)(\d+)$/i);
                if (m) max = Math.max(max, parseInt(m[1], 10));
            }
            const next = max + 1;
            return { next_id: `ROC${String(next).padStart(5, '0')}` };
        }
        return client.get('/employees/generate-id');
    },

    /** Active employees who do not have a Users record yet (matched by email/phone). */
    getWithoutUser: async () => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            return [] as Array<Record<string, unknown>>;
        }
        return client.get('/employees/without-user');
    },
    
    getStatistics: async () => {
        if (USE_MOCK_ADAPTER) {
            await delay(MOCK_DELAY);
            const activeEmployees = DB.users.filter(u => u.role !== undefined).length;
            const newHires = DB.users.filter(u => {
                const joinDate = new Date(u.joinDate || Date.now());
                const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                return joinDate > thirtyDaysAgo;
            }).length;
            const terminated = 0; // No terminated users in mock
            
            return {
                total_employees: activeEmployees,
                new_hires: newHires,
                terminated: terminated,
                net_change: newHires - terminated
            };
        }
        return client.get('/employees/statistics');
    }
  },

  employeeMovements: {
    list: async (params?: {
      department_id?: string;
      employee_id?: string;
      type?: string;
      status?: string;
      limit?: number;
    }) => {
      const q = new URLSearchParams();
      if (params?.department_id) q.set('department_id', params.department_id);
      if (params?.employee_id) q.set('employee_id', params.employee_id);
      if (params?.type) q.set('type', params.type);
      if (params?.status) q.set('status', params.status);
      if (params?.limit) q.set('limit', String(params.limit));
      const qs = q.toString();
      return client.get(`/employee-movements${qs ? `?${qs}` : ''}`);
    },
    listPendingMyApproval: async () => client.get('/employee-movements/pending-my-approval'),
    create: async (payload: {
      employeeId: string;
      movementType: string;
      effectiveDate: string;
      toDepartmentId?: string;
      toPositionId?: string;
      toReportingManagerId?: string | null;
      toBaseSalary?: number;
      toCurrency?: string;
      newContractType?: string;
      newEmploymentStatus?: string;
      notes?: string;
      changeReason?: string;
      sourceAppraisalId?: string | null;
      assignedApproverUserId?: string;
      assignedApproverUserIds?: string[];
      saveAsDraft?: boolean;
    }) => client.post('/employee-movements', payload),
    cancel: async (id: string) => client.post(`/employee-movements/${id}/cancel`, {}),
    approve: async (id: string, notes?: string) =>
      client.post(`/employee-movements/${id}/approve`, { notes }),
    reject: async (id: string, reason?: string) =>
      client.post(`/employee-movements/${id}/reject`, { reason }),
    return: async (id: string, notes: string) =>
      client.post(`/employee-movements/${id}/return`, { notes }),
    /** Edit + resubmit a returned movement. */
    update: async (
      id: string,
      payload: {
        effectiveDate?: string;
        toDepartmentId?: string;
        toPositionId?: string;
        toBaseSalary?: number;
        toCurrency?: string;
        newContractType?: string;
        newEmploymentStatus?: string;
        notes?: string;
        changeReason?: string;
        assignedApproverUserId?: string;
        assignedApproverUserIds?: string[];
      }
    ) => client.put(`/employee-movements/${id}`, payload),
    historyFlags: async (employeeIds: string[]) => {
      if (!employeeIds.length) return { employeeIds: [] as string[] };
      const q = new URLSearchParams();
      q.set('employee_ids', employeeIds.join(','));
      return client.get(`/employee-movements/history-flags?${q.toString()}`);
    },
  },

  workflow: {
    getApprovers: async () => client.get('/workflow/approvers'),
  },

  appraisal: {
    getPeriods: async () => client.get('/appraisal/periods'),
    createPeriod: async (data: Record<string, unknown>) => client.post('/appraisal/periods', data),
    updatePeriod: async (id: string, data: Record<string, unknown>) =>
      client.put(`/appraisal/periods/${id}`, data),
    deletePeriod: async (id: string) => client.delete(`/appraisal/periods/${id}`),
    getComponents: async () => client.get('/appraisal/kpi-components'),
    saveComponents: async (components: Record<string, unknown>[]) =>
      client.put('/appraisal/kpi-components', { components }),
    getAttendanceRules: async () => client.get('/appraisal/attendance-rules'),
    saveAttendanceRules: async (rules: Record<string, unknown>[]) =>
      client.put('/appraisal/attendance-rules', { rules }),
    getPolicy: async () => client.get('/appraisal/policy'),
    savePolicy: async (policy: Record<string, unknown>) => client.put('/appraisal/policy', policy),
    getRecommendationRules: async () => client.get('/appraisal/recommendation-rules'),
    saveRecommendationRules: async (rules: Record<string, unknown>[]) =>
      client.put('/appraisal/recommendation-rules', { rules }),
    listAppraisals: async (params?: { periodId?: string; userId?: string; status?: string }) => {
      const qs = new URLSearchParams();
      if (params?.periodId) qs.set('periodId', params.periodId);
      if (params?.userId) qs.set('userId', params.userId);
      if (params?.status) qs.set('status', params.status);
      const q = qs.toString();
      return client.get(`/appraisal/appraisals${q ? `?${q}` : ''}`);
    },
    listPendingMyApproval: async () => client.get('/appraisal/pending-my-approval'),
    getAppraisal: async (id: string) => client.get(`/appraisal/appraisals/${id}`),
    getMySelfEvaluations: async () => client.get('/appraisal/my-self-evaluations'),
    getMyPerformance: async () => client.get('/appraisal/my-performance'),
    getMyPerformanceDetail: async (id: string) =>
      client.get(`/appraisal/my-performance/appraisals/${id}`),
    submitSelfEvaluation: async (
      id: string,
      data: {
        strengths?: string;
        weaknesses?: string;
        notes?: string;
        scores?: Array<{ componentId: string; rawScore: number }>;
      }
    ) => client.post(`/appraisal/appraisals/${id}/self-evaluation`, data),
    createAppraisal: async (data: Record<string, unknown>) =>
      client.post('/appraisal/appraisals', data),
    bulkCreate: async (periodId: string) =>
      client.post('/appraisal/appraisals', { bulkPeriodId: periodId }),
    saveScores: async (id: string, scores: Record<string, unknown>[]) =>
      client.put(`/appraisal/appraisals/${id}/scores`, { scores }),
    saveEvaluation: async (
      id: string,
      data: { strengths?: string; weaknesses?: string; managerRecommendations?: string }
    ) => client.put(`/appraisal/appraisals/${id}/evaluation`, data),
    workflow: async (
      id: string,
      action: string,
      options?: {
        notes?: string;
        assignedManagerUserId?: string;
        assignedEvaluatorUserIds?: string[];
        assignedFinalApproverUserId?: string;
        assignedFinalApproverUserIds?: string[];
        evaluation?: {
          strengths?: string;
          weaknesses?: string;
          managerRecommendations?: string;
        };
      }
    ) =>
      client.post(`/appraisal/appraisals/${id}/workflow`, {
        action,
        notes: options?.notes,
        assignedManagerUserId: options?.assignedManagerUserId,
        assignedEvaluatorUserIds: options?.assignedEvaluatorUserIds,
        assignedFinalApproverUserId: options?.assignedFinalApproverUserId,
        assignedFinalApproverUserIds: options?.assignedFinalApproverUserIds,
        evaluation: options?.evaluation,
      }),
    getManagerAssignees: async (departmentId: string) => {
      const qs = new URLSearchParams({ departmentId });
      return client.get(`/appraisal/manager-assignees?${qs.toString()}`);
    },
    getHistory: async (userId: string) => client.get(`/appraisal/history/${userId}`),
    getAnalytics: async (params?: { periodId?: string; departmentId?: string }) => {
      const qs = new URLSearchParams();
      if (params?.periodId) qs.set('periodId', params.periodId);
      if (params?.departmentId) qs.set('departmentId', params.departmentId);
      const q = qs.toString();
      return client.get(`/appraisal/analytics${q ? `?${q}` : ''}`);
    },
    previewAutomatic: async (userId: string, periodId: string, metric: string) => {
      const qs = new URLSearchParams({ userId, periodId, metric });
      return client.get(`/appraisal/preview/automatic?${qs.toString()}`);
    },
  },

  reviews: {
    getProbation: async () => client.get('/reviews/probation'),
    getProbationHrAssignees: async () => client.get('/reviews/probation/hr-assignees'),
    getProbationManagerAssignees: async (departmentId?: string) => {
      const qs = departmentId ? `?departmentId=${encodeURIComponent(departmentId)}` : '';
      return client.get(`/reviews/probation/manager-assignees${qs}`);
    },
    getProbationHistory: async (userId: string) =>
      client.get(`/reviews/probation/history/${encodeURIComponent(userId)}`),
    submitProbationReview: async (data: Record<string, unknown>) =>
      client.post('/reviews/probation/submit', data),
    listPendingProbationMyApproval: async () =>
      client.get('/reviews/probation/pending-my-approval', { noCache: true }),
    probationWorkflow: async (
      reviewId: string,
      action: 'approve_final' | 'reject_final' | 'return_final',
      body?: { notes?: string }
    ) => client.post(`/reviews/probation/workflow/${encodeURIComponent(reviewId)}`, { action, ...body }),
    getMyProbationSelfEvaluation: async () => client.get('/reviews/probation/my-self-evaluation'),
    submitProbationSelfEvaluation: async (data: Record<string, unknown>) =>
      client.post('/reviews/probation/self-evaluation', data),
    getAll: async (type?: string) =>
      client.get(type ? `/reviews?type=${encodeURIComponent(type)}` : '/reviews'),
    save: async (data: Record<string, unknown>) => client.post('/reviews', data),
    update: async (id: string, data: Record<string, unknown>) => client.put(`/reviews/${id}`, data),
  },

  analytics: {
    getPersonal: async (params: {
      preset?: string;
      startDate?: string;
      endDate?: string;
      userId?: string;
    }) => {
      const qs = new URLSearchParams();
      if (params.preset) qs.set('preset', params.preset);
      if (params.startDate) qs.set('startDate', params.startDate);
      if (params.endDate) qs.set('endDate', params.endDate);
      if (params.userId) qs.set('userId', params.userId);
      const q = qs.toString();
      return client.get(`/analytics/personal${q ? `?${q}` : ''}`);
    },
    getKpiGrades: async () => client.get('/analytics/kpi-grades'),
    saveKpiGrades: async (grades: Array<Record<string, unknown>>) =>
      client.put('/analytics/kpi-grades', { grades }),
  },

  personalHub: {
    getOverview: async (userId?: string) => {
      const qs = userId ? `?userId=${encodeURIComponent(userId)}` : '';
      return client.get(`/analytics/personal-hub/overview${qs}`);
    },
    getWorkRoster: async (month: string, userId?: string) => {
      const qs = new URLSearchParams({ month });
      if (userId) qs.set('userId', userId);
      return client.get(`/analytics/personal-hub/work-roster?${qs}`);
    },
    getRequests: async (userId?: string, limit?: number) => {
      const qs = new URLSearchParams();
      if (userId) qs.set('userId', userId);
      if (limit) qs.set('limit', String(limit));
      const q = qs.toString();
      return client.get(`/analytics/personal-hub/requests${q ? `?${q}` : ''}`);
    },
    listNotes: async () => client.get('/analytics/personal-hub/notes'),
    createNote: async (body: { title?: string; body?: string }) =>
      client.post('/analytics/personal-hub/notes', body),
    updateNote: async (id: string, body: { title?: string; body?: string }) =>
      client.put(`/analytics/personal-hub/notes/${id}`, body),
    deleteNote: async (id: string) => client.delete(`/analytics/personal-hub/notes/${id}`),
    listAlerts: async () => client.get('/analytics/personal-hub/alerts'),
    createAlert: async (body: { title: string; alertAt: string; notes?: string }) =>
      client.post('/analytics/personal-hub/alerts', body),
    updateAlert: async (
      id: string,
      body: { title?: string; alertAt?: string; notes?: string; isDone?: boolean }
    ) => client.put(`/analytics/personal-hub/alerts/${id}`, body),
    deleteAlert: async (id: string) => client.delete(`/analytics/personal-hub/alerts/${id}`),
  },
};
