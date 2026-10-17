import type { ReportCategory, ReportDefinition } from './reportTypes.js';
import { startOfYear, todayYmd } from '../dashboardDateRange.js';
import { currentMonthKey } from './reportFilterUtils.js';

/** Reports Module Structure — two top-level groups. */
const CAT: Record<ReportCategory, string> = {
  workforce: 'Workforce Reports',
  attendance: 'Workforce Reports',
  leave_ot: 'Workforce Reports',
  payroll: 'Workforce Reports',
  hr_risk: 'Workforce Reports',
  performance: 'Workforce Reports',
  org_kpis: 'Workforce Reports',
  forecasts: 'Forecast & Planning Reports',
};

function dateRangeFilters(required = true) {
  return [
    {
      key: 'startDate',
      label: 'From',
      type: 'date' as const,
      required,
      defaultValue: startOfYear(),
    },
    {
      key: 'endDate',
      label: 'To',
      type: 'date' as const,
      required,
      defaultValue: todayYmd(),
    },
  ];
}

function deptFilter() {
  return {
    key: 'departmentId',
    label: 'Department',
    type: 'department' as const,
  };
}

function monthFilter() {
  return {
    key: 'month',
    label: 'Payroll month',
    type: 'month' as const,
    required: true,
    defaultValue: currentMonthKey(),
  };
}

function horizonFilter() {
  return {
    key: 'horizonMonths',
    label: 'Forecast horizon',
    type: 'select' as const,
    options: [
      { value: '3', label: '3 months' },
      { value: '6', label: '6 months' },
    ],
    defaultValue: '3',
  };
}

/**
 * Reports Module Structure catalog.
 * List dumps that mirror Employees / Attendance / Leaves / OT / Payroll UIs stay excluded.
 */
export const REPORT_CATALOG: ReportDefinition[] = [
  // —— Workforce Reports ——
  {
    id: 'headcount-summary',
    title: 'Department',
    description:
      'Department-level staffing: department, positions, manager, and total staff.',
    category: 'workforce',
    categoryLabel: CAT.workforce,
    filters: [deptFilter()],
  },
  {
    id: 'attrition-by-department',
    title: 'Leaving by Department',
    description:
      'Department attendance snapshot — headcount, present, absent, late, early leave, on leave, and attendance rate.',
    category: 'workforce',
    categoryLabel: CAT.workforce,
    filters: [...dateRangeFilters(), deptFilter()],
  },
  {
    id: 'workforce-composition',
    title: 'Workforce composition',
    description:
      'Active workforce mix by contract, employment type, and tenure band — with average base salary.',
    category: 'workforce',
    categoryLabel: CAT.workforce,
    filters: [deptFilter()],
  },
  {
    id: 'leave-utilization',
    title: 'Leave',
    description:
      'Leave usage by department: headcount, employees on leave, one column per active Leave Type (auto-updates when types are added), and leave rate.',
    category: 'workforce',
    categoryLabel: CAT.workforce,
    filters: [...dateRangeFilters(), deptFilter()],
  },
  {
    id: 'ot-by-department',
    title: 'OT',
    description:
      'Overtime by department: headcount, employees with OT, total and average hours, and estimated OT cost.',
    category: 'workforce',
    categoryLabel: CAT.workforce,
    filters: [...dateRangeFilters(), deptFilter()],
  },
  {
    id: 'payroll-by-department',
    title: 'Payroll',
    description:
      'Payroll cost by department for the selected month — gross, allowances, deductions, net, and total payroll cost.',
    category: 'workforce',
    categoryLabel: CAT.workforce,
    filters: [monthFilter(), deptFilter()],
  },
  {
    id: 'payroll-and-rule',
    title: 'Payroll & Rule',
    description:
      'Combined payroll compliance view: NSSF, tax, seniority, and salary movement by department for the payroll period.',
    category: 'workforce',
    categoryLabel: CAT.workforce,
    filters: [monthFilter(), deptFilter()],
  },
  {
    id: 'nssf-contributions',
    title: 'NSSF Contribution Report',
    description:
      'Employee and employer NSSF amounts for government filing — NSSF ID, USD and KHR totals from the payroll month.',
    category: 'workforce',
    categoryLabel: CAT.workforce,
    filters: [monthFilter(), deptFilter()],
  },
  {
    id: 'tax-withholding',
    title: 'Tax Withholding Report',
    description:
      'Tax on salary (ToS) withheld for GDT filing — Tax ID, gross, and tax in USD and KHR for the payroll month.',
    category: 'workforce',
    categoryLabel: CAT.workforce,
    filters: [monthFilter(), deptFilter()],
  },
  {
    id: 'abandonment-absence-alerts',
    title: 'Absence Risk Report',
    description:
      'Absence risk by department — cases, days, rate, risk level, and action status for the report period.',
    category: 'workforce',
    categoryLabel: CAT.workforce,
    filters: dateRangeFilters(false),
  },
  {
    id: 'org-monthly-kpis',
    title: 'Monthly Workforce KPI',
    description:
      'Monthly workforce KPIs: headcount, hires, separations, turnover, attendance, leave, OT, payroll cost, and HR risk.',
    category: 'workforce',
    categoryLabel: CAT.workforce,
    filters: dateRangeFilters(),
  },

  // —— Forecast & Planning Reports ——
  {
    id: 'headcount-outlook',
    title: 'Headcount Forecast',
    description:
      'Forecast headcount from planned hires and separations, growth rate, open positions, workforce gap, and risk.',
    category: 'forecasts',
    categoryLabel: CAT.forecasts,
    filters: [...dateRangeFilters(), deptFilter(), horizonFilter()],
  },
  {
    id: 'payroll-cost-outlook',
    title: 'Payroll Cost Forecast Report',
    description:
      'Forecast payroll and labor cost drivers — growth, new hire cost, increments, allowances, bonus, OT, and cost risk.',
    category: 'forecasts',
    categoryLabel: CAT.forecasts,
    filters: [horizonFilter()],
  },
  {
    id: 'ot-cost-outlook',
    title: 'Overtime Cost Forecast',
    description:
      'Department OT hours and cost forecast with growth rate, reasons, recommended action, and OT risk level.',
    category: 'forecasts',
    categoryLabel: CAT.forecasts,
    filters: [...dateRangeFilters(), deptFilter(), horizonFilter()],
  },
  {
    id: 'attendance-risk-outlook',
    title: 'Attendance Risk Forecast',
    description:
      'Department attendance forecast — forecast rate, absence and late trends, leave utilization, and recommended action.',
    category: 'forecasts',
    categoryLabel: CAT.forecasts,
    filters: [
      ...dateRangeFilters(),
      deptFilter(),
      horizonFilter(),
      {
        key: 'thresholdPct',
        label: 'Threshold %',
        type: 'select',
        options: [
          { value: '85', label: '85%' },
          { value: '90', label: '90%' },
          { value: '95', label: '95%' },
        ],
        defaultValue: '90',
      },
    ],
  },
];

export function getReportDefinition(id: string): ReportDefinition | undefined {
  return REPORT_CATALOG.find((r) => r.id === id);
}

export function listReportCatalog(): ReportDefinition[] {
  return REPORT_CATALOG;
}
