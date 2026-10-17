import crypto from 'crypto';
import { sequelize } from '../db.js';

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS payroll_policy_versions (
  id VARCHAR(64) NOT NULL,
  policy_type VARCHAR(40) NOT NULL,
  policy_key VARCHAR(80) NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  payload JSON NOT NULL,
  notes VARCHAR(500) NULL,
  created_by VARCHAR(64) NULL,
  created_at DATETIME NOT NULL,
  modified_by VARCHAR(64) NULL,
  modified_at DATETIME NULL,
  approved_by VARCHAR(64) NULL,
  approved_at DATETIME NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_ppv_type_from (policy_type, effective_from),
  KEY idx_ppv_type_key_from (policy_type, policy_key, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

export type PayrollPolicyVersionRow = {
  id: string;
  policy_type: string;
  policy_key: string | null;
  effective_from: string;
  effective_to: string | null;
  payload: unknown;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export function payrollPolicyVersionId(): string {
  return `ppv-${crypto.randomBytes(8).toString('hex')}`;
}

export async function ensurePayrollPolicyVersionSchema(): Promise<void> {
  await sequelize.query(CREATE_SQL);
  const { ensurePayrollPolicyVersionAuditColumns } = await import('../sensitiveModuleAuditSchema.js');
  await ensurePayrollPolicyVersionAuditColumns();
}
