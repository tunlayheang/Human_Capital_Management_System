import { normalizeWorkspacePath, normalizeWorkspaceSearch } from './workspaceTabs';
import {
  getCachedReportCatalogTitle,
  humanizeReportCatalogId,
} from './reportCatalogTitleCache';

type TFn = (key: string) => string;

function tOr(key: string, fallback: string, t: TFn): string {
  const translated = t(key);
  return translated && translated !== key && !translated.includes('.') ? translated : fallback;
}

/** Fallback tab titles for detail / wizard routes before async data loads. */
export function resolveDetailWorkspaceTabLabel(
  pathname: string,
  _search: string,
  t: TFn
): string | null {
  const path = normalizeWorkspacePath(pathname);

  const exactPathLabels: Record<string, { key: string; fallback: string }> = {
    '/employees': { key: 'employees.listTab', fallback: 'Employee list' },
    '/employees/onboarding': { key: 'employees.onboardingTab', fallback: 'Onboarding' },
    '/employees/movements': { key: 'employees.movementsTab', fallback: 'Movements' },
    '/employees/offboarding': { key: 'employees.offboardingTab', fallback: 'Offboarding list' },
  };
  const exact = exactPathLabels[path];
  if (exact) return tOr(exact.key, exact.fallback, t);

  if (/^\/departments\/[^/]+$/.test(path)) {
    return tOr('departments.detailTab', 'Department', t);
  }
  if (/^\/payroll\/runs\/[^/]+$/.test(path)) {
    return tOr('payroll.runDetailTab', 'Payroll run', t);
  }
  if (/^\/projects\/[^/]+$/.test(path)) {
    return tOr('projects.detailTab', 'Project', t);
  }
  if (path.includes('/employees/onboarding/new') || path.endsWith('/employees/new')) {
    return tOr('employees.newEmployee', 'New employee', t);
  }
  if (/\/employees\/[^/]+\/edit$/.test(path) || path.includes('/employees/edit/')) {
    return tOr('employees.editEmployeeTab', 'Edit employee', t);
  }
  if (path.includes('/employees/offboarding/wizard')) {
    return tOr('employees.offboardingWizardTab', 'Offboarding wizard', t);
  }
  if (path.includes('/employees/offboarding/payment')) {
    return tOr('employees.offboardingPaymentTab', 'Final settlement', t);
  }
  if (path.includes('/employees/movements/wizard')) {
    return tOr('employees.movementWizardTab', 'Employee movement', t);
  }
  if (path.includes('/employees/card/')) {
    return tOr('employees.cardTab', 'Employee card', t);
  }
  if (path === '/reports/catalog') {
    const params = new URLSearchParams(normalizeWorkspaceSearch(_search).slice(1));
    const reportId = params.get('report')?.trim() || '';
    if (reportId) {
      return (
        getCachedReportCatalogTitle(reportId) ||
        humanizeReportCatalogId(reportId)
      );
    }
    return tOr('reports.module.catalogTitle', 'Reports Module Structure', t);
  }

  return null;
}

/** Tab label from `?tab=` when sidebar child matching is unavailable. */
export function resolveQueryTabWorkspaceLabel(
  pathname: string,
  search: string,
  t: TFn
): string | null {
  const path = normalizeWorkspacePath(pathname);
  const params = new URLSearchParams(normalizeWorkspaceSearch(search).slice(1));
  const tab = params.get('tab');
  if (!tab) return null;

  if (path === '/settings') {
    const map: Record<string, string> = {
      company: tOr('settings.companyProfile', 'Company profile', t),
      security: tOr('settings.security', 'Security', t),
      office: tOr('settings.officeLocation', 'Office location', t),
      qr: tOr('settings.generateQr', 'Generate QR', t),
      create_admin: tOr('settings.createAdmin', 'Create admin', t),
    };
    // In-page company sections (General, Branding, …) stay on the same sidebar item.
    return map[tab] ?? null;
  }

  if (path === '/permissions') {
    const map: Record<string, string> = {
      roles: tOr('permissions.rolesTab', 'Role management', t),
      matrix: tOr('permissions.matrixTab', 'Permission matrix', t),
      overrides: tOr('permissions.overridesTab', 'User overrides', t),
    };
    return map[tab] ?? null;
  }

  if (path === '/attendance') {
    const scope = params.get('scope');
    const map: Record<string, string> = {
      list: tOr('attendance.listTab', 'Attendance list', t),
      tracking: tOr('attendance.trackingTab', 'Leaderboard', t),
      settings: tOr('attendance.settingsTab', 'Clock rules', t),
    };
    if (map[tab]) return map[tab];
    if (scope === 'self') return tOr('nav.attendance', 'Attendance', t);
  }

  if (path === '/leaves') {
    const map: Record<string, string> = {
      requests: tOr('leaves.requestsTab', 'Leave approval', t),
      planning: tOr('leaves.planningTab', 'Leave planning', t),
      config: tOr('leaves.configTab', 'Leave configuration', t),
    };
    return map[tab] ?? null;
  }

  if (path === '/overtime') {
    const map: Record<string, string> = {
      my: tOr('overtime.myTab', 'My overtime', t),
      my_overtime: tOr('overtime.myTab', 'My overtime', t),
      requests: tOr('overtime.requestsTab', 'OT Approval', t),
      config: tOr('overtime.configTab', 'OT configuration', t),
    };
    return map[tab] ?? null;
  }

  if (path === '/payroll') {
    const map: Record<string, string> = {
      dashboard: tOr('payroll.dashboardTab', 'Payroll overview', t),
      calendar: tOr('payroll.calendarTab', 'Payroll calendar', t),
      rules: tOr('payroll.rulesTab', 'Payroll rules', t),
      approvals: tOr('payroll.approvalsTab', 'Payroll Approval', t),
      payment: tOr('payroll.paymentTab', 'Payment', t),
      historical: tOr('payroll.historicalTab', 'Payroll history', t),
    };
    return map[tab] ?? null;
  }

  if (path === '/payroll/rules') {
    const map: Record<string, string> = {
      tax: tOr('nav.modules.pay-rules-tax', 'Tax', t),
      nssf: tOr('nav.modules.pay-rules-nssf', 'NSSF', t),
      allowance: tOr('nav.modules.pay-rules-allowance', 'Allowance', t),
      unified: tOr('nav.modules.pay-rules-work', 'Work & leave', t),
      seniority: tOr('nav.modules.pay-rules-seniority', 'Siniority', t),
    };
    return map[tab] ?? tOr('payroll.rulesTab', 'Payroll rules', t);
  }

  if (path === '/performance') {
    const map: Record<string, string> = {
      'kpi-appraisals': tOr('nav.modules.perf-kpi', 'Appraisals', t),
      'kpi-analytics': tOr('performance.tabs.analytics', 'Performance analytics', t),
      'kpi-settings': tOr('performance.tabs.configuration', 'Performance configuration', t),
      probation: tOr('nav.modules.perf-probation', 'Probation', t),
      'kpi-approvals': tOr('nav.modules.perf-kpi', 'Appraisals', t),
      'probation-approvals': tOr('nav.modules.perf-probation', 'Probation', t),
    };
    return map[tab] ?? null;
  }

  if (path === '/projects') {
    const map: Record<string, string> = {
      overview: tOr('projects.overviewTab', 'Project overview', t),
      timeline: tOr('projects.timelineTab', 'Project timeline', t),
    };
    return map[tab] ?? null;
  }

  if (path === '/reports') {
    const map: Record<string, string> = {
      overview: tOr('reports.overviewTab', 'Report analytics', t),
      catalog: tOr('reports.module.catalogTitle', 'Reports Module Structure', t),
    };
    return map[tab] ?? null;
  }

  return null;
}
