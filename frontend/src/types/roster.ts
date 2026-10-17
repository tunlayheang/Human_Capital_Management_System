export interface MonthlyRosterEntry {
  employeeId: string;
  day: number;
  leaveType: string;
  isLocked?: boolean;
  /** Present when the cell was auto-filled from an approved leave request. */
  sourceLeaveRequestId?: string | null;
}

export interface MonthlyFixedRoster {
  id: string;
  month: number;
  year: number;
  name: string;
  entries: MonthlyRosterEntry[];
  createdAt: string;
  updatedAt: string;
}

export type CalendarPlanningEntry = {
  id: string;
  /** User id for approved leaves; employee id for fixed roster cells. */
  userId: string;
  /** Resolved display name when roster entry uses employee id. */
  employeeName?: string;
  type: string;
  startDate: string;
  endDate: string;
  isFixedRoster?: boolean;
  /** Roster cell created from approved leave sync (dedupe with live leave list). */
  fromApprovedLeave?: boolean;
};
