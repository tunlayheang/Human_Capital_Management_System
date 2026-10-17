import { sequelize } from '../../db.js';
import type { SeniorityIndemnityPaymentRow } from './seniorityIndemnityTypes.js';

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS seniority_indemnity_payments (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  employee_id VARCHAR(64) NOT NULL,
  payroll_month CHAR(7) NOT NULL,
  calendar_year INT NOT NULL,
  payment_kind ENUM('june','december','settlement') NOT NULL,
  amount_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  payout_days DECIMAL(8,4) NOT NULL DEFAULT 0,
  daily_rate_usd DECIMAL(12,4) NOT NULL DEFAULT 0,
  salary_basis_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  status ENUM('draft','pending','approved','paid','cancelled') NOT NULL DEFAULT 'draft',
  formula VARCHAR(512) NULL,
  audit_json JSON NULL,
  payslip_id VARCHAR(64) NULL,
  created_by VARCHAR(64) NULL,
  approved_by VARCHAR(64) NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_seniority_indemnity_employee_month (employee_id, payroll_month, payment_kind),
  KEY idx_seniority_indemnity_employee (employee_id),
  KEY idx_seniority_indemnity_year (calendar_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

export function seniorityIndemnityPaymentId(): string {
  return `sip-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function ensureSeniorityIndemnitySchema(): Promise<void> {
  await sequelize.query(CREATE_TABLE_SQL);
}

export async function sumPaidIndemnityForCalendarYear(
  employeeId: string,
  calendarYear: number
): Promise<number> {
  await ensureSeniorityIndemnitySchema();
  const [rows] = (await sequelize.query(
    `SELECT COALESCE(SUM(payout_days), 0) AS totalDays
     FROM seniority_indemnity_payments
     WHERE employee_id = :employeeId
       AND calendar_year = :year
       AND status IN ('approved','paid')
       AND payment_kind IN ('june','december')`,
    { replacements: { employeeId, year: calendarYear } }
  )) as [Array<{ totalDays: number }>, unknown];
  return Number(rows[0]?.totalDays ?? 0);
}

export async function findApprovedIndemnityPayment(
  employeeId: string,
  payrollMonth: string,
  paymentKind: 'june' | 'december' | 'settlement'
): Promise<SeniorityIndemnityPaymentRow | null> {
  await ensureSeniorityIndemnitySchema();
  const [rows] = (await sequelize.query(
    `SELECT * FROM seniority_indemnity_payments
     WHERE employee_id = :employeeId
       AND payroll_month = :month
       AND payment_kind = :kind
       AND status IN ('approved','paid')
     LIMIT 1`,
    {
      replacements: { employeeId, month: payrollMonth.slice(0, 7), kind: paymentKind },
    }
  )) as [SeniorityIndemnityPaymentRow[], unknown];
  return rows[0] ?? null;
}

export async function upsertSeniorityIndemnityPaymentDraft(
  row: Omit<SeniorityIndemnityPaymentRow, 'created_at' | 'approved_at'> & {
    audit_json: Record<string, unknown>;
  }
): Promise<void> {
  await ensureSeniorityIndemnitySchema();
  const existing = await findApprovedIndemnityPayment(
    row.employee_id,
    row.payroll_month,
    row.payment_kind
  );
  if (existing) return;

  await sequelize.query(
    `INSERT INTO seniority_indemnity_payments
      (id, employee_id, payroll_month, calendar_year, payment_kind, amount_usd, payout_days,
       daily_rate_usd, salary_basis_usd, status, formula, audit_json, payslip_id, created_by)
     VALUES
      (:id, :employee_id, :payroll_month, :calendar_year, :payment_kind, :amount_usd, :payout_days,
       :daily_rate_usd, :salary_basis_usd, :status, :formula, :audit_json, :payslip_id, :created_by)
     ON DUPLICATE KEY UPDATE
       amount_usd = VALUES(amount_usd),
       payout_days = VALUES(payout_days),
       daily_rate_usd = VALUES(daily_rate_usd),
       salary_basis_usd = VALUES(salary_basis_usd),
       formula = VALUES(formula),
       audit_json = VALUES(audit_json),
       updated_at = CURRENT_TIMESTAMP`,
    {
      replacements: {
        ...row,
        audit_json: JSON.stringify(row.audit_json ?? {}),
        payslip_id: row.payslip_id ?? null,
        created_by: row.created_by ?? null,
      },
    }
  );
}
