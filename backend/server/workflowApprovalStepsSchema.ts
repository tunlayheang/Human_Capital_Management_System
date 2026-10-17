import { QueryTypes } from 'sequelize';
import { sequelize } from './db.js';

export const WORKFLOW_APPROVAL_STEPS_TABLE = 'workflow_approval_steps';

export type WorkflowApprovalEntityType =
  | 'leave'
  | 'overtime'
  | 'movement'
  | 'appraisal_final'
  | 'appraisal_eval'
  | 'probation_final'
  | 'probation_eval'
  | 'payroll_run';

type LegacyApproverTable = {
  table: string;
  entityType: WorkflowApprovalEntityType;
  fkColumn: string;
};

const LEGACY_APPROVER_TABLES: LegacyApproverTable[] = [
  { table: 'leave_request_approvers', entityType: 'leave', fkColumn: 'leave_id' },
  { table: 'overtime_request_approvers', entityType: 'overtime', fkColumn: 'overtime_id' },
  { table: 'employee_movement_approvers', entityType: 'movement', fkColumn: 'movement_id' },
  { table: 'employee_appraisal_approvers', entityType: 'appraisal_final', fkColumn: 'appraisal_id' },
  { table: 'employee_appraisal_evaluators', entityType: 'appraisal_eval', fkColumn: 'appraisal_id' },
  { table: 'employee_probation_approvers', entityType: 'probation_final', fkColumn: 'review_id' },
  { table: 'employee_probation_evaluators', entityType: 'probation_eval', fkColumn: 'review_id' },
  { table: 'payroll_run_approvers', entityType: 'payroll_run', fkColumn: 'run_id' },
];

let consolidated = false;

async function tableExists(table: string): Promise<boolean> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    { replacements: [table] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function ensureWorkflowApprovalStepsTable(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS \`${WORKFLOW_APPROVAL_STEPS_TABLE}\` (
      \`id\` varchar(96) NOT NULL,
      \`entity_type\` varchar(32) NOT NULL,
      \`entity_id\` varchar(255) NOT NULL,
      \`user_id\` varchar(64) NOT NULL,
      \`status\` varchar(16) NOT NULL DEFAULT 'pending',
      \`approved_at\` varchar(32) DEFAULT NULL,
      \`sort_order\` int NOT NULL DEFAULT 0,
      \`created_at\` varchar(32) NOT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`workflow_approval_steps_unique\` (\`entity_type\`, \`entity_id\`, \`user_id\`),
      KEY \`workflow_approval_steps_entity\` (\`entity_type\`, \`entity_id\`),
      KEY \`workflow_approval_steps_user\` (\`user_id\`, \`entity_type\`, \`status\`),
      KEY \`was_entity_status_sort\` (\`entity_type\`, \`entity_id\`, \`status\`, \`sort_order\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function migrateLegacyApproverTable(legacy: LegacyApproverTable): Promise<void> {
  if (!(await tableExists(legacy.table))) return;

  const required = ['id', legacy.fkColumn, 'user_id', 'status', 'sort_order', 'created_at'];
  for (const col of required) {
    if (!(await columnExists(legacy.table, col))) {
      console.warn(
        `[db] Skipping legacy approver migrate for ${legacy.table}: missing column ${col}`
      );
      return;
    }
  }

  await sequelize.query(
    `INSERT IGNORE INTO \`${WORKFLOW_APPROVAL_STEPS_TABLE}\`
      (id, entity_type, entity_id, user_id, status, approved_at, sort_order, created_at)
     SELECT id, ?, \`${legacy.fkColumn}\`, user_id, status, approved_at, sort_order, created_at
     FROM \`${legacy.table}\``,
    { replacements: [legacy.entityType] }
  );

  await sequelize.query(`DROP TABLE IF EXISTS \`${legacy.table}\``);
}

async function backfillMovementApproversFromParent(): Promise<void> {
  if (!(await tableExists('employee_movements'))) return;

  await sequelize.query(`
    INSERT IGNORE INTO \`${WORKFLOW_APPROVAL_STEPS_TABLE}\`
      (id, entity_type, entity_id, user_id, status, approved_at, sort_order, created_at)
    SELECT
      CONCAT('ma-', em.id, '-', em.assigned_approver_user_id),
      'movement',
      em.id,
      em.assigned_approver_user_id,
      CASE WHEN em.status IN ('approved', 'applied', 'completed', 'scheduled') THEN 'approved' ELSE 'pending' END,
      em.approved_at,
      0,
      COALESCE(em.created_at, NOW())
    FROM employee_movements em
    WHERE em.assigned_approver_user_id IS NOT NULL
      AND TRIM(em.assigned_approver_user_id) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM \`${WORKFLOW_APPROVAL_STEPS_TABLE}\` was
        WHERE was.entity_type = 'movement' AND was.entity_id = em.id
      )
  `);
}

async function backfillAppraisalFinalApproversFromParent(): Promise<void> {
  if (!(await tableExists('employee_appraisals'))) return;

  await sequelize.query(`
    INSERT IGNORE INTO \`${WORKFLOW_APPROVAL_STEPS_TABLE}\`
      (id, entity_type, entity_id, user_id, status, approved_at, sort_order, created_at)
    SELECT
      CONCAT('aa-', ea.id, '-', ea.assigned_final_approver_user_id),
      'appraisal_final',
      ea.id,
      ea.assigned_final_approver_user_id,
      CASE WHEN ea.workflow_status = 'APPROVED' THEN 'approved' ELSE 'pending' END,
      ea.final_approved_at,
      0,
      COALESCE(ea.updated_at, NOW())
    FROM employee_appraisals ea
    WHERE ea.assigned_final_approver_user_id IS NOT NULL
      AND TRIM(ea.assigned_final_approver_user_id) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM \`${WORKFLOW_APPROVAL_STEPS_TABLE}\` was
        WHERE was.entity_type = 'appraisal_final' AND was.entity_id = ea.id
      )
  `);
}

/** Create unified table, migrate legacy per-module approver tables, backfill single-approver parents. */
export async function ensureWorkflowApprovalStepsConsolidated(): Promise<void> {
  if (consolidated) return;
  await ensureWorkflowApprovalStepsTable();

  for (const legacy of LEGACY_APPROVER_TABLES) {
    try {
      await migrateLegacyApproverTable(legacy);
    } catch (err) {
      console.warn(
        `[db] Legacy approver migrate failed for ${legacy.table}:`,
        (err as Error)?.message || err
      );
    }
  }

  try {
    await backfillMovementApproversFromParent();
  } catch (err) {
    console.warn('[db] Movement approver backfill failed:', (err as Error)?.message || err);
  }

  try {
    await backfillAppraisalFinalApproversFromParent();
  } catch (err) {
    console.warn('[db] Appraisal approver backfill failed:', (err as Error)?.message || err);
  }

  consolidated = true;
  console.log('[db] workflow_approval_steps table is ready (legacy approver tables consolidated).');
}

export async function countWorkflowApprovalSteps(
  entityType: WorkflowApprovalEntityType,
  entityId: string
): Promise<number> {
  const rows = (await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM \`${WORKFLOW_APPROVAL_STEPS_TABLE}\`
     WHERE entity_type = ? AND entity_id = ?`,
    { replacements: [entityType, entityId], type: QueryTypes.SELECT }
  )) as { cnt: number }[];
  return Number(rows[0]?.cnt ?? 0);
}
