import { User, Role, Department, AttendanceRecord, LeaveRequest, LeaveStatus, Project, ProjectStatus, Task, TaskStatus, Notification, NotificationType, Message, PayrollRun, Payslip, LeaveType, FeaturePermission, Job, Candidate, ApplicationStatus } from '../types';
import {
  CANONICAL_NSSF_ASSUMED_WAGE_BRACKETS,
  nssfBracketsToDisplayRows,
} from '../utils/nssfAssumedWage';
import { CANONICAL_PAYROLL_TAX_BRACKETS_KHR } from '../utils/payrollTaxRate';

export const MOCK_DEPARTMENTS: Department[] = [
    { id: 'DEPT001', name: 'Engineering', headCount: 12 },
    { id: 'DEPT002', name: 'Human Resources', headCount: 4 },
    { id: 'DEPT003', name: 'Sales', headCount: 8 },
];

export const MOCK_JOBS: Job[] = [
    { id: 'j-1', title: 'Senior Frontend Developer', departmentId: 'DEPT001', description: 'We are looking for an experienced React developer.', requirements: ['React', 'TypeScript', 'Tailwind'], status: 'OPEN', postedDate: '2023-10-01', location: 'Phnom Penh', salaryRange: '$1500 - $2500', type: 'Full-time' },
    { id: 'j-2', title: 'HR Assistant', departmentId: 'DEPT002', description: 'Assist with daily HR operations.', requirements: ['Communication', 'Organization'], status: 'OPEN', postedDate: '2023-10-05', location: 'Phnom Penh', salaryRange: '$500 - $800', type: 'Internship' },
];

export const MOCK_CANDIDATES: Candidate[] = [
    { id: 'c-1', jobId: 'j-1', name: 'Sophea Ly', email: 'sophea@example.com', phone: '012345678', status: ApplicationStatus.APPLIED, appliedDate: '2023-10-10', rating: 0 },
    { id: 'c-2', jobId: 'j-1', name: 'Veasna Chan', email: 'veasna@example.com', phone: '098765432', status: ApplicationStatus.INTERVIEW, appliedDate: '2023-10-08', rating: 4 },
];

export const MOCK_USERS: User[] = [
    { id: 'u-1', name: 'Sokha Chan', email: 'admin@company.com', role: Role.ADMIN, departmentId: 'DEPT001', position: 'CTO', avatarUrl: 'https://i.pravatar.cc/150?u=1', joinDate: '2020-01-01', salary: 2500, dependents: 2, phone: '012345678', address: 'Phnom Penh' },
    { id: 'u-2', name: 'Dara Kim', email: 'hr@company.com', role: Role.HR, departmentId: 'DEPT002', position: 'HR Manager', avatarUrl: 'https://i.pravatar.cc/150?u=2', joinDate: '2021-03-15', salary: 1800, dependents: 1, phone: '098765432', address: 'Siem Reap' },
    { id: 'u-3', name: 'Vibol Meas', email: 'manager@company.com', role: Role.MANAGER, departmentId: 'DEPT001', position: 'Eng Manager', avatarUrl: 'https://i.pravatar.cc/150?u=3', joinDate: '2021-06-01', salary: 2000, dependents: 0, phone: '011223344', address: 'Phnom Penh' },
    { id: 'u-4', name: 'Bopha Keo', email: 'employee@company.com', role: Role.EMPLOYEE, departmentId: 'DEPT001', position: 'Developer', avatarUrl: 'https://i.pravatar.cc/150?u=4', joinDate: '2022-01-10', salary: 1200, dependents: 0, phone: '077889900', address: 'Battambang' },
];

/** Attendance is loaded from the API; keep empty when mock adapter is enabled. */
export const MOCK_ATTENDANCE: AttendanceRecord[] = [];
export const MOCK_LEAVES: LeaveRequest[] = [
    { id: 'l-1', userId: 'u-4', type: 'Annual', startDate: '2023-11-01', endDate: '2023-11-03', reason: 'Vacation', status: LeaveStatus.PENDING },
];

export const MOCK_PROJECTS: Project[] = [
    {
        id: 'P0001',
        title: 'Website Redesign',
        description: 'Revamp corporate site with modern UX and accessibility standards.',
        departmentId: 'DEPT001',
        leadId: 'u-3',
        status: ProjectStatus.ACTIVE,
        progress: 0,
        startDate: '2026-01-10',
        deadline: '2026-06-15',
        priority: 'HIGH',
        members: ['u-3', 'u-4'],
    },
    {
        id: 'P0002',
        title: 'Mobile HR App',
        description: 'Native companion app for attendance and leave workflows.',
        departmentId: 'DEPT001',
        leadId: 'u-3',
        status: ProjectStatus.PLANNING,
        progress: 0,
        startDate: '2026-02-01',
        deadline: '2026-07-20',
        priority: 'MEDIUM',
        members: ['u-4'],
    },
    {
        id: 'P0003',
        title: 'Payroll Automation',
        description: 'Integrate tax rules and approval flows into payroll runs.',
        departmentId: 'DEPT002',
        leadId: 'u-2',
        status: ProjectStatus.ACTIVE,
        progress: 0,
        startDate: '2026-01-20',
        deadline: '2026-05-30',
        priority: 'CRITICAL',
        members: ['u-2', 'u-1'],
    },
    {
        id: 'P0004',
        title: 'Security Audit',
        description: 'Quarterly penetration test and remediation tracking.',
        departmentId: 'DEPT001',
        leadId: 'u-1',
        status: ProjectStatus.COMPLETED,
        progress: 0,
        startDate: '2026-01-05',
        deadline: '2026-03-01',
        priority: 'HIGH',
    },
    {
        id: 'P0005',
        title: 'Sales CRM Migration',
        description: 'Data migration from legacy CRM to unified pipeline.',
        departmentId: 'DEPT003',
        leadId: 'u-2',
        status: ProjectStatus.ON_HOLD,
        progress: 0,
        startDate: '2026-03-15',
        deadline: '2026-06-30',
        priority: 'LOW',
    },
];

export const MOCK_TASKS: Task[] = [
    {
        id: 'T1',
        title: 'Design System Tokens',
        description: 'Define color, spacing, and typography tokens.',
        projectId: 'P0001',
        assigneeId: 'u-4',
        creatorId: 'u-3',
        status: TaskStatus.IN_PROGRESS,
        priority: 'HIGH',
        progress: 55,
        startDate: '2026-01-15',
        dueDate: '2026-02-28',
        estimatedHours: 40,
        loggedHours: 18,
        createdAt: '2026-01-12T08:00:00.000Z',
        dependencies: [],
        subtasks: [],
        comments: [],
    },
    {
        id: 'T2',
        title: 'Homepage Wireframes',
        description: 'Low-fidelity wireframes for marketing pages.',
        projectId: 'P0001',
        assigneeId: 'u-4',
        creatorId: 'u-3',
        status: TaskStatus.DONE,
        priority: 'MEDIUM',
        progress: 100,
        startDate: '2026-01-10',
        dueDate: '2026-01-25',
        estimatedHours: 24,
        loggedHours: 24,
        createdAt: '2026-01-10T08:00:00.000Z',
        dependencies: [],
        subtasks: [],
        comments: [],
    },
    {
        id: 'T3',
        title: 'API Schema Review',
        description: 'Validate OpenAPI contracts for mobile endpoints.',
        projectId: 'P0002',
        assigneeId: 'u-4',
        creatorId: 'u-3',
        status: TaskStatus.TODO,
        priority: 'MEDIUM',
        progress: 0,
        startDate: '2026-02-05',
        dueDate: '2026-03-10',
        estimatedHours: 16,
        loggedHours: 0,
        createdAt: '2026-02-01T08:00:00.000Z',
        dependencies: [],
        subtasks: [],
        comments: [],
    },
    {
        id: 'T4',
        title: 'Tax Bracket Import',
        description: 'Load Cambodia tax brackets into payroll engine.',
        projectId: 'P0003',
        assigneeId: 'u-2',
        creatorId: 'u-1',
        status: TaskStatus.REVIEW,
        priority: 'CRITICAL',
        progress: 85,
        startDate: '2026-01-22',
        dueDate: '2026-02-15',
        estimatedHours: 32,
        loggedHours: 28,
        createdAt: '2026-01-20T08:00:00.000Z',
        dependencies: [],
        subtasks: [],
        comments: [],
    },
    {
        id: 'T5',
        title: 'Run Approval Workflow',
        description: 'HR approve/reject flow for payroll runs.',
        projectId: 'P0003',
        assigneeId: 'u-1',
        creatorId: 'u-2',
        status: TaskStatus.IN_PROGRESS,
        priority: 'HIGH',
        progress: 40,
        startDate: '2026-02-01',
        dueDate: '2026-04-01',
        estimatedHours: 48,
        loggedHours: 12,
        createdAt: '2026-01-25T08:00:00.000Z',
        dependencies: [],
        subtasks: [],
        comments: [],
    },
];

export const MOCK_NOTIFICATIONS: Notification[] = [
    {
        id: 'n-1',
        userId: 'u-4',
        title: 'Leave approved',
        message: 'Your leave request has been approved.',
        type: NotificationType.SUCCESS,
        isRead: false,
        createdAt: new Date().toISOString(),
        link: '/leaves',
    },
    {
        id: 'n-2',
        userId: 'u-3',
        title: 'Leave request pending',
        message: 'A team member submitted a leave request for your review.',
        type: NotificationType.INFO,
        isRead: false,
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        link: '/leaves',
    },
];

export const MOCK_MESSAGES: Message[] = [
    { id: 'm-1', senderId: 'u-3', receiverId: 'u-4', content: 'Hey, how is the bug fix going?', createdAt: new Date(Date.now() - 3600000).toISOString(), isRead: true },
    { id: 'm-2', senderId: 'u-4', receiverId: 'u-3', content: 'Almost done, pushing soon.', createdAt: new Date(Date.now() - 1800000).toISOString(), isRead: false },
];

/** Payroll runs are created via the app; no demo rows. */
export const MOCK_PAYROLL_RUNS: PayrollRun[] = [];

export const MOCK_PAYROLL_SCHEDULE = { runDayOfMonth: 28, payDayOfMonth: 31, timezone: 'ICT' };

export const MOCK_PAYROLL_NSSF_WAGE_BRACKETS = nssfBracketsToDisplayRows(
  CANONICAL_NSSF_ASSUMED_WAGE_BRACKETS
);

export const MOCK_PAYROLL_TAX_BRACKETS = CANONICAL_PAYROLL_TAX_BRACKETS_KHR;

export const MOCK_PAYROLL_COMPLIANCE_RULES = [
  {
    id: 'pcr-minimum_wage',
    ruleKey: 'minimum_wage',
    name: 'Minimum Wage',
    legalRef: 'Prakas No. 222/23',
    description:
      'Applicable to garment, textile, footwear, and travel product sectors for 2024.',
    config: { amountUsd: 204, period: 'month' },
    displayValue: '$204/month',
    sortOrder: 1,
  },
  {
    id: 'pcr-nssf_occupational_risk',
    ruleKey: 'nssf_occupational_risk',
    name: 'NSSF Occupational Risk',
    legalRef: 'NSSF / MLVT — Occupational Risk',
    description: '',
    config: { employeePct: 0, employerPct: 0.8 },
    displayValue: '0.8% employer-only (0% from employee pay)',
    sortOrder: 2,
  },
  {
    id: 'pcr-nssf_healthcare',
    ruleKey: 'nssf_healthcare',
    name: 'NSSF Health Care',
    legalRef: 'NSSF / MLVT — Health Care',
    description: '',
    config: { employeePct: 0, employerPct: 2.6 },
    displayValue: '2.6% employer-only (0% from employee pay)',
    sortOrder: 3,
  },
  {
    id: 'pcr-nssf_pension',
    ruleKey: 'nssf_pension',
    name: 'NSSF Pension Fund',
    legalRef: 'Sub-Decree No. 28',
    description: '',
    config: { employeePct: 2, employerPct: 2, employeeCapKhr: 24000, assumedWageCapKhr: 1200000 },
    displayValue: '4% total — 2% from pay (max 24,000 KHR)',
    sortOrder: 4,
  },
  {
    id: 'pcr-seniority_indemnity',
    ruleKey: 'seniority_indemnity',
    name: 'Seniority Indemnity',
    legalRef: 'Labor Law Art. 89',
    description: 'Paid semi-annually (7.5 days in June, 7.5 days in December).',
    config: { daysPerYear: 15, payoutJuneDays: 7.5, payoutDecemberDays: 7.5 },
    displayValue: '15 days/year',
    sortOrder: 5,
  },
  {
    id: 'pcr-overtime_multipliers',
    ruleKey: 'overtime_multipliers',
    name: 'Overtime Multipliers',
    legalRef: 'Labor Law Art. 139',
    description:
      '1.5x when clock-out is after scheduled time out on working days; 2.0x for night (10 PM–5 AM), Planning roster rest days, and public holidays.',
    config: { multiplierNormal: 1.5, multiplierPremium: 2 },
    displayValue: '1.5x - 2.0x',
    sortOrder: 6,
  },
];

/** Payslips are created when a payroll run is processed; no demo rows. */
export const MOCK_PAYSLIPS: Payslip[] = [];

export const MOCK_LEAVE_TYPES: LeaveType[] = [
    {
      id: 'lt-1',
      name: 'Annual',
      isPaid: true,
      daysAllowed: 18,
      leaveCategory: 'join_date_based',
      monthlyAccrualRate: 1.5,
      allowCarryForward: true,
      maxCarryForward: 5,
      yearlyResetEnabled: true,
    },
    {
      id: 'lt-2',
      name: 'Sick',
      isPaid: true,
      daysAllowed: 7,
      leaveCategory: 'fixed_allocation',
      yearlyResetEnabled: true,
    },
    {
      id: 'lt-3',
      name: 'Unpaid',
      isPaid: false,
      daysAllowed: 0,
      leaveCategory: 'approval_based',
      affectsPayroll: true,
      requiresApproval: true,
    },
    {
      id: 'lt-4',
      name: 'Maternity',
      isPaid: true,
      daysAllowed: 90,
      leaveCategory: 'event_based',
      eventTriggerType: 'Maternity',
      maxUsagePerEmployment: 90,
      requiresDocument: true,
    },
];

export const MOCK_PERMISSIONS: FeaturePermission[] = [
    { feature: 'manage_users', roles: [Role.ADMIN, Role.HR] },
    { feature: 'approve_leaves', roles: [Role.ADMIN, Role.HR, Role.MANAGER] },
    { feature: 'view_payroll', roles: [Role.ADMIN, Role.HR] },
];
