import { AttendanceStatus, Role } from '../types';

type TFn = (path: string, vars?: Record<string, string | number>) => string;

const ATTENDANCE_STATUS_KEYS: Record<string, string> = {
  [AttendanceStatus.PRESENT]: 'attendance.status.present',
  [AttendanceStatus.LATE]: 'attendance.status.late',
  [AttendanceStatus.DAY_OFF]: 'attendance.status.dayOff',
  [AttendanceStatus.PH]: 'attendance.status.ph',
  [AttendanceStatus.MISSION]: 'attendance.status.mission',
  [AttendanceStatus.ON_LEAVE]: 'attendance.status.onLeave',
  [AttendanceStatus.PAID_LEAVE]: 'attendance.status.paidLeave',
  [AttendanceStatus.UNPAID_LEAVE]: 'attendance.status.unpaidLeave',
  [AttendanceStatus.ABSENT]: 'attendance.status.absent',
  [AttendanceStatus.AWAITING]: 'attendance.status.absent',
};

const PAYROLL_RUN_STATUS_KEYS: Record<string, string> = {
  PROCESSING: 'payroll.runStatus.processing',
  PENDING_APPROVAL: 'payroll.runStatus.pendingApproval',
  APPROVED: 'payroll.runStatus.approved',
  COMPLETED: 'payroll.runStatus.completed',
  PAID: 'payroll.runStatus.paid',
  DRAFT: 'payroll.runStatus.draft',
  REJECTED: 'payroll.runStatus.rejected',
  CANCELLED: 'payroll.runStatus.cancelled',
};

const ROLE_KEYS: Record<string, string> = {
  [Role.ADMIN]: 'messages.admin',
  [Role.HR]: 'messages.hr',
  [Role.MANAGER]: 'messages.manager',
  [Role.EMPLOYEE]: 'messages.employee',
  STAFF: 'messages.employee',
};

export function translateAttendanceStatus(status: AttendanceStatus | string, t: TFn): string {
  const key = ATTENDANCE_STATUS_KEYS[String(status).toUpperCase()];
  if (key) {
    const label = t(key);
    if (label && !label.includes('.')) return label;
  }
  return t(`attendance.status.${String(status).toLowerCase()}`) || String(status);
}

export function translatePayrollRunStatus(status: string, t: TFn): string {
  const normalized = String(status).toUpperCase().replace(/\s+/g, '_');
  const key = PAYROLL_RUN_STATUS_KEYS[normalized];
  if (key) return t(key);
  return t(`payroll.runStatus.${normalized.toLowerCase()}`) || status.replace(/_/g, ' ');
}

export function translateRole(role: Role | string, t: TFn): string {
  const key = ROLE_KEYS[String(role).toUpperCase()];
  if (key) {
    const label = t(key);
    if (label && !label.includes('.')) return label;
  }
  // Fallback: EMPLOYEE → Staff even if i18n key is missing
  const upper = String(role ?? '').toUpperCase();
  if (upper === 'EMPLOYEE' || upper === 'STAFF') return 'Staff';
  if (upper === 'ADMIN') return 'Admin';
  if (upper === 'HR') return 'HR';
  if (upper === 'MANAGER') return 'Manager';
  return String(role);
}

export function localeForLanguage(language: 'en' | 'km'): string | undefined {
  return language === 'km' ? 'km-KH' : undefined;
}
