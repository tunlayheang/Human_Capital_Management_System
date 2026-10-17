import { chipClassesForLeaveTypeLabel } from './leaveTypeColors';

/** Badge class names for leave type (approvals table, planning calendar). */
export function getLeaveTypeColor(type: string): string {
  return chipClassesForLeaveTypeLabel(type);
}

/** @deprecated Use `<StatusLabel context="leave" />` instead. */
export function getStatusColor(_status: string): string {
  return '';
}

export const MY_LEAVE_TYPE_BADGE =
  'bg-primary-100 text-primary-800 border border-primary-200 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-800';
