export type { OfficeLocationZone as OfficeLocation } from './types/attendance';

export enum Role {
  ADMIN = 'ADMIN',     
  HR = 'HR',           
  MANAGER = 'MANAGER', 
  EMPLOYEE = 'EMPLOYEE'
}

export enum AttendanceStatus {
  PRESENT = 'PRESENT',
  LATE = 'LATE',
  ABSENT = 'ABSENT',
  /** @deprecated Prefer PAID_LEAVE / UNPAID_LEAVE — kept for legacy rows. */
  ON_LEAVE = 'ON_LEAVE',
  /** Approved or roster leave that counts toward paid days. */
  PAID_LEAVE = 'PAID_LEAVE',
  /** Approved or roster leave that does not count toward paid days. */
  UNPAID_LEAVE = 'UNPAID_LEAVE',
  /** Scheduled rest day (planning roster / weekly off) — no clock-in expected. */
  DAY_OFF = 'DAY_OFF',
  /** Employer public holiday on planning roster — paid day, no clock-in expected. */
  PH = 'PH',
  /** Mission / offsite work on planning roster — clock in/out recorded with Mission status. */
  MISSION = 'MISSION',
  /** No clock-in yet today (admin grid placeholder before end-of-day reconcile). */
  AWAITING = 'AWAITING',
}

export enum LeaveStatus {
  PENDING = 'PENDING',
  /** Manager approved — awaiting HR final approval */
  MANAGER_APPROVED = 'MANAGER_APPROVED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  /** Returned to submitter for revision / resubmit */
  RETURNED = 'RETURNED',
  /** Withdrawn by employee before final approval */
  CANCELLED = 'CANCELLED',
}

export type OvertimeRateTier =
  | 'regular_100'
  | 'daytime_150'
  | 'rest_holiday_200'
  | 'night_200';

export type OvertimeRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED' | 'CANCELLED';

/** One approver in an ordered request-approval chain (Leave / Overtime). */
export type WorkflowAssignedApprover = {
  userId: string;
  name: string | null;
  status: 'pending' | 'approved';
  approvedAt: string | null;
  sortOrder: number;
  phase: 'approved' | 'current' | 'queued';
};

/** Shared chain fields returned by Leave / Overtime DTOs when approvers were selected. */
export interface WorkflowApproverChainFields {
  assignedApproverUserIds?: string[];
  assignedApprovers?: WorkflowAssignedApprover[];
  currentApproverUserId?: string | null;
  currentApproverName?: string | null;
  approvalProgress?: { approved: number; total: number } | null;
}

export interface OvertimeRequest extends WorkflowApproverChainFields {
  id: string;
  userId: string;
  employeeId?: string | null;
  otTypeId?: string | null;
  otTypeName?: string | null;
  /** Khmer label from linked overtime type when available. */
  otTypeNameKh?: string | null;
  workDate: string;
  hours: number;
  rateTier: OvertimeRateTier;
  reason: string;
  status: OvertimeRequestStatus;
  appliedOn?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  clockIn?: string | null;
  clockOut?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type OvertimeTypeRules = {
  minHours: number;
  maxHoursPerDay: number;
  minAdvanceDays: number;
  requireStartEndTime: boolean;
  requireClockInOut: boolean;
};

export type OvertimeType = {
  id: string;
  name: string;
  nameKh?: string;
  description?: string;
  descriptionKh?: string;
  rateTier: OvertimeRateTier;
  isActive: boolean;
  rules: OvertimeTypeRules;
};

export type OvertimeRequestConfig = {
  types: OvertimeType[];
  globalMaxHoursPerMonth: number;
};

export enum ProjectStatus {
  PLANNING = 'PLANNING',
  ACTIVE = 'ACTIVE',
  ON_HOLD = 'ON_HOLD',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum TaskStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  REVIEW = 'REVIEW',
  DONE = 'DONE',
  BLOCKED = 'BLOCKED',
}

export type ProjectPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TaskPriority = ProjectPriority;

export enum NotificationType {
  INFO = 'INFO',
  WARNING = 'WARNING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}

export interface Department {
  id: string;
  name: string;
  /** Official department name in Khmer script */
  nameKh?: string;
  /** Short internal unit code (e.g. HR, FIN) */
  code?: string;
  headCount: number;
  managerId?: string;
  managerName?: string;
  officeLocationId?: string;
  officeLocationName?: string;
  /** Soft status — inactive units stay for history but are not assignable. */
  isActive?: boolean;
}

export interface Position {
  id: string;
  title: string;
  /** Job title in Khmer script */
  titleKh?: string;
  departmentId: string;
  /** Organizational job level (e.g. SENIOR_OFFICER). */
  level?: string | null;
  /** Default portal access role for this position (EMPLOYEE | MANAGER | HR). */
  accessRole?: string | null;
  description?: string;
  /** Midpoint / legacy single value */
  salary?: number;
  salaryMin?: number;
  salaryMax?: number;
  /** Soft status — inactive roles stay for history but are not assignable. */
  isActive?: boolean;
  /** Employees still referencing this position (any status) — blocks hard delete. */
  assignedStaff?: number;
}

export interface EmergencyContact {
  name: string;
  relation: string;
  phone: string;
}

export interface User {
  id: string;
  /** Linked `employees.id` — profile data is loaded from the employee row. */
  employeeId?: string | null;
  /** HR display code (`employees.employee_id`, e.g. ROC00001) — shown in UI as Display ID. */
  displayEmployeeId?: string | null;
  /** Portal-only admin login code (`users.login_id`, e.g. ADM00001). Null for employee-linked accounts. */
  loginId?: string | null;
  name: string;
  email: string;
  role: Role;
  /** system = Admin portal account without an employee HR record */
  accountType?: 'system' | 'employee_linked' | 'user';
  /** Linked employee profile (when returned by user/chat APIs). */
  employee?: {
    status?: string | null;
    employee_id?: string;
    first_name?: string;
    last_name?: string;
    full_name?: string;
    first_name_kh?: string;
    last_name_kh?: string;
    full_name_kh?: string;
    avatar_url?: string | null;
    position_title?: string | null;
    position_title_kh?: string | null;
    department_name?: string | null;
    department_name_kh?: string | null;
  } | null;
  departmentId: string;
  position: string;
  avatarUrl: string;
  joinDate: string;
  salary?: number;
  birthDate?: string;
  shiftStart?: string; 
  shiftEnd?: string;   
  phone?: string;
  address?: string;
  dependents?: number; 
  emergencyContact?: EmergencyContact;
  token?: string;
  /** Stable browser device id — bound to server session. */
  deviceId?: string;
  /** ISO timestamp — session ends after idle timeout without activity (sliding). */
  sessionExpiresAt?: string;
  /** Minutes of inactivity before logout (from Settings → Security). */
  sessionTimeoutMinutes?: number;
  permissionsOverride?: Record<string, boolean>;
  // Enhanced Profile Fields
  firstName?: string;
  lastName?: string;
  gender?: string;
  nationalId?: string;
  bio?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankName?: string;
  /** Display-only payroll / tax / NSSF currency preference (KHR authoritative). */
  preferredCurrency?: 'KHR' | 'USD';
  taxId?: string;
  startDate?: string;
  endDate?: string;
  workLocation?: string;
  employmentType?: string;
  managerId?: string;
  leaveBalance?: number;
  usedLeave?: number;
  isActive?: boolean;
  /** Chat presence — active within ~5 minutes */
  isOnline?: boolean;
  lastSeenAt?: string;
  /** False when portal login was enabled without a password yet. */
  hasPassword?: boolean;
  /** Character count of the current password (masked UI only; not the password). */
  passwordLength?: number | null;
  /** True until the user sets their own password after first login / admin reset. */
  mustChangePassword?: boolean;
  status?: string;
  /** Portal PIN lock — synced from /auth/security and profile. */
  pinSet?: boolean;
  pinLockEnabled?: boolean;
  pinMandatory?: boolean;
  pinRequired?: boolean;
  pinAutoLockMinutes?: number;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
  category?: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  entityId?: string;
  entityType?: string;
  senderId?: string;
  isRead: boolean;
  createdAt: string;
  link?: string;
}

export interface MessageQuote {
  id: string;
  senderId: string;
  senderName?: string;
  content: string;
  deletedAt?: string;
  attachmentType?: string;
}

export type ChatSystemEventKind = 'group_rename' | 'group_leave';

export interface ChatSystemEvent {
  kind: ChatSystemEventKind;
  editorId?: string;
  editorName?: string;
  oldName?: string;
  newName?: string;
  memberName?: string;
}

export interface Message {
  id: string;
  senderId: string;
  receiverId?: string | null;
  groupId?: string | null;
  content: string;
  attachmentUrl?: string;
  attachmentPath?: string;
  attachmentType?: 'image' | 'pdf' | 'file' | 'audio';
  createdAt: string;
  isRead: boolean;
  deletedAt?: string;
  isDeleted?: boolean;
  editedAt?: string;
  replyToId?: string;
  forwardedFromId?: string;
  replyTo?: MessageQuote | null;
  forwardedLabel?: string;
  messageType?: string;
  systemEvent?: ChatSystemEvent;
}

export interface ChatMuteSettings {
  muteAll: boolean;
  mutedDirect: string[];
  mutedGroups: string[];
}

export const CHAT_DELETE_WINDOW_MS = 5 * 60 * 1000;

export type ChatInboxTab = 'all' | 'group';

export interface DirectInboxItem {
  kind: 'direct';
  partnerId: string;
  partner: User;
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount: number;
  pinned?: boolean;
}

export interface GroupInboxItem {
  kind: 'group';
  groupId: string;
  name: string;
  memberCount: number;
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount: number;
  pinned?: boolean;
}

export interface AnnouncementsInboxItem {
  kind: 'announcements';
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount: number;
  pinned?: boolean;
}

export type ChatPinTarget = {
  targetKind: 'direct' | 'group';
  targetId: string;
  pinnedAt: string;
};

export type ChatInboxItem = DirectInboxItem | GroupInboxItem | AnnouncementsInboxItem;

export type ChatAnnouncement = {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  title: string | null;
  content: string;
  createdAt: string;
  read: boolean;
  /** ISO datetime — removed from dashboard ticker after this time. */
  dashboardExpiresAt?: string | null;
  activeOnDashboard?: boolean;
};

export type ChatTarget =
  | { kind: 'direct'; user: User }
  | { kind: 'group'; groupId: string; name: string; memberCount: number }
  | { kind: 'announcements' };

export interface AttendanceRecord {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  clockIn?: string; // ISO string
  clockOut?: string; // ISO string
  status: AttendanceStatus;
  workHours?: number;
  locationIn?: { lat: number; lng: number; address?: string };
  locationOut?: { lat: number; lng: number; address?: string };
  /** ISO timestamp when HR last corrected clock times */
  correctionAt?: string;
  /** User id of HR/manager who applied the correction */
  correctionBy?: string;
  /** Why the times were manually corrected */
  correctionReason?: string;
  /** What changed, e.g. "Check-in: 7:56 AM → 8:30 AM | Check-out: — → 5:12 PM" */
  correctionSummary?: string;
  /** Synthetic row for today before clock-in (not persisted in attendancerecords). */
  isGridPlaceholder?: boolean;
  /** Row loaded from MySQL attendancerecords (has clock-in/out or reconciled absence). */
  persistedInDatabase?: boolean;
  /** Approved leave type name when status is on leave (from Leave request). */
  leaveTypeLabel?: string | null;
  leaveTypeCode?: string | null;
  /** False for unpaid leave types (e.g. UNPAID). */
  leaveIsPaid?: boolean | null;
  /** Clocked in/out on a roster day off — status stays DAY_OFF; pay via OT request. */
  workedOnDayOff?: boolean;
  requiresOvertimeRequest?: boolean;
  otEligibleHours?: number | null;
  /** Minutes late after grace period (0 when on time). */
  lateMinutes?: number;
  /** Legacy flag on attendance records (warnings feature removed). */
  lateExcused?: boolean;
}

export type LeaveCategory =
  | 'accrual_based'
  | 'join_date_based'
  | 'fixed_allocation'
  | 'event_based'
  | 'approval_based';

// Updated to support dynamic types
export interface LeaveType {
  id: string;
  name: string;
  nameKh?: string;
  description?: string;
  descriptionKh?: string;
  isPaid: boolean;
  daysAllowed: number;
  leaveCategory?: LeaveCategory;
  leaveCategoryLabel?: string;
  monthlyAccrualRate?: number | null;
  yearlyResetEnabled?: boolean;
  maxCarryForward?: number;
  allowCarryForward?: boolean;
  eventTriggerType?: string | null;
  maxUsagePerEmployment?: number | null;
  affectsPayroll?: boolean;
  requiresDocument?: boolean;
  requiresApproval?: boolean;
  isActive?: boolean;
  code?: string;
}

export interface FixedRoster {
  id: string;
  name: string;
  rosterType: 'WEEKLY' | 'MONTHLY' | 'SHIFT' | 'CUSTOM';
  schedule: { days?: number[]; [key: string]: unknown };
  isActive?: boolean;
  description?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export type LeaveHalfDayPeriod = 'AM' | 'PM';

export interface LeaveRequest extends WorkflowApproverChainFields {
  id: string;
  userId: string;
  type: string; // Now refers to LeaveType.name
  /** Khmer leave type name when available from catalog. */
  typeKh?: string | null;
  startDate: string;
  endDate: string;
  /** Single-day leave for half of a working day (0.5 day balance). */
  isHalfDay?: boolean;
  /** Morning or afternoon when isHalfDay is true. */
  halfDayPeriod?: LeaveHalfDayPeriod | null;
  reason: string;
  status: LeaveStatus;
  rejectionReason?: string;
  /** Portal user id of manager who must approve first */
  assignedManagerId?: string | null;
  /** Department routing for multi-dept approvers */
  assignedDepartmentId?: string | null;
  managerApprovedAt?: string | null;
  managerApprovedBy?: string | null;
  hrApprovedAt?: string | null;
  hrApprovedBy?: string | null;
  /** Date-only legacy field (YYYY-MM-DD). */
  appliedOn?: string | null;
  /** When the request was submitted (from DB). */
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type LeaveApproverManager = {
  id: string;
  name: string;
  email: string;
  role: string;
  departmentId?: string;
  departmentName?: string;
  isDepartmentHead?: boolean;
};

export type LeaveApproverDepartment = {
  departmentId: string;
  departmentName: string;
  managers: LeaveApproverManager[];
};

export type LeaveApproverManagersResponse = {
  departments: LeaveApproverDepartment[];
  managers: LeaveApproverManager[];
  suggestedManagerId?: string | null;
  suggestedDepartmentId?: string | null;
};

/** Leave type toggle in employee Work Schedule (HR assignment). */
export type LeaveAssignmentOption = {
  leaveTypeId: string;
  name: string;
  nameKh?: string | null;
  code: string;
  isPaid: boolean;
  daysAllowed: number;
  assigned: boolean;
};

/** Per leave-type balance for an employee (My Leave). */
export type LeaveBalanceEntry = {
  leaveTypeId: string;
  leaveTypeName: string;
  leaveTypeNameKh?: string | null;
  code: string;
  isPaid: boolean;
  year: number;
  entitlement: number;
  used: number;
  carriedOver: number;
  remaining: number;
  leaveCategory?: LeaveCategory;
  accrued?: number;
  /** Policy maximum for a full calendar year (e.g. 18 for AL). */
  fullYearEntitlement?: number;
  /** Join-year prorated cap when true; full-year cap when false. */
  proratedJoinYear?: boolean;
};

export interface ProjectMilestone {
  id: string;
  title: string;
  dueDate?: string;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  departmentId: string;
  leadId: string;
  status: ProjectStatus;
  progress: number;
  deadline: string;
  startDate?: string;
  /** ISO datetime from DB — used for “created between” filters on Timeline. */
  createdAt?: string;
  /** Soft-delete timestamp — set when removed from the active list. */
  deletedAt?: string | null;
  priority?: ProjectPriority;
  members?: string[];
  milestones?: ProjectMilestone[];
}

export interface Task {
  id: string;
  title: string;
  description: string;
  projectId: string;
  assigneeId: string;
  creatorId: string;
  status: TaskStatus;
  dueDate: string;
  startDate?: string;
  createdAt: string;
  /** Soft-delete timestamp — set when removed from the active list. */
  deletedAt?: string | null;
  priority?: TaskPriority;
  progress?: number;
  estimatedHours?: number;
  loggedHours?: number;
  dependencies?: string[];
  subtasks?: unknown[];
  comments?: unknown[];
}

// EMPLOYEE REVIEWS
export type ReviewStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'PASSED'
  | 'FAILED'
  | 'UPCOMING'
  | 'REVIEW_DUE'
  | 'IN_REVIEW'
  | 'EXTENDED';
export type ProbationReviewStatus =
  | 'UPCOMING'
  | 'REVIEW_DUE'
  | 'IN_REVIEW'
  | 'PENDING_MANAGER'
  | 'PENDING_EMPLOYEE'
  | 'PENDING_HR'
  | 'PENDING_FINAL_APPROVAL'
  | 'PASSED'
  | 'EXTENDED'
  | 'FAILED'
  | 'REJECTED';
export type ProbationReviewRecommendation = 'PASS' | 'EXTEND' | 'FAIL';
export type ProbationRatingLevel =
  | 'EXCELLENT'
  | 'GOOD'
  | 'AVERAGE'
  | 'NEEDS_IMPROVEMENT';
export type ProbationEvaluationRatings = {
  jobPerformance: ProbationRatingLevel;
  attendance: ProbationRatingLevel;
  workAttitude: ProbationRatingLevel;
  teamwork: ProbationRatingLevel;
};
export type ReviewType = 'PROBATION' | 'PERFORMANCE' | 'TRAINING';

export interface EmployeeReview {
  id: string;
  userId: string;
  reviewType: ReviewType;
  periodEnd?: string;
  score?: number;
  status: ReviewStatus;
  notes?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface ProbationReviewSummary {
  totalOnProbation: number;
  reviewsDueThisMonth: number;
  passed: number;
  extended: number;
  failed: number;
}

export interface ProbationRow {
  userId: string;
  employeeId?: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  departmentId?: string;
  departmentName?: string;
  positionId?: string;
  position?: string;
  /** Current contractual base salary on the employee record. */
  baseSalary?: number;
  currency?: string;
  joinDate: string;
  probationEnd: string;
  probationMonths: number;
  workerType?: string;
  inProbation?: boolean;
  daysRemaining: number;
  overdue: boolean;
  due?: boolean;
  reviewId: string | null;
  status: ProbationReviewStatus;
  recommendation: ProbationReviewRecommendation | null;
  overallRecommendation: string | null;
  nextReviewDate: string | null;
  ratings: ProbationEvaluationRatings | null;
  strengths: string;
  areasForImprovement: string;
  hrNotes: string;
  probationConfirmedAt?: string | null;
  score?: number | null;
  notes?: string;
  reviewedAt: string | null;
  reviewedBy?: string | null;
  assignedHrUserId?: string | null;
  assignedHrName?: string | null;
  assignedManagerUserId?: string | null;
  assignedManagerName?: string | null;
  routedByHrUserId?: string | null;
  managerSubmittedBy?: string | null;
  managerSubmittedAt?: string | null;
  employeeSubmittedAt?: string | null;
  employeeSubmittedBy?: string | null;
  employeeRatings?: ProbationEvaluationRatings | null;
  employeeStrengths?: string;
  employeeAreasForImprovement?: string;
  managerRatings?: ProbationEvaluationRatings | null;
  managerStrengths?: string;
  managerAreasForImprovement?: string;
  managerOverallRecommendation?: string | null;
  canManagerEdit?: boolean;
  canEmployeeSelfEvaluate?: boolean;
  canHrDecide?: boolean;
  canEvaluate?: boolean;
  canRouteToManager?: boolean;
  assignedEvaluatorUserIds?: string[];
  assignedEvaluators?: Array<{
    userId: string;
    name: string | null;
    status: 'pending' | 'submitted';
    submittedAt: string | null;
    sortOrder: number;
    phase: 'submitted' | 'current' | 'queued';
  }>;
  currentEvaluatorUserId?: string | null;
  currentEvaluatorName?: string | null;
  evaluationProgress?: { submitted: number; total: number } | null;
  evaluatorRatingsByUserId?: Record<string, ProbationEvaluationRatings>;
  managementEvaluationsByUserId?: Record<
    string,
    {
      strengths?: string | null;
      areasForImprovement?: string | null;
      overallRecommendation?: string | null;
      submittedAt?: string | null;
    }
  >;
  assignedApproverUserIds?: string[];
  assignedApprovers?: Array<{
    userId: string;
    name: string | null;
    status: string;
    approvedAt: string | null;
    sortOrder: number;
    phase?: 'approved' | 'current' | 'queued';
  }>;
  currentApproverUserId?: string | null;
  currentApproverName?: string | null;
  approvalProgress?: { approved: number; total: number } | null;
  canApproverReview?: boolean;
}

export type ProbationPendingApprovalItem = {
  reviewId: string;
  userId: string;
  employeeId: string | null;
  employeeName: string;
  departmentName: string | null;
  status: ProbationReviewStatus;
  recommendation: ProbationReviewRecommendation | null;
  overallRecommendation: string | null;
  probationEnd: string | null;
  managerSubmittedAt: string | null;
  employeeSubmittedAt: string | null;
  hrNotes: string | null;
  assignedApproverUserIds: string[];
  assignedApprovers: NonNullable<ProbationRow['assignedApprovers']>;
  currentApproverUserId: string | null;
  currentApproverName: string | null;
  approvalProgress: { approved: number; total: number } | null;
  canApproverReview: boolean;
  pendingDecision?: Record<string, unknown> | null;
}

export type PayrollPendingApprovalItem = {
  runId: string;
  month: string;
  monthLabel: string;
  status: string;
  totalEmployees: number;
  totalNetPay: number;
  calculatedAt: string | null;
  calculatedBy: string | null;
  calculatedByName: string | null;
  assignedApproverUserIds: string[];
  assignedApprovers: NonNullable<ProbationRow['assignedApprovers']>;
  currentApproverUserId: string | null;
  currentApproverName: string | null;
  approvalProgress: { approved: number; total: number } | null;
  canApproverReview: boolean;
  selfApprovalBlocked: boolean;
  href: string;
  viewerApprovalCompletedAt?: string | null;
};

export type PayrollApprovalsInboxResponse = {
  queue: PayrollPendingApprovalItem[];
  history: PayrollPendingApprovalItem[];
  historyScope?: 'personal' | 'all';
};

export type PayrollPaymentRunOption = {
  runId: string;
  month: string;
  monthLabel: string;
  status: string;
  totalEmployees: number;
  pendingCount: number;
  paidCount: number;
  holdingCount: number;
  /** Last ICT date (YYYY-MM-DD) when payment status may still be changed. */
  paymentEditableUntil?: string | null;
  /** False after the 1-month post-approval grace window. */
  paymentUpdatesAllowed?: boolean;
};

export type PayrollPaymentQueueItem = {
  payslipId: string;
  payrollRunId: string;
  userId: string;
  employeeId: string;
  employeeName: string;
  positionTitle: string | null;
  departmentName: string | null;
  email: string | null;
  phone: string | null;
  month: string;
  monthLabel: string;
  grossPay: number;
  baseSalary: number;
  allowanceTotal: number;
  otTotal: number;
  deductionsTotal: number;
  nssfEmployee: number;
  taxOnSalary: number;
  netPay: number;
  netPayKhr: number;
  exchangeRate: number;
  disbursementStatus: PayslipDisbursementStatus;
  disbursementStatusAt: string | null;
  disbursementHoldNote: string | null;
  runStatus: string;
  paymentMethod: string;
  bankName: string | null;
  bankAccountNumber: string | null;
  taxId: string | null;
  nssfId: string | null;
  currency: string;
};

export type ProbationManagerAssignee = {
  userId: string;
  name: string;
  email: string;
  departmentId: string;
  departmentName: string;
};

export type ProbationHrAssignee = {
  userId: string;
  name: string;
  email: string;
};

export interface ProbationReviewHistoryItem {
  id: string;
  reviewDate: string;
  reviewer: string | null;
  status: string;
  recommendation: ProbationReviewRecommendation | null;
  overallRecommendation: string | null;
  ratings: ProbationEvaluationRatings | null;
  strengths: string;
  areasForImprovement: string;
  hrNotes: string;
  extensionDays: number | null;
  extensionReason: string | null;
  nextReviewDate: string | null;
  notes: string;
}

// PAYROLL TYPES
export type PayrollStatus =
  | 'DRAFT'
  | 'PROCESSING'
  | 'UNDER_REVIEW'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'LOCKED'
  | 'PAYMENT_PROCESSING'
  | 'COMPLETED'
  | 'PAID'
  | 'REJECTED'
  | 'CANCELLED'
  | 'REVERSED';

export type AttendancePeriodStatus = 'OPEN' | 'FINALIZED' | 'LOCKED';

export interface HybridPayrollComponents {
  model: 'hybrid_enterprise_v1';
  periodMonth: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  attendanceCutoffDate: string | null;
  attendancePeriodStatus: AttendancePeriodStatus | 'OPEN';
  fixed: {
    contractBaseSalary: number;
    fixedBaseSalary: number;
    prorationFactor: number;
    prorationReason?: string | null;
    positionAllowance: number;
    seniorityAllowance: number;
    seniorityIndemnity: number;
    transportAllowance: number;
    mealAllowance: number;
    otherFixedAllowances: number;
    total: number;
  };
  variableAdditions: {
    overtime: {
      hours100?: number;
      amount100?: number;
      hours150: number;
      amount150: number;
      hours200: number;
      amount200: number;
      total: number;
    };
    attendanceIncentive: number;
    commission: number;
    shiftAllowance: number;
    attendanceAllowance: number;
    otMeal: number;
    other: number;
    total: number;
  };
  variableDeductions: {
    unpaidLeave: number;
    unexcusedAbsence: number;
    latePenalty: number;
    advances: number;
    other: number;
    total: number;
  };
  earningsBeforeStatutory: number;
  adjustmentTotal: number;
  notes: string[];
  payrollAudit?: PayrollCalculationAudit;
  dayClassification?: PayrollDayClassificationAudit;
  standardDays?: number;
  eligibleDays?: number;
  taxDependents?: number;
  taxDependentReliefUsd?: number;
  taxableBaseUsd?: number;
}

export interface PayrollLeaveBreakdownLine {
  code: string | null;
  name: string;
  paid: boolean;
  category: 'payable' | 'deductible' | 'neutral';
  days: number;
}

export interface PayrollDayClassificationAudit {
  employmentEligiblePeriod: { start: string; end: string } | null;
  totalScheduledWorkingDays: number;
  scheduledWorkingDays: number;
  payableDays: number;
  deductibleDays: number;
  neutralDays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  unexcusedAbsentDays: number;
  attendanceBreakdown: Record<string, number>;
  leaveBreakdown: PayrollLeaveBreakdownLine[];
  finalized: boolean;
}

export interface PayrollAttendancePeriod {
  id?: string;
  month: string;
  status: AttendancePeriodStatus;
  payPeriodStart: string;
  payPeriodEnd: string;
  attendanceCutoffDate: string | null;
  finalizedBy?: string | null;
  finalizedAt?: string | null;
  notes?: string | null;
  /** True when ICT midnight on the payroll calendar cutoff date has passed. */
  isCutoffReached?: boolean;
  /** True when HR may manually freeze attendance (cutoff reached and period still OPEN). */
  canFreezeAttendance?: boolean;
  /** How attendance was frozen: SCHEDULER, MANUAL, PAYROLL_APPROVED, etc. */
  freezeTrigger?: string | null;
  /** True when the Reopen action is allowed for this period. */
  canReopenAttendance?: boolean;
  /** Attendance period is frozen for payroll review (FINALIZED / LOCKED). */
  reviewFrozen?: boolean;
  /** Last date included in the payroll-review freeze window. */
  frozenThroughDate?: string | null;
  /** New attendance rows may still be captured inside the frozen cutoff range. */
  allowNewInputInFrozenRange?: boolean;
  /** Existing rows inside the frozen cutoff range are view-only. */
  allowUpdatesInFrozenRange?: boolean;
}

export interface PayrollAttendanceSummary {
    recordsInPeriod: number;
    presentDays: number;
    paidLeaveDays?: number;
    unpaidLeaveDays?: number;
    absentDays?: number;
    paidDays?: number;
    payrollBasisDays?: number;
    /** @deprecated Use payrollBasisDays */
    scheduledWorkDays?: number;
    lateCount?: number;
    overtimeHours?: number;
    attendanceSource?: 'attendance_records';
    totalWorkHours: number;
    standardHoursPerDay: number;
    hourlyRate: number;
    /** Contract base ÷ payroll basis days (leave/absence deduction rate). */
    dailyRate?: number;
    dependents: number;
}

export interface NssfPensionDetail {
    monthlyWageKhr: number;
    assumedWageKhr: number;
    employeeOccupationalRiskKhr?: number;
    employeeHealthcareKhr?: number;
    employeePensionKhr: number;
    employeeTotalKhr?: number;
    employerOccupationalRiskKhr?: number;
    employerHealthcareKhr?: number;
    employerPensionKhr?: number;
    employerTotalKhr?: number;
    employerNssfUsd?: number;
}

export interface PayrollReviewSnapshot {
    positionTitle: string;
    bankName: string | null;
    bankAccountNumber: string | null;
    paymentMethod: string;
}

export type EmploymentReviewFlag =
    | 'new_hire'
    | 'mid_month_join'
    | 'resigning'
    | 'final_settlement_overlap';

export interface PayrollReviewContext extends PayrollReviewSnapshot {
    departmentId: string | null;
    departmentName: string;
    contractBaseUsd: number;
    proratedPayUsd: number;
    payableDays: number;
    scheduledWorkingDays: number;
    prorationPct: number;
    prorationLabel: string;
    exchangeRate: number;
    employmentFlags: EmploymentReviewFlag[];
    priorMonthNetUsd: number | null;
    priorMonth: string | null;
    netChangeVsPriorMonthUsd: number | null;
    netChangeVsPriorMonthPct: number | null;
    previousRunNetUsd: number | null;
    netChangeVsPreviousRunUsd: number | null;
    netChangedSincePreviousRun: boolean;
    attendancePeriodStatus: string | null;
    attendanceFinalized: boolean;
    nssfId: string | null;
    taxId: string | null;
    nssfAssumedWageKhr: number | null;
    totalEmployerCostUsd: number;
    taxMarginalRatePct?: number;
}

export type PayrollPaymentStatus = 'pending' | 'exported' | 'paid';

export type PayslipDisbursementStatus = 'PENDING' | 'PAID' | 'HOLDING';

export interface PayrollCalculationAudit {
    engineVersion: string;
    payrollPeriodStart: string;
    payrollPeriodEnd: string;
    totalCalendarDays: number;
    totalScheduledWorkingDays: number;
    eligibleWorkingDays: number;
    calculationMethod: string;
    dailyRateDivisor: number;
    dailyRateUsed?: number;
    /** Contractual payroll divisor (22/24/26) — salary rate, not roster scheduling. */
    payrollBasisDays?: number;
    payrollWorkDayMethod?: string;
    dailyRateSource?: 'employee_basis' | 'company_basis' | 'roster' | 'legacy';
    prorationFactor: number;
    payrollProcessingType: 'MONTHLY' | 'FINAL_SETTLEMENT';
    usedLegacyFallback?: boolean;
    rosterBased?: boolean;
    planningNonWorkingDaysInPeriod?: number;
    employmentEligiblePeriodStart?: string;
    employmentEligiblePeriodEnd?: string;
    payableDays?: number;
    deductibleDays?: number;
    neutralDays?: number;
}

export interface SalaryBreakdown {
    baseSalary: number;
    contractBaseSalary?: number;
    hybrid?: HybridPayrollComponents;
    proratedDays: number;
    payrollAudit?: PayrollCalculationAudit;
    /** Semi-annual indemnity (June / December) — Labor Law Art. 89 */
    seniorityIndemnity?: number;
    /** Snapshot metadata for indemnity tooltip / audit (engine output). */
    seniorityIndemnitySnapshot?: Record<string, unknown>;
    /** Service tenure entitlement (Seniority Engine — not an allowance). */
    seniorityEntitlement?: number;
    senioritySnapshot?: Record<string, unknown>;
    attendanceSummary?: PayrollAttendanceSummary;
    allowances: {
        transport: number;
        attendance: number;
        meal: number;
        seniority: number;
        position?: number;
        commission?: number;
        otMeal?: number;
    };
    /** Engine lines for Salary Overview (when allowance package is selected). */
    allowanceLines?: Array<{ code: string; name: string; amount: number }>;
    allowancePackageName?: string;
    overtime: {
        hours100?: number;
        amount100?: number;
        hours150: number;
        amount150: number;
        hours200: number;
        amount200: number;
        total: number;
    };
    grossSalary: number;
    /** GDT dependent allowance before ToS (USD) — reduces taxable base, not gross pay. */
    taxDependentReliefUsd?: number;
    /** Gross minus dependent relief — used for salary tax brackets. */
    taxableBaseUsd?: number;
    taxableIncomeKhr?: number;
    taxableIncomeUsd?: number;
    taxAmountKhr?: number;
    taxAmountUsd?: number;
    exchangeRateUsed?: number;
    nssfSalaryKhr?: number;
    nssfSalaryUsd?: number;
    employeeContributionKhr?: number;
    employeeContributionUsd?: number;
    employerContributionKhr?: number;
    employerContributionUsd?: number;
    /** Marginal GDT bracket rate (%) for taxable base this period. */
    taxMarginalRatePct?: number;
    /** Roll-up of allowances + seniority + indemnity + back pay (excludes base & OT). */
    allowanceTotalUsd?: number;
    /** Absence + advance deductions (excludes NSSF and tax). */
    otherDeductionsUsd?: number;
    /** HR / payment fields snapshotted at calculation time. */
    reviewSnapshot?: PayrollReviewSnapshot;
    /** Extended review metadata (department, proration, comparisons). */
    reviewContext?: PayrollReviewContext;
    /** Prior-month back pay rolled into this period (approved adjustments only). */
    backPayment?: number;
    backPaymentSourceMonth?: string;
    deductions: {
        nssf: number; 
        taxOnSalary: number; 
        absences: number;
        advances: number;
        total: number;
    };
    netSalary: number;
    exchangeRate: number; 
    netSalaryKHR: number;
    /** Employee NSSF shares deducted from pay (per Payroll Rules). */
    nssfDetail?: NssfPensionDetail;
}

export interface PayrollRun {
    id: string;
    month: string;
    status: PayrollStatus;
    totalEmployees: number;
    totalNetPay: number;
    totalGross?: number;
    year?: number;
    runDate?: string;
    payDate?: string;
    payPeriodStart?: string;
    payPeriodEnd?: string;
    attendanceCutoffDate?: string | null;
    createdAt: string;
    /** Last time payslips were calculated for this run (updates on recalculate). */
    calculatedAt?: string;
    approvedBy?: string;
    calculatedBy?: string;
    /** Display name of the user who calculated / ran payroll. */
    calculatedByName?: string | null;
    /** Server: maker-checker active for this environment. */
    makerCheckerEnforced?: boolean;
    /** Server: current user cannot approve because they calculated this run. */
    selfApprovalBlocked?: boolean;
    /** Server: viewer is the current approver in the chain. */
    canApproverReview?: boolean;
    canEditApprovers?: boolean;
    needsApproverRouting?: boolean;
    /** Server: viewer may cancel this pending-approval run (preparer or admin). */
    canCancel?: boolean;
    assignedApproverUserIds?: string[];
    assignedApprovers?: Array<{
        userId: string;
        name: string | null;
        status: string;
        approvedAt: string | null;
        sortOrder: number;
        phase?: 'approved' | 'current' | 'queued';
    }>;
    currentApproverUserId?: string | null;
    currentApproverName?: string | null;
    approvalProgress?: { approved: number; total: number } | null;
    reviewedBy?: string;
    lockedAt?: string;
    payrollCalendarId?: string;
    payrollCycleId?: string;
    payrollGroupId?: string;
    /** Approved / locked runs are historical snapshots — view only. */
    readOnly?: boolean;
}

export interface PayrollSchedule {
    runDayOfMonth: number;
    payDayOfMonth?: number;
    timezone?: string;
}

export type PayrollOtDayTier = 'daytime_ot' | 'premium';

export type PayrollPeriodType = 'monthly' | 'biweekly' | 'weekly';

export interface PayrollGroupConfig {
    id: string;
    name: string;
    companyId?: string | null;
    branchId?: string | null;
    departmentIds?: string[];
    periodType: PayrollPeriodType;
    defaultAttendanceCutoffDay: number;
    defaultPayrollCalculationDay: number;
    defaultPayrollApprovalDay: number;
    defaultPaymentDay?: number;
    active?: boolean;
}

export interface PayrollCycleDefinition {
    month: string;
    periodStart: string;
    periodEnd: string;
    attendanceCutoffDate: string;
    payrollCalculationDate: string;
    payrollApprovalDate: string;
    paymentDate?: string;
}

export interface PayrollCalendarCycleConfig {
    groups: PayrollGroupConfig[];
    cyclesByGroup: Record<string, Record<string, PayrollCycleDefinition>>;
}

export interface PayrollCalendarStatusSnapshot {
    businessDate: string;
    calendarId: string;
    year: number;
    groups: Array<{
        groupId: string;
        groupName: string;
        activeCycle: PayrollCycleDefinition & {
            cycleId: string;
            calendarId: string;
            payrollGroupId: string;
            payrollGroupName: string;
        } | null;
        nextCycle: PayrollCycleDefinition | null;
        attendanceStatus: 'OPEN' | 'FINALIZED' | 'LOCKED';
        attendanceFrozenAt: string | null;
        freezeTrigger: string | null;
        daysUntilCutoff: number | null;
        daysUntilCalculation: number | null;
        isCutoffReached: boolean;
        isAttendanceLocked: boolean;
    }>;
}

export interface PayrollCalendarYear {
    year: number;
    runDates: string[];
    attendanceCutoffDates?: string[];
    defaultAttendanceCutoffDayOfMonth?: number;
    /** When true (default), attendance is locked automatically on each month's cutoff date. */
    autoFreezeAttendanceOnCutoff?: boolean;
    cycleConfig?: PayrollCalendarCycleConfig;
    status?: PayrollCalendarStatusSnapshot;
    /** groupId → months with approved/locked payroll (milestones not editable). */
    monthLocks?: Record<string, Array<{ month: string; status: string }>>;
    otDayTiers: Record<string, PayrollOtDayTier>;
    defaultRunDayOfMonth: number;
    employerOtNote?: string;
    otRates?: {
        daytimeMultiplier: number;
        premiumMultiplier: number;
    };
}

export interface PayrollTaxBracket {
    /** Bracket floor (KHR). */
    min: number;
    /** Bracket ceiling (KHR). */
    max: number;
    rate: number;
    /** GDT deduction amount (KHR) — Tax = (base × rate%) − deduction */
    deduction: number;
    range: string;
    currency?: 'KHR' | 'USD';
}

export interface PayrollPolicyEffectiveInfo {
    effectiveFrom?: string | null;
    scheduledEffectiveFrom?: string | null;
    lastUpdatedAt?: string | null;
    lastUpdatedBy?: string | null;
}

/** Payroll engine KHR/USD rate (system setting). */
export interface PayrollExchangeRateDetails extends PayrollPolicyEffectiveInfo {
    exchangeRateKhrPerUsd: number;
    latestExchangeRateKhrPerUsd?: number;
    dependentAllowanceUsd: number;
    dependentAllowanceKhr: number;
    isConfigured: boolean;
}

export interface PayrollTaxBracketPolicy extends PayrollPolicyEffectiveInfo {
    brackets: PayrollTaxBracket[];
}

export interface PayrollNssfWagePolicy extends PayrollPolicyEffectiveInfo {
    brackets: PayrollNssfWageBracket[];
}

/** NSSF contributory wage level (monthly wage KHR → assumed wage KHR). */
export interface PayrollNssfWageBracket {
    level: number;
    wageMinKhr: number;
    wageMaxKhr: number | null;
    assumedWageKhr: number;
    range: string;
}

export interface PayrollComplianceRule extends PayrollPolicyEffectiveInfo {
    id: string;
    ruleKey: string;
    name: string;
    legalRef: string;
    description: string;
    config: Record<string, number | string>;
    displayValue: string;
    sortOrder: number;
}

export interface AllowanceType {
    id: string;
    code: string;
    name: string;
    category: string;
    calculation_type: string;
    taxable: boolean;
    active: boolean;
    description?: string | null;
}

export interface AllowanceRule {
    id: string;
    allowance_type_id: string;
    rule_name: string;
    trigger_type: string;
    condition_json: Record<string, unknown>;
    formula?: string | null;
    fixed_amount: number;
    percentage_rate: number;
    priority: number;
    effective_from?: string | null;
    effective_to?: string | null;
    active: boolean;
    stackable?: boolean;
    type?: AllowanceType;
}

export interface EmployeeAllowanceAssignment {
    id: string;
    employee_id: string;
    allowance_type_id: string;
    allowance_rule_id?: string | null;
    custom_amount?: number | null;
    start_date?: string | null;
    end_date?: string | null;
    active: boolean;
    notes?: string | null;
}

export interface AllowanceTemplate {
    id: string;
    template_name: string;
    department_id?: string | null;
    role_id?: string | null;
    active: boolean;
    items?: Array<{
        id: string;
        allowance_type_id: string;
        allowance_rule_id?: string | null;
        amount: number;
    }>;
}

export interface AllowanceSimulationResult {
    employee: Record<string, unknown>;
    month: string;
    result: {
        lines: Array<{
            code: string;
            name: string;
            amount: number;
            ruleId: string;
            ruleName: string;
            appliedConditions: Record<string, unknown>;
        }>;
        legacy: Record<string, number>;
        total: number;
    };
}

export interface CreatePayrollRunPayload {
    year: number;
    month: number;
    runDate: string;
    payDate: string;
    /** Finalize attendance for the month immediately before calculating payroll. */
    autoFinalizeAttendance?: boolean;
    requireAttendanceFinalized?: boolean;
    assignedApproverUserIds?: string[];
}

export type PayrollAnomalySeverity = 'info' | 'warning' | 'critical';

export interface PayrollAnomaly {
  code: string;
  severity: PayrollAnomalySeverity;
  message: string;
  details?: Record<string, number | string | boolean | null>;
}

export interface PayrollAnomalySummary {
  engineVersion: string;
  employeesReviewed: number;
  employeesFlagged: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  topPatterns: Array<{ code: string; count: number }>;
}

export interface Payslip {
  id: string;
  payrollRunId: string;
  /** Portal user id (internal). */
  userId: string;
  /** HR employee code, e.g. ROC00001. */
  employeeId?: string;
  month: string;
  /** Assembled from `payslipbreakdowns` table (or mock store); not stored on payslip row. */
  breakdown?: SalaryBreakdown;
  status: PayrollStatus;
  generatedAt: string;
  basicSalary?: number;
  deductions?: number;
  netPay?: number;
  warnings?: Array<{ code: string; message: string }>;
  anomalies?: PayrollAnomaly[];
  /** HR reviewer note before run approval. */
  reviewerNote?: string | null;
  /** Post-approval disbursement status (null on preview / pre-approval). */
  paymentStatus?: PayrollPaymentStatus | null;
  /** HR salary payment release status for this payslip. */
  disbursementStatus?: PayslipDisbursementStatus | null;
  disbursementStatusAt?: string | null;
  disbursementHoldNote?: string | null;
  /** Stored snapshot — do not recalculate from current employee data. */
  readOnly?: boolean;
  snapshotMissing?: boolean;
}

export interface EmployeeDataRetentionCounts {
  attendanceRecords: number;
  leaveRequests: number;
  payslips: number;
  overtimeRequests: number;
  documents: number;
  movements: number;
  statusHistory: number;
}

export interface EmployeeArchiveRow {
  id: number;
  terminatedAt?: string | null;
  terminationReason?: string | null;
  terminatedBy?: string | null;
  restoredAt?: string | null;
  restoredBy?: string | null;
  isCurrentlyArchived?: boolean;
  snapshotName?: string | null;
  departmentName?: string | null;
  positionTitle?: string | null;
}

export type SensitiveFieldChange = {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
  beforeDisplay?: string | null;
  afterDisplay?: string | null;
};

export type EmployeeSensitiveChange = {
  id: string;
  employee_pk: string;
  employee_id: string;
  change_source: 'profile_update' | 'movement' | 'field_correction';
  source_ref_id?: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  change_reason: string;
  effective_date?: string | null;
  before_state?: unknown;
  after_state?: unknown;
  field_changes?: SensitiveFieldChange[];
  submitted_by?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_notes?: string | null;
  created_at: string;
  applied_at?: string | null;
};

export interface EmployeeArchiveDetail {
  employeeId: string;
  employeePk: string;
  portalUserId?: string | null;
  currentStatus: string;
  isOffboarded: boolean;
  retention: EmployeeDataRetentionCounts;
  archives: EmployeeArchiveRow[];
  dataRetained: boolean;
  retentionNote: string;
}

export interface Holiday {
  id: string;
  name: string;
  date: string;
  type: 'Public' | 'Company';
  description?: string;
}

export interface FeaturePermission {
    feature: string; // e.g., 'manage_users', 'approve_leaves'
    roles: Role[];
}

export enum ApplicationStatus {
  APPLIED = 'APPLIED',
  SCREENING = 'SCREENING',
  INTERVIEW = 'INTERVIEW',
  OFFER = 'OFFER',
  HIRED = 'HIRED',
  REJECTED = 'REJECTED'
}

export interface Job {
  id: string;
  title: string;
  departmentId: string;
  description: string;
  requirements: string[];
  status: 'OPEN' | 'CLOSED';
  postedDate: string;
  location: string;
  salaryRange?: string;
  type: 'Full-time' | 'Part-time' | 'Contract' | 'Internship';
}

export interface Candidate {
  id: string;
  jobId: string;
  name: string;
  email: string;
  phone: string;
  resumeUrl?: string; // URL to the uploaded CV
  status: ApplicationStatus;
  appliedDate: string;
  notes?: string;
  rating?: number;
  matchScore?: number; // 0-100 score based on keyword matching
}
