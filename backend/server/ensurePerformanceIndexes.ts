import { QueryTypes } from 'sequelize';
import { sequelize } from './db.js';

type IndexSpec = {
  table: string;
  name: string;
  columns: string;
};

/**
 * Composite indexes for the hottest production query shapes.
 * Safe to re-run: skips indexes that already exist.
 */
const PERFORMANCE_INDEXES: IndexSpec[] = [
  // Leave — pending inbox + approved overlap / payroll maps
  {
    table: 'leaverequests',
    name: 'leave_requests_user_status_start',
    columns: '`userId`, `status`, `startDate`',
  },
  {
    table: 'leaverequests',
    name: 'leave_requests_status_user',
    columns: '`status`, `userId`',
  },
  {
    table: 'leaverequests',
    name: 'leave_requests_user_status_end',
    columns: '`userId`, `status`, `endDate`',
  },
  {
    table: 'leaverequests',
    name: 'leave_requests_assigned_manager',
    columns: '`assignedManagerId`',
  },

  // Messages — unread DMs + group last-message / thread order
  {
    table: 'messages',
    name: 'messages_receiver_read_group',
    columns: '`receiverId`, `isRead`, `groupId`',
  },
  {
    table: 'messages',
    name: 'messages_group_created',
    columns: '`groupId`, `createdAt`',
  },
  {
    table: 'messages',
    name: 'messages_created',
    columns: '`createdAt`',
  },
  {
    table: 'messages',
    name: 'messages_direct_pair_created',
    columns: '`senderId`, `receiverId`, `createdAt`',
  },

  // Notifications — bell feed ORDER BY createdAt
  {
    table: 'notifications',
    name: 'notifications_user_id_created',
    columns: '`userId`, `createdAt`',
  },

  // Chat meta — almost every query is kind + user/parent/created
  {
    table: 'hcms_chat_meta',
    name: 'idx_hcms_chat_meta_kind_user',
    columns: '`kind`, `user_id`',
  },
  {
    table: 'hcms_chat_meta',
    name: 'idx_hcms_chat_meta_kind_parent',
    columns: '`kind`, `parent_id`',
  },
  {
    table: 'hcms_chat_meta',
    name: 'idx_hcms_chat_meta_kind_created',
    columns: '`kind`, `created_at`',
  },
  {
    table: 'hcms_chat_meta',
    name: 'idx_hcms_chat_meta_kind_ref',
    columns: '`kind`, `ref_id`',
  },

  // Overtime — month caps / range scans
  {
    table: 'overtimerequests',
    name: 'overtimerequests_user_status_workdate',
    columns: '`userId`, `status`, `workDate`',
  },

  // Movements — pending lists ordered by effective date
  {
    table: 'employee_movements',
    name: 'employee_movements_status_effective',
    columns: '`status`, `effective_date`',
  },

  // Payroll runs / attendance periods
  {
    table: 'payrollruns',
    name: 'payroll_runs_month_group',
    columns: '`month`, `payrollGroupId`',
  },
  {
    table: 'payrollruns',
    name: 'payroll_runs_month_status',
    columns: '`month`, `status`',
  },
  {
    table: 'payrollattendanceperiods',
    name: 'payrollattendanceperiods_month_group',
    columns: '`month`, `payrollGroupId`',
  },

  // Workflow approval steps — current-turn inbox joins
  {
    table: 'workflow_approval_steps',
    name: 'was_entity_status_sort',
    columns: '`entity_type`, `entity_id`, `status`, `sort_order`',
  },

  // Attendance — roster grids / history / dashboard snapshot counts
  {
    table: 'attendancerecords',
    name: 'attendancerecords_date_status',
    columns: '`date`, `status`',
  },
  {
    table: 'attendancerecords',
    name: 'attendancerecords_user_date',
    columns: '`userId`, `date`',
  },
  {
    table: 'attendancerecords',
    name: 'attendancerecords_date_user',
    columns: '`date`, `userId`',
  },

  // Employees — list filters + summary cards
  {
    table: 'employees',
    name: 'employees_status_department',
    columns: '`status`, `department_id`',
  },
  {
    table: 'employees',
    name: 'employees_email',
    columns: '`email`',
  },

  // Offboarding settlement EXISTS used by Active/Inactive filters
  {
    table: 'finalsettlementruns',
    name: 'finalsettlementruns_employee_status',
    columns: '`employee_id`, `status`',
  },
];

async function tableExists(table: string): Promise<boolean> {
  const rows = (await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    { replacements: [table], type: QueryTypes.SELECT }
  )) as unknown[];
  return Array.isArray(rows) && rows.length > 0;
}

async function indexExists(table: string, indexName: string): Promise<boolean> {
  const rows = (await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    { replacements: [table, indexName], type: QueryTypes.SELECT }
  )) as unknown[];
  return Array.isArray(rows) && rows.length > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = (await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    { replacements: [table, column], type: QueryTypes.SELECT }
  )) as unknown[];
  return Array.isArray(rows) && rows.length > 0;
}

/** True when every column referenced by the index exists on the table. */
async function indexColumnsReady(table: string, columnsSql: string): Promise<boolean> {
  const cols = columnsSql
    .split(',')
    .map((c) => c.replace(/`/g, '').trim())
    .filter(Boolean);
  for (const col of cols) {
    if (!(await columnExists(table, col))) return false;
  }
  return true;
}

/**
 * Ensure composite indexes used by Leaves, Chat, Notifications, Payroll, and Approvals.
 * Runs on local init and remote migrate so Render + Aiven pick them up without a manual DBA step.
 */
export async function ensurePerformanceIndexes(): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;

  for (const spec of PERFORMANCE_INDEXES) {
    try {
      if (!(await tableExists(spec.table))) {
        skipped += 1;
        continue;
      }
      if (!(await indexColumnsReady(spec.table, spec.columns))) {
        skipped += 1;
        continue;
      }
      if (await indexExists(spec.table, spec.name)) {
        skipped += 1;
        continue;
      }
      await sequelize.query(
        `ALTER TABLE \`${spec.table}\` ADD INDEX \`${spec.name}\` (${spec.columns})`
      );
      console.log(`[db] Added index ${spec.table}.${spec.name}`);
      added += 1;
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      // Duplicate / concurrent create is fine.
      if (/Duplicate key name|already exists/i.test(msg)) {
        skipped += 1;
        continue;
      }
      console.warn(`[db] Could not add index ${spec.table}.${spec.name}:`, msg);
      skipped += 1;
    }
  }

  return { added, skipped };
}
