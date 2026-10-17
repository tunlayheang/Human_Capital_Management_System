import { sequelize } from '../db.js';

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS employee_monthly_sales (
  id VARCHAR(64) NOT NULL,
  employee_id VARCHAR(64) NOT NULL,
  payroll_month VARCHAR(7) NOT NULL,
  sales_amount DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  notes TEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ems_employee_month (employee_id, payroll_month),
  KEY idx_ems_month (payroll_month),
  KEY idx_ems_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

let ensured = false;

/** Idempotent DDL for commission monthly sales input. */
export async function ensureEmployeeMonthlySalesSchema(): Promise<void> {
  if (ensured) return;
  await sequelize.query(CREATE_SQL);
  ensured = true;
}
