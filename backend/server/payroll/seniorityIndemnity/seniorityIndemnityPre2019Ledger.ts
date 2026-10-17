import { sequelize } from '../../db.js';
import type { Pre2019BackPayLedgerRow } from './seniorityIndemnityTypes.js';

const CREATE_PRE2019_SQL = `
CREATE TABLE IF NOT EXISTS seniority_indemnity_pre2019_ledger (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  employee_id VARCHAR(64) NOT NULL,
  calendar_year INT NOT NULL,
  days_paid DECIMAL(8,4) NOT NULL DEFAULT 0,
  amount_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  status ENUM('draft','pending','approved','paid','cancelled') NOT NULL DEFAULT 'draft',
  formula VARCHAR(512) NULL,
  audit_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pre2019_employee_year (employee_id, calendar_year),
  KEY idx_pre2019_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

export function pre2019BackPayLedgerId(): string {
  return `sip19-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function ensurePre2019BackPayLedgerSchema(): Promise<void> {
  await sequelize.query(CREATE_PRE2019_SQL);
}

export async function sumOutstandingPre2019BackPayUsd(employeeId: string): Promise<number> {
  await ensurePre2019BackPayLedgerSchema();
  const [rows] = (await sequelize.query(
    `SELECT COALESCE(SUM(amount_usd), 0) AS totalUsd
     FROM seniority_indemnity_pre2019_ledger
     WHERE employee_id = :employeeId
       AND status IN ('approved','paid')`,
    { replacements: { employeeId } }
  )) as [Array<{ totalUsd: number }>, unknown];
  return Number(rows[0]?.totalUsd ?? 0);
}

export async function listPre2019BackPayLedger(
  employeeId: string
): Promise<Pre2019BackPayLedgerRow[]> {
  await ensurePre2019BackPayLedgerSchema();
  const [rows] = (await sequelize.query(
    `SELECT * FROM seniority_indemnity_pre2019_ledger WHERE employee_id = :employeeId ORDER BY calendar_year ASC`,
    { replacements: { employeeId } }
  )) as [Pre2019BackPayLedgerRow[], unknown];
  return rows ?? [];
}
