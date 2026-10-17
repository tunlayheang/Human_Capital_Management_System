import { Sequelize, DataTypes } from 'sequelize';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import {
  normalizeMysqlUrl,
  buildSequelizeDialectOptions,
  resolveMysqlSsl,
} from './mysqlConfig';
import { modelNameToTableName } from './tableNames';
import { migrateOrganizationUnitIds } from './orgUnitIdFormat';

// On Render, use dashboard env vars only — do not load committed backend/.env in production.
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
  dotenv.config({ path: '.env.local', override: true });
}

const sharedSequelizeOptions = {
  dialect: 'mysql' as const,
  define: {
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
  },
  logging: false,
  benchmark: process.env.NODE_ENV !== 'production',
  retry: {
    max: 3,
    timeout: 5000,
  },
  // Remote MySQL (Aiven) has tighter connection limits than local XAMPP.
  // Keep the pool small so we don't starve the DB or pile up SSL handshakes.
  pool: {
    max: Number(process.env.DB_POOL_MAX || (process.env.NODE_ENV === 'production' ? 10 : 25)),
    min: Number(process.env.DB_POOL_MIN || (process.env.NODE_ENV === 'production' ? 1 : 5)),
    acquire: 60_000,
    idle: 20_000,
    evict: 5_000,
  },
};

const rawMysqlUrl = process.env.MYSQL_URL?.trim() || '';
const { connectionUrl: mysqlUrl, useSsl: mysqlUrlSsl } = rawMysqlUrl
  ? normalizeMysqlUrl(rawMysqlUrl)
  : { connectionUrl: '', useSsl: false };

/** Set true after a successful `sequelize.authenticate()` in `initDb`. */
export let isDatabaseReady = false;
/** False when core tables (users, employees, …) are missing — login will fail until db:setup. */
export let isSchemaComplete = false;

/** Flip readiness after a live health re-check finds the schema healthy again. */
export function markDatabaseSchemaHealthy(): void {
  isDatabaseReady = true;
  isSchemaComplete = true;
}

/** Mark schema unhealthy after a failed wipe/restore so login returns a clear 503 until recovered. */
export function markDatabaseSchemaUnhealthy(): void {
  isSchemaComplete = false;
}

/** DB reachable but core HR tables missing — allow admin login + backup restore. */
export function markDatabaseConnectionReady(): void {
  isDatabaseReady = true;
}

function logDatabaseTarget(): void {
  const raw = process.env.MYSQL_URL?.trim();
  if (raw) {
    const base = raw.split('?')[0];
    try {
      const u = new URL(base);
      console.log(
        `[db] MYSQL_URL → ${u.hostname}:${u.port || '3306'}/${u.pathname?.replace(/^\//, '') || 'defaultdb'} (ssl=${mysqlUrlSsl})`
      );
    } catch {
      console.log('[db] MYSQL_URL is set (host not logged — check format: mysql://user:pass@host:port/db)');
    }
  } else {
    console.log(
      `[db] Using DB_HOST=${process.env.DB_HOST || 'localhost'} DB_NAME=${process.env.DB_NAME || 'iroc_db'}`
    );
  }
}

const discreteDbSsl = resolveMysqlSsl(false);

export const sequelize = mysqlUrl
  ? new Sequelize(mysqlUrl, {
      ...sharedSequelizeOptions,
      dialectOptions: buildSequelizeDialectOptions(mysqlUrlSsl),
    })
  : new Sequelize(
      process.env.DB_NAME || 'iroc_db',
      process.env.DB_USER || 'root',
      process.env.DB_PASSWORD || '',
      {
        ...sharedSequelizeOptions,
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 3306),
        // Honor DB_SSL for Aiven when MYSQL_URL is not set (previously forced SSL off).
        dialectOptions: buildSequelizeDialectOptions(discreteDbSsl),
      }
    );

// MySQL dumps use lowercase names (`users`, `jobs`); default Sequelize pluralizes to `Users`, `Jobs`.
sequelize.addHook('beforeDefine', (attributes, options) => {
  if (!options.tableName && typeof options.name?.singular === 'string') {
    options.tableName = modelNameToTableName(options.name.singular);
  }
});

/** Portal login account — HR profile data lives on `employees`. */
export const User = sequelize.define(
  'User',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    email: { type: DataTypes.STRING, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: true },
    role: { type: DataTypes.STRING, defaultValue: 'EMPLOYEE' },
    employeeId: { type: DataTypes.STRING, allowNull: true },
    /** Normalized digits-only mobile — used for login / OTP (synced from employees.phone). */
    phone: { type: DataTypes.STRING(32), allowNull: true },
    /** Portal display label for system-only accounts (no employee record). */
    display_name: { type: DataTypes.STRING(120), allowNull: true },
    /**
     * Portal-only admin login code (e.g. ADM00001). Not an employee badge —
     * system admins keep employeeId null and have no `employees` row.
     */
    login_id: { type: DataTypes.STRING(32), allowNull: true },
    /** Self-service photo for system-only accounts (no linked employee row). */
    avatar_url: { type: DataTypes.STRING(512), allowNull: true },
    status: { type: DataTypes.STRING, defaultValue: 'ACTIVE' },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    otp: { type: DataTypes.STRING },
    otpExpiry: { type: DataTypes.DATE },
    sessionToken: { type: DataTypes.STRING },
    lastActivity: { type: DataTypes.DATE },
    passwordChangedAt: { type: DataTypes.DATE },
    /**
     * Character count of the current portal password (not the password itself).
     * Used for masked “current password” UI; updated on hash / successful verify.
     */
    passwordLength: { type: DataTypes.INTEGER, allowNull: true },
    /** True until the user sets their own password after first login (or admin reset). */
    mustChangePassword: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    resetToken: { type: DataTypes.STRING },
    resetTokenExpiry: { type: DataTypes.DATE },
    resetPasswordVerifiedAt: { type: DataTypes.DATE },
    securityPinHash: { type: DataTypes.STRING },
    pinAutoLockMinutes: { type: DataTypes.INTEGER, defaultValue: 15 },
    pinLockEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
    pinFailedAttempts: { type: DataTypes.INTEGER, defaultValue: 0 },
    pinLockedRequiresOtp: { type: DataTypes.BOOLEAN, defaultValue: false },
    pinLockedRequiresAdminReset: { type: DataTypes.BOOLEAN, defaultValue: false },
    pinRecoveryOtpHash: { type: DataTypes.STRING },
    pinRecoveryOtpExpiry: { type: DataTypes.DATE },
    pinRecoveryVerifiedAt: { type: DataTypes.DATE },
    /** Failed password login counter (Settings → Security max attempts). */
    failedLoginAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    /** When set and in the future, password login is blocked until this time. */
    loginLockedUntil: { type: DataTypes.DATE, allowNull: true },
    preferred_currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'KHR' },
  },
  {
    tableName: 'users',
    timestamps: true,
    indexes: [
      { unique: true, fields: ['email'] },
      { fields: ['role'] },
      { fields: ['employeeId'] },
      { fields: ['phone'] },
      { unique: true, fields: ['login_id'], name: 'users_login_id_unique' },
    ],
  }
);

export const Department = sequelize.define('Department', {
  id: { type: DataTypes.STRING, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  name_kh: { type: DataTypes.STRING(255), allowNull: true },
  /** Short internal unit code (e.g. HR, FIN). */
  code: { type: DataTypes.STRING(16), allowNull: true },
  /** Portal user id (users.id) — kept in sync with department_head_id for the UI. */
  managerId: { type: DataTypes.STRING, allowNull: true },
  /** Employee row id (employees.id) — canonical department head FK in MySQL. */
  department_head_id: { type: DataTypes.STRING, allowNull: true },
  /** Attendance office id (systemsettings attendance.office_location) for this department. */
  office_location_id: { type: DataTypes.STRING, allowNull: true },
  /** Soft status — inactive departments stay for history but cannot be assigned to new staff. */
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
  tableName: 'departments',
  indexes: [
    { unique: true, fields: ['code'], name: 'departments_code_unique' },
    { fields: ['isActive'] },
  ],
});

export const Position = sequelize.define('Position', {
  id: { type: DataTypes.STRING, primaryKey: true },
  title: { type: DataTypes.STRING, allowNull: false },
  title_kh: { type: DataTypes.STRING(255), allowNull: true },
  department_id: { type: DataTypes.STRING },
  level: { type: DataTypes.STRING(64) },
  access_role: { type: DataTypes.STRING(32) },
  salary_min: { type: DataTypes.FLOAT, defaultValue: 0 },
  salary_max: { type: DataTypes.FLOAT, defaultValue: 0 },
  description: { type: DataTypes.TEXT },
  /** Soft status — inactive positions stay for history but cannot be assigned to new staff. */
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
  tableName: 'positions',
  indexes: [
    { fields: ['department_id'] },
    { fields: ['isActive'] },
  ]
});

// ============================================
// EMPLOYEE MODULE DATABASE SCHEMA
// SQL Server Compatible
// ============================================

// 1. EMPLOYEES TABLE (Core employee information)
export const Employee = sequelize.define('Employee', {
  id: { type: DataTypes.STRING, primaryKey: true },
  employee_id: { type: DataTypes.STRING, allowNull: false, unique: true },
  first_name: { type: DataTypes.STRING, allowNull: false },
  last_name: { type: DataTypes.STRING, allowNull: false },
  first_name_kh: { type: DataTypes.STRING(255), allowNull: true },
  last_name_kh: { type: DataTypes.STRING(255), allowNull: true },
  email: { type: DataTypes.STRING, allowNull: false },
  phone: { type: DataTypes.STRING, allowNull: false },
  work_phone: { type: DataTypes.STRING },
  /** Telegram contact number shown on employee ID cards (separate from login phone). */
  telegram_number: { type: DataTypes.STRING(32), allowNull: true },
  avatar_url: { type: DataTypes.STRING },
  /** Self-service “About me” / bio text shown on the employee profile. */
  bio: { type: DataTypes.TEXT, allowNull: true },
  gender: { type: DataTypes.STRING, allowNull: false },
  birth_date: { type: DataTypes.DATE, allowNull: false },
  nationality: { type: DataTypes.STRING, defaultValue: 'Cambodia' },
  ethnicity: { type: DataTypes.STRING },
  religion: { type: DataTypes.STRING },
  national_id: { type: DataTypes.STRING },
  passport_number: { type: DataTypes.STRING },
  birth_certificate_number: { type: DataTypes.STRING },
  marital_status: { type: DataTypes.STRING, defaultValue: 'single' },
  spouse_name: { type: DataTypes.STRING },
  spouse_name_kh: { type: DataTypes.STRING(255), allowNull: true },
  spouse_occupation: { type: DataTypes.STRING },
  spouse_phone: { type: DataTypes.STRING },
  /** Null when department was deleted (cascade) or employee is unassigned. Required on create. */
  department_id: { type: DataTypes.STRING, allowNull: true },
  /** Null when position/department was deleted (cascade) or employee is unassigned. Required on create. */
  position_id: { type: DataTypes.STRING, allowNull: true },
  /** Organizational job title (denormalized from positions.title) — not used for authorization. */
  job_position: { type: DataTypes.STRING(120), allowNull: true },
  employment_type: { type: DataTypes.STRING, defaultValue: 'Full-Time' },
  contract_type: { type: DataTypes.STRING, allowNull: true },
  employment_status: { type: DataTypes.STRING, allowNull: true },
  join_date: { type: DataTypes.DATE, allowNull: false },
  probation_period_months: { type: DataTypes.INTEGER, defaultValue: 3 },
  /** regular | specialized | non_specialized — caps probation per Labour Law Art. 68. */
  worker_type: { type: DataTypes.STRING(32), defaultValue: 'regular' },
  /** Set when HR passes probation review; ends in-probation state before computed end. */
  probation_confirmed_at: { type: DataTypes.DATEONLY, allowNull: true },
  /** Scheduled follow-up after an extension decision. */
  probation_next_review_date: { type: DataTypes.DATEONLY, allowNull: true },
  work_location: { type: DataTypes.STRING, defaultValue: 'office' },
  /** Scheduled work days per week (1–7). */
  work_days: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 5 },
  time_in: { type: DataTypes.STRING(5), defaultValue: '08:00' },
  time_out: { type: DataTypes.STRING(5), defaultValue: '17:00' },
  work_hours: { type: DataTypes.DECIMAL(4, 2), defaultValue: 8 },
  break_duration_minutes: { type: DataTypes.INTEGER, defaultValue: 60 },
  grace_period_minutes: { type: DataTypes.INTEGER, allowNull: true },
  /** Contractual payroll divisor (22 / 24 / 26) — independent of monthly roster scheduling. */
  payroll_basis_days: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 26 },
  /** Assigned allowance package (allowance_templates.id). */
  allowance_template_id: { type: DataTypes.STRING, allowNull: true },
  street_address: { type: DataTypes.STRING },
  street_address_kh: { type: DataTypes.STRING(500), allowNull: true },
  city: { type: DataTypes.STRING },
  city_kh: { type: DataTypes.STRING(255), allowNull: true },
  state_province: { type: DataTypes.STRING },
  postal_code: { type: DataTypes.STRING },
  country: { type: DataTypes.STRING, defaultValue: 'Cambodia' },
  emergency_contact_name: { type: DataTypes.STRING },
  emergency_contact_name_kh: { type: DataTypes.STRING(255), allowNull: true },
  emergency_contact_relationship: { type: DataTypes.STRING },
  emergency_contact_relationship_kh: { type: DataTypes.STRING(255), allowNull: true },
  emergency_contact_phone: { type: DataTypes.STRING },
  status: { type: DataTypes.STRING, defaultValue: 'active' },
  onboarding_completed_at: { type: DataTypes.DATE },
  terminated_at: { type: DataTypes.DATE },
  termination_reason: { type: DataTypes.STRING },
  offboard_type: { type: DataTypes.STRING(20), allowNull: true },
  offboard_source: { type: DataTypes.STRING(32), allowNull: true },
  resignation_submitted_at: { type: DataTypes.DATE, allowNull: true },
  resignation_approved_at: { type: DataTypes.DATE, allowNull: true },
  last_working_date: { type: DataTypes.DATEONLY, allowNull: true },
  final_settlement_date: { type: DataTypes.DATEONLY, allowNull: true },
  last_valid_working_date: { type: DataTypes.DATEONLY, allowNull: true },
  suspended_at: { type: DataTypes.DATE, allowNull: true },
  final_removal_approved_at: { type: DataTypes.DATE, allowNull: true },
  final_removal_approved_by: { type: DataTypes.STRING(64), allowNull: true },
  offboard_pending_settlement_id: { type: DataTypes.STRING(64), allowNull: true },
  created_by: { type: DataTypes.STRING },
  /** Uploaded HR documents (National ID, contract, etc.) — replaces legacy employeedocuments table. */
  documents_json: { type: DataTypes.JSON, allowNull: true },
}, {
  tableName: 'employees',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['employee_id'] },
    { unique: true, fields: ['email'] },
    { fields: ['department_id'] },
    { fields: ['position_id'] },
    { fields: ['status'] },
    { fields: ['join_date'] }
  ]
});

/** Per-employee compensation master (base salary, tax/NSSF, bank). 1:1 with employees.id */
export const SalaryStructure = sequelize.define(
  'SalaryStructure',
  {
    employee_id: { type: DataTypes.STRING, primaryKey: true },
    salary_type: { type: DataTypes.STRING, defaultValue: 'monthly' },
    base_salary: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING, defaultValue: 'USD' },
    payment_day: { type: DataTypes.INTEGER },
    bank_name: { type: DataTypes.STRING },
    bank_account_number: { type: DataTypes.STRING },
    payment_method: { type: DataTypes.STRING, allowNull: false, defaultValue: 'bank' },
    tax_id: { type: DataTypes.STRING },
    nssf_id: { type: DataTypes.STRING },
    tax_dependents: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    nssf_enrolled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    effective_from: { type: DataTypes.DATE },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: 'salarystructures',
    timestamps: false,
    indexes: [{ fields: ['effective_from'] }],
  }
);

// 3. EMPLOYEE DEPENDENTS
export const EmployeeDependent = sequelize.define('EmployeeDependent', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  employee_id: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  name_kh: { type: DataTypes.STRING(255), allowNull: true },
  relationship: { type: DataTypes.STRING, allowNull: false },
  birth_date: { type: DataTypes.DATE },
  is_beneficiary: { type: DataTypes.BOOLEAN, defaultValue: false },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  age: { type: DataTypes.INTEGER, allowNull: true },
  gender: { type: DataTypes.STRING(32), allowNull: true },
  occupation: { type: DataTypes.STRING(255), allowNull: true },
  has_job: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
  tableName: 'employeedependents',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [{ fields: ['employee_id'] }]
});

/** Issued employee ID cards — snapshot fields + expiry; multiple rows per employee. */
export const EmployeeIssuedCard = sequelize.define(
  'EmployeeIssuedCard',
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    employee_id: { type: DataTypes.STRING, allowNull: false },
    display_employee_id: { type: DataTypes.STRING, allowNull: false },
    issue_date: { type: DataTypes.DATEONLY, allowNull: false },
    expire_date: { type: DataTypes.DATEONLY, allowNull: false },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'active' },
    name_en: { type: DataTypes.STRING(500), allowNull: false },
    name_kh: { type: DataTypes.STRING(500), allowNull: true },
    position_title: { type: DataTypes.STRING(500), allowNull: false },
    avatar_url: { type: DataTypes.STRING(1024), allowNull: true },
    contact_phone: { type: DataTypes.STRING(255), allowNull: false },
    contact_telegram: { type: DataTypes.STRING(255), allowNull: true },
    join_date_snapshot: { type: DataTypes.DATEONLY, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    issued_by: { type: DataTypes.STRING(255), allowNull: true },
  },
  {
    tableName: 'employeecards',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['employee_id'] },
      { fields: ['display_employee_id'] },
      { fields: ['status'] },
      { fields: ['expire_date'] },
      { fields: ['issue_date'] },
    ],
  }
);

// 7b. TERMINATED EMPLOYEE ARCHIVE (full row snapshot at termination)
export const HistoryEmployee = sequelize.define(
  'HistoryEmployee',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    employee_pk: { type: DataTypes.STRING, allowNull: false },
    employee_id: { type: DataTypes.STRING, allowNull: false },
    employee_snapshot: { type: DataTypes.TEXT('long'), allowNull: false },
    terminated_at: { type: DataTypes.DATE, allowNull: false },
    termination_reason: { type: DataTypes.STRING(500), allowNull: false },
    terminated_by: { type: DataTypes.STRING },
    restored_at: { type: DataTypes.DATE },
    restored_by: { type: DataTypes.STRING },
    is_currently_terminated: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  {
    tableName: 'historyemployee',
    timestamps: false,
    indexes: [
      { fields: ['employee_id'] },
      { fields: ['employee_pk'] },
      { fields: ['terminated_at'] },
      { fields: ['is_currently_terminated'] },
    ],
  }
);

// 7. EMPLOYEE STATUS HISTORY (Audit)
export const EmployeeStatusHistory = sequelize.define('EmployeeStatusHistory', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  employee_id: { type: DataTypes.STRING, allowNull: false },
  old_status: { type: DataTypes.STRING },
  new_status: { type: DataTypes.STRING, allowNull: false },
  reason: { type: DataTypes.STRING },
  changed_by: { type: DataTypes.STRING },
  changed_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  tableName: 'employeestatushistories',
  timestamps: false,
  indexes: [
    { fields: ['employee_id'] },
    { fields: ['changed_at'] }
  ]
});

/** Transfer / promotion records tied to department & position changes. */
export const EmployeeMovement = sequelize.define(
  'EmployeeMovement',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    employee_pk: { type: DataTypes.STRING, allowNull: false },
    employee_id: { type: DataTypes.STRING, allowNull: false },
    movement_type: { type: DataTypes.STRING, allowNull: false },
    effective_date: { type: DataTypes.STRING, allowNull: false },
    from_department_id: { type: DataTypes.STRING, allowNull: false },
    to_department_id: { type: DataTypes.STRING, allowNull: false },
    from_position_id: { type: DataTypes.STRING, allowNull: false },
    to_position_id: { type: DataTypes.STRING, allowNull: false },
    from_job_position: { type: DataTypes.STRING, allowNull: true },
    to_job_position: { type: DataTypes.STRING, allowNull: true },
    from_reporting_manager_id: { type: DataTypes.STRING, allowNull: true },
    to_reporting_manager_id: { type: DataTypes.STRING, allowNull: true },
    from_base_salary: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    to_base_salary: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    from_currency: { type: DataTypes.STRING(8), allowNull: true },
    to_currency: { type: DataTypes.STRING(8), allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    source_appraisal_id: { type: DataTypes.STRING, allowNull: true },
    source_probation_review_id: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'completed' },
    created_by: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.STRING },
    applied_at: { type: DataTypes.STRING, allowNull: true },
    field_key: { type: DataTypes.STRING, allowNull: true },
    current_value: { type: DataTypes.TEXT, allowNull: true },
    new_value: { type: DataTypes.TEXT, allowNull: true },
    approved_by: { type: DataTypes.STRING, allowNull: true },
    approved_at: { type: DataTypes.STRING, allowNull: true },
  },
  {
    tableName: 'employee_movements',
    timestamps: false,
    indexes: [
      { fields: ['employee_id'] },
      { fields: ['to_department_id'] },
      { fields: ['from_department_id'] },
      { fields: ['effective_date'] },
      { fields: ['status'] },
    ],
  }
);

export const AttendanceRecord = sequelize.define('AttendanceRecord', {
  id: { type: DataTypes.STRING, primaryKey: true },
  userId: { type: DataTypes.STRING, allowNull: false },
  date: { type: DataTypes.STRING, allowNull: false },
  clockIn: { type: DataTypes.STRING },
  clockOut: { type: DataTypes.STRING },
  status: { type: DataTypes.STRING },
  locationIn: { type: DataTypes.JSON },
  locationOut: { type: DataTypes.JSON },
  workHours: { type: DataTypes.FLOAT },
  correctionAt: { type: DataTypes.STRING, allowNull: true },
  correctionBy: { type: DataTypes.STRING, allowNull: true },
  correctionReason: { type: DataTypes.STRING(500), allowNull: true },
  correctionSummary: { type: DataTypes.STRING(1000), allowNull: true },
  lateMinutes: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
  lateExcused: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
}, {
  indexes: [
    { fields: ['userId', 'date'] },
    { fields: ['date'] }
  ]
});

export const LeaveRequest = sequelize.define('LeaveRequest', {
  id: { type: DataTypes.STRING, primaryKey: true },
  userId: { type: DataTypes.STRING, allowNull: false },
  type: { type: DataTypes.STRING, allowNull: false },
  startDate: { type: DataTypes.STRING, allowNull: false },
  endDate: { type: DataTypes.STRING, allowNull: false },
  isHalfDay: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  halfDayPeriod: { type: DataTypes.STRING, allowNull: true },
  reason: { type: DataTypes.TEXT },
  status: { type: DataTypes.STRING, defaultValue: 'PENDING' },
  appliedOn: { type: DataTypes.STRING },
  rejectionReason: { type: DataTypes.TEXT },
  assignedManagerId: { type: DataTypes.STRING, allowNull: true },
  managerApprovedAt: { type: DataTypes.DATE, allowNull: true },
  managerApprovedBy: { type: DataTypes.STRING, allowNull: true },
  hrApprovedAt: { type: DataTypes.DATE, allowNull: true },
  hrApprovedBy: { type: DataTypes.STRING, allowNull: true },
}, {
  indexes: [
    { fields: ['userId'] },
    { fields: ['status'] }
  ]
});

/** HR-configured overtime categories (pay rate + validation rules). */
export const OvertimeType = sequelize.define(
  'OvertimeType',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    nameKh: { type: DataTypes.STRING, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    descriptionKh: { type: DataTypes.TEXT, allowNull: true },
    rateTier: {
      type: DataTypes.ENUM('regular_100', 'daytime_150', 'rest_holiday_200', 'night_200'),
      allowNull: false,
      defaultValue: 'daytime_150',
    },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    minHours: { type: DataTypes.DECIMAL(4, 2), allowNull: false, defaultValue: 0.25 },
    maxHoursPerDay: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 12 },
    minAdvanceDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    requireStartEndTime: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    requireClockInOut: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  {
    tableName: 'overtimetypes',
    indexes: [{ fields: ['isActive'] }],
  }
);

/** Employee-submitted overtime; only APPROVED rows count in payroll. */
export const OvertimeRequest = sequelize.define(
  'OvertimeRequest',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    userId: { type: DataTypes.STRING, allowNull: false },
    otTypeId: { type: DataTypes.STRING, allowNull: true },
    workDate: { type: DataTypes.DATEONLY, allowNull: false },
    hours: { type: DataTypes.DECIMAL(6, 2), allowNull: false },
    rateTier: {
      type: DataTypes.ENUM('regular_100', 'daytime_150', 'rest_holiday_200', 'night_200'),
      allowNull: false,
      defaultValue: 'daytime_150',
    },
    reason: { type: DataTypes.TEXT, allowNull: false },
    status: {
      type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED'),
      allowNull: false,
      defaultValue: 'PENDING',
    },
    appliedOn: { type: DataTypes.DATEONLY },
    approvedBy: { type: DataTypes.STRING },
    approvedAt: { type: DataTypes.DATE },
    rejectionReason: { type: DataTypes.TEXT },
    startTime: { type: DataTypes.STRING(8), allowNull: true },
    endTime: { type: DataTypes.STRING(8), allowNull: true },
    clockIn: { type: DataTypes.DATE, allowNull: true },
    clockOut: { type: DataTypes.DATE, allowNull: true },
  },
  {
    tableName: 'overtimerequests',
    indexes: [
      { fields: ['userId', 'status'] },
      { fields: ['workDate'] },
      { fields: ['status', 'workDate'] },
      { fields: ['otTypeId'] },
    ],
  }
);

OvertimeRequest.belongsTo(OvertimeType, { as: 'overtimeType', foreignKey: 'otTypeId' });
OvertimeType.hasMany(OvertimeRequest, { foreignKey: 'otTypeId' });

export const Project = sequelize.define('Project', {
  id: { type: DataTypes.STRING, primaryKey: true },
  title: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT },
  status: { type: DataTypes.STRING, defaultValue: 'ACTIVE' },
  progress: { type: DataTypes.INTEGER, defaultValue: 0 },
  deadline: { type: DataTypes.STRING },
  startDate: { type: DataTypes.STRING, allowNull: true },
  priority: { type: DataTypes.STRING, allowNull: true },
  departmentId: { type: DataTypes.STRING },
  leadId: { type: DataTypes.STRING },
  /** Portal user id of the creator — Managers manage only projects they created. */
  createdBy: { type: DataTypes.STRING, allowNull: true },
  /** Soft-delete timestamp (ISO). Null = active. */
  deletedAt: { type: DataTypes.STRING, allowNull: true },
}, {
  indexes: [
    { fields: ['departmentId'] },
    { fields: ['leadId'] },
    { fields: ['createdBy'] },
    { fields: ['status'] }
  ]
});

export const Task = sequelize.define('Task', {
  id: { type: DataTypes.STRING, primaryKey: true },
  title: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT },
  projectId: { type: DataTypes.STRING, allowNull: true },
  assigneeId: { type: DataTypes.STRING },
  creatorId: { type: DataTypes.STRING },
  status: { type: DataTypes.STRING, defaultValue: 'TODO' },
  progress: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  priority: { type: DataTypes.STRING(20), allowNull: true, defaultValue: 'MEDIUM' },
  startDate: { type: DataTypes.STRING },
  dueDate: { type: DataTypes.STRING },
  estimatedHours: { type: DataTypes.FLOAT, allowNull: true, defaultValue: 0 },
  loggedHours: { type: DataTypes.FLOAT, allowNull: true, defaultValue: 0 },
  createdAt: { type: DataTypes.STRING },
  updatedAt: { type: DataTypes.DATE },
  /** Soft-delete timestamp (ISO). Null = active. */
  deletedAt: { type: DataTypes.STRING, allowNull: true },
}, {
  indexes: [
    { fields: ['projectId'] },
    { fields: ['assigneeId'] },
    { fields: ['creatorId'] },
    { fields: ['status'] }
  ]
});

export const PayrollRun = sequelize.define('PayrollRun', {
  id: { type: DataTypes.STRING, primaryKey: true },
  month: { type: DataTypes.STRING, allowNull: false },
  totalEmployees: { type: DataTypes.INTEGER, defaultValue: 0 },
  totalNetPay: { type: DataTypes.FLOAT, defaultValue: 0 },
  status: { type: DataTypes.STRING, defaultValue: 'DRAFT' },
  processedBy: { type: DataTypes.STRING },
  calculatedBy: { type: DataTypes.STRING },
  calculatedAt: { type: DataTypes.STRING },
  payPeriodStart: { type: DataTypes.STRING(10) },
  payPeriodEnd: { type: DataTypes.STRING(10) },
  attendanceCutoffDate: { type: DataTypes.STRING(10) },
  reviewedBy: { type: DataTypes.STRING(64) },
  approvedBy: { type: DataTypes.STRING(64) },
  lockedAt: { type: DataTypes.STRING(32) },
  lockedBy: { type: DataTypes.STRING(64) },
  payrollCalendarId: { type: DataTypes.STRING(40) },
  payrollCycleId: { type: DataTypes.STRING(64) },
  payrollGroupId: { type: DataTypes.STRING(40) },
  paymentNumber: { type: DataTypes.STRING(40) },
  paymentExportedAt: { type: DataTypes.STRING(32) },
  paymentExportedBy: { type: DataTypes.STRING(64) },
  bankExportRef: { type: DataTypes.STRING(120) },
  paymentReconciledAt: { type: DataTypes.STRING(32) },
  createdAt: { type: DataTypes.STRING },
}, {
  indexes: [
    { fields: ['month'] },
    { fields: ['status'] }
  ]
});

export const Payslip = sequelize.define('Payslip', {
  id: { type: DataTypes.STRING, primaryKey: true },
  payrollRunId: { type: DataTypes.STRING, allowNull: false },
  /** Portal user id — payroll and attendance resolve employee via users.employeeId. */
  userId: { type: DataTypes.STRING, allowNull: false },
  month: { type: DataTypes.STRING, allowNull: false },
  status: { type: DataTypes.STRING, defaultValue: 'DRAFT' },
  disbursementStatus: { type: DataTypes.STRING, defaultValue: 'PENDING' },
  disbursementStatusAt: { type: DataTypes.STRING, allowNull: true },
  disbursementStatusBy: { type: DataTypes.STRING, allowNull: true },
  disbursementHoldNote: { type: DataTypes.TEXT, allowNull: true },
  reviewerNote: { type: DataTypes.TEXT, allowNull: true },
  generatedAt: { type: DataTypes.STRING },
}, {
  indexes: [
    { fields: ['payrollRunId'] },
    { fields: ['userId', 'month'] },
  ],
});

/** Normalized payroll calculation lines (1:1 with payslip). */
export const PayslipBreakdown = sequelize.define(
  'PayslipBreakdown',
  {
    payslipId: { type: DataTypes.STRING, primaryKey: true },
    baseSalary: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    proratedDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 26 },
    grossSalary: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    netSalary: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    exchangeRate: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 4100 },
    netSalaryKhr: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    allowanceTransport: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    allowanceAttendance: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    allowanceMeal: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    allowanceSeniority: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    allowanceSeniorityIndemnity: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    allowancePosition: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    allowanceCommission: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    allowanceOtMeal: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    allowanceBreakdownJson: { type: DataTypes.TEXT },
    otHours100: { type: DataTypes.DECIMAL(8, 2), allowNull: false, defaultValue: 0 },
    otAmount100: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    otHours150: { type: DataTypes.DECIMAL(8, 2), allowNull: false, defaultValue: 0 },
    otAmount150: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    otHours200: { type: DataTypes.DECIMAL(8, 2), allowNull: false, defaultValue: 0 },
    otAmount200: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    otTotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    deductionNssf: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    deductionTaxOnSalary: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    deductionAbsences: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    deductionAdvances: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    deductionTotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    attendanceRecordsInPeriod: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    attendancePresentDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    attendancePaidLeaveDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    attendancePaidDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    attendanceAbsentDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    attendanceScheduledWorkDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    attendanceTotalWorkHours: { type: DataTypes.DECIMAL(8, 2), allowNull: false, defaultValue: 0 },
    attendanceStandardHoursPerDay: { type: DataTypes.DECIMAL(4, 2), allowNull: false, defaultValue: 8 },
    attendanceHourlyRate: { type: DataTypes.DECIMAL(10, 4), allowNull: false, defaultValue: 0 },
    attendanceDependents: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    contractBaseSalary: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    hybridComponentsJson: { type: DataTypes.TEXT },
    payrollAuditJson: { type: DataTypes.TEXT },
    backPaymentUsd: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    backPaymentSourceMonth: { type: DataTypes.STRING(7) },
    reviewContextJson: { type: DataTypes.TEXT },
  },
  {
    tableName: 'payslipbreakdowns',
    timestamps: true,
  }
);

Payslip.hasOne(PayslipBreakdown, { foreignKey: 'payslipId', as: 'breakdownRow' });
PayslipBreakdown.belongsTo(Payslip, { foreignKey: 'payslipId' });

export const Notification = sequelize.define('Notification', {
  id: { type: DataTypes.STRING, primaryKey: true },
  userId: { type: DataTypes.STRING, allowNull: false },
  title: { type: DataTypes.STRING, allowNull: false },
  message: { type: DataTypes.TEXT },
  type: { type: DataTypes.STRING },
  category: { type: DataTypes.STRING, allowNull: false, defaultValue: 'SYSTEM' },
  priority: { type: DataTypes.STRING, allowNull: false, defaultValue: 'NORMAL' },
  entityId: { type: DataTypes.STRING, allowNull: true },
  entityType: { type: DataTypes.STRING, allowNull: true },
  senderId: { type: DataTypes.STRING, allowNull: true },
  isRead: { type: DataTypes.BOOLEAN, defaultValue: false },
  createdAt: { type: DataTypes.STRING },
  link: { type: DataTypes.STRING },
}, {
  tableName: 'notifications',
  indexes: [
    { fields: ['userId', 'isRead'] },
    { fields: ['userId', 'createdAt'] },
    { fields: ['userId', 'category'] },
  ]
});

export const Message = sequelize.define('Message', {
  id: { type: DataTypes.STRING, primaryKey: true },
  senderId: { type: DataTypes.STRING, allowNull: false },
  receiverId: { type: DataTypes.STRING, allowNull: true },
  groupId: { type: DataTypes.STRING, allowNull: true },
  content: { type: DataTypes.TEXT },
  isRead: { type: DataTypes.BOOLEAN, defaultValue: false },
  createdAt: { type: DataTypes.STRING },
  attachmentUrl: { type: DataTypes.STRING },
  attachmentType: { type: DataTypes.STRING },
  deletedAt: { type: DataTypes.STRING, allowNull: true },
  editedAt: { type: DataTypes.STRING, allowNull: true },
  replyToId: { type: DataTypes.STRING, allowNull: true },
  forwardedFromId: { type: DataTypes.STRING, allowNull: true },
  messageType: { type: DataTypes.STRING, allowNull: true },
  updatedAt: { type: DataTypes.DATE, allowNull: true },
}, {
  timestamps: false,
  indexes: [
    { fields: ['senderId'] },
    { fields: ['receiverId'] },
    { fields: ['groupId'] },
    { fields: ['isRead'] },
    { fields: ['replyToId'] },
  ],
});

/** Legacy MySQL grant models removed — grants live in permissionFileStore (JSON). */
export const SystemSetting = sequelize.define('SystemSetting', {
  id: { type: DataTypes.STRING, primaryKey: true },
  key: { type: DataTypes.STRING, allowNull: false, unique: true },
  value: { type: DataTypes.JSON },
  category: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT },
  isPublic: { type: DataTypes.BOOLEAN, defaultValue: false },
}, {
  indexes: [
    { fields: ['key'] },
    { fields: ['category'] }
  ]
});

/** Unified company profile (Settings → Company profile tabs). One row id=default. */
export const CompanyProfile = sequelize.define(
  'CompanyProfile',
  {
    id: { type: DataTypes.STRING(32), primaryKey: true, defaultValue: 'default' },
    name: { type: DataTypes.STRING(255), allowNull: true },
    legal_name: { type: DataTypes.STRING(255), allowNull: true },
    short_name: { type: DataTypes.STRING(64), allowNull: true },
    industry_type: { type: DataTypes.STRING(128), allowNull: true },
    business_type: { type: DataTypes.STRING(128), allowNull: true },
    founded_date: { type: DataTypes.DATEONLY, allowNull: true },
    website: { type: DataTypes.STRING(512), allowNull: true },
    logo_url: { type: DataTypes.TEXT, allowNull: true },
    banner_logo_url: { type: DataTypes.TEXT, allowNull: true },
    seal_url: { type: DataTypes.TEXT, allowNull: true },
    signature_url: { type: DataTypes.TEXT, allowNull: true },
    main_phone: { type: DataTypes.STRING(32), allowNull: true },
    secondary_phone: { type: DataTypes.STRING(32), allowNull: true },
    company_email: { type: DataTypes.STRING(255), allowNull: true },
    hr_email: { type: DataTypes.STRING(255), allowNull: true },
    support_email: { type: DataTypes.STRING(255), allowNull: true },
    fax_number: { type: DataTypes.STRING(32), allowNull: true },
    default_country: { type: DataTypes.STRING(128), allowNull: true },
    timezone: { type: DataTypes.STRING(64), allowNull: true },
    date_format: { type: DataTypes.STRING(32), allowNull: true },
    time_format: { type: DataTypes.STRING(32), allowNull: true },
    currency: { type: DataTypes.STRING(8), allowNull: true },
    language: { type: DataTypes.STRING(32), allowNull: true },
    week_start: { type: DataTypes.STRING(16), allowNull: true },
    registration_number: { type: DataTypes.STRING(128), allowNull: true },
    tax_id: { type: DataTypes.STRING(128), allowNull: true },
    tax_registration_date: { type: DataTypes.DATEONLY, allowNull: true },
    nssf_number: { type: DataTypes.STRING(128), allowNull: true },
    patent_number: { type: DataTypes.STRING(128), allowNull: true },
    ministry_registration_number: { type: DataTypes.STRING(128), allowNull: true },
    labor_registration_number: { type: DataTypes.STRING(128), allowNull: true },
    default_tax_rule: { type: DataTypes.STRING(64), allowNull: true },
    exchange_rate_source: { type: DataTypes.STRING(64), allowNull: true },
    payslip_footer: { type: DataTypes.TEXT, allowNull: true },
    report_header: { type: DataTypes.TEXT, allowNull: true },
    report_footer: { type: DataTypes.TEXT, allowNull: true },
    email_signature: { type: DataTypes.TEXT, allowNull: true },
  },
  { tableName: 'company_profile', timestamps: true, underscored: true }
);

export const SettingsPositionLevel = sequelize.define(
  'SettingsPositionLevel',
  {
    code: { type: DataTypes.STRING(40), primaryKey: true },
    label: { type: DataTypes.STRING(120), allowNull: false },
    tier: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    structure_tier: {
      type: DataTypes.ENUM('manager', 'officer', 'staff'),
      allowNull: false,
      defaultValue: 'staff',
    },
  },
  { tableName: 'settings_position_levels', timestamps: true, underscored: true }
);

export const SettingsSecurity = sequelize.define(
  'SettingsSecurity',
  {
    id: { type: DataTypes.STRING(32), primaryKey: true, defaultValue: 'default' },
    session_timeout_minutes: { type: DataTypes.STRING(16), allowNull: true },
    password_min_length: { type: DataTypes.STRING(8), allowNull: true },
    password_complexity: { type: DataTypes.JSON, allowNull: true },
    /** Plaintext default used when provisioning employee portal logins without an explicit password. */
    default_portal_password: { type: DataTypes.STRING(128), allowNull: true },
    /** When false, new portal accounts require an explicit password (default password feature off). */
    default_portal_password_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    mfa_required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    max_login_attempts: { type: DataTypes.STRING(8), allowNull: true },
    locked_period_minutes: { type: DataTypes.STRING(16), allowNull: true },
  },
  { tableName: 'settings_security', timestamps: true, underscored: true }
);

export const EmployeeSetting = sequelize.define('EmployeeSetting', {
  id: { type: DataTypes.STRING, primaryKey: true },
  employeeId: { type: DataTypes.STRING, allowNull: false },
  settingKey: { type: DataTypes.STRING, allowNull: false },
  value: { type: DataTypes.JSON },
}, {
  indexes: [
    { fields: ['employeeId', 'settingKey'], unique: true }
  ]
});

export const PermissionTemplate = sequelize.define('PermissionTemplate', {
  id: { type: DataTypes.STRING, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT },
  /** permission_bundle = grant keys; role_menu = sidebar paths (JSON string array) */
  template_kind: {
    type: DataTypes.STRING(32),
    allowNull: false,
    defaultValue: 'permission_bundle',
  },
  /** HR | MANAGER | EMPLOYEE when template_kind is role_menu */
  role_code: { type: DataTypes.STRING(32), allowNull: true },
  permissions: { type: DataTypes.JSON },
  createdBy: { type: DataTypes.STRING },
}, {
  indexes: [
    { fields: ['name'] },
    { fields: ['template_kind'] },
    { unique: true, fields: ['role_code'], name: 'permission_templates_role_menu_unique' },
  ],
});

export const AuditLog = sequelize.define('AuditLog', {
  id: { type: DataTypes.STRING, primaryKey: true },
  entityType: { type: DataTypes.STRING, allowNull: false },
  entityId: { type: DataTypes.STRING },
  action: { type: DataTypes.STRING, allowNull: false },
  oldValue: { type: DataTypes.JSON },
  newValue: { type: DataTypes.JSON },
  performedBy: { type: DataTypes.STRING, allowNull: false },
  reason: { type: DataTypes.TEXT },
  metadata: { type: DataTypes.JSON },
}, {
  indexes: [
    { fields: ['entityType', 'entityId'] },
    { fields: ['performedBy', 'createdAt'] },
    { fields: ['createdAt'] }
  ]
});

// ============================================
// LEAVE MANAGEMENT - ROSTER MODULE
// ============================================

// Fixed Roster (scheduled days off)
export const FixedRoster = sequelize.define('FixedRoster', {
  id: { type: DataTypes.STRING, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  rosterType: { type: DataTypes.ENUM('WEEKLY', 'MONTHLY', 'SHIFT', 'CUSTOM'), allowNull: false },
  schedule: { type: DataTypes.JSON, allowNull: false }, // e.g., { days: [0, 6] } for Sunday/Saturday weekly
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  effectiveFrom: { type: DataTypes.DATE },
  effectiveTo: { type: DataTypes.DATE },
  description: { type: DataTypes.TEXT },
  createdBy: { type: DataTypes.STRING },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  indexes: [
    { fields: ['rosterType'] },
    { fields: ['isActive'] }
  ]
});

// Roster Assignment to employees/departments
export const RosterAssignment = sequelize.define('RosterAssignment', {
  id: { type: DataTypes.STRING, primaryKey: true },
  rosterId: { type: DataTypes.STRING, allowNull: false },
  entityType: { type: DataTypes.ENUM('EMPLOYEE', 'DEPARTMENT', 'POSITION'), allowNull: false },
  entityId: { type: DataTypes.STRING, allowNull: false },
  allocation: { type: DataTypes.DECIMAL(5,2), defaultValue: 100 },
  effectiveFrom: { type: DataTypes.DATE },
  effectiveTo: { type: DataTypes.DATE },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  indexes: [
    { fields: ['rosterId'] },
    { fields: ['entityType', 'entityId'] }
  ]
});

// Roster Exception (one-off override)
export const RosterException = sequelize.define('RosterException', {
  id: { type: DataTypes.STRING, primaryKey: true },
  rosterId: { type: DataTypes.STRING, allowNull: false },
  employeeId: { type: DataTypes.STRING, allowNull: false },
  date: { type: DataTypes.DATE, allowNull: false },
  isWorking: { type: DataTypes.BOOLEAN, defaultValue: false }, // true = working, false = off
  reason: { type: DataTypes.STRING },
  createdBy: { type: DataTypes.STRING },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  indexes: [
    { fields: ['rosterId', 'employeeId'] },
    { fields: ['date'] }
  ]
});

/** Monthly planning roster header (Leaves → Planning tab). */
export const MonthlyPlanningRoster = sequelize.define(
  'MonthlyPlanningRoster',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    month: { type: DataTypes.INTEGER, allowNull: false },
    year: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: 'monthlyplanningrosters',
    indexes: [
      { fields: ['year', 'month'] },
      { fields: ['isActive'] },
    ],
  }
);

/** One cell per employee per day (normalized; no JSON blob on roster header). */
export const MonthlyPlanningRosterEntry = sequelize.define(
  'MonthlyPlanningRosterEntry',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    rosterId: { type: DataTypes.STRING, allowNull: false },
    employeeId: { type: DataTypes.STRING, allowNull: false },
    day: { type: DataTypes.INTEGER, allowNull: false },
    leaveType: { type: DataTypes.STRING, allowNull: false },
    isLocked: { type: DataTypes.BOOLEAN, defaultValue: true },
    /** Set when cell was created from an approved leave request. */
    sourceLeaveRequestId: { type: DataTypes.STRING, allowNull: true },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: 'monthlyplanningrosterentries',
    indexes: [
      { fields: ['rosterId'] },
      { fields: ['rosterId', 'employeeId', 'day'], unique: true },
      { fields: ['employeeId'] },
      { fields: ['sourceLeaveRequestId'] },
    ],
  }
);

MonthlyPlanningRoster.hasMany(MonthlyPlanningRosterEntry, {
  foreignKey: 'rosterId',
  as: 'entryRows',
});
MonthlyPlanningRosterEntry.belongsTo(MonthlyPlanningRoster, { foreignKey: 'rosterId' });

// Leave Type Configuration
export const LeaveType = sequelize.define('LeaveType', {
  id: { type: DataTypes.STRING, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  nameKh: { type: DataTypes.STRING, allowNull: true },
  code: { type: DataTypes.STRING, allowNull: false, unique: true },
  description: { type: DataTypes.TEXT },
  descriptionKh: { type: DataTypes.TEXT, allowNull: true },
  isPaid: { type: DataTypes.BOOLEAN, defaultValue: true },
  daysAllowed: { type: DataTypes.INTEGER, defaultValue: 0 },
  leaveCategory: { type: DataTypes.STRING, allowNull: true },
  monthlyAccrualRate: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
  yearlyResetEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
  maxCarryForward: { type: DataTypes.INTEGER, defaultValue: 0 },
  eventTriggerType: { type: DataTypes.STRING, allowNull: true },
  maxUsagePerEmployment: { type: DataTypes.INTEGER, allowNull: true },
  affectsPayroll: { type: DataTypes.BOOLEAN, defaultValue: true },
  requiresDocument: { type: DataTypes.BOOLEAN, defaultValue: false },
  requiresApproval: { type: DataTypes.BOOLEAN, defaultValue: true },
  /** Payroll day category override: 'payable' | 'deductible' | 'neutral' (null = derive from isPaid). */
  payrollCategory: { type: DataTypes.STRING, allowNull: true },
  /** Explicit deduct-salary flag (null = derive from isPaid). */
  deductSalary: { type: DataTypes.BOOLEAN, allowNull: true },
  color: { type: DataTypes.STRING, defaultValue: '#3B82F6' },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  timestamps: true,
  indexes: [
    { fields: ['code'] },
    { fields: ['isActive'] }
  ]
});

// Leave Balance per employee per type
export const LeaveBalance = sequelize.define('LeaveBalance', {
  id: { type: DataTypes.STRING, primaryKey: true },
  employeeId: { type: DataTypes.STRING, allowNull: false },
  leaveTypeId: { type: DataTypes.STRING, allowNull: false },
  year: { type: DataTypes.INTEGER, allowNull: false },
  openingBalance: { type: DataTypes.DECIMAL(7, 2), defaultValue: 0 },
  accrued: { type: DataTypes.DECIMAL(7, 2), defaultValue: 0 },
  entitlement: { type: DataTypes.DECIMAL(7, 2), defaultValue: 0 },
  used: { type: DataTypes.DECIMAL(7, 2), defaultValue: 0 },
  carriedOver: { type: DataTypes.DECIMAL(7, 2), defaultValue: 0 },
  lastAccrualMonth: { type: DataTypes.STRING, allowNull: true },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  indexes: [
    { fields: ['employeeId', 'leaveTypeId', 'year'], unique: true }
  ]
});

/** Assignment without balance (event-based / approval-based leave types). */
export const EmployeeLeaveTypeAssignment = sequelize.define(
  'EmployeeLeaveTypeAssignment',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    employeeId: { type: DataTypes.STRING, allowNull: false },
    leaveTypeId: { type: DataTypes.STRING, allowNull: false },
    year: { type: DataTypes.INTEGER, allowNull: false },
    enabled: { type: DataTypes.BOOLEAN, defaultValue: true },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    indexes: [{ fields: ['employeeId', 'leaveTypeId', 'year'], unique: true }],
  }
);

export const UserDeviceSession = sequelize.define('UserDeviceSession', {
  id: { type: DataTypes.STRING, primaryKey: true },
  userId: { type: DataTypes.STRING, allowNull: false },
  deviceId: { type: DataTypes.STRING, allowNull: false },
  deviceLabel: { type: DataTypes.STRING },
  sessionToken: { type: DataTypes.STRING, allowNull: false },
  lastActivity: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  tableName: 'userdevicesessions',
  indexes: [
    { fields: ['userId'] },
    { fields: ['sessionToken'] },
    { unique: true, fields: ['userId', 'deviceId'] },
  ],
});

export const EmployeeReview = sequelize.define('EmployeeReview', {
  id: { type: DataTypes.STRING, primaryKey: true },
  userId: { type: DataTypes.STRING, allowNull: false },
  reviewType: {
    type: DataTypes.ENUM('PROBATION', 'PERFORMANCE', 'TRAINING'),
    defaultValue: 'PROBATION',
  },
  periodEnd: { type: DataTypes.DATEONLY },
  score: { type: DataTypes.INTEGER },
  status: {
    type: DataTypes.STRING(32),
    defaultValue: 'UPCOMING',
  },
  notes: { type: DataTypes.TEXT },
  reviewedBy: { type: DataTypes.STRING },
  reviewedAt: { type: DataTypes.DATE },
  grade: { type: DataTypes.STRING(5), allowNull: true },
  categoryScoresJson: { type: DataTypes.TEXT, allowNull: true },
  periodMonth: { type: DataTypes.STRING(7), allowNull: true },
  recommendation: { type: DataTypes.STRING(16), allowNull: true },
  evaluationRatingsJson: { type: DataTypes.TEXT, allowNull: true },
  strengths: { type: DataTypes.TEXT, allowNull: true },
  areasForImprovement: { type: DataTypes.TEXT, allowNull: true },
  hrNotes: { type: DataTypes.TEXT, allowNull: true },
  extensionDays: { type: DataTypes.INTEGER, allowNull: true },
  extensionReason: { type: DataTypes.TEXT, allowNull: true },
  nextReviewDate: { type: DataTypes.DATEONLY, allowNull: true },
  overallRecommendation: { type: DataTypes.STRING(128), allowNull: true },
  employeeRowId: { type: DataTypes.STRING(64), allowNull: true },
  assignedHrUserId: { type: DataTypes.STRING(64), allowNull: true },
  assignedManagerUserId: { type: DataTypes.STRING(64), allowNull: true },
  routedByHrUserId: { type: DataTypes.STRING(64), allowNull: true },
  routedAt: { type: DataTypes.DATE, allowNull: true },
  managerSubmittedBy: { type: DataTypes.STRING(64), allowNull: true },
  managerSubmittedAt: { type: DataTypes.DATE, allowNull: true },
  employeeSubmittedBy: { type: DataTypes.STRING(64), allowNull: true },
  employeeSubmittedAt: { type: DataTypes.DATE, allowNull: true },
  outcomePayloadJson: { type: DataTypes.TEXT, allowNull: true },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  tableName: 'employeereviews',
  indexes: [
    { fields: ['userId'] },
    { fields: ['reviewType'] },
    { fields: ['status'] },
  ],
});

// ============================================
// PROJECT MODULE - ENHANCED
// ============================================

// Project Assignment
export const ProjectAssignment = sequelize.define('ProjectAssignment', {
  id: { type: DataTypes.STRING, primaryKey: true },
  projectId: { type: DataTypes.STRING, allowNull: false },
  employeeId: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.STRING },
  allocationPercentage: { type: DataTypes.INTEGER, defaultValue: 100 },
  startDate: { type: DataTypes.DATE },
  endDate: { type: DataTypes.DATE },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  indexes: [
    { fields: ['projectId'] },
    { fields: ['employeeId'] }
  ]
});

// ============================================
// PAYROLL MODULE - ENHANCED
// ============================================

// Tax Bracket Configuration
export const TaxBracket = sequelize.define(
  'TaxBracket',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    minIncome: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    maxIncome: { type: DataTypes.DECIMAL(12, 2) },
    rate: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
    baseTax: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    currency: { type: DataTypes.STRING, defaultValue: 'USD' },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  },
  {
    tableName: 'taxbrackets',
    timestamps: false,
    indexes: [{ fields: ['isActive'] }],
  }
);

// --- Dynamic allowance rule engine (Payroll → Rules) ---
export const AllowanceType = sequelize.define(
  'AllowanceType',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    code: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    category: { type: DataTypes.STRING(32), allowNull: false },
    calculation_type: { type: DataTypes.STRING(32), allowNull: false },
    taxable: { type: DataTypes.BOOLEAN, defaultValue: true },
    active: { type: DataTypes.BOOLEAN, defaultValue: true },
    description: { type: DataTypes.TEXT },
  },
  { tableName: 'allowance_types', timestamps: true, underscored: true }
);

export const AllowanceRule = sequelize.define(
  'AllowanceRule',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    allowance_type_id: { type: DataTypes.STRING, allowNull: false },
    rule_name: { type: DataTypes.STRING(160), allowNull: false },
    trigger_type: { type: DataTypes.STRING(32), allowNull: false },
    condition_json: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    formula: { type: DataTypes.STRING(512) },
    fixed_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    percentage_rate: { type: DataTypes.DECIMAL(8, 4), defaultValue: 0 },
    priority: { type: DataTypes.INTEGER, defaultValue: 100 },
    effective_from: { type: DataTypes.DATEONLY },
    effective_to: { type: DataTypes.DATEONLY },
    active: { type: DataTypes.BOOLEAN, defaultValue: true },
    stackable: { type: DataTypes.BOOLEAN, defaultValue: true },
  },
  { tableName: 'allowance_rules', timestamps: true, underscored: true }
);

export const EmployeeAllowanceAssignment = sequelize.define(
  'EmployeeAllowanceAssignment',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    employee_id: { type: DataTypes.STRING, allowNull: false },
    allowance_type_id: { type: DataTypes.STRING, allowNull: false },
    allowance_rule_id: { type: DataTypes.STRING },
    custom_amount: { type: DataTypes.DECIMAL(12, 2) },
    start_date: { type: DataTypes.DATEONLY },
    end_date: { type: DataTypes.DATEONLY },
    active: { type: DataTypes.BOOLEAN, defaultValue: true },
    notes: { type: DataTypes.TEXT },
  },
  { tableName: 'employee_allowance_assignments', timestamps: true, underscored: true }
);

export const AllowanceTemplate = sequelize.define(
  'AllowanceTemplate',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    template_name: { type: DataTypes.STRING(160), allowNull: false },
    department_id: { type: DataTypes.STRING },
    role_id: { type: DataTypes.STRING },
    active: { type: DataTypes.BOOLEAN, defaultValue: true },
    items_json: { type: DataTypes.JSON, allowNull: true },
  },
  { tableName: 'allowance_templates', timestamps: true, underscored: true }
);

AllowanceType.hasMany(AllowanceRule, { foreignKey: 'allowance_type_id', as: 'rules' });
AllowanceRule.belongsTo(AllowanceType, { foreignKey: 'allowance_type_id', as: 'type' });
Employee.hasMany(EmployeeAllowanceAssignment, { foreignKey: 'employee_id', as: 'allowanceAssignments' });
EmployeeAllowanceAssignment.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });

/** Monthly sales input for commission_based allowance rules (employee + YYYY-MM). */
export const EmployeeMonthlySales = sequelize.define(
  'EmployeeMonthlySales',
  {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    employee_id: { type: DataTypes.STRING(64), allowNull: false },
    payroll_month: { type: DataTypes.STRING(7), allowNull: false },
    sales_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    notes: { type: DataTypes.TEXT },
  },
  {
    tableName: 'employee_monthly_sales',
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ['employee_id', 'payroll_month'] }],
  }
);

Employee.hasMany(EmployeeMonthlySales, { foreignKey: 'employee_id', as: 'monthlySales' });
EmployeeMonthlySales.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });

export const UnifiedPayrollRule = sequelize.define(
  'UnifiedPayrollRule',
  {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    description: { type: DataTypes.TEXT },
    category: { type: DataTypes.STRING(32), allowNull: false },
    source: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'employee' },
    mode: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'simple' },
    condition_json: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    action_json: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 50 },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    is_template: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    is_system: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    effective_from: { type: DataTypes.DATEONLY },
    effective_to: { type: DataTypes.DATEONLY },
  },
  { tableName: 'unified_payroll_rules', timestamps: true, underscored: true }
);

export const SeniorityRule = sequelize.define(
  'SeniorityRule',
  {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    description: { type: DataTypes.TEXT },
    effective_from: { type: DataTypes.DATEONLY, allowNull: false },
    effective_to: { type: DataTypes.DATEONLY },
    accrual_type: { type: DataTypes.STRING(32), allowNull: false },
    accrual_config: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    calculation_base: { type: DataTypes.STRING(32), defaultValue: 'basic_salary' },
    eligibility_rules: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    proration_rules: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    payment_frequency: { type: DataTypes.STRING(32), defaultValue: 'monthly' },
    applicable_groups: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    priority: { type: DataTypes.INTEGER, defaultValue: 100 },
    active: { type: DataTypes.BOOLEAN, defaultValue: true },
  },
  { tableName: 'seniority_rules', timestamps: true, underscored: true }
);

export const SeniorityIndemnityPolicy = sequelize.define(
  'SeniorityIndemnityPolicy',
  {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    description: { type: DataTypes.TEXT },
    legal_ref: { type: DataTypes.STRING(255) },
    effective_from: { type: DataTypes.DATEONLY, allowNull: false },
    effective_to: { type: DataTypes.DATEONLY },
    days_per_year: { type: DataTypes.DECIMAL(6, 2), allowNull: false, defaultValue: 15 },
    payout_june_days: { type: DataTypes.DECIMAL(6, 2), allowNull: false, defaultValue: 7.5 },
    payout_december_days: { type: DataTypes.DECIMAL(6, 2), allowNull: false, defaultValue: 7.5 },
    daily_rate_method: { type: DataTypes.STRING(32), defaultValue: 'scheduled_26' },
    salary_basis: { type: DataTypes.JSON, allowNull: false, defaultValue: ['base_salary'] },
    eligible_contract_types: { type: DataTypes.JSON, allowNull: false, defaultValue: ['UDC'] },
    excluded_employment_types: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: ['Intern', 'Consultant', 'Freelancer', 'Contract'],
    },
    inclusion_rule: { type: DataTypes.STRING(32), defaultValue: 'after_probation' },
    inclusion_months: { type: DataTypes.INTEGER, defaultValue: 0 },
    working_days_divisor: { type: DataTypes.INTEGER, defaultValue: 26 },
    extended_config: { type: DataTypes.JSON },
    priority: { type: DataTypes.INTEGER, defaultValue: 100 },
    active: { type: DataTypes.BOOLEAN, defaultValue: false },
  },
  { tableName: 'seniority_indemnity_policies', timestamps: true, underscored: true }
);

export const SeniorityLedger = sequelize.define(
  'SeniorityLedger',
  {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    employee_id: { type: DataTypes.STRING(64), allowNull: false },
    type: { type: DataTypes.STRING(24), allowNull: false },
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    balance_after: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    payroll_month: { type: DataTypes.STRING(7) },
    reference_id: { type: DataTypes.STRING(64) },
    reason: { type: DataTypes.STRING(255) },
    rule_id: { type: DataTypes.STRING(64) },
    snapshot: { type: DataTypes.JSON },
  },
  { tableName: 'seniority_ledger', timestamps: true, underscored: true, updatedAt: false }
);

export const EmployeeSeniorityProfile = sequelize.define(
  'EmployeeSeniorityProfile',
  {
    employee_id: { type: DataTypes.STRING(64), primaryKey: true },
    active_rule_id: { type: DataTypes.STRING(64) },
    total_service_days: { type: DataTypes.INTEGER, defaultValue: 0 },
    current_balance_usd: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    last_calculated_date: { type: DataTypes.DATEONLY },
    last_accrual_usd: { type: DataTypes.DECIMAL(12, 2) },
  },
  { tableName: 'employee_seniority_profiles', timestamps: true, underscored: true }
);

export const UnifiedPayrollRuleLog = sequelize.define(
  'UnifiedPayrollRuleLog',
  {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    employee_id: { type: DataTypes.STRING(64), allowNull: false },
    payroll_month: { type: DataTypes.STRING(7) },
    rule_id: { type: DataTypes.STRING(64), allowNull: false },
    triggered_at: { type: DataTypes.DATE, allowNull: false },
    input_snapshot: { type: DataTypes.JSON },
    output_result: { type: DataTypes.JSON },
  },
  { tableName: 'unified_payroll_rule_logs', timestamps: true, underscored: true, updatedAt: false }
);

// Payroll compliance rules (MLVT / NSSF / OT — editable in Rules tab)
export const PayrollComplianceRule = sequelize.define(
  'PayrollComplianceRule',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    ruleKey: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    legalRef: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    config: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  },
  {
    tableName: 'payrollcompliancerules',
    timestamps: false,
    indexes: [{ fields: ['isActive'] }, { unique: true, fields: ['ruleKey'] }],
  }
);

// NSSF assumed contributory wage table (ministry levels 1–22)
export const NssfAssumedWageBracket = sequelize.define(
  'NssfAssumedWageBracket',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    level: { type: DataTypes.INTEGER, allowNull: false },
    wageMinKhr: { type: DataTypes.DECIMAL(14, 0), allowNull: false },
    wageMaxKhr: { type: DataTypes.DECIMAL(14, 0) },
    assumedWageKhr: { type: DataTypes.DECIMAL(14, 0), allowNull: false },
    sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  },
  {
    tableName: 'nssfassumedwagebrackets',
    timestamps: false,
    indexes: [{ fields: ['isActive'] }, { fields: ['level'] }],
  }
);

// Payroll compliance calendar (run dates + OT day tiers per year)
export const PayrollCalendar = sequelize.define(
  'PayrollCalendar',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    year: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    config: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  },
  {
    tableName: 'payrollcalendars',
    timestamps: true,
    indexes: [{ unique: true, fields: ['year'] }],
  }
);

// NSSF rates live in systemsettings key payroll.nssf_config (see nssfConfigService.ts).

// ============================================
// SYSTEM SETTINGS & PERMISSION OVERRIDE MODULE
// ============================================

/**
 * Drop accumulated duplicate indexes (anything matching `<column>_<digits>`) on
 * tables managed by Sequelize. Past `alter: true` cycles added a new unique
 * index on each restart until MySQL hit the 64-keys-per-table cap. This sweeps
 * them up so subsequent `sync()` calls succeed. Safe to re-run.
 */
/** Drop duplicate FKs (same column → same parent table) left by repeated `sync({ alter: true })`. */
async function dropDuplicateAccumulatedForeignKeys() {
  type FkRow = {
    TABLE_NAME: string;
    CONSTRAINT_NAME: string;
    COLUMN_NAME: string;
    REFERENCED_TABLE_NAME: string;
    REFERENCED_COLUMN_NAME: string;
  };
  try {
    const [rows] = await sequelize.query(
      `SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE()
         AND REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, CONSTRAINT_NAME`
    );
    const seen = new Map<string, string>();
    let dropped = 0;
    for (const row of rows as FkRow[]) {
      const sig = `${row.TABLE_NAME}|${row.COLUMN_NAME}|${row.REFERENCED_TABLE_NAME}|${row.REFERENCED_COLUMN_NAME}`;
      if (!seen.has(sig)) {
        seen.set(sig, row.CONSTRAINT_NAME);
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await sequelize.query(
          `ALTER TABLE \`${row.TABLE_NAME}\` DROP FOREIGN KEY \`${row.CONSTRAINT_NAME}\``
        );
        dropped++;
      } catch {
        /* ignore */
      }
    }
    if (dropped > 0) {
      console.log(`Dropped ${dropped} duplicate foreign key(s) from managed tables.`);
    }
  } catch {
    /* information_schema unavailable — skip */
  }
}

async function dropDuplicateAccumulatedIndexes() {
  const tables = ['Users'];
  let totalDropped = 0;
  for (const table of tables) {
    try {
      type IndexRow = { INDEX_NAME?: string };
      const [rows] = await sequelize.query(
        `SELECT DISTINCT INDEX_NAME
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :table
           AND INDEX_NAME REGEXP '_[0-9]+$'
           AND INDEX_NAME <> 'PRIMARY'`,
        { replacements: { table } }
      );
      const dup = (rows as IndexRow[])
        .map((r) => r.INDEX_NAME)
        .filter((n): n is string => !!n);
      for (const name of dup) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await sequelize.query(
            `ALTER TABLE \`${table}\` DROP INDEX \`${name}\``
          );
          totalDropped++;
        } catch {
          /* index already gone or in-use — ignore */
        }
      }
    } catch {
      /* table doesn't exist on this DB — skip */
    }
  }
  if (totalDropped > 0) {
    console.log(`Dropped ${totalDropped} accumulated duplicate index(es) across managed tables.`);
  }
}

export const initDb = async () => {
  isDatabaseReady = false;
  logDatabaseTarget();
  try {
    await sequelize.authenticate();
  } catch (error) {
    console.error('Unable to connect to the database:', error);
    if (process.env.NODE_ENV === 'production') {
      console.error(
        '[db] API will start in degraded mode. /api/health returns 503 until MYSQL_URL resolves.'
      );
    } else {
      console.error(
        '[db] Local dev: ensure XAMPP MySQL is running and unset MYSQL_URL / DB_SSL in this terminal (they are for Aiven only).'
      );
    }
    return;
  }

  isDatabaseReady = true;
  console.log('Database connection has been established successfully.');

  try {
    const { dropLegacyEmployeeTables } = await import('./legacyTableCleanup.js');
    await dropLegacyEmployeeTables();
  } catch (legacyDropErr) {
    console.warn(
      '[db] Legacy table cleanup:',
      (legacyDropErr as Error)?.message || legacyDropErr
    );
  }

  try {
    const { isCoreSchemaComplete, listMissingCoreTables, repairCoreSchemaFromTemplate, probeInnoDbEngineHealth, INNODB_1932_RECOVERY_HINT } =
      await import('./schemaHealth.js');
    let coreOk = await isCoreSchemaComplete(sequelize);
    if (
      !coreOk &&
      process.env.NODE_ENV !== 'production' &&
      process.env.DB_AUTO_REPAIR !== 'false'
    ) {
      console.warn(
        '[db] Core tables missing (incomplete SQL import). Auto-importing backend/database/hcms_db.sql…'
      );
      isDatabaseReady = false;
      if (repairCoreSchemaFromTemplate()) {
        coreOk = await isCoreSchemaComplete(sequelize);
      }
    }
    // Production (and any env that skipped SQL repair): recreate *empty* missing tables so
    // list APIs stop 500ing. Does not drop existing tables (users survive). Admin must restore
    // a backup to reload HR data.
    if (!coreOk && process.env.DB_AUTO_SHELL_SCHEMA !== 'false') {
      const missing = await listMissingCoreTables(sequelize);
      console.warn(
        `[db] Core tables missing (${missing.join(', ')}). Creating empty table shells via sync()…`
      );
      try {
        await sequelize.sync();
        coreOk = await isCoreSchemaComplete(sequelize);
        if (coreOk) {
          console.warn(
            '[db] Empty core schema shells are ready. Restore a SQL backup to reload employees and related data.'
          );
        }
      } catch (shellErr) {
        console.error(
          '[db] Failed to create empty core schema shells:',
          (shellErr as Error)?.message || shellErr
        );
      }
    }
    isSchemaComplete = coreOk;

    if (coreOk) {
      const engine = await probeInnoDbEngineHealth(sequelize);
      if (!engine.ok) {
        isSchemaComplete = false;
        isDatabaseReady = false;
        console.error('[db] CRITICAL: InnoDB orphan tables detected (#1932).');
        console.error(`[db] Broken core tables: ${engine.orphanTables.join(', ')}`);
        if (engine.sampleError) console.error(`[db] Sample: ${engine.sampleError}`);
        console.error(`[db] ${INNODB_1932_RECOVERY_HINT}`);
        return;
      }
    }
    if (!coreOk) {
      const missing = await listMissingCoreTables(sequelize);
      console.error(
        `[db] Schema incomplete (missing: ${missing.join(', ') || 'unknown'}). ` +
          'Login stays available if the live probe later recovers; from project root run: npm run db:setup'
      );
      // Keep the TCP connection marked ready so health can re-probe and heal.
      // Do not abort the rest of init — optional tables may still be ensured.
      isSchemaComplete = false;
    } else {
      isDatabaseReady = true;
    }
  } catch (schemaCheckErr) {
    console.warn('[db] Could not verify core schema:', (schemaCheckErr as Error)?.message);
    isSchemaComplete = false;
  }

  try {
    await ensureHistoryEmployeeTable();
    console.log('[db] historyemployee archive table is ready.');
    const { ensureEmployeeSensitiveChangeSchema } = await import(
      './employeeSensitiveChangeSchema.js'
    );
    await ensureEmployeeSensitiveChangeSchema();
    const { ensureFieldCorrectionsConsolidated } = await import('./employeeSensitiveChangeService.js');
    await ensureFieldCorrectionsConsolidated();
    console.log('[db] employee_sensitive_changes table is ready.');
    const { ensureAttendanceLateColumns } = await import('./attendanceLateFields.js');
    await ensureAttendanceLateColumns();
    const { ensureAttendanceWarningsRemoved } = await import('./attendanceWarningRemoval.js');
    await ensureAttendanceWarningsRemoved();
  } catch (historyTableErr) {
    console.warn(
      '[db] Could not ensure historyemployee table:',
      (historyTableErr as Error)?.message || historyTableErr
    );
  }

  try {
    await ensureEmployeecardsTable();
    await ensureEmployeeDependentChildColumns();
    console.log('[db] employeecards table is ready.');
  } catch (cardsTableErr) {
    console.warn(
      '[db] Could not ensure employeecards table:',
      (cardsTableErr as Error)?.message || cardsTableErr
    );
  }

  try {
    const { ensureAppraisalSchema } = await import('./appraisal/appraisalSchema.js');
    await ensureAppraisalSchema();
    const { ensureAppraisalScoreAuditConsolidated } = await import(
      './appraisal/appraisalScoreAuditService.js'
    );
    await ensureAppraisalScoreAuditConsolidated();
    console.log('[db] KPI appraisal schema is ready.');
  } catch (appraisalSchemaErr) {
    console.warn(
      '[db] Could not ensure appraisal schema:',
      (appraisalSchemaErr as Error)?.message || appraisalSchemaErr
    );
  }

  try {
    const { ensurePersonalHubSchema } = await import('./personalAnalytics/personalHubSchema.js');
    await ensurePersonalHubSchema();
    const { ensureEmployeeReviewKpiColumns } = await import(
      './personalAnalytics/employeeReviewKpiSchema.js'
    );
    await ensureEmployeeReviewKpiColumns();
    console.log('[db] personal hub schema is ready.');
  } catch (hubSchemaErr) {
    console.warn(
      '[db] Could not ensure personal hub schema:',
      (hubSchemaErr as Error)?.message || hubSchemaErr
    );
  }

  try {
    await ensureEmployeeMovementsTable();
    await ensureEmployeeMovementSalaryColumns();
    await ensureEmployeeMovementAppraisalColumn();
    await ensureEmployeeMovementProbationColumn();
    const { ensureEmployeeMovementExtendedColumns, ensureEmployeeEmploymentStatusColumn } =
      await import('./employeeMovementSchema.js');
    await ensureEmployeeMovementExtendedColumns();
    await ensureEmployeeEmploymentStatusColumn();
    const { ensureWorkflowApprovalStepsConsolidated } = await import(
      './workflowApprovalStepsSchema.js'
    );
    await ensureWorkflowApprovalStepsConsolidated();
    console.log('[db] employee_movements table is ready.');
  } catch (movementTableErr) {
    console.warn(
      '[db] Could not ensure employee_movements table:',
      (movementTableErr as Error)?.message || movementTableErr
    );
  }

  try {
    const { ensureEmployeeDocumentsConsolidated } = await import('./employeeDocumentSchema.js');
    await ensureEmployeeDocumentsConsolidated();
    const { normalizeEmployeeDocumentTypesInDatabase } = await import('./employeeDocumentService.js');
    await normalizeEmployeeDocumentTypesInDatabase();
  } catch (docConsolidateErr) {
    console.warn(
      '[db] Could not consolidate employee documents:',
      (docConsolidateErr as Error)?.message || docConsolidateErr
    );
  }

  try {
    const { ensureAuditLogsConsolidated } = await import('./auditLogConsolidationService.js');
    await ensureAuditLogsConsolidated();
  } catch (auditConsolidateErr) {
    console.warn(
      '[db] Could not consolidate audit logs:',
      (auditConsolidateErr as Error)?.message || auditConsolidateErr
    );
  }

  try {
    const { ensurePayrollHybridSchema } = await import('./payroll/payrollHybridSchema.js');
    await ensurePayrollHybridSchema();
    const { ensureFinalSettlementSchema } = await import('./payroll/finalSettlementSchema.js');
    await ensureFinalSettlementSchema();
    const { ensureSeniorityIndemnitySchema } = await import(
      './payroll/seniorityIndemnity/seniorityIndemnityLedger.js'
    );
    await ensureSeniorityIndemnitySchema();
    const { ensurePre2019BackPayLedgerSchema } = await import(
      './payroll/seniorityIndemnity/seniorityIndemnityPre2019Ledger.js'
    );
    await ensurePre2019BackPayLedgerSchema();
    await ensureEmployeeContractTypeColumn();
    const { ensureProbationLifecycleColumns } = await import('./probationSchema.js');
    await ensureProbationLifecycleColumns();
    const { ensureProbationReviewSchema } = await import('./probation/probationReviewSchema.js');
    await ensureProbationReviewSchema();
    const { ensureWorkflowApprovalStepsConsolidated } = await import(
      './workflowApprovalStepsSchema.js'
    );
    await ensureWorkflowApprovalStepsConsolidated();
    const { ensureEmployeeOffboardingColumns } = await import('./payroll/employeeOffboardingSchema.js');
    await ensureEmployeeOffboardingColumns();
    const { ensureAbandonmentSchema } = await import('./payroll/abandonmentSchema.js');
    await ensureAbandonmentSchema();
    console.log('[db] payroll hybrid schema is ready.');
    const { reopenAttendanceLockedBeforeCutoff } = await import(
      './payroll/attendanceFinalizationService.js'
    );
    const reopened = await reopenAttendanceLockedBeforeCutoff();
    if (reopened > 0) {
      console.log(`[payroll] Reopened ${reopened} attendance period(s) locked before cutoff.`);
    }
    const { syncInputFreezeForApprovedPayrollRuns } = await import(
      './payroll/payrollPeriodFreezeService.js'
    );
    await syncInputFreezeForApprovedPayrollRuns();
  } catch (hybridSchemaErr) {
    console.warn(
      '[db] Could not ensure payroll hybrid schema:',
      (hybridSchemaErr as Error)?.message || hybridSchemaErr
    );
  }

  try {
    const { ensureTaskExecutionColumns } = await import('./taskSchema.js');
    await ensureTaskExecutionColumns();
    console.log('[db] tasks schema is ready.');
  } catch (taskSchemaErr) {
    console.warn(
      '[db] Could not ensure tasks columns:',
      (taskSchemaErr as Error)?.message || taskSchemaErr
    );
  }

  try {
    const { ensurePayslipBreakdownSchema } = await import('./payslipBreakdownService.js');
    await ensurePayslipBreakdownSchema();
    console.log('[db] payslipbreakdowns table is ready.');
  } catch (payslipBreakdownErr) {
    console.warn(
      '[db] Could not ensure payslip breakdown schema:',
      (payslipBreakdownErr as Error)?.message || payslipBreakdownErr
    );
  }

  try {
    await ensurePayslipReviewerNoteColumn();
    const { ensurePayslipDisbursementSchema } = await import('./payroll/payslipDisbursementService.js');
    await ensurePayslipDisbursementSchema();
    console.log('[db] payslips schema is ready.');
  } catch (payslipEmpColErr) {
    console.warn(
      '[db] Could not ensure payslips columns:',
      (payslipEmpColErr as Error)?.message || payslipEmpColErr
    );
  }

  try {
    const { ensureSalaryStructureSchema } = await import('./salaryStructureService.js');
    await ensureSalaryStructureSchema();
    const { ensureSalaryStructureHistorySchema } = await import('./salaryStructureHistoryService.js');
    await ensureSalaryStructureHistorySchema();
    console.log('[db] salarystructures table is ready.');
  } catch (salaryStructureErr) {
    console.warn(
      '[db] Could not ensure salary structure schema:',
      (salaryStructureErr as Error)?.message || salaryStructureErr
    );
  }

  try {
    const { ensureExchangeRateSchema } = await import('./exchangeRateSchema.js');
    const { seedDefaultExchangeRateIfEmpty } = await import('./exchangeRateService.js');
    await ensureExchangeRateSchema();
    const { ensureSensitiveModuleSchemas } = await import('./sensitiveModuleAuditSchema.js');
    await ensureSensitiveModuleSchemas();
    await seedDefaultExchangeRateIfEmpty();
    const { runExchangeRateHistoryOnStartup } = await import('./exchangeRateHistoryJob.js');
    await runExchangeRateHistoryOnStartup();
    console.log('[db] exchange_rates table is ready.');
  } catch (exchangeRateErr) {
    console.warn(
      '[db] Could not ensure exchange_rates schema:',
      (exchangeRateErr as Error)?.message || exchangeRateErr
    );
  }

  try {
    const { ensureTaxBracketSchema } = await import('./taxBracketService.js');
    await ensureTaxBracketSchema();
    console.log('[db] taxbrackets table is ready.');
  } catch (taxBracketErr) {
    console.warn(
      '[db] Could not ensure tax bracket schema:',
      (taxBracketErr as Error)?.message || taxBracketErr
    );
  }

  try {
    const { ensureAllowanceRulesSchema } = await import('./allowanceSchemaService.js');
    await ensureAllowanceRulesSchema();
    console.log('[db] allowance rule engine tables are ready.');
  } catch (allowanceErr) {
    console.warn(
      '[db] Could not ensure allowance rules schema:',
      (allowanceErr as Error)?.message || allowanceErr
    );
  }

  try {
    const { ensureSeniorityIndemnityPolicySchema } = await import(
      './payroll/seniorityIndemnity/seniorityIndemnityPolicySchema.js'
    );
    await ensureSeniorityIndemnityPolicySchema();
    console.log('[db] seniority indemnity policy tables are ready.');
  } catch (indemnityPolicyErr) {
    console.warn(
      '[db] Could not ensure seniority indemnity policy schema:',
      (indemnityPolicyErr as Error)?.message || indemnityPolicyErr
    );
  }

  try {
    const { ensureSeniorityEngineSchema } = await import(
      './payroll/seniority/seniorityRuleSchema.js'
    );
    await ensureSeniorityEngineSchema();
    console.log('[db] seniority engine tables are ready.');
  } catch (seniorityErr) {
    console.warn(
      '[db] Could not ensure seniority engine schema:',
      (seniorityErr as Error)?.message || seniorityErr
    );
  }

  try {
    const { ensureUnifiedPayrollRuleSchema } = await import(
      './payroll/unifiedPayrollRuleSchema.js'
    );
    await ensureUnifiedPayrollRuleSchema();
    console.log('[db] unified payroll rule engine tables are ready.');
  } catch (unifiedRuleErr) {
    console.warn(
      '[db] Could not ensure unified payroll rules schema:',
      (unifiedRuleErr as Error)?.message || unifiedRuleErr
    );
  }

  try {
    const { ensureEmployeeMonthlySalesSchema } = await import(
      './payroll/employeeMonthlySalesSchema.js'
    );
    await ensureEmployeeMonthlySalesSchema();
    console.log('[db] employee_monthly_sales table is ready.');
  } catch (monthlySalesErr) {
    console.warn(
      '[db] Could not ensure employee_monthly_sales schema:',
      (monthlySalesErr as Error)?.message || monthlySalesErr
    );
  }

  try {
    const { ensurePayrollComplianceRulesSchema } = await import(
      './payrollComplianceRuleService.js'
    );
    await ensurePayrollComplianceRulesSchema();
    console.log('[db] payrollcompliancerules table is ready.');
    const { ensureInitialPayrollPolicyVersions } = await import(
      './payroll/payrollPolicyVersionBootstrap.js'
    );
    await ensureInitialPayrollPolicyVersions();
    console.log('[db] payroll policy versions bootstrapped.');
  } catch (complianceErr) {
    console.warn(
      '[db] Could not ensure payroll compliance rules schema:',
      (complianceErr as Error)?.message || complianceErr
    );
  }

  try {
    const { ensureNssfAssumedWageBracketSchema } = await import('./nssfAssumedWageService.js');
    await ensureNssfAssumedWageBracketSchema();
    console.log('[db] nssfassumedwagebrackets table is ready.');
  } catch (nssfWageErr) {
    console.warn(
      '[db] Could not ensure NSSF assumed wage bracket schema:',
      (nssfWageErr as Error)?.message || nssfWageErr
    );
  }

  try {
    const { ensurePayrollCalendarSchema } = await import('./payrollCalendarService.js');
    await ensurePayrollCalendarSchema();
    console.log('[db] payrollcalendars table is ready.');
    const { startPayrollRunNotificationScheduler } = await import(
      './payrollRunNotificationService.js'
    );
    startPayrollRunNotificationScheduler();
    const { startPayrollAttendanceFreezeScheduler } = await import(
      './payroll/attendanceFreezeScheduler.js'
    );
    startPayrollAttendanceFreezeScheduler();
    const { startLeaveRenewalScheduler } = await import('./leaveScheduler.js');
    startLeaveRenewalScheduler();
  } catch (payrollCalErr) {
    console.warn(
      '[db] Could not ensure payroll calendar schema:',
      (payrollCalErr as Error)?.message || payrollCalErr
    );
  }

  try {
    const { ensureNotificationSchema } = await import('./notificationSchema.js');
    await ensureNotificationSchema();
  } catch (notificationSchemaErr) {
    console.warn(
      '[db] Could not upgrade notification schema:',
      (notificationSchemaErr as Error)?.message || notificationSchemaErr
    );
  }

  try {
    const { ensureCanonicalProjectTaskIds } = await import('./projectTaskIdService.js');
    await ensureCanonicalProjectTaskIds();
  } catch (idMigrationErr) {
    console.warn(
      '[db] Could not canonicalize project/task ids:',
      (idMigrationErr as Error)?.message || idMigrationErr
    );
  }

  try {
    const { ensureMonthlyPlanningRosterSchema } = await import('./monthlyPlanningRosterService.js');
    await ensureMonthlyPlanningRosterSchema();
    console.log('[db] monthlyplanningrosters + monthlyplanningrosterentries tables are ready.');
    const { startPlanningRosterReminderScheduler } = await import(
      './planningRosterReminderService.js'
    );
    startPlanningRosterReminderScheduler();
    const { startProbationReminderScheduler } = await import(
      './probation/probationReminderService.js'
    );
    startProbationReminderScheduler();
    const { startEmployeeCardExpiryReminderScheduler } = await import(
      './employeeCardExpiryReminderService.js'
    );
    startEmployeeCardExpiryReminderScheduler();
    const { startAppraisalPeriodReminderScheduler } = await import(
      './appraisal/appraisalPeriodReminderService.js'
    );
    startAppraisalPeriodReminderScheduler();
    const { startPersonalHubAlertReminderScheduler } = await import(
      './personalAnalytics/personalHubAlertReminderService.js'
    );
    startPersonalHubAlertReminderScheduler();
    const { startWorkDeadlineReminderScheduler } = await import(
      './workDeadlineReminderService.js'
    );
    startWorkDeadlineReminderScheduler();
  } catch (mprErr) {
    console.warn(
      '[db] Could not ensure monthly planning roster schema:',
      (mprErr as Error)?.message || mprErr
    );
  }

  try {
    const { startAttendanceReconcileScheduler, runAttendanceReconcileOnStartup } =
      await import('./attendanceReconcileScheduler.js');
    startAttendanceReconcileScheduler();
    runAttendanceReconcileOnStartup();
    console.log('[attendance] Daily absence reconcile scheduler started.');
    const { startEmployeeMovementScheduler } = await import('./employeeMovementScheduler.js');
    startEmployeeMovementScheduler();
    const { startExchangeRateHistoryScheduler } = await import('./exchangeRateHistoryJob.js');
    startExchangeRateHistoryScheduler();
  } catch (attSchedErr) {
    console.warn(
      '[attendance] Could not start reconcile scheduler:',
      (attSchedErr as Error)?.message || attSchedErr
    );
  }

  try {
    const { ensureOvertimeRequestSchema } = await import('./overtimeRequestService.js');
    await ensureOvertimeRequestSchema();
    console.log('[db] overtimetypes and overtimerequests tables are ready.');
  } catch (otErr) {
    console.warn(
      '[db] Could not ensure overtime request schema:',
      (otErr as Error)?.message || otErr
    );
  }

  try {
    const { ensureUserAccountSchema } = await import('./userAccountService.js');
    await ensureUserAccountSchema();
  } catch (userAccountErr) {
    console.warn(
      '[db] Could not ensure users account schema:',
      (userAccountErr as Error)?.message || userAccountErr
    );
  }

  try {
    const {
      ensureUserDisplayNameColumn,
      ensureUserLoginIdColumn,
      migrateLegacySystemAdminAccounts,
    } = await import('./systemAdminAccount.js');
    await ensureUserDisplayNameColumn();
    await ensureUserLoginIdColumn();
    await migrateLegacySystemAdminAccounts();
  } catch (displayNameErr) {
    console.warn(
      '[db] Could not ensure users.display_name / login_id / system admin migration:',
      (displayNameErr as Error)?.message || displayNameErr
    );
  }

  try {
    const { ensureEmployeeLoginAccounts } = await import('./employeeLoginAccountService.js');
    await ensureEmployeeLoginAccounts();
  } catch (loginSyncErr) {
    console.warn(
      '[db] Could not sync employee portal logins:',
      (loginSyncErr as Error)?.message || loginSyncErr
    );
  }

  try {
    // Project membership backfill only — permission grants are file-store (no MySQL catalog).
    try {
      const { backfillProjectMemberships } = await import('./projectAccessService.js');
      const backfill = await backfillProjectMemberships();
      if (backfill.leadsEnsured || backfill.assigneesEnsured) {
        console.log('[db] Project membership backfill:', backfill);
      }
    } catch (projectBackfillErr) {
      console.warn(
        '[db] Could not backfill project memberships:',
        (projectBackfillErr as Error)?.message || projectBackfillErr
      );
    }
  } catch (permCatalogErr) {
    const msg = (permCatalogErr as Error)?.message || String(permCatalogErr);
    console.warn('[db] Project membership backfill skipped:', msg);
  }

  try {
    const { ensureV40Schema } = await import('./v40Schema.js');
    await ensureV40Schema();
    console.log('[db] v4.0 feature schema (PIN, sessions, QR, reviews) is ready.');
  } catch (v40Err) {
    console.warn(
      '[db] Could not ensure v4.0 schema:',
      (v40Err as Error)?.message || v40Err
    );
  }

  try {
    const { ensureOrganizationSettingsTables, migrateOrganizationSettingsFromLegacy } =
      await import('./organizationSettingsService.js');
    await ensureOrganizationSettingsTables();
    console.log('[db] company_profile, settings_position_levels, and settings_security are ready.');
    const mig = await migrateOrganizationSettingsFromLegacy();
    if (mig.migrated > 0) {
      console.log(`[db] Migrated ${mig.migrated} organization setting(s) from systemsettings into normalized tables.`);
    }
    const { loadPositionLevelsFromDb } = await import('./positionLevelSettingsService.js');
    await loadPositionLevelsFromDb();
    const { ensureRoleMenuStorage } = await import('./navMenuService.js');
    await ensureRoleMenuStorage();
    console.log('[db] Role menu visibility stored in permissiontemplates (template_kind=role_menu).');
  } catch (orgSettingsErr) {
    console.error(
      '[db] Could not ensure organization settings tables:',
      (orgSettingsErr as Error)?.message || orgSettingsErr
    );
  }

  try {
    await ensureEmployeeAttendanceScheduleColumns();
    await ensureEmployeePayrollBasisDaysColumn();
    await ensureEmployeeTelegramNumberColumn();
    await ensureEmployeeBirthCertificateColumn();
    await ensureEmployeeKhmerInfoColumns();
    await ensureDepartmentPositionKhmerColumns();
    const { ensureLeaveWorkflowColumns, normalizeLeaveRequestTypeIdsToNames } = await import(
      './leaveWorkflowService.js'
    );
    await ensureLeaveWorkflowColumns();
    const normalizedTypes = await normalizeLeaveRequestTypeIdsToNames();
    if (normalizedTypes > 0) {
      console.log(`[db] Normalized ${normalizedTypes} leave request type id(s) to catalog names.`);
    }
    const { ensureEmployeeJobPositionColumn } = await import('./employeeJobPosition.js');
    await ensureEmployeeJobPositionColumn();
    await ensureDepartmentManagerIdColumn();
    await ensureDepartmentOfficeLocationColumn();
    await ensureDepartmentCodeColumn();
    await ensureDepartmentIsActiveColumn();
    await ensurePositionIsActiveColumn();
    await ensureEmployeePlacementNullable();
    await ensureProjectExtendedColumns();
    await ensureChatSchema();
    try {
      const { ensurePerformanceIndexes } = await import('./ensurePerformanceIndexes.js');
      const { added, skipped } = await ensurePerformanceIndexes();
      if (added > 0) {
        console.log(`[db] Performance indexes: ${added} added (${skipped} already present/skipped).`);
      }
    } catch (idxErr) {
      console.warn(
        '[db] Could not ensure performance indexes:',
        (idxErr as Error)?.message || idxErr
      );
    }
    const { migrateLegacyOfficelocationsIfNeeded } = await import('./attendanceSettings.js');
    await migrateLegacyOfficelocationsIfNeeded();
    const { ensureDatabaseConsolidation } = await import('./databaseConsolidation.js');
    await ensureDatabaseConsolidation();
    await dropDepartmentGeoFenceColumn();
    await dropDepartmentParentColumn();
    await ensurePositionSalaryRangeColumns();
    await ensurePositionLevelRoleColumns();
    await dropEmployeeWorkingDaysColumn();
    console.log('[db] Employee attendance schedule columns are ready.');
  } catch (scheduleColErr) {
    console.warn(
      '[db] Could not ensure employee schedule columns:',
      (scheduleColErr as Error)?.message || scheduleColErr
    );
  }

  try {
    const { ensureSchemaColumnCleanup } = await import('./schemaColumnCleanup.js');
    await ensureSchemaColumnCleanup();
    const { ensureSchemaIdentityCleanup } = await import('./schemaIdentityCleanup.js');
    await ensureSchemaIdentityCleanup();
  } catch (schemaCleanupErr) {
    console.warn(
      '[db] Could not run schema column cleanup:',
      (schemaCleanupErr as Error)?.message || schemaCleanupErr
    );
  }

  try {

    const isMissingTable = (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      const parent = (err as { parent?: { code?: string } })?.parent?.code;
      return parent === 'ER_NO_SUCH_TABLE' || /doesn't exist/i.test(msg);
    };

    let hasCoreSchema = false;
    try {
      await sequelize.query('SELECT 1 FROM `users` LIMIT 1');
      hasCoreSchema = true;
    } catch {
      hasCoreSchema = false;
    }

    if (!hasCoreSchema) {
      console.log('[db] No schema detected (empty Aiven defaultdb) — creating tables with sync()...');
      await sequelize.sync();
      console.log('[db] Base schema created. Import backend/database/hcms_db.sql for full data and user accounts.');
      try {
        const adminCount = await User.count();
        if (adminCount === 0) {
          const { createSystemAdminAccount } = await import('./systemAdminAccount.js');
          const password =
            process.env.HCMS_BOOTSTRAP_ADMIN_PASSWORD?.trim() ||
            process.env.HCMS_ADMIN_PASSWORD?.trim() ||
            'Admin@123#$%';
          await createSystemAdminAccount({
            id: 'u-1',
            email: 'admin@hcms.local',
            phone: '0100000001',
            password,
            displayName: 'System Administrator',
            loginId: 'ADM00001',
            isActive: true,
            nextUserId: async () => 'u-1',
          });
          console.log('[db] Bootstrapped ADM00001 after empty-schema sync.');
        }
      } catch (adminErr) {
        console.warn(
          '[db] Default admin bootstrap skipped:',
          (adminErr as Error)?.message || adminErr
        );
      }
    } else {
      await dropDuplicateAccumulatedForeignKeys();
      await dropDuplicateAccumulatedIndexes();
      if (process.env.NODE_ENV === 'production') {
        console.log(
          '[db] Production: skipping sync({alter:true}) — use db:sync-remote to update schema/data.'
        );
      } else if (process.env.DB_SYNC_ALTER === 'true') {
        try {
          await sequelize.sync({ alter: true });
          console.log('All models were synchronized successfully (alter: true).');
        } catch (syncErr) {
          console.warn(
            'sequelize.sync({alter:true}) failed — continuing with migrations/seeding against existing schema:',
            (syncErr as Error)?.message || syncErr
          );
          await dropDuplicateAccumulatedIndexes();
        }
      } else {
        console.log(
          '[db] Skipping sequelize.sync({ alter: true }) for fast startup. Set DB_SYNC_ALTER=true when you need schema drift fixes.'
        );
      }
    }

    try {
      const { ensureNotificationSchema } = await import('./notificationSchema.js');
      await ensureNotificationSchema();
    } catch (e) {
      console.warn(
        '[db] Could not upgrade notification schema:',
        (e as Error)?.message || e
      );
    }

    // Legacy EMP### / IROC##### display IDs → canonical ROC##### (primary keys unchanged).
    try {
      const { migrateLegacyEmployeeDisplayIds } = await import('./employeeIdFormat.js');
      await migrateLegacyEmployeeDisplayIds();
    } catch (e) {
      console.warn('Skipping EMP/IROC→ROC employee_id migration:', (e as Error)?.message || e);
    }

    try {
      const { migrateLegacyPayrollRunIds } = await import('./payroll/payrollRunIdFormat.js');
      await migrateLegacyPayrollRunIds();
    } catch (e) {
      console.warn('Skipping payroll run id → PRROC##### migration:', (e as Error)?.message || e);
    }

    try {
      const { migrateLegacyPayslipIds } = await import('./payroll/payslipIdFormat.js');
      await migrateLegacyPayslipIds();
    } catch (e) {
      console.warn('Skipping payslip id → PSROC# migration:', (e as Error)?.message || e);
    }

    try {
      await migrateOrganizationUnitIds();
    } catch (e) {
      console.warn('Skipping DEPT/POS id migration:', (e as Error)?.message || e);
    }

    // Display branding: iROC → ROC (company settings); office geofence lives in systemsettings.
    try {
      await sequelize.query(
        `UPDATE systemsettings
         SET value = REPLACE(CAST(value AS CHAR), 'iROC', 'ROC')
         WHERE \`key\` IN ('attendance.office_location', 'attendance.office_locations')
           AND CAST(value AS CHAR) LIKE '%iROC%'`,
        { raw: true }
      );
      await sequelize.query(
        `UPDATE systemsettings
         SET value = REPLACE(CAST(value AS CHAR), 'IROC HR Consulting', 'ROC HR Consulting')
         WHERE \`key\` = 'company.name'`,
        { raw: true }
      );
      await sequelize.query(
        `UPDATE company_profile
         SET name = REPLACE(name, 'IROC HR Consulting', 'ROC HR Consulting')
         WHERE id = 'default' AND name LIKE '%IROC%'`,
        { raw: true }
      );
    } catch (e) {
      console.warn('Skipping iROC→ROC branding migration:', (e as Error)?.message || e);
    }

    // Rewrite any `u-{timestamp}*` Users.id values (left over from a previous
    // bug that used Date.now() when auto-creating logins during onboarding)
    // back into clean `u-N` sequentials. Cascades into every column that
    // references Users.id so foreign-key relationships are preserved.
    //
    // We deliberately leave `user-admin` / `user-hr` / `user-manager` /
    // `user-employee` (and any other non-numeric ids) alone — those are
    // intentional named accounts from the provisioning script.
    try {
      const userRows = (await User.findAll({
        attributes: ['id'],
        raw: true,
      })) as { id?: string }[];

      let maxSeq = 0;
      const bad: string[] = [];
      for (const r of userRows) {
        const id = String(r.id || '');
        const seqMatch = id.match(/^u-(\d+)$/i);
        if (seqMatch) {
          const n = parseInt(seqMatch[1], 10);
          if (Number.isFinite(n) && n > 0 && n < 1_000_000_000) {
            maxSeq = Math.max(maxSeq, n);
          } else if (Number.isFinite(n) && n >= 1_000_000_000) {
            bad.push(id);
          }
          continue;
        }
        // Catches `u-{timestamp}-{random}` shape (the second bug variant).
        if (/^u-\d{10,}/i.test(id)) bad.push(id);
      }

      if (bad.length) {
        // (table, column) pairs that store a User.id reference. Keep additive —
        // unknown / missing tables are silently skipped.
        const userFkColumns: Array<[string, string]> = [
          ['Users', 'managerId'],
          ['AttendanceRecords', 'userId'],
          ['LeaveRequests', 'userId'],
          ['Tasks', 'assigneeId'],
          ['Payslips', 'userId'],
          ['Notifications', 'userId'],
          ['Messages', 'senderId'],
          ['Messages', 'receiverId'],
          ['roles', 'createdBy'],
          ['EmployeeShifts', 'createdBy'],
          ['WorkdayOverrides', 'createdBy'],
          ['AuditLogs', 'changedBy'],
        ];

        bad.sort();
        let next = maxSeq + 1;
        for (const oldId of bad) {
          const newId = `u-${next}`;
          next += 1;

          // eslint-disable-next-line no-await-in-loop
          const clash = await User.findOne({ where: { id: newId }, attributes: ['id'] });
          if (clash) continue;

          // eslint-disable-next-line no-await-in-loop
          await sequelize.query(
            'UPDATE `Users` SET id = :newId WHERE id = :oldId',
            { replacements: { newId, oldId } }
          );

          for (const [table, column] of userFkColumns) {
            try {
              // eslint-disable-next-line no-await-in-loop
              await sequelize.query(
                `UPDATE \`${table}\` SET \`${column}\` = :newId WHERE \`${column}\` = :oldId`,
                { replacements: { newId, oldId } }
              );
            } catch {
              /* table or column doesn't exist on this DB — skip */
            }
          }
        }
        console.log(
          `Rewrote ${bad.length} user id(s) from u-<timestamp> to sequential u-N (FKs updated).`
        );
      }
    } catch (e) {
      console.warn('Skipping user id normalization:', (e as Error)?.message || e);
    }

    // Rewrite any `emp-{timestamp}` row IDs (left over from a previous bug that
    // used Date.now() for new rows) back into clean `emp-N` sequentials so admin
    // tables stay readable. Self-FK columns are migrated alongside.
    try {
      const allRows = (await Employee.findAll({
        attributes: ['id'],
        raw: true,
      })) as { id?: string }[];

      let maxSeq = 0;
      const bad: string[] = [];
      for (const r of allRows) {
        const m = String(r.id || '').match(/^emp-(\d+)$/i);
        if (!m) continue;
        const n = parseInt(m[1], 10);
        if (!Number.isFinite(n)) continue;
        if (n > 0 && n < 1_000_000_000) {
          // Treat values < 1e9 as legitimate sequence counters; everything
          // above is almost certainly a Date.now() timestamp.
          maxSeq = Math.max(maxSeq, n);
        } else if (n >= 1_000_000_000) {
          bad.push(String(r.id));
        }
      }

      if (bad.length) {
        // Lock in oldest-first so the smallest replacement number maps to the
        // earliest stray timestamp ID (deterministic).
        bad.sort((a, b) => {
          const na = parseInt(a.slice(4), 10);
          const nb = parseInt(b.slice(4), 10);
          return na - nb;
        });
        let next = maxSeq + 1;
        for (const oldId of bad) {
          const newId = `emp-${next}`;
          next += 1;
          // Skip if the target row id is somehow already in use.
          // eslint-disable-next-line no-await-in-loop
          const clash = await Employee.findOne({ where: { id: newId }, attributes: ['id'] });
          if (clash) continue;
          // eslint-disable-next-line no-await-in-loop
          await sequelize.query(
            'UPDATE employees SET id = :newId WHERE id = :oldId',
            { replacements: { newId, oldId } }
          );
          try {
            // eslint-disable-next-line no-await-in-loop
            await sequelize.query(
              'UPDATE departments SET department_head_id = :newId WHERE department_head_id = :oldId',
              { replacements: { newId, oldId } }
            );
          } catch {
            /* department_head_id column may not exist on very old schemas */
          }
        }
        console.log(`Rewrote ${bad.length} employee row id(s) from emp-<timestamp> to sequential emp-N.`);
      }
    } catch (e) {
      console.warn('Skipping employee row-id normalization:', (e as Error)?.message || e);
    }

    // Bootstrap system configuration if missing (system settings, leave types,
    // tax brackets, NSSF). Role permission grants live in the file store — not MySQL.
    // NO demo users/employees/departments/jobs/projects/etc. are seeded.
    let settingsCount = 0;
    try {
      settingsCount = await SystemSetting.count();
    } catch (countErr) {
      if (isMissingTable(countErr)) {
        await sequelize.sync();
        settingsCount = await SystemSetting.count();
      } else {
        throw countErr;
      }
    }
    if (settingsCount === 0) {
      console.log('Bootstrapping system configuration (settings, leave types, tax brackets, NSSF)...');

      // Seed System Settings (Global)
      const systemSettings = [
        { id: 'ss-1', key: 'company.name', value: 'ROC HR Consulting', category: 'company', description: 'Company name', isPublic: true },
        { id: 'ss-2', key: 'company.address', value: 'Phnom Penh, Cambodia', category: 'company', description: 'Company address', isPublic: true },
        { id: 'ss-3', key: 'company.taxId', value: 'TAX-001234', category: 'company', description: 'Tax ID', isPublic: false },
        { id: 'ss-4', key: 'company.currency', value: 'USD', category: 'company', description: 'Default currency', isPublic: true },
        { id: 'ss-5', key: 'workingHours.startTime', value: '08:00', category: 'working_hours', description: 'Default start time' },
        { id: 'ss-6', key: 'workingHours.endTime', value: '17:00', category: 'working_hours', description: 'Default end time' },
        { id: 'ss-7', key: 'workingHours.breakDuration', value: 60, category: 'working_hours', description: 'Break duration in minutes' },
        { id: 'ss-8', key: 'workingHours.workingDays', value: [1,2,3,4,5], category: 'working_hours', description: 'Working days (1=Mon, 7=Sun)' },
        { id: 'ss-9', key: 'attendance.gracePeriod', value: 15, category: 'attendance', description: 'Grace period in minutes' },
        { id: 'ss-10', key: 'attendance.latePenalty', value: 50, category: 'attendance', description: 'Late penalty percentage' },
        { id: 'ss-11', key: 'leave.annualLeaveDays', value: 15, category: 'leave', description: 'Annual leave days per year' },
        { id: 'ss-12', key: 'leave.carryoverLimit', value: 5, category: 'leave', description: 'Maximum carryover days' },
        { id: 'ss-13', key: 'payroll.cycle', value: 'monthly', category: 'payroll', description: 'Payroll cycle' },
        { id: 'ss-14', key: 'payroll.paymentDay', value: 28, category: 'payroll', description: 'Payment day of month' },
        { id: 'ss-15', key: 'security.sessionTimeout', value: 30, category: 'security', description: 'Session timeout in minutes' },
        { id: 'ss-16', key: 'security.passwordMinLength', value: 12, category: 'security', description: 'Minimum password length' },
      ];
      await SystemSetting.bulkCreate(systemSettings);

      // Legacy permission_bundle templates (unused at runtime; role_menu is separate).
      await PermissionTemplate.bulkCreate([
        { id: 'tmpl-1', name: 'Temporary Admin', description: 'Full admin access for temporary needs', template_kind: 'permission_bundle', permissions: [], createdBy: 'u-1' },
        { id: 'tmpl-2', name: 'Auditor', description: 'View-only access for auditors', template_kind: 'permission_bundle', permissions: ['employees.view', 'attendance.view', 'leave.view', 'payroll.view', 'department.view', 'project.view', 'reports.view', 'reports.export'], createdBy: 'u-1' },
        { id: 'tmpl-3', name: 'Project Lead', description: 'Extended project management access', template_kind: 'permission_bundle', permissions: ['project.view', 'project.create', 'project.edit', 'project.delete', 'project.approve', 'task.create', 'task.edit'], createdBy: 'u-1' },
      ]);

      // Seed Leave Types
      await LeaveType.bulkCreate([
        {
          id: 'lt-annual',
          name: 'Annual Leave',
          code: 'ANNUAL',
          description: 'Regular paid vacation',
          isPaid: true,
          daysAllowed: 18,
          leaveCategory: 'join_date_based',
          monthlyAccrualRate: 1.5,
          maxCarryForward: 5,
          yearlyResetEnabled: true,
          color: '#22C55E',
        },
        {
          id: 'lt-sick',
          name: 'Sick Leave',
          code: 'SICK',
          description: 'Medical leave',
          isPaid: true,
          daysAllowed: 14,
          leaveCategory: 'fixed_allocation',
          yearlyResetEnabled: true,
          color: '#EF4444',
        },
        {
          id: 'lt-maternity',
          name: 'Maternity Leave',
          code: 'MATERNITY',
          description: 'Maternity leave',
          isPaid: true,
          daysAllowed: 90,
          leaveCategory: 'event_based',
          eventTriggerType: 'Maternity',
          maxUsagePerEmployment: 90,
          requiresDocument: true,
          color: '#EC4899',
        },
        {
          id: 'lt-paternity',
          name: 'Paternity Leave',
          code: 'PATERNITY',
          description: 'Paternity leave',
          isPaid: true,
          daysAllowed: 7,
          leaveCategory: 'event_based',
          eventTriggerType: 'Paternity',
          maxUsagePerEmployment: 7,
          color: '#8B5CF6',
        },
        {
          id: 'lt-public-holiday',
          name: 'Public Holiday',
          code: 'PUBLIC_HOLIDAY',
          description: 'Paid public holiday leave applied on employer-announced dates',
          isPaid: true,
          daysAllowed: 9,
          leaveCategory: 'fixed_allocation',
          yearlyResetEnabled: true,
          affectsPayroll: true,
          payrollCategory: 'payable',
          deductSalary: false,
          color: '#0EA5E9',
        },
        {
          id: 'lt-unpaid',
          name: 'Unpaid Leave',
          code: 'UNPAID',
          description: 'Leave without pay',
          isPaid: false,
          daysAllowed: 0,
          leaveCategory: 'approval_based',
          affectsPayroll: true,
          requiresApproval: true,
          payrollCategory: 'deductible',
          deductSalary: true,
          color: '#6B7280',
        },
      ]);

      // Seed Fixed Rosters
      await FixedRoster.bulkCreate([
        { id: 'rost-1', name: 'Weekend Off', rosterType: 'WEEKLY', schedule: { days: [0, 6] }, isActive: true, description: 'Standard weekend off' },
        { id: 'rost-2', name: 'Monday Off', rosterType: 'WEEKLY', schedule: { days: [1] }, isActive: true, description: 'Monday off shift' },
      ]);

      // Seed Tax Brackets (Cambodia GDT ToS — monthly USD)
      const { DEFAULT_TAX_BRACKETS_USD } = await import('./taxBracketService.js');
      await TaxBracket.bulkCreate([...DEFAULT_TAX_BRACKETS_USD]);

      // Seed NSSF configuration (systemsettings)
      const { ensureDefaultNssfConfigSetting } = await import('./nssfConfigService.js');
      await ensureDefaultNssfConfigSetting();

      console.log('System configuration bootstrap completed.');
    }
  } catch (error) {
    console.warn(
      '[db] Post-connect setup warning (API still uses DB):',
      error instanceof Error ? error.message : error
    );
  }
};

// ============================================
// SEQUELIZE ASSOCIATIONS - EMPLOYEE MODULE
// ============================================

// Employee associations
Employee.belongsTo(Department, { foreignKey: 'department_id', as: 'department' });
Employee.belongsTo(Position, { foreignKey: 'position_id', as: 'position' });

Employee.hasOne(SalaryStructure, { foreignKey: 'employee_id', as: 'salaryStructure' });
SalaryStructure.belongsTo(Employee, { foreignKey: 'employee_id' });

Employee.hasMany(EmployeeDependent, { foreignKey: 'employee_id', as: 'dependents' });

// Department associations
Department.hasMany(Employee, { foreignKey: 'department_id', as: 'employees' });
Department.hasMany(Position, { foreignKey: 'department_id', as: 'positions' });
Department.belongsTo(Employee, { foreignKey: 'department_head_id', as: 'head' });
// Position associations
Position.belongsTo(Department, { foreignKey: 'department_id', as: 'department' });
Position.hasMany(Employee, { foreignKey: 'position_id', as: 'employees' });

// Employee allowances and deductions

// Employee dependents and documents
EmployeeDependent.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });

Employee.hasMany(EmployeeIssuedCard, { foreignKey: 'employee_id', as: 'issued_cards' });
EmployeeIssuedCard.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });

// Employee status history (employee_id column stores employees.id PK)
EmployeeStatusHistory.belongsTo(Employee, { foreignKey: 'employee_id', as: 'employee' });

HistoryEmployee.belongsTo(Employee, { foreignKey: 'employee_pk', targetKey: 'id', as: 'employee' });

// ============================================
// SEQUELIZE ASSOCIATIONS - PERMISSION MODULE
// ============================================

export async function ensureEmployeeMovementsTable(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS \`employee_movements\` (
      \`id\` varchar(255) NOT NULL,
      \`employee_pk\` varchar(255) NOT NULL,
      \`employee_id\` varchar(255) NOT NULL,
      \`movement_type\` varchar(32) NOT NULL,
      \`effective_date\` varchar(32) NOT NULL,
      \`from_department_id\` varchar(255) NOT NULL,
      \`to_department_id\` varchar(255) NOT NULL,
      \`from_position_id\` varchar(255) NOT NULL,
      \`to_position_id\` varchar(255) NOT NULL,
      \`from_job_position\` varchar(120) DEFAULT NULL,
      \`to_job_position\` varchar(120) DEFAULT NULL,
      \`from_reporting_manager_id\` varchar(255) DEFAULT NULL,
      \`to_reporting_manager_id\` varchar(255) DEFAULT NULL,
      \`from_base_salary\` decimal(12,2) DEFAULT NULL,
      \`to_base_salary\` decimal(12,2) DEFAULT NULL,
      \`from_currency\` varchar(8) DEFAULT NULL,
      \`to_currency\` varchar(8) DEFAULT NULL,
      \`notes\` text,
      \`status\` varchar(32) NOT NULL DEFAULT 'completed',
      \`created_by\` varchar(255) DEFAULT NULL,
      \`created_at\` varchar(255) DEFAULT NULL,
      \`applied_at\` varchar(255) DEFAULT NULL,
      PRIMARY KEY (\`id\`),
      KEY \`employee_movements_employee_id\` (\`employee_id\`),
      KEY \`employee_movements_to_dept\` (\`to_department_id\`),
      KEY \`employee_movements_from_dept\` (\`from_department_id\`),
      KEY \`employee_movements_effective\` (\`effective_date\`),
      KEY \`employee_movements_status\` (\`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

/** Salary from/to on employee_movements (salary_update type). */
export async function ensureEmployeeMovementSalaryColumns(): Promise<void> {
  const cols: { name: string; ddl: string }[] = [
    { name: 'from_base_salary', ddl: '`from_base_salary` decimal(12,2) DEFAULT NULL' },
    { name: 'to_base_salary', ddl: '`to_base_salary` decimal(12,2) DEFAULT NULL' },
    { name: 'from_currency', ddl: '`from_currency` varchar(8) DEFAULT NULL' },
    { name: 'to_currency', ddl: '`to_currency` varchar(8) DEFAULT NULL' },
  ];
  for (const { name, ddl } of cols) {
    try {
      const [rows]: any = await sequelize.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_movements' AND COLUMN_NAME = ? LIMIT 1`,
        { replacements: [name] }
      );
      if (Array.isArray(rows) && rows.length) continue;
      await sequelize.query(`ALTER TABLE \`employee_movements\` ADD COLUMN ${ddl}`);
      console.log(`[db] Added employee_movements.${name}`);
    } catch (err) {
      console.warn(
        `[db] Could not add employee_movements.${name}:`,
        (err as Error)?.message || err
      );
    }
  }
}

/** Link movements back to approved KPI appraisals. */
export async function ensureEmployeeMovementAppraisalColumn(): Promise<void> {
  try {
    const [rows]: any = await sequelize.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_movements' AND COLUMN_NAME = 'source_appraisal_id' LIMIT 1`
    );
    if (Array.isArray(rows) && rows.length) return;
    await sequelize.query(
      `ALTER TABLE \`employee_movements\` ADD COLUMN \`source_appraisal_id\` varchar(64) DEFAULT NULL AFTER \`notes\``
    );
    await sequelize.query(
      `ALTER TABLE \`employee_movements\` ADD KEY \`employee_movements_source_appraisal\` (\`source_appraisal_id\`)`
    ).catch(() => undefined);
    console.log('[db] Added employee_movements.source_appraisal_id');
  } catch (err) {
    console.warn(
      '[db] Could not add employee_movements.source_appraisal_id:',
      (err as Error)?.message || err
    );
  }
}

/** Link movements back to probation review decisions. */
export async function ensureEmployeeMovementProbationColumn(): Promise<void> {
  try {
    const [rows]: any = await sequelize.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_movements' AND COLUMN_NAME = 'source_probation_review_id' LIMIT 1`
    );
    if (!Array.isArray(rows) || !rows.length) {
      await sequelize.query(
        `ALTER TABLE \`employee_movements\` ADD COLUMN \`source_probation_review_id\` varchar(64) DEFAULT NULL AFTER \`source_appraisal_id\``
      );
      await sequelize.query(
        `ALTER TABLE \`employee_movements\` ADD KEY \`employee_movements_source_probation\` (\`source_probation_review_id\`)`
      ).catch(() => undefined);
      console.log('[db] Added employee_movements.source_probation_review_id');
    }
    await backfillProbationMovementSources();
  } catch (err) {
    console.warn(
      '[db] Could not add employee_movements.source_probation_review_id:',
      (err as Error)?.message || err
    );
  }
}

/** Stamp existing movements created by probation pass outcomes (pre-linking rows). */
export async function backfillProbationMovementSources(): Promise<number> {
  let affected = 0;
  try {
    const [, meta]: any = await sequelize.query(
      `UPDATE \`employee_movements\` em
       INNER JOIN \`employeereviews\` er
         ON er.reviewType = 'PROBATION'
        AND er.status = 'PASSED'
        AND er.outcomePayloadJson IS NOT NULL
        AND JSON_UNQUOTE(JSON_EXTRACT(er.outcomePayloadJson, '$.passResult.movementId')) = em.id
       SET em.source_probation_review_id = er.id
       WHERE em.source_probation_review_id IS NULL`
    );
    affected = Number(meta?.affectedRows ?? 0);
  } catch (err) {
    console.warn(
      '[db] SQL backfill for probation movements failed, using JS fallback:',
      (err as Error)?.message || err
    );
  }

  try {
    const [unlinked] = (await sequelize.query(
      `SELECT id FROM \`employee_movements\` WHERE source_probation_review_id IS NULL`
    )) as [Array<{ id: string }>, unknown];
    if (!unlinked?.length) {
      if (affected > 0) {
        console.log(`[db] Backfilled source_probation_review_id on ${affected} movement(s).`);
      }
      return affected;
    }

    const [reviews] = (await sequelize.query(
      `SELECT id, outcomePayloadJson FROM \`employeereviews\`
       WHERE reviewType = 'PROBATION' AND status = 'PASSED' AND outcomePayloadJson IS NOT NULL`
    )) as [Array<{ id: string; outcomePayloadJson: string }>, unknown];

    const movementToReview = new Map<string, string>();
    for (const review of reviews ?? []) {
      try {
        const payload = JSON.parse(String(review.outcomePayloadJson ?? '{}'));
        const movementId = String(payload?.passResult?.movementId ?? '').trim();
        if (movementId) movementToReview.set(movementId, String(review.id));
      } catch {
        /* ignore malformed payload */
      }
    }

    for (const row of unlinked) {
      const movementId = String(row.id ?? '').trim();
      const reviewId = movementToReview.get(movementId);
      if (!reviewId) continue;
      await sequelize.query(
        `UPDATE \`employee_movements\` SET source_probation_review_id = :reviewId WHERE id = :movementId`,
        { replacements: { reviewId, movementId } }
      );
      affected += 1;
    }
  } catch (err) {
    console.warn(
      '[db] Could not backfill probation movement sources:',
      (err as Error)?.message || err
    );
  }

  if (affected > 0) {
    console.log(`[db] Backfilled source_probation_review_id on ${affected} movement(s).`);
  }
  return affected;
}

/** Ensures archive table exists on local XAMPP and production without full schema re-import. */
export async function ensureHistoryEmployeeTable(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS \`historyemployee\` (
      \`id\` int NOT NULL AUTO_INCREMENT,
      \`employee_pk\` varchar(255) NOT NULL,
      \`employee_id\` varchar(255) NOT NULL,
      \`employee_snapshot\` longtext NOT NULL,
      \`terminated_at\` datetime NOT NULL,
      \`termination_reason\` varchar(500) NOT NULL,
      \`terminated_by\` varchar(255) DEFAULT NULL,
      \`restored_at\` datetime DEFAULT NULL,
      \`restored_by\` varchar(255) DEFAULT NULL,
      \`is_currently_terminated\` tinyint(1) NOT NULL DEFAULT 1,
      \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updatedAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      KEY \`historyemployee_employee_id\` (\`employee_id\`),
      KEY \`historyemployee_employee_pk\` (\`employee_pk\`),
      KEY \`historyemployee_terminated_at\` (\`terminated_at\`),
      KEY \`historyemployee_is_currently_terminated\` (\`is_currently_terminated\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function ensurePayslipReviewerNoteColumn(): Promise<void> {
  const [colRows]: any = await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payslips' AND COLUMN_NAME = 'reviewerNote' LIMIT 1`
  );
  if (!Array.isArray(colRows) || !colRows.length) {
    await sequelize.query(
      'ALTER TABLE `payslips` ADD COLUMN `reviewerNote` TEXT NULL AFTER `status`'
    );
    console.log('[db] Added payslips.reviewerNote column.');
  }
}

/** Khmer display names on departments and positions. */
export async function ensureDepartmentPositionKhmerColumns(): Promise<void> {
  const specs: [string, string, string][] = [
    ['departments', 'name_kh', 'VARCHAR(255) NULL AFTER `name`'],
    ['positions', 'title_kh', 'VARCHAR(255) NULL AFTER `title`'],
  ];
  for (const [table, col, ddl] of specs) {
    try {
      const [rows]: any = await sequelize.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
        { replacements: [table, col] }
      );
      if (Array.isArray(rows) && rows.length) continue;
      await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${ddl}`);
      console.log(`[db] Added ${table}.${col}.`);
    } catch (err) {
      console.warn(`[db] Could not add ${table}.${col}:`, (err as Error)?.message || err);
    }
  }
}

/** Optional Khmer-script fields on employees and child dependents. */
export async function ensureEmployeeKhmerInfoColumns(): Promise<void> {
  const employeeCols: [string, string][] = [
    ['first_name_kh', 'VARCHAR(255) NULL AFTER `last_name`'],
    ['last_name_kh', 'VARCHAR(255) NULL AFTER `first_name_kh`'],
    ['street_address_kh', 'VARCHAR(500) NULL AFTER `street_address`'],
    ['city_kh', 'VARCHAR(255) NULL AFTER `city`'],
    ['spouse_name_kh', 'VARCHAR(255) NULL AFTER `spouse_name`'],
    ['emergency_contact_name_kh', 'VARCHAR(255) NULL AFTER `emergency_contact_name`'],
    ['emergency_contact_relationship_kh', 'VARCHAR(255) NULL AFTER `emergency_contact_relationship`'],
    ['bio', 'TEXT NULL AFTER `avatar_url`'],
  ];
  for (const [col, ddl] of employeeCols) {
    try {
      const [rows]: any = await sequelize.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = ? LIMIT 1`,
        { replacements: [col] }
      );
      if (Array.isArray(rows) && rows.length) continue;
      await sequelize.query(`ALTER TABLE \`employees\` ADD COLUMN \`${col}\` ${ddl}`);
      console.log(`[db] Added employees.${col}.`);
    } catch (err) {
      console.warn(`[db] Could not add employees.${col}:`, (err as Error)?.message || err);
    }
  }
  try {
    const [rows]: any = await sequelize.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employeedependents' AND COLUMN_NAME = 'name_kh' LIMIT 1`
    );
    if (!Array.isArray(rows) || !rows.length) {
      await sequelize.query(
        'ALTER TABLE `employeedependents` ADD COLUMN `name_kh` VARCHAR(255) NULL AFTER `name`'
      );
      console.log('[db] Added employeedependents.name_kh.');
    }
  } catch (err) {
    console.warn('[db] Could not add employeedependents.name_kh:', (err as Error)?.message || err);
  }
}

/** UDC / FDC contract type for seniority indemnity eligibility (Labor Law Art. 89). */
export async function ensureEmployeeContractTypeColumn(): Promise<void> {
  const col = 'contract_type';
  try {
    const [rows]: any = await sequelize.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = ? LIMIT 1`,
      { replacements: [col] }
    );
    if (Array.isArray(rows) && rows.length) return;
    await sequelize.query(
      "ALTER TABLE `employees` ADD COLUMN `contract_type` VARCHAR(8) NULL DEFAULT NULL AFTER `employment_type`"
    );
    console.log('[db] Added employees.contract_type.');
  } catch (err) {
    console.warn(`[db] Could not add employees.${col}:`, (err as Error)?.message || err);
  }
}

/** Birth certificate number on employees (identification documents). */
export async function ensureEmployeeBirthCertificateColumn(): Promise<void> {
  const col = 'birth_certificate_number';
  try {
    const [rows]: any = await sequelize.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = ? LIMIT 1`,
      { replacements: [col] }
    );
    if (Array.isArray(rows) && rows.length) return;
    await sequelize.query(
      'ALTER TABLE `employees` ADD COLUMN `birth_certificate_number` VARCHAR(255) NULL AFTER `passport_number`'
    );
  } catch (err) {
    console.warn(`[db] Could not add employees.${col}:`, (err as Error)?.message || err);
  }
}

/** Telegram number for ID cards (distinct from employees.phone). */
export async function ensureEmployeeTelegramNumberColumn(): Promise<void> {
  const col = 'telegram_number';
  try {
    const [rows]: any = await sequelize.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = ? LIMIT 1`,
      { replacements: [col] }
    );
    if (Array.isArray(rows) && rows.length) return;
    await sequelize.query(
      'ALTER TABLE `employees` ADD COLUMN `telegram_number` VARCHAR(32) NULL AFTER `work_phone`'
    );
    console.log('[db] Added employees.telegram_number.');
  } catch (err) {
    console.warn(`[db] Could not add employees.${col}:`, (err as Error)?.message || err);
  }
}

/** Per-employee payroll basis days (22 / 24 / 26). Defaults existing rows to 26. */
export async function ensureEmployeePayrollBasisDaysColumn(): Promise<void> {
  const col = 'payroll_basis_days';
  try {
    const [rows]: any = await sequelize.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = ? LIMIT 1`,
      { replacements: [col] }
    );
    if (Array.isArray(rows) && rows.length) {
      await sequelize.query(
        `UPDATE \`employees\` SET \`payroll_basis_days\` = 26 WHERE \`payroll_basis_days\` IS NULL`
      );
      return;
    }
    await sequelize.query(
      'ALTER TABLE `employees` ADD COLUMN `payroll_basis_days` INT NULL DEFAULT 26 AFTER `grace_period_minutes`'
    );
    await sequelize.query(
      `UPDATE \`employees\` SET \`payroll_basis_days\` = 26 WHERE \`payroll_basis_days\` IS NULL`
    );
    console.log('[db] Added employees.payroll_basis_days (default 26).');
  } catch (err) {
    console.warn(`[db] Could not add employees.${col}:`, (err as Error)?.message || err);
  }
}

/** Adds per-employee attendance schedule columns on existing installs. */
export async function ensureEmployeeAttendanceScheduleColumns(): Promise<void> {
  const alters: { col: string; sql: string }[] = [
    { col: 'work_days', sql: 'ADD COLUMN `work_days` INT NULL DEFAULT 5' },
    { col: 'time_in', sql: "ADD COLUMN `time_in` VARCHAR(5) NOT NULL DEFAULT '08:00'" },
    { col: 'time_out', sql: "ADD COLUMN `time_out` VARCHAR(5) NOT NULL DEFAULT '17:00'" },
    { col: 'work_hours', sql: 'ADD COLUMN `work_hours` DECIMAL(4,2) NOT NULL DEFAULT 8.00' },
    { col: 'break_duration_minutes', sql: 'ADD COLUMN `break_duration_minutes` INT NOT NULL DEFAULT 60' },
    { col: 'grace_period_minutes', sql: 'ADD COLUMN `grace_period_minutes` INT NULL' },
  ];
  for (const { col, sql } of alters) {
    try {
      const [rows]: any = await sequelize.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = ? LIMIT 1`,
        { replacements: [col] }
      );
      if (Array.isArray(rows) && rows.length) continue;
      await sequelize.query(`ALTER TABLE \`employees\` ${sql}`);
    } catch (err) {
      console.warn(`[db] Could not add employees.${col}:`, (err as Error)?.message || err);
    }
  }
}

/** Job level and default portal access role on positions. */
export async function ensurePositionLevelRoleColumns(): Promise<void> {
  for (const col of ['level', 'access_role'] as const) {
    try {
      const [rows]: any = await sequelize.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'positions' AND COLUMN_NAME = ? LIMIT 1`,
        { replacements: [col] }
      );
      if (Array.isArray(rows) && rows.length) continue;
      const sqlType = col === 'level' ? 'VARCHAR(64) NULL' : 'VARCHAR(32) NULL';
      await sequelize.query(`ALTER TABLE \`positions\` ADD COLUMN \`${col}\` ${sqlType}`);
      console.log(`[db] Added positions.${col}`);
    } catch (err) {
      console.warn(`[db] Could not add positions.${col}:`, (err as Error)?.message || err);
    }
  }
}

/** Annual salary range on positions (USD). */
export async function ensurePositionSalaryRangeColumns(): Promise<void> {
  for (const col of ['salary_min', 'salary_max'] as const) {
    try {
      const [rows]: any = await sequelize.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'positions' AND COLUMN_NAME = ? LIMIT 1`,
        { replacements: [col] }
      );
      if (Array.isArray(rows) && rows.length) continue;
      await sequelize.query(`ALTER TABLE \`positions\` ADD COLUMN \`${col}\` FLOAT NULL DEFAULT 0`);
      console.log(`[db] Added positions.${col}`);
    } catch (err) {
      console.warn(`[db] Could not add positions.${col}:`, (err as Error)?.message || err);
    }
  }
  try {
    await sequelize.query(
      `UPDATE positions
       SET salary_min = COALESCE(NULLIF(salary_min, 0), salary, 0),
           salary_max = COALESCE(NULLIF(salary_max, 0), salary, salary_min, 0)
       WHERE salary IS NOT NULL`
    );
  } catch {
    try {
      await sequelize.query(
        `UPDATE positions
         SET salary_min = COALESCE(salary_min, 0),
             salary_max = COALESCE(salary_max, salary_min, 0)
         WHERE salary_min IS NULL OR salary_max IS NULL`
      );
    } catch {
      /* optional backfill */
    }
  }
}

/** Removes legacy per-department geofence JSON (attendance uses office_locations). */
export async function dropDepartmentGeoFenceColumn(): Promise<void> {
  try {
    const [rows]: any = await sequelize.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'departments' AND COLUMN_NAME = 'geoFence' LIMIT 1`
    );
    if (Array.isArray(rows) && rows.length) {
      await sequelize.query('ALTER TABLE `departments` DROP COLUMN `geoFence`');
      console.log('[db] Dropped departments.geoFence column.');
    }
  } catch (err) {
    console.warn('[db] Could not drop departments.geoFence:', (err as Error)?.message || err);
  }
}

/** Removes parent/child department hierarchy (flat business units only). */
export async function dropDepartmentParentColumn(): Promise<void> {
  try {
    const [cols]: any = await sequelize.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'departments'
         AND COLUMN_NAME = 'parent_department_id' LIMIT 1`
    );
    if (!Array.isArray(cols) || !cols.length) return;

    const [fks]: any = await sequelize.query(
      `SELECT CONSTRAINT_NAME AS constraintName
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'departments'
         AND COLUMN_NAME = 'parent_department_id'
         AND REFERENCED_TABLE_NAME IS NOT NULL`
    );
    for (const row of Array.isArray(fks) ? fks : []) {
      const name = String(row.constraintName ?? row.CONSTRAINT_NAME ?? '').trim();
      if (!name) continue;
      await sequelize.query(`ALTER TABLE \`departments\` DROP FOREIGN KEY \`${name}\``);
    }

    try {
      await sequelize.query('ALTER TABLE `departments` DROP INDEX `parent_department_id`');
    } catch {
      /* index may already be removed with the FK */
    }

    await sequelize.query('ALTER TABLE `departments` DROP COLUMN `parent_department_id`');
    console.log('[db] Dropped departments.parent_department_id column.');
  } catch (err) {
    console.warn(
      '[db] Could not drop departments.parent_department_id:',
      (err as Error)?.message || err
    );
  }
}

/** Portal manager assignment on departments (Users.id). */
export async function ensureTaskProjectIdColumn(): Promise<void> {
  try {
    const [rows]: any = await sequelize.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'projectId' LIMIT 1`
    );
    if (Array.isArray(rows) && rows.length) return;
    await sequelize.query('ALTER TABLE `tasks` ADD COLUMN `projectId` varchar(255) NULL');
    await sequelize.query('CREATE INDEX `tasks_project_id` ON `tasks` (`projectId`)');
    console.log('[db] Added tasks.projectId column.');
  } catch (err) {
    console.warn('[db] Could not add tasks.projectId:', (err as Error)?.message || err);
  }
}

export async function ensureProjectExtendedColumns(): Promise<void> {
  await ensureTaskProjectIdColumn();
  for (const col of [
    { name: 'startDate', ddl: 'varchar(32) NULL' },
    { name: 'priority', ddl: 'varchar(32) NULL' },
    { name: 'deletedAt', ddl: 'varchar(64) NULL' },
    { name: 'createdBy', ddl: 'varchar(64) NULL' },
  ]) {
    try {
      const [rows]: any = await sequelize.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = :col LIMIT 1`,
        { replacements: { col: col.name } }
      );
      if (Array.isArray(rows) && rows.length) continue;
      await sequelize.query(`ALTER TABLE \`projects\` ADD COLUMN \`${col.name}\` ${col.ddl}`);
      console.log(`[db] Added projects.${col.name} column.`);
    } catch (err) {
      console.warn(`[db] Could not add projects.${col.name}:`, (err as Error)?.message || err);
    }
  }

  // Legacy rows: seed missing creator from lead once (never overwrites a real createdBy).
  try {
    await sequelize.query(
      `UPDATE \`projects\`
       SET \`createdBy\` = \`leadId\`
       WHERE (\`createdBy\` IS NULL OR \`createdBy\` = '')
         AND \`leadId\` IS NOT NULL AND \`leadId\` <> ''`
    );
  } catch (err) {
    console.warn('[db] Could not backfill projects.createdBy:', (err as Error)?.message || err);
  }
}

/** Chat groups/mutes/pins/announcements live in unified `hcms_chat_meta`; messages stay separate. */
export async function ensureChatSchema(): Promise<void> {
  try {
    const { ensureChatMetaSchema } = await import('./chatMetaSchema.js');
    await ensureChatMetaSchema();

    const [groupCol]: any = await sequelize.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'groupId' LIMIT 1`
    );
    if (!Array.isArray(groupCol) || !groupCol.length) {
      await sequelize.query('ALTER TABLE `messages` ADD COLUMN `groupId` varchar(255) NULL');
      await sequelize.query('CREATE INDEX `messages_group_id` ON `messages` (`groupId`)');
    }
    try {
      await sequelize.query(
        'ALTER TABLE `messages` MODIFY COLUMN `receiverId` varchar(255) NULL'
      );
    } catch {
      /* already nullable */
    }
    for (const col of ['deletedAt', 'replyToId', 'forwardedFromId', 'messageType', 'editedAt'] as const) {
      const [exists]: any = await sequelize.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME = '${col}' LIMIT 1`
      );
      if (!Array.isArray(exists) || !exists.length) {
        await sequelize.query(`ALTER TABLE \`messages\` ADD COLUMN \`${col}\` varchar(255) NULL`);
      }
    }
    try {
      await sequelize.query(
        'ALTER TABLE `messages` MODIFY COLUMN `updatedAt` datetime NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
      );
    } catch {
      /* column may not exist on very old schemas */
    }
    for (const idx of [
      'CREATE INDEX `messages_receiver_read_group` ON `messages` (`receiverId`, `isRead`, `groupId`)',
      'CREATE INDEX `messages_group_created` ON `messages` (`groupId`, `createdAt`)',
      'CREATE INDEX `messages_created` ON `messages` (`createdAt`)',
    ]) {
      try {
        await sequelize.query(idx);
      } catch {
        /* index may already exist */
      }
    }
    console.log('[db] Chat schema is ready (hcms_chat_meta + messages).');
  } catch (err) {
    console.warn('[db] Could not ensure chat schema:', (err as Error)?.message || err);
  }
}

export async function ensureDepartmentManagerIdColumn(): Promise<void> {
  try {
    const [rows]: any = await sequelize.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'departments' AND COLUMN_NAME = 'managerId' LIMIT 1`
    );
    if (Array.isArray(rows) && rows.length) return;
    await sequelize.query('ALTER TABLE `departments` ADD COLUMN `managerId` varchar(255) NULL');
    console.log('[db] Added departments.managerId column.');
  } catch (err) {
    console.warn('[db] Could not add departments.managerId:', (err as Error)?.message || err);
  }
}

export async function ensureDepartmentCodeColumn(): Promise<void> {
  try {
    const [rows]: any = await sequelize.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'departments' AND COLUMN_NAME = 'code' LIMIT 1`
    );
    if (!Array.isArray(rows) || !rows.length) {
      await sequelize.query(
        'ALTER TABLE `departments` ADD COLUMN `code` varchar(16) NULL AFTER `name_kh`'
      );
      console.log('[db] Added departments.code column.');
    }
    try {
      await sequelize.query(
        'CREATE UNIQUE INDEX `departments_code_unique` ON `departments` (`code`)'
      );
    } catch {
      /* index may already exist */
    }
  } catch (err) {
    console.warn('[db] Could not add departments.code:', (err as Error)?.message || err);
  }
}

/** Soft-active flag so closed units remain for history but are not assignable. */
export async function ensureDepartmentIsActiveColumn(): Promise<void> {
  try {
    const [rows]: any = await sequelize.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'departments' AND COLUMN_NAME = 'isActive' LIMIT 1`
    );
    if (!Array.isArray(rows) || !rows.length) {
      await sequelize.query(
        'ALTER TABLE `departments` ADD COLUMN `isActive` tinyint(1) NOT NULL DEFAULT 1'
      );
      console.log('[db] Added departments.isActive column.');
    }
    try {
      await sequelize.query('CREATE INDEX `departments_is_active` ON `departments` (`isActive`)');
    } catch {
      /* index may already exist */
    }
  } catch (err) {
    console.warn('[db] Could not add departments.isActive:', (err as Error)?.message || err);
  }
}

/** Soft-active flag so closed roles remain for history but are not assignable. */
export async function ensurePositionIsActiveColumn(): Promise<void> {
  try {
    const [rows]: any = await sequelize.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'positions' AND COLUMN_NAME = 'isActive' LIMIT 1`
    );
    if (!Array.isArray(rows) || !rows.length) {
      await sequelize.query(
        'ALTER TABLE `positions` ADD COLUMN `isActive` tinyint(1) NOT NULL DEFAULT 1'
      );
      console.log('[db] Added positions.isActive column.');
    }
    try {
      await sequelize.query('CREATE INDEX `positions_is_active` ON `positions` (`isActive`)');
    } catch {
      /* index may already exist */
    }
  } catch (err) {
    console.warn('[db] Could not add positions.isActive:', (err as Error)?.message || err);
  }
}

/** Allow null department/position after cascade department delete (unassigned employees). */
export async function ensureEmployeePlacementNullable(): Promise<void> {
  try {
    for (const col of ['department_id', 'position_id'] as const) {
      const [rows]: any = await sequelize.query(
        `SELECT IS_NULLABLE AS is_nullable FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = '${col}' LIMIT 1`
      );
      const nullable = String(rows?.[0]?.is_nullable ?? rows?.[0]?.IS_NULLABLE ?? '').toUpperCase();
      if (nullable === 'YES') continue;
      await sequelize.query(
        `ALTER TABLE \`employees\` MODIFY COLUMN \`${col}\` varchar(255) NULL`
      );
      console.log(`[db] Made employees.${col} nullable.`);
    }
  } catch (err) {
    console.warn(
      '[db] Could not make employees.department_id/position_id nullable:',
      (err as Error)?.message || err
    );
  }
}

/** Legacy nullable column; departments are not tied to office locations. */
export async function ensureDepartmentOfficeLocationColumn(): Promise<void> {
  try {
    const [rows]: any = await sequelize.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'departments' AND COLUMN_NAME = 'office_location_id' LIMIT 1`
    );
    if (!Array.isArray(rows) || !rows.length) {
      await sequelize.query('ALTER TABLE `departments` ADD COLUMN `office_location_id` varchar(255) NULL');
      await sequelize.query(
        'CREATE INDEX `departments_office_location_id` ON `departments` (`office_location_id`)'
      );
      console.log('[db] Added departments.office_location_id column.');
    }
  } catch (err) {
    console.warn('[db] Could not add departments.office_location_id:', (err as Error)?.message || err);
  }
}

/** Drops legacy fixed weekday column (schedule uses time_in/time_out only). */
export async function dropEmployeeWorkingDaysColumn(): Promise<void> {
  try {
    const [rows]: any = await sequelize.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'working_days' LIMIT 1`
    );
    if (Array.isArray(rows) && rows.length) {
      await sequelize.query('ALTER TABLE `employees` DROP COLUMN `working_days`');
      console.log('[db] Dropped employees.working_days column.');
    }
  } catch (err) {
    console.warn('[db] Could not drop employees.working_days:', (err as Error)?.message || err);
  }
}

/** Child dependent profile fields (tax: has_job = true → not a dependent). */
export async function ensureEmployeeDependentChildColumns(): Promise<void> {
  const alters: [string, string][] = [
    ['sort_order', 'INT NOT NULL DEFAULT 0'],
    ['age', 'INT NULL'],
    ['gender', 'VARCHAR(32) NULL'],
    ['occupation', 'VARCHAR(255) NULL'],
    ['has_job', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ];
  for (const [col, ddl] of alters) {
    try {
      const [rows]: any = await sequelize.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employeedependents' AND COLUMN_NAME = ? LIMIT 1`,
        { replacements: [col] }
      );
      if (!Array.isArray(rows) || !rows.length) {
        await sequelize.query(`ALTER TABLE \`employeedependents\` ADD COLUMN \`${col}\` ${ddl}`);
        console.log(`[db] Added employeedependents.${col}.`);
      }
    } catch (err) {
      console.warn(`[db] Could not add employeedependents.${col}:`, (err as Error)?.message || err);
    }
  }
}

/** Ensures issued ID card rows table exists (additive migration). */
export async function ensureEmployeecardsTable(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS \`employeecards\` (
      \`id\` varchar(36) NOT NULL,
      \`employee_id\` varchar(255) NOT NULL,
      \`display_employee_id\` varchar(255) NOT NULL,
      \`issue_date\` date NOT NULL,
      \`expire_date\` date NOT NULL,
      \`status\` varchar(32) NOT NULL DEFAULT 'active',
      \`name_en\` varchar(500) NOT NULL,
      \`name_kh\` varchar(500) DEFAULT NULL,
      \`position_title\` varchar(500) NOT NULL,
      \`avatar_url\` varchar(1024) DEFAULT NULL,
      \`contact_phone\` varchar(255) NOT NULL,
      \`contact_telegram\` varchar(255) DEFAULT NULL,
      \`join_date_snapshot\` date DEFAULT NULL,
      \`notes\` text DEFAULT NULL,
      \`issued_by\` varchar(255) DEFAULT NULL,
      \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      KEY \`employeecards_employee_id\` (\`employee_id\`),
      KEY \`employeecards_display_employee_id\` (\`display_employee_id\`),
      KEY \`employeecards_status\` (\`status\`),
      KEY \`employeecards_expire_date\` (\`expire_date\`),
      KEY \`employeecards_issue_date\` (\`issue_date\`),
      CONSTRAINT \`employeecards_ibfk_employee\` FOREIGN KEY (\`employee_id\`) REFERENCES \`employees\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
