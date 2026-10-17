import { sequelize } from '../db.js';

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = (await sequelize.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column LIMIT 1`,
    { replacements: { table, column } }
  )) as [unknown[], unknown];
  return Array.isArray(rows) && rows.length > 0;
}

let migrationsDone = false;
let migrationsInFlight: Promise<void> | null = null;

export async function ensureAppraisalColumnMigrations(): Promise<void> {
  if (migrationsDone) return;
  if (migrationsInFlight) {
    await migrationsInFlight;
    return;
  }

  migrationsInFlight = (async () => {
    const appraisalCols: Array<[string, string]> = [
      ['ranking_position', 'INT NULL'],
      ['strengths', 'TEXT NULL'],
      ['weaknesses', 'TEXT NULL'],
      ['manager_recommendations', 'TEXT NULL'],
      ['rejected_by', 'VARCHAR(64) NULL'],
      ['rejected_at', 'DATETIME NULL'],
      ['rejection_reason', 'TEXT NULL'],
      ['assigned_manager_user_id', 'VARCHAR(64) NULL'],
      ['routed_by_hr_user_id', 'VARCHAR(64) NULL'],
      ['routed_at', 'DATETIME NULL'],
      ['manager_submitted_at', 'DATETIME NULL'],
      ['manager_submitted_by', 'VARCHAR(64) NULL'],
      ['outcome_payload_json', 'TEXT NULL'],
      ['assigned_final_approver_user_id', 'VARCHAR(64) NULL'],
      ['returned_by', 'VARCHAR(64) NULL'],
      ['returned_at', 'DATETIME NULL'],
      ['return_notes', 'TEXT NULL'],
    ];

    for (const [col, def] of appraisalCols) {
      if (!(await columnExists('employee_appraisals', col))) {
        await sequelize.query(`ALTER TABLE employee_appraisals ADD COLUMN \`${col}\` ${def}`);
      }
    }

    const componentScoreCols: Array<[string, string]> = [
      ['hr_raw_score', 'DECIMAL(6,2) NULL'],
      ['manager_raw_score', 'DECIMAL(6,2) NULL'],
      ['employee_raw_score', 'DECIMAL(6,2) NULL'],
      // Per-evaluator raw scores keyed by evaluator user id, e.g. {"u1": 80, "u2": 70}.
      // Supports an unfixed number of management evaluators feeding the average.
      ['evaluator_scores_json', 'TEXT NULL'],
    ];
    for (const [col, def] of componentScoreCols) {
      if (!(await columnExists('appraisal_component_scores', col))) {
        await sequelize.query(`ALTER TABLE appraisal_component_scores ADD COLUMN \`${col}\` ${def}`);
      }
    }

    const periodCols: Array<[string, string]> = [
      ['alert_notification_date', 'DATE NULL'],
      ['alert_notification_sent_at', 'DATE NULL'],
      // Soft enable/disable — same table, no new table.
      ['is_active', 'TINYINT(1) NOT NULL DEFAULT 1'],
    ];
    for (const [col, def] of periodCols) {
      if (!(await columnExists('appraisal_periods', col))) {
        await sequelize.query(`ALTER TABLE appraisal_periods ADD COLUMN \`${col}\` ${def}`);
      }
    }

    const { ensureAppraisalApproversTable } = await import('../workflowAppraisalApproverService.js');
    await ensureAppraisalApproversTable();
    migrationsDone = true;
  })();

  try {
    await migrationsInFlight;
  } finally {
    migrationsInFlight = null;
  }
}
