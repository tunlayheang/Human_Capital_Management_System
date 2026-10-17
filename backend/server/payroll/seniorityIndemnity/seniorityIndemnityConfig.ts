import type { PayrollComplianceRuleConfig } from '../../payrollComplianceRuleService.js';
import type {
  Pre2019BackPayConfig,
  SeniorityIndemnityConfig,
  SeniorityIndemnityDailyRateMethod,
  SeniorityIndemnityInclusionRule,
  SeniorityIndemnityResignationPolicy,
  SeniorityIndemnitySalaryComponent,
  SeniorityIndemnityWorkingDaysDivisor,
} from './seniorityIndemnityTypes.js';

const DEFAULT_SALARY_BASIS: SeniorityIndemnitySalaryComponent[] = [
  'base_salary',
  'fixed_allowance',
  'position_allowance',
  'commission',
];

const DEFAULT_ELIGIBLE_CONTRACTS = ['UDC'];
const DEFAULT_EXCLUDED_EMPLOYMENT = ['Intern', 'Consultant', 'Freelancer'];

const DEFAULT_PRE2019: Pre2019BackPayConfig = {
  enabled: true,
  capDays: 156,
  capMonths: 6,
  sectorKey: 'other',
  schedule: [],
};

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean);
    } catch {
      return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return fallback;
}

function parseSalaryBasis(value: unknown): SeniorityIndemnitySalaryComponent[] {
  const allowed = new Set<SeniorityIndemnitySalaryComponent>([
    'base_salary',
    'position_allowance',
    'responsibility_allowance',
    'fixed_allowance',
    'commission',
    'other_recurring',
  ]);
  const raw = parseStringArray(value, DEFAULT_SALARY_BASIS);
  const filtered = raw.filter((v) => allowed.has(v as SeniorityIndemnitySalaryComponent));
  return filtered.length ? (filtered as SeniorityIndemnitySalaryComponent[]) : DEFAULT_SALARY_BASIS;
}

function parseWorkingDaysDivisor(value: unknown): SeniorityIndemnityWorkingDaysDivisor {
  const n = Math.floor(num(value, 26));
  if (n === 22 || n === 24 || n === 26) return n;
  return 26;
}

function parsePre2019BackPay(raw: unknown): Pre2019BackPayConfig {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const scheduleRaw = Array.isArray(o.schedule) ? o.schedule : [];
  const schedule = scheduleRaw
    .map((row) => {
      const r = row as Record<string, unknown>;
      return { year: Math.floor(num(r.year, 0)), days: num(r.days, 0) };
    })
    .filter((e) => e.year > 0 && e.days > 0);
  const sector = String(o.sectorKey ?? 'other').toLowerCase();
  return {
    enabled: o.enabled !== false && o.enabled !== 'false' && o.enabled !== 0,
    capDays: num(o.capDays, DEFAULT_PRE2019.capDays),
    capMonths: Math.max(1, Math.floor(num(o.capMonths, DEFAULT_PRE2019.capMonths))),
    sectorKey: sector === 'textile_garment_footwear' ? 'textile_garment_footwear' : 'other',
    schedule,
  };
}

export const DEFAULT_SENIORITY_INDEMNITY_CONFIG: SeniorityIndemnityConfig = {
  enabled: true,
  daysPerYear: 15,
  payoutJuneDays: 7.5,
  payoutDecemberDays: 7.5,
  dailyRateMethod: 'scheduled_26',
  workingDaysDivisor: 26,
  salaryBasis: DEFAULT_SALARY_BASIS,
  eligibleContractTypes: DEFAULT_ELIGIBLE_CONTRACTS,
  excludedEmploymentTypes: DEFAULT_EXCLUDED_EMPLOYMENT,
  inclusionRule: 'after_probation',
  inclusionMonths: 0,
  semesterMinDaysForFullMonth: 21,
  terminationPartialSemesterDays: 7,
  resignationIndemnityPolicy: 'none',
  pre2019BackPay: DEFAULT_PRE2019,
  fdcSeveranceRuleEnabled: true,
};

export function parseSeniorityIndemnityConfig(
  raw: PayrollComplianceRuleConfig | Record<string, unknown> | null | undefined
): SeniorityIndemnityConfig {
  const cfg = raw ?? {};
  const inclusionRuleRaw = String(cfg.inclusionRule ?? 'after_probation').toLowerCase();
  const inclusionRule: SeniorityIndemnityInclusionRule =
    inclusionRuleRaw === 'after_months' ? 'after_months' : 'after_probation';

  const rateMethodRaw = String(cfg.dailyRateMethod ?? 'scheduled_26').toLowerCase();
  const dailyRateMethod: SeniorityIndemnityDailyRateMethod =
    rateMethodRaw === 'actual_working_days' ? 'actual_working_days' : 'scheduled_26';

  const resignationRaw = String(cfg.resignationIndemnityPolicy ?? 'none').toLowerCase();
  const resignationIndemnityPolicy: SeniorityIndemnityResignationPolicy =
    resignationRaw === 'employer_parity' ? 'employer_parity' : 'none';

  const workingDaysDivisor = parseWorkingDaysDivisor(
    cfg.workingDaysDivisor ??
      (dailyRateMethod === 'scheduled_26' ? 26 : cfg.scheduledWorkingDays ?? 26)
  );

  return {
    enabled: cfg.enabled !== false && cfg.enabled !== 'false' && cfg.enabled !== 0,
    daysPerYear: num(cfg.daysPerYear, DEFAULT_SENIORITY_INDEMNITY_CONFIG.daysPerYear),
    payoutJuneDays: num(cfg.payoutJuneDays, DEFAULT_SENIORITY_INDEMNITY_CONFIG.payoutJuneDays),
    payoutDecemberDays: num(
      cfg.payoutDecemberDays,
      DEFAULT_SENIORITY_INDEMNITY_CONFIG.payoutDecemberDays
    ),
    dailyRateMethod,
    workingDaysDivisor,
    salaryBasis: parseSalaryBasis(cfg.salaryBasis),
    eligibleContractTypes: parseStringArray(
      cfg.eligibleContractTypes,
      DEFAULT_SENIORITY_INDEMNITY_CONFIG.eligibleContractTypes
    ),
    excludedEmploymentTypes: parseStringArray(
      cfg.excludedEmploymentTypes,
      DEFAULT_SENIORITY_INDEMNITY_CONFIG.excludedEmploymentTypes
    ),
    inclusionRule,
    inclusionMonths: Math.max(0, Math.floor(num(cfg.inclusionMonths, 0))),
    semesterMinDaysForFullMonth: Math.max(
      1,
      Math.floor(num(cfg.semesterMinDaysForFullMonth, 21))
    ),
    terminationPartialSemesterDays: num(
      cfg.terminationPartialSemesterDays,
      DEFAULT_SENIORITY_INDEMNITY_CONFIG.terminationPartialSemesterDays
    ),
    resignationIndemnityPolicy,
    pre2019BackPay: parsePre2019BackPay(cfg.pre2019BackPay),
    fdcSeveranceRuleEnabled: cfg.fdcSeveranceRuleEnabled !== false,
  };
}

/** Map UI / HR labels (Permanent, Fixed-Term, …) onto UDC / FDC for Art. 89 eligibility. */
export function normalizeContractTypeToken(raw: string): string {
  const t = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!t) return '';
  if (
    t === 'UDC' ||
    t === 'UNDETERMINED' ||
    t === 'UNLIMITED' ||
    t === 'PERMANENT' ||
    t.includes('PERMANENT')
  ) {
    return 'UDC';
  }
  if (
    t === 'FDC' ||
    t === 'CONTRACT' ||
    t === 'TEMPORARY' ||
    t === 'FIXED TERM' ||
    t === 'FIXED TERM CONTRACT' ||
    t.includes('FIXED TERM')
  ) {
    return 'FDC';
  }
  return t;
}

export function inferContractTypeFromEmployment(
  contractType: string | null | undefined,
  employmentType: string | null | undefined
): string {
  const fromContract = normalizeContractTypeToken(String(contractType ?? ''));
  if (fromContract === 'UDC' || fromContract === 'FDC') return fromContract;

  const emp = String(employmentType ?? '').trim();
  const fromEmp = normalizeContractTypeToken(emp);
  if (fromEmp === 'UDC' || fromEmp === 'FDC') return fromEmp;

  if (emp === 'Contract' || emp === 'Intern' || emp === 'Consultant' || emp === 'Freelancer') {
    return 'FDC';
  }
  if (emp === 'Full-Time' || emp === 'Part-Time') return 'UDC';
  return 'UDC';
}
