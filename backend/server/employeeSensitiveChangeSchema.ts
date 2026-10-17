import crypto from 'crypto';
import { sequelize } from './db.js';

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS employee_sensitive_changes (
  id VARCHAR(64) NOT NULL,
  employee_pk VARCHAR(255) NOT NULL,
  change_source VARCHAR(32) NOT NULL,
  source_ref_id VARCHAR(64) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  change_reason TEXT NOT NULL,
  effective_date DATE NULL,
  before_state JSON NOT NULL,
  after_state JSON NOT NULL,
  field_changes JSON NOT NULL,
  submitted_by VARCHAR(64) NULL,
  reviewed_by VARCHAR(64) NULL,
  reviewed_at DATETIME NULL,
  review_notes TEXT NULL,
  created_at DATETIME NOT NULL,
  applied_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_esc_employee_pk (employee_pk),
  KEY idx_esc_status (status),
  KEY idx_esc_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

export type EmployeeSensitiveChangeStatus = 'pending' | 'approved' | 'rejected' | 'applied';

export type EmployeeSensitiveChangeRow = {
  id: string;
  employee_pk: string;
  /** Display badge — resolved from employee_pk at read time, not stored. */
  employee_id: string;
  change_source: 'profile_update' | 'movement' | 'field_correction';
  source_ref_id: string | null;
  status: EmployeeSensitiveChangeStatus;
  change_reason: string;
  effective_date: string | null;
  before_state: unknown;
  after_state: unknown;
  field_changes: unknown;
  submitted_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  applied_at: string | null;
};

export function employeeSensitiveChangeId(): string {
  return `esc-${crypto.randomBytes(8).toString('hex')}`;
}

export async function ensureEmployeeSensitiveChangeSchema(): Promise<void> {
  await sequelize.query(CREATE_SQL);
  const [cols] = (await sequelize.query(
    `SHOW COLUMNS FROM employee_sensitive_changes LIKE 'effective_date'`
  )) as [unknown[], unknown];
  if (!Array.isArray(cols) || cols.length === 0) {
    await sequelize.query(
      `ALTER TABLE employee_sensitive_changes ADD COLUMN effective_date DATE NULL AFTER change_reason`
    );
  }
}
