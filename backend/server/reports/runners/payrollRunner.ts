import { Op } from 'sequelize';
import { Department, Employee, PayrollRun, Payslip, SalaryStructure, User } from '../../db.js';
import type { ReportColumn, ReportRunner, ReportRow } from '../reportTypes.js';
import { num, round2, str } from '../reportFilterUtils.js';

export type PayslipFlat = {
  employeeId: string;
  name: string;
  departmentId: string;
  department: string;
  grossSalary: number;
  netSalary: number;
  baseSalary: number;
  overtimePay: number;
  allowancesTotal: number;
  nssfEmployee: number;
  nssfEmployer: number;
  nssfEmployeeKhr: number;
  nssfEmployerKhr: number;
  taxUsd: number;
  taxKhr: number;
  taxId: string;
  nssfId: string;
  exchangeRate: number;
  seniorityIndemnity: number;
  month: string;
  runId: string;
  runStatus: string;
};

/** Employer NSSF USD — column first, then nssfDetail snapshot (matches payroll register). */
function resolveEmployerNssfUsd(breakdown: Record<string, unknown> | null): number {
  if (!breakdown) return 0;
  const direct = num(breakdown.employerContributionUsd);
  if (direct > 0) return round2(direct);
  const detail = (breakdown.nssfDetail as Record<string, unknown>) || {};
  if (num(detail.employerNssfUsd) > 0) return round2(num(detail.employerNssfUsd));
  const ex = num(breakdown.exchangeRate) || 4100;
  if (num(detail.employerTotalKhr) > 0 && ex > 0) {
    return round2(num(detail.employerTotalKhr) / ex);
  }
  return round2(direct);
}

function complianceId(
  review: Record<string, unknown> | null | undefined,
  salary: Record<string, unknown> | undefined,
  reviewKey: string,
  salaryKey: string
): string {
  const fromReview = str(review?.[reviewKey]).trim();
  if (fromReview && fromReview !== '0') return fromReview;
  const fromSalary = salary ? str(salary[salaryKey]).trim() : '';
  if (fromSalary && fromSalary !== '0') return fromSalary;
  return '';
}

export async function loadMonthPayslips(
  month: string,
  departmentId?: string
): Promise<{
  rows: PayslipFlat[];
  note?: string;
}> {
  const monthKey = month.slice(0, 7);
  const runs = await PayrollRun.findAll({
    where: { month: { [Op.like]: `${monthKey}%` } },
    order: [['createdAt', 'DESC']],
    limit: 20,
  });

  const preferred =
    runs.find((r) => {
      const s = str(r.get('status')).toUpperCase();
      return ['APPROVED', 'LOCKED', 'PAID', 'FINALIZED', 'CLOSED'].includes(s);
    }) || runs[0];

  if (!preferred) {
    return { rows: [], note: `No payroll run found for ${monthKey}.` };
  }

  const runId = str(preferred.get('id'));
  const runStatus = str(preferred.get('status'));
  const runMonth = str(preferred.get('month')).slice(0, 7) || monthKey;

  const payslips = await Payslip.findAll({
    where: { payrollRunId: runId },
    limit: 5000,
  });

  const { loadBreakdownForPayslipId } = await import('../../payslipBreakdownService.js');
  const userIds = payslips.map((p) => str(p.get('userId'))).filter(Boolean);
  const users = userIds.length
    ? await User.findAll({
        where: { id: { [Op.in]: userIds } },
        attributes: ['id', 'employeeId', 'display_name', 'email'],
      })
    : [];
  const userById = new Map(
    users.map((u) => [str(u.get('id')), u.get({ plain: true }) as Record<string, unknown>])
  );
  const empPks = users.map((u) => str(u.get('employeeId'))).filter(Boolean);
  const employees = empPks.length
    ? await Employee.findAll({
        where: { id: { [Op.in]: empPks } },
        attributes: ['id', 'employee_id', 'department_id', 'first_name', 'last_name'],
      })
    : [];
  const empByPk = new Map(
    employees.map((e) => [str(e.get('id')), e.get({ plain: true }) as Record<string, unknown>])
  );
  const salaryRows = empPks.length
    ? await SalaryStructure.findAll({
        where: { employee_id: { [Op.in]: empPks } },
        attributes: ['employee_id', 'tax_id', 'nssf_id'],
      })
    : [];
  const salaryByEmpPk = new Map(
    salaryRows.map((s) => [
      str(s.get('employee_id')),
      s.get({ plain: true }) as Record<string, unknown>,
    ])
  );
  const deptIds = [...new Set(employees.map((e) => str(e.get('department_id'))).filter(Boolean))];
  const depts = deptIds.length
    ? await Department.findAll({ where: { id: { [Op.in]: deptIds } } })
    : [];
  const deptName = new Map(depts.map((d) => [str(d.get('id')), str(d.get('name'))]));

  const rows: PayslipFlat[] = [];
  for (const ps of payslips) {
    const plain = ps.get({ plain: true }) as Record<string, unknown>;
    const user = userById.get(str(plain.userId));
    const emp = user ? empByPk.get(str(user.employeeId)) : undefined;
    const salary = emp ? salaryByEmpPk.get(str(emp.id)) : undefined;
    const departmentIdVal = emp ? str(emp.department_id) : '';
    if (departmentId && departmentIdVal !== departmentId) continue;

    const breakdown = (await loadBreakdownForPayslipId(str(plain.id))) as Record<
      string,
      unknown
    > | null;
    const deductions = (breakdown?.deductions as Record<string, unknown>) || {};
    const review = (breakdown?.reviewContext as Record<string, unknown>) || null;
    const nssfDetail = (breakdown?.nssfDetail as Record<string, unknown>) || {};
    const exchangeRate =
      num(breakdown?.exchangeRate) ||
      num(review?.exchangeRate) ||
      num(nssfDetail.exchangeRate) ||
      4100;
    const name =
      (emp ? [str(emp.first_name), str(emp.last_name)].filter(Boolean).join(' ') : '') ||
      str(user?.display_name) ||
      str(user?.email);

    const nssfEmployee = round2(
      num(deductions.nssf) ||
        num(breakdown?.employeeContributionUsd) ||
        num(breakdown?.deductionNssf)
    );
    const nssfEmployer = resolveEmployerNssfUsd(breakdown);
    let nssfEmployeeKhr = round2(
      num(breakdown?.employeeContributionKhr) || num(nssfDetail.employeeTotalKhr)
    );
    let nssfEmployerKhr = round2(
      num(breakdown?.employerContributionKhr) || num(nssfDetail.employerTotalKhr)
    );
    if (nssfEmployeeKhr <= 0 && nssfEmployee > 0 && exchangeRate > 0) {
      nssfEmployeeKhr = Math.round(nssfEmployee * exchangeRate);
    }
    if (nssfEmployerKhr <= 0 && nssfEmployer > 0 && exchangeRate > 0) {
      nssfEmployerKhr = Math.round(nssfEmployer * exchangeRate);
    }

    const taxUsd = round2(
      num(breakdown?.taxAmountUsd) ||
        num(deductions.taxOnSalary) ||
        num(breakdown?.deductionTaxOnSalary)
    );
    let taxKhr = round2(num(breakdown?.taxAmountKhr));
    if (taxKhr <= 0 && taxUsd > 0 && exchangeRate > 0) {
      taxKhr = Math.round(taxUsd * exchangeRate);
    }

    rows.push({
      employeeId: emp ? str(emp.employee_id) : str(plain.employeeId),
      name,
      departmentId: departmentIdVal,
      department: deptName.get(departmentIdVal) || '(No department)',
      grossSalary: round2(num(breakdown?.grossSalary ?? plain.grossSalary)),
      netSalary: round2(num(breakdown?.netSalary ?? plain.netSalary)),
      baseSalary: round2(num(breakdown?.baseSalary)),
      overtimePay: round2(num(breakdown?.overtimePay ?? breakdown?.otPay)),
      allowancesTotal: round2(
        num(breakdown?.allowancesTotal) ||
          num((breakdown?.allowances as Record<string, unknown>)?.total)
      ),
      nssfEmployee,
      nssfEmployer,
      nssfEmployeeKhr,
      nssfEmployerKhr,
      taxUsd,
      taxKhr,
      taxId: complianceId(review, salary, 'taxId', 'tax_id'),
      nssfId: complianceId(review, salary, 'nssfId', 'nssf_id'),
      exchangeRate,
      seniorityIndemnity: round2(
        num(breakdown?.seniorityIndemnity) || num(breakdown?.allowanceSeniorityIndemnity)
      ),
      month: runMonth,
      runId,
      runStatus,
    });
  }

  return {
    rows,
    note: `Source payroll run ${runId} (${runStatus}) for ${runMonth}.`,
  };
}

type DeptBucket = {
  department: string;
  employees: number;
  employeeNssf: number;
  employerNssf: number;
  total: number;
  gross: number;
  taxUsd: number;
  taxKhr: number;
  net: number;
  indemnity: number;
  paidCount: number;
  overtime: number;
  allowances: number;
};

function emptyBucket(department: string): DeptBucket {
  return {
    department,
    employees: 0,
    employeeNssf: 0,
    employerNssf: 0,
    total: 0,
    gross: 0,
    taxUsd: 0,
    taxKhr: 0,
    net: 0,
    indemnity: 0,
    paidCount: 0,
    overtime: 0,
    allowances: 0,
  };
}

function groupByDepartment(flat: PayslipFlat[]): Map<string, DeptBucket> {
  const map = new Map<string, DeptBucket>();
  for (const r of flat) {
    const key = r.departmentId || '_none';
    const bucket = map.get(key) || emptyBucket(r.department || '(No department)');
    bucket.employees += 1;
    bucket.employeeNssf += r.nssfEmployee;
    bucket.employerNssf += r.nssfEmployer;
    bucket.total += r.nssfEmployee + r.nssfEmployer;
    bucket.gross += r.grossSalary;
    bucket.taxUsd += r.taxUsd;
    bucket.taxKhr += r.taxKhr;
    bucket.net += r.netSalary;
    bucket.overtime += r.overtimePay;
    bucket.allowances += r.allowancesTotal;
    if (r.seniorityIndemnity > 0) {
      bucket.indemnity += r.seniorityIndemnity;
      bucket.paidCount += 1;
    }
    map.set(key, bucket);
  }
  return map;
}

/**
 * NSSF contributions for government filing — one row per payslip with NSSF ID
 * and employee/employer amounts from the preferred payroll run of the month.
 */
export const runNssfContributions: ReportRunner = async (filters) => {
  const { rows: flat, note } = await loadMonthPayslips(
    filters.month,
    filters.departmentId || undefined
  );

  const rows: ReportRow[] = flat
    .map((r) => {
      const nssfTotal = round2(r.nssfEmployee + r.nssfEmployer);
      const nssfTotalKhr = Math.round(r.nssfEmployeeKhr + r.nssfEmployerKhr);
      return {
        employeeId: r.employeeId,
        name: r.name,
        department: r.department,
        nssfId: r.nssfId || '—',
        gross: r.grossSalary,
        nssfEmployee: r.nssfEmployee,
        nssfEmployer: r.nssfEmployer,
        nssfTotal,
        nssfEmployeeKhr: Math.round(r.nssfEmployeeKhr),
        nssfEmployerKhr: Math.round(r.nssfEmployerKhr),
        nssfTotalKhr,
      };
    })
    .sort((a, b) => {
      const dept = String(a.department).localeCompare(String(b.department));
      if (dept !== 0) return dept;
      return String(a.name).localeCompare(String(b.name));
    });

  const sumEe = round2(flat.reduce((s, r) => s + r.nssfEmployee, 0));
  const sumEr = round2(flat.reduce((s, r) => s + r.nssfEmployer, 0));
  const sumEeKhr = Math.round(flat.reduce((s, r) => s + r.nssfEmployeeKhr, 0));
  const sumErKhr = Math.round(flat.reduce((s, r) => s + r.nssfEmployerKhr, 0));
  const covered = flat.filter((r) => r.nssfEmployee > 0 || r.nssfEmployer > 0).length;

  return {
    columns: [
      { key: 'employeeId', label: 'Employee ID', aggregate: 'omit' },
      { key: 'name', label: 'Employee', aggregate: 'omit' },
      { key: 'department', label: 'Department', aggregate: 'omit' },
      { key: 'nssfId', label: 'NSSF ID', aggregate: 'omit' },
      { key: 'gross', label: 'Gross (USD)', align: 'right', format: 'currency' },
      { key: 'nssfEmployee', label: 'Employee NSSF (USD)', align: 'right', format: 'currency' },
      { key: 'nssfEmployer', label: 'Employer NSSF (USD)', align: 'right', format: 'currency' },
      { key: 'nssfTotal', label: 'NSSF total (USD)', align: 'right', format: 'currency' },
      { key: 'nssfEmployeeKhr', label: 'Employee NSSF (KHR)', align: 'right', format: 'number' },
      { key: 'nssfEmployerKhr', label: 'Employer NSSF (KHR)', align: 'right', format: 'number' },
      { key: 'nssfTotalKhr', label: 'NSSF total (KHR)', align: 'right', format: 'number' },
    ] satisfies ReportColumn[],
    rows,
    note: [
      note,
      'NSSF filing report for the company: employee share (withheld) + employer share (company cost). Use NSSF ID and KHR totals when submitting to the National Social Security Fund.',
    ]
      .filter(Boolean)
      .join(' '),
    summaryCards: [
      { key: 'payslips', label: 'Payslips', value: flat.length, format: 'number' },
      { key: 'covered', label: 'NSSF covered', value: covered, format: 'number' },
      { key: 'ee', label: 'Employee NSSF (USD)', value: sumEe, format: 'currency' },
      { key: 'er', label: 'Employer NSSF (USD)', value: sumEr, format: 'currency' },
      {
        key: 'total',
        label: 'Combined NSSF (USD)',
        value: round2(sumEe + sumEr),
        format: 'currency',
      },
      { key: 'eeKhr', label: 'Employee NSSF (KHR)', value: sumEeKhr, format: 'number' },
      { key: 'erKhr', label: 'Employer NSSF (KHR)', value: sumErKhr, format: 'number' },
    ],
  };
};

/**
 * Tax on salary (ToS) withholding for GDT filing — one row per payslip with Tax ID
 * and tax amounts from the preferred payroll run of the month.
 */
export const runTaxWithholding: ReportRunner = async (filters) => {
  const { rows: flat, note } = await loadMonthPayslips(
    filters.month,
    filters.departmentId || undefined
  );

  const rows: ReportRow[] = flat
    .map((r) => ({
      employeeId: r.employeeId,
      name: r.name,
      department: r.department,
      taxId: r.taxId || '—',
      taxableGross: r.grossSalary,
      taxUsd: r.taxUsd,
      taxKhr: Math.round(r.taxKhr),
      net: r.netSalary,
    }))
    .sort((a, b) => {
      const dept = String(a.department).localeCompare(String(b.department));
      if (dept !== 0) return dept;
      return String(a.name).localeCompare(String(b.name));
    });

  const sumTaxUsd = round2(flat.reduce((s, r) => s + r.taxUsd, 0));
  const sumTaxKhr = Math.round(flat.reduce((s, r) => s + r.taxKhr, 0));
  const taxableEmployees = flat.filter((r) => r.taxUsd > 0).length;

  return {
    columns: [
      { key: 'employeeId', label: 'Employee ID', aggregate: 'omit' },
      { key: 'name', label: 'Employee', aggregate: 'omit' },
      { key: 'department', label: 'Department', aggregate: 'omit' },
      { key: 'taxId', label: 'Tax ID', aggregate: 'omit' },
      { key: 'taxableGross', label: 'Gross (USD)', align: 'right', format: 'currency' },
      { key: 'taxUsd', label: 'Tax ToS (USD)', align: 'right', format: 'currency' },
      { key: 'taxKhr', label: 'Tax ToS (KHR)', align: 'right', format: 'number' },
      { key: 'net', label: 'Net (USD)', align: 'right', format: 'currency' },
    ] satisfies ReportColumn[],
    rows,
    note: [
      note,
      'Tax on salary (ToS) filing report for the company. Use Tax ID and KHR tax when remitting to the General Department of Taxation (GDT).',
    ]
      .filter(Boolean)
      .join(' '),
    summaryCards: [
      { key: 'payslips', label: 'Payslips', value: flat.length, format: 'number' },
      { key: 'taxable', label: 'Taxable employees', value: taxableEmployees, format: 'number' },
      { key: 'taxUsd', label: 'Total tax (USD)', value: sumTaxUsd, format: 'currency' },
      { key: 'taxKhr', label: 'Total tax (KHR)', value: sumTaxKhr, format: 'number' },
    ],
  };
};

export const runSeniorityIndemnity: ReportRunner = async (filters) => {
  const { rows: flat, note } = await loadMonthPayslips(filters.month);
  const monthNum = Number(filters.month.slice(5, 7));
  const byDept = groupByDepartment(flat);
  const rows: ReportRow[] = [...byDept.values()]
    .filter((b) => b.paidCount > 0)
    .map((b) => ({
      department: b.department,
      employeesPaid: b.paidCount,
      seniorityIndemnity: round2(b.indemnity),
    }))
    .sort((a, b) => String(a.department).localeCompare(String(b.department)));

  const tip =
    monthNum === 6 || monthNum === 12
      ? undefined
      : 'Seniority indemnity typically pays in June and December; other months may be empty.';

  const paidEmployees = flat.filter((r) => r.seniorityIndemnity > 0).length;
  const totalIndemnity = round2(flat.reduce((s, r) => s + r.seniorityIndemnity, 0));

  return {
    columns: [
      { key: 'department', label: 'Department' },
      { key: 'employeesPaid', label: 'Employees paid', align: 'right', format: 'number' },
      { key: 'seniorityIndemnity', label: 'Indemnity (USD)', align: 'right', format: 'currency' },
    ],
    rows,
    note: [note, tip].filter(Boolean).join(' '),
    summaryCards: [
      { key: 'paid', label: 'Employees paid', value: paidEmployees, format: 'number' },
      { key: 'indemnity', label: 'Total indemnity', value: totalIndemnity, format: 'currency' },
      { key: 'depts', label: 'Departments', value: rows.length, format: 'number' },
    ],
  };
};

/** Payroll cost by department — catalog title: Payroll. */
export const runPayrollByDepartment: ReportRunner = async (filters) => {
  const { rows: flat, note } = await loadMonthPayslips(
    filters.month,
    filters.departmentId || undefined
  );
  const byDept = groupByDepartment(flat);
  const rows: ReportRow[] = [...byDept.values()]
    .map((b) => {
      const deductions = round2(Math.max(0, b.gross - b.net));
      const totalPayrollCost = round2(b.gross + b.employerNssf);
      return {
        department: b.department,
        currentHeadcount: b.employees,
        grossSalary: round2(b.gross),
        totalAllowances: round2(b.allowances),
        totalDeductions: deductions,
        netPay: round2(b.net),
        totalPayrollCost,
      };
    })
    .sort((a, b) => String(a.department).localeCompare(String(b.department)));

  return {
    columns: [
      { key: 'department', label: 'Department' },
      { key: 'currentHeadcount', label: 'Current Headcount', align: 'right', format: 'number' },
      { key: 'grossSalary', label: 'Gross Salary', align: 'right', format: 'currency' },
      { key: 'totalAllowances', label: 'Total Allowances', align: 'right', format: 'currency' },
      { key: 'totalDeductions', label: 'Total Deductions', align: 'right', format: 'currency' },
      { key: 'netPay', label: 'Net Pay', align: 'right', format: 'currency' },
      {
        key: 'totalPayrollCost',
        label: 'Total Payroll Cost',
        align: 'right',
        format: 'currency',
      },
    ],
    rows,
    note: [note, 'Total Payroll Cost = gross + employer NSSF.'].filter(Boolean).join(' '),
    summaryCards: [
      { key: 'headcount', label: 'Headcount', value: flat.length, format: 'number' },
      {
        key: 'gross',
        label: 'Gross Salary',
        value: round2(flat.reduce((s, r) => s + r.grossSalary, 0)),
        format: 'currency',
      },
      {
        key: 'net',
        label: 'Net Pay',
        value: round2(flat.reduce((s, r) => s + r.netSalary, 0)),
        format: 'currency',
      },
    ],
  };
};

/**
 * Payroll & Rule — NSSF, tax, seniority, and salary movement combined by department.
 */
export const runPayrollAndRule: ReportRunner = async (filters) => {
  const monthKey = filters.month.slice(0, 7);
  const { rows: flat, note } = await loadMonthPayslips(
    monthKey,
    filters.departmentId || undefined
  );
  const byDept = groupByDepartment(flat);

  const { listHistoricalSalaryChanges } = await import(
    '../../payroll/historicalRecordsService.js'
  );
  const changes = await listHistoricalSalaryChanges(500);
  const monthStart = `${monthKey}-01`;
  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7));
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${monthKey}-${String(lastDay).padStart(2, '0')}`;

  const empPks = [...new Set(changes.map((c) => str(c.employeePk)).filter(Boolean))];
  const employees = empPks.length
    ? await Employee.findAll({
        where: { id: { [Op.in]: empPks } },
        attributes: ['id', 'department_id'],
      })
    : [];
  const empDept = new Map(employees.map((e) => [str(e.get('id')), str(e.get('department_id'))]));

  type SalMove = {
    employeesWithChange: number;
    totalAdjustment: number;
    pctSum: number;
    pctCount: number;
  };
  const salByDept = new Map<string, SalMove>();
  for (const c of changes) {
    const effective = str(c.effectiveFrom).slice(0, 10);
    if (!effective || effective < monthStart || effective > monthEnd) continue;
    const deptId = empDept.get(str(c.employeePk)) || '_none';
    if (filters.departmentId && deptId !== filters.departmentId) continue;
    const prev = num(c.previousBaseSalary);
    const next = num(c.baseSalary);
    const delta = next - prev;
    const pct = prev > 0 ? ((next - prev) / prev) * 100 : 0;
    const bucket = salByDept.get(deptId) || {
      employeesWithChange: 0,
      totalAdjustment: 0,
      pctSum: 0,
      pctCount: 0,
    };
    bucket.employeesWithChange += 1;
    bucket.totalAdjustment += delta;
    if (prev > 0) {
      bucket.pctSum += pct;
      bucket.pctCount += 1;
    }
    salByDept.set(deptId, bucket);
  }

  const rows: ReportRow[] = [...byDept.entries()].map(([deptId, b]) => {
    const sal = salByDept.get(deptId) || {
      employeesWithChange: 0,
      totalAdjustment: 0,
      pctSum: 0,
      pctCount: 0,
    };
    const taxableEmployees = flat.filter(
      (r) => (r.departmentId || '_none') === deptId && r.taxUsd > 0
    ).length;
    const nssfCovered = flat.filter(
      (r) =>
        (r.departmentId || '_none') === deptId &&
        (r.nssfEmployee > 0 || r.nssfEmployer > 0)
    ).length;
    return {
      payrollPeriod: monthKey,
      department: b.department,
      currentHeadcount: b.employees,
      employeesCovered: b.employees,
      taxableEmployees,
      eligibleEmployees: nssfCovered,
      grossTaxableSalary: round2(b.gross),
      employeeNssf: round2(b.employeeNssf),
      employerNssf: round2(b.employerNssf),
      totalNssf: round2(b.total),
      totalTaxAmount: round2(b.taxUsd),
      totalSeniorityPay: round2(b.indemnity),
      employeesWithSalaryChange: sal.employeesWithChange,
      totalSalaryAdjustment: round2(sal.totalAdjustment),
      averageSalaryIncreasePct:
        sal.pctCount > 0 ? Math.round((sal.pctSum / sal.pctCount) * 100) / 100 : 0,
      totalPayrollCost: round2(b.gross + b.employerNssf),
    };
  });

  rows.sort((a, b) => String(a.department).localeCompare(String(b.department)));

  return {
    columns: [
      { key: 'payrollPeriod', label: 'Payroll Period', aggregate: 'omit' },
      { key: 'department', label: 'Department' },
      { key: 'currentHeadcount', label: 'Current Headcount', align: 'right', format: 'number' },
      { key: 'employeesCovered', label: 'Employees Covered', align: 'right', format: 'number' },
      { key: 'taxableEmployees', label: 'Taxable Employees', align: 'right', format: 'number' },
      { key: 'eligibleEmployees', label: 'Eligible Employees', align: 'right', format: 'number' },
      {
        key: 'grossTaxableSalary',
        label: 'Gross Taxable Salary',
        align: 'right',
        format: 'currency',
      },
      {
        key: 'employeeNssf',
        label: 'Employee NSSF Contribution',
        align: 'right',
        format: 'currency',
      },
      {
        key: 'employerNssf',
        label: 'Employer NSSF Contribution',
        align: 'right',
        format: 'currency',
      },
      {
        key: 'totalNssf',
        label: 'Total NSSF Contribution',
        align: 'right',
        format: 'currency',
      },
      { key: 'totalTaxAmount', label: 'Total Tax Amount', align: 'right', format: 'currency' },
      {
        key: 'totalSeniorityPay',
        label: 'Total Seniority Pay',
        align: 'right',
        format: 'currency',
      },
      {
        key: 'employeesWithSalaryChange',
        label: 'Employees with Salary Change',
        align: 'right',
        format: 'number',
      },
      {
        key: 'totalSalaryAdjustment',
        label: 'Total Salary Adjustment',
        align: 'right',
        format: 'currency',
      },
      {
        key: 'averageSalaryIncreasePct',
        label: 'Average Salary Increase (%)',
        align: 'right',
        format: 'percent',
        aggregate: 'avg',
      },
      {
        key: 'totalPayrollCost',
        label: 'Total Payroll Cost',
        align: 'right',
        format: 'currency',
      },
    ] satisfies ReportColumn[],
    rows,
    note: [
      note,
      `Salary movement uses effective dates in ${monthStart} → ${monthEnd}. Eligible employees = NSSF contributors.`,
    ]
      .filter(Boolean)
      .join(' '),
    summaryCards: [
      { key: 'period', label: 'Payroll Period', value: monthKey },
      { key: 'employees', label: 'Employees Covered', value: flat.length, format: 'number' },
      {
        key: 'nssf',
        label: 'Total NSSF',
        value: round2(flat.reduce((s, r) => s + r.nssfEmployee + r.nssfEmployer, 0)),
        format: 'currency',
      },
      {
        key: 'tax',
        label: 'Total Tax',
        value: round2(flat.reduce((s, r) => s + r.taxUsd, 0)),
        format: 'currency',
      },
    ],
  };
};

/**
 * Payslip-level government remittance: employee NSSF + employer NSSF + GDT tax (ToS)
 * the company must pay for the preferred payroll run of the month.
 */
export const runGovernmentRemittance: ReportRunner = async (filters) => {
  const { rows: flat, note } = await loadMonthPayslips(
    filters.month,
    filters.departmentId || undefined
  );

  const rows: ReportRow[] = flat
    .map((r) => {
      const nssfTotal = round2(r.nssfEmployee + r.nssfEmployer);
      const remittanceTotal = round2(nssfTotal + r.taxUsd);
      return {
        employeeId: r.employeeId,
        name: r.name,
        department: r.department,
        nssfId: r.nssfId || '—',
        taxId: r.taxId || '—',
        gross: r.grossSalary,
        nssfEmployee: r.nssfEmployee,
        nssfEmployer: r.nssfEmployer,
        nssfTotal,
        nssfEmployeeKhr: Math.round(r.nssfEmployeeKhr),
        nssfEmployerKhr: Math.round(r.nssfEmployerKhr),
        taxUsd: r.taxUsd,
        taxKhr: Math.round(r.taxKhr),
        remittanceTotal,
      };
    })
    .sort((a, b) => {
      const dept = String(a.department).localeCompare(String(b.department));
      if (dept !== 0) return dept;
      return String(a.name).localeCompare(String(b.name));
    });

  const sumEe = round2(flat.reduce((s, r) => s + r.nssfEmployee, 0));
  const sumEr = round2(flat.reduce((s, r) => s + r.nssfEmployer, 0));
  const sumTax = round2(flat.reduce((s, r) => s + r.taxUsd, 0));
  const sumRemit = round2(sumEe + sumEr + sumTax);

  return {
    columns: [
      { key: 'employeeId', label: 'Employee ID', aggregate: 'omit' },
      { key: 'name', label: 'Employee', aggregate: 'omit' },
      { key: 'department', label: 'Department', aggregate: 'omit' },
      { key: 'nssfId', label: 'NSSF ID', aggregate: 'omit' },
      { key: 'taxId', label: 'Tax ID', aggregate: 'omit' },
      { key: 'gross', label: 'Gross', align: 'right', format: 'currency' },
      { key: 'nssfEmployee', label: 'NSSF (employee)', align: 'right', format: 'currency' },
      { key: 'nssfEmployer', label: 'NSSF (employer)', align: 'right', format: 'currency' },
      { key: 'nssfTotal', label: 'NSSF total', align: 'right', format: 'currency' },
      {
        key: 'nssfEmployeeKhr',
        label: 'NSSF ee (KHR)',
        align: 'right',
        format: 'number',
      },
      {
        key: 'nssfEmployerKhr',
        label: 'NSSF er (KHR)',
        align: 'right',
        format: 'number',
      },
      { key: 'taxUsd', label: 'Tax ToS (USD)', align: 'right', format: 'currency' },
      { key: 'taxKhr', label: 'Tax (KHR)', align: 'right', format: 'number' },
      {
        key: 'remittanceTotal',
        label: 'Total remittance',
        align: 'right',
        format: 'currency',
      },
    ] satisfies ReportColumn[],
    rows,
    note: [
      note,
      'Amounts the company remits to NSSF and GDT: employee NSSF (withheld) + employer NSSF (company cost) + tax on salary (ToS).',
    ]
      .filter(Boolean)
      .join(' '),
    summaryCards: [
      { key: 'payslips', label: 'Payslips', value: flat.length, format: 'number' },
      { key: 'eeNssf', label: 'Employee NSSF', value: sumEe, format: 'currency' },
      { key: 'erNssf', label: 'Employer NSSF', value: sumEr, format: 'currency' },
      { key: 'tax', label: 'Tax (ToS)', value: sumTax, format: 'currency' },
      { key: 'remit', label: 'Total remittance', value: sumRemit, format: 'currency' },
    ],
  };
};
