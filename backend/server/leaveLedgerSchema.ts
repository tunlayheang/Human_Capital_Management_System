import { sequelize } from './db.js';

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS leave_ledger (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  employee_id VARCHAR(64) NOT NULL,
  leave_type_id VARCHAR(64) NOT NULL,
  calendar_year INT NOT NULL,
  accrual_month CHAR(7) NULL,
  transaction_type ENUM('accrual','usage','carry_forward','adjustment') NOT NULL,
  days DECIMAL(7,2) NOT NULL,
  join_date DATE NULL,
  join_day INT NULL,
  applied_tier VARCHAR(32) NULL,
  source_ref VARCHAR(128) NULL,
  generated_by VARCHAR(64) NOT NULL DEFAULT 'month_end_accrual',
  audit_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_leave_ledger_accrual (employee_id, leave_type_id, accrual_month),
  KEY idx_leave_ledger_employee_year (employee_id, calendar_year),
  KEY idx_leave_ledger_type (leave_type_id),
  KEY idx_leave_ledger_source (source_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

export async function ensureLeaveLedgerSchema(): Promise<void> {
  await sequelize.query(CREATE_TABLE_SQL);
}
