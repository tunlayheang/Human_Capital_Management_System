import type { ElementType } from 'react';
import {
  Building2,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  ClipboardCheck,
  Grid3x3,
  Landmark,
  LayoutGrid,
  List,
  Lock,
  Shield,
  SlidersHorizontal,
  Trophy,
  UserCheck,
  UserCog,
  UserPlus,
  ArrowRightLeft,
  UserX,
  Banknote,
  AreaChart,
  FileCheck,
  FileSpreadsheet,
  Layers,
  MapPinned,
  QrCode,
  BadgeCheck,
  ShieldPlus,
  DatabaseBackup,
  AlarmClock,
  Cog,
  LineChart,
  GanttChart,
  Hourglass,
  ScrollText,
} from 'lucide-react';
import { Role } from '../types';
import { PERM } from '../constants/permissionKeys';
import { navSections } from './navConfig';
import { canAccessFullPayrollModule } from '../utils/payrollAccess';

export type ModuleSidebarChild = {
  navKey: string;
  fallbackLabel: string;
  path: string;
  icon: ElementType;
  search?: string;
  labelKey?: string;
  roles?: Role[];
  permKey?: string;
  /** Visible when the user holds any of these permission keys. */
  permAnyKeys?: string[];
};

export type ModuleSidebarContext = {
  hasRole: (roles: Role | Role[]) => boolean;
  hasPermission: (key: string) => boolean;
  /** Role menu config — hide sub-items when base path is not allowed for this user. */
  isPathVisible?: (path: string, search?: string) => boolean;
  userRole?: Role | string;
  isAdminHRManager: boolean;
  isManagerOnly: boolean;
  isHrLeaveOps: boolean;
  canPlanningAndConfig: boolean;
  canApproveOvertime: boolean;
  canConfigOvertime: boolean;
  hasEmployeeView: boolean;
  hasEmployeeCreate: boolean;
  hasEmployeeMovements: boolean;
  hasOffboardingAccess: boolean;
};

function child(
  navKey: string,
  fallbackLabel: string,
  path: string,
  icon: ElementType,
  opts?: { search?: string; labelKey?: string; roles?: Role[]; permKey?: string; permAnyKeys?: string[] }
): ModuleSidebarChild {
  return { navKey, fallbackLabel, path, icon, ...opts };
}

const moduleNavParentByKey = new Map(
  navSections.flatMap((section) => section.items.map((item) => [item.navKey, item] as const))
);

export function getModuleNavParent(navKey: string) {
  return moduleNavParentByKey.get(navKey);
}

/** Sub-menu entries for a sidebar module (replaces horizontal SegmentTabs). */
export function getModuleSidebarChildren(
  navKey: string,
  ctx: ModuleSidebarContext
): ModuleSidebarChild[] | null {
  switch (navKey) {
    case 'mgmt-attendance':
      return [
        child('att-mgmt-list', 'Attendance list', '/attendance', List, {
          search: '?scope=manage&tab=list',
          permKey: PERM.ATTENDANCE_VIEW,
        }),
        child('att-mgmt-tracking', 'Leaderboard', '/attendance', Trophy, {
          search: '?scope=manage&tab=tracking',
          permKey: PERM.ATTENDANCE_VIEW,
        }),
        child('att-mgmt-settings-rules', 'Clock rules', '/attendance', AlarmClock, {
          search: '?scope=manage&tab=settings&settingsTab=rules',
          permKey: PERM.ATTENDANCE_MANAGE,
        }),
      ];

    case 'mgmt-leave': {
      const items: ModuleSidebarChild[] = [];
      if (ctx.hasPermission(PERM.LEAVE_APPROVE)) {
        items.push(
          child('leave-requests', 'Leave Approval', '/leaves', CheckCircle2, {
            search: '?scope=manage&tab=requests',
            permKey: PERM.LEAVE_APPROVE,
          })
        );
      }
      if (ctx.hasPermission(PERM.LEAVE_EDIT) || ctx.canPlanningAndConfig) {
        if (ctx.hasPermission(PERM.LEAVE_EDIT)) {
          items.push(
            child('leave-planning', 'Leave planning', '/leaves', CalendarRange, {
              search: '?scope=manage&tab=planning',
              permKey: PERM.LEAVE_EDIT,
            }),
            child('leave-config', 'Leave configuration', '/leaves', SlidersHorizontal, {
              search: '?scope=manage&tab=config',
              permKey: PERM.LEAVE_EDIT,
            })
          );
        }
      }
      return items.length ? items : null;
    }

    case 'mgmt-overtime': {
      const items: ModuleSidebarChild[] = [];
      if (!ctx.canApproveOvertime) {
        items.push(
          child('ot-my', 'My overtime', '/overtime', Hourglass, {
            search: '?scope=manage&tab=my_overtime',
            permKey: PERM.OVERTIME_VIEW,
          })
        );
      }
      if (ctx.canApproveOvertime) {
        items.push(
          child('ot-requests', 'OT Approval', '/overtime', ClipboardCheck, {
            search: '?scope=manage&tab=requests',
            permKey: PERM.OVERTIME_MANAGE,
          })
        );
      }
      if (ctx.canConfigOvertime) {
        items.push(
          child('ot-config', 'OT configuration', '/overtime', Cog, {
            search: '?scope=manage&tab=config',
            permKey: PERM.OVERTIME_CONFIG,
          })
        );
      }
      return items.length ? items : null;
    }

    case 'mgmt-employees': {
      const items: ModuleSidebarChild[] = [];
      // Onboarding opens the employee list first; creators also get a New Employee action there.
      if (ctx.hasEmployeeView || ctx.hasEmployeeCreate) {
        items.push(
          child('emp-onboard', 'Onboarding', '/employees/onboarding', UserPlus, {
            permAnyKeys: [PERM.EMPLOYEE_VIEW, PERM.EMPLOYEE_CREATE],
          })
        );
      }
      if (ctx.hasEmployeeMovements || ctx.hasEmployeeView) {
        items.push(
          child('emp-movements', 'Movements', '/employees/movements', ArrowRightLeft, {
            permKey: PERM.EMPLOYEE_MOVEMENTS,
          })
        );
      }
      if (ctx.hasOffboardingAccess) {
        items.push(
          child('emp-offboarding', 'Offboarding list', '/employees/offboarding', UserX, {
            permAnyKeys: [PERM.EMPLOYEE_OFFBOARD, PERM.EMPLOYEE_TERMINATE],
          })
        );
      }
      return items.length ? items : null;
    }

    case 'mgmt-performance': {
      const items: ModuleSidebarChild[] = [
        child('perf-analytics', 'Performance analytics', '/performance', LineChart, {
          search: '?tab=kpi-analytics',
          permKey: PERM.PERFORMANCE_VIEW,
        }),
        child('perf-kpi', 'Appraisals', '/performance', FileCheck, {
          search: '?tab=kpi-appraisals',
          permAnyKeys: [PERM.PERFORMANCE_VIEW, PERM.PERFORMANCE_APPRAISAL_VIEW],
        }),
        child('perf-probation', 'Probation', '/performance', UserCheck, {
          search: '?tab=probation',
          permKey: PERM.PERFORMANCE_VIEW,
        }),
        child('perf-config', 'Performance configuration', '/performance', Layers, {
          search: '?tab=kpi-settings',
          permAnyKeys: [PERM.PERFORMANCE_MANAGE, PERM.PERFORMANCE_APPRAISAL_MANAGE],
        }),
      ];
      if (ctx.isManagerOnly) {
        return items.filter((item) => ['perf-kpi', 'perf-probation'].includes(item.navKey));
      }
      return items;
    }

    case 'mgmt-payroll':
      return [
        child('pay-dash', 'Payroll overview', '/payroll', Landmark, { permKey: PERM.PAYROLL_VIEW }),
        child('pay-cal', 'Payroll schedule', '/payroll/calendar', CalendarClock, { permKey: PERM.PAYROLL_VIEW }),
        child('pay-rules', 'Payroll rules', '/payroll/rules', ScrollText, {
          permKey: PERM.PAYROLL_VIEW,
        }),
        child('pay-approvals', 'Payroll Approval', '/payroll/approvals', BadgeCheck, {
          permAnyKeys: [PERM.PAYROLL_APPROVE, PERM.PAYROLL_PROCESS, PERM.PAYROLL_VIEW],
        }),
        child('pay-payment', 'Payment', '/payroll/payment', Banknote, {
          permKey: PERM.PAYROLL_PROCESS,
        }),
      ];

    case 'mgmt-reports':
      return [
        child('rep-overview', 'Report analytics', '/reports', AreaChart, {
          permKey: PERM.REPORTS_VIEW,
        }),
        child('rep-catalog', 'Reports Module Structure', '/reports/catalog', FileSpreadsheet, {
          permKey: PERM.REPORTS_VIEW,
        }),
      ];

    case 'mgmt-projects':
      return [
        child('proj-overview', 'Project overview', '/projects', LayoutGrid, {
          search: '?scope=manage&tab=overview',
          permKey: PERM.PROJECTS_VIEW,
        }),
        child('proj-timeline', 'Project timeline', '/projects', GanttChart, {
          search: '?scope=manage&tab=timeline',
          permKey: PERM.PROJECTS_VIEW,
        }),
      ];

    case 'admin-permissions':
      return [
        child('perm-roles', 'Role management', '/permissions', Shield, {
          search: '?tab=roles',
          permAnyKeys: [PERM.PERMISSIONS_VIEW, PERM.PERMISSIONS_MANAGE],
        }),
        child('perm-matrix', 'Permission matrix', '/permissions', Grid3x3, {
          search: '?tab=matrix',
          permAnyKeys: [PERM.PERMISSIONS_VIEW, PERM.PERMISSIONS_MANAGE],
        }),
        child('perm-overrides', 'User overrides', '/permissions', UserCog, {
          search: '?tab=overrides',
          permAnyKeys: [PERM.PERMISSIONS_VIEW, PERM.PERMISSIONS_MANAGE],
        }),
      ];

    case 'admin-settings':
      return [
        child('set-company', 'Company profile', '/settings', Building2, {
          search: '?tab=company',
          permKey: PERM.SETTINGS_VIEW,
        }),
        child('set-security', 'Security', '/settings', Lock, {
          search: '?tab=security',
          permKey: PERM.SETTINGS_SECURITY_VIEW,
        }),
        child('set-office', 'Office location', '/settings', MapPinned, {
          search: '?tab=office',
          permKey: PERM.SETTINGS_EDIT,
        }),
        child('set-qr', 'Generate QR', '/settings', QrCode, {
          search: '?tab=qr',
          permKey: PERM.SETTINGS_VIEW,
        }),
        child('set-admin', 'Create admin', '/settings', ShieldPlus, {
          search: '?tab=create_admin',
          permKey: PERM.USERS_MANAGE,
        }),
        child('set-backup', 'Backup', '/settings/backup', DatabaseBackup, {
          roles: [Role.ADMIN],
        }),
      ];

    default:
      return null;
  }
}

const PAYROLL_FULL_MODULE_CHILD_KEYS = new Set([
  'pay-dash',
  'pay-cal',
  'pay-rules',
]);

export function filterModuleSidebarChildren(
  children: ModuleSidebarChild[],
  ctx: ModuleSidebarContext,
  modulePath?: string,
  moduleSearch?: string
): ModuleSidebarChild[] {
  return children.filter((c) => {
    if (c.roles?.length && !c.roles.some((r) => ctx.hasRole(r))) return false;
    if (ctx.isPathVisible) {
      const childPathVisible = ctx.isPathVisible(c.path, c.search);
      if (modulePath) {
        const parentVisible = ctx.isPathVisible(modulePath, moduleSearch);
        if (!parentVisible && !childPathVisible) return false;
      } else if (!childPathVisible) {
        return false;
      }
      // Parent module path allowed — still honor per-item permission keys.
      if (PAYROLL_FULL_MODULE_CHILD_KEYS.has(c.navKey)) {
        if (!canAccessFullPayrollModule(ctx.hasPermission, ctx.userRole)) return false;
      } else if (c.permAnyKeys?.length) {
        if (!c.permAnyKeys.some((key) => ctx.hasPermission(key))) return false;
      } else if (c.permKey && !ctx.hasPermission(c.permKey)) return false;
      return true;
    }
    if (PAYROLL_FULL_MODULE_CHILD_KEYS.has(c.navKey)) {
      if (!canAccessFullPayrollModule(ctx.hasPermission, ctx.userRole)) return false;
    } else if (c.permAnyKeys?.length) {
      if (!c.permAnyKeys.some((key) => ctx.hasPermission(key))) return false;
    } else if (c.permKey && !ctx.hasPermission(c.permKey)) return false;
    return true;
  });
}

/** Visible sub-menu items for a module, or null when the item should render as a plain link. */
export function getVisibleModuleChildren(
  navKey: string,
  ctx: ModuleSidebarContext
): ModuleSidebarChild[] | null {
  if (!MODULE_NAV_KEYS_WITH_CHILDREN.has(navKey)) return null;
  const raw = getModuleSidebarChildren(navKey, ctx);
  if (!raw?.length) return null;
  const parent = getModuleNavParent(navKey);
  const filtered = filterModuleSidebarChildren(
    raw,
    ctx,
    parent?.path,
    parent?.search
  );
  return filtered.length ? filtered : null;
}

/** Nav keys that use expandable sidebar sub-menus instead of in-page tabs. */
export const MODULE_NAV_KEYS_WITH_CHILDREN = new Set([
  'mgmt-attendance',
  'mgmt-leave',
  'mgmt-overtime',
  'mgmt-employees',
  'mgmt-performance',
  'mgmt-payroll',
  'mgmt-reports',
  'mgmt-projects',
  'admin-permissions',
  'admin-settings',
]);
