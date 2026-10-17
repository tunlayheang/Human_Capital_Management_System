import type {
  SeniorityAccrualConfig,
  SeniorityAccrualType,
  SeniorityServiceTier,
} from './seniorityTypes.js';

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function roundUsd(v: number): number {
  return Math.round(v * 100) / 100;
}

export function serviceYearsFromJoin(joinDate: string | Date | null | undefined, asOf = Date.now()): number {
  if (!joinDate) return 0;
  const d = new Date(joinDate);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, (asOf - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

export function serviceDaysFromJoin(joinDate: string | Date | null | undefined, asOf = Date.now()): number {
  if (!joinDate) return 0;
  const d = new Date(joinDate);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((asOf - d.getTime()) / (24 * 60 * 60 * 1000)));
}

function normalizeTier(raw: unknown): SeniorityServiceTier | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const yearsMin = num(t.yearsMin ?? t.years_min);
  const yearsMax = num(t.yearsMax ?? t.years_max, 99);
  const amountUsd = num(t.amountUsd ?? t.amount_usd);
  if (!Number.isFinite(yearsMin) || !Number.isFinite(yearsMax)) return null;
  return { yearsMin, yearsMax, amountUsd };
}

/**
 * Highest tier where years of service >= yearsMin (supports "5+ years" style bands).
 * Falls back to inclusive [min, max] when no min-only match (legacy rows).
 */
function pickTier(tiers: SeniorityServiceTier[], years: number): number {
  const normalized = tiers
    .map(normalizeTier)
    .filter((t): t is SeniorityServiceTier => t != null)
    .sort((a, b) => num(b.yearsMin) - num(a.yearsMin));

  for (const t of normalized) {
    const min = num(t.yearsMin);
    const max = num(t.yearsMax, 99);
    if (years >= min && (max >= min ? years <= max : true)) {
      return num(t.amountUsd);
    }
  }
  return 0;
}

/** Full-month accrual before employment-window proration. */
export function computeFullMonthSeniorityAccrual(params: {
  accrualType: SeniorityAccrualType;
  accrualConfig: SeniorityAccrualConfig;
  baseSalary: number;
  serviceYears: number;
}): number {
  const cfg = params.accrualConfig ?? {};
  const base = Math.max(0, params.baseSalary);

  switch (params.accrualType) {
    case 'fixed_monthly':
      return roundUsd(num(cfg.amountUsd));
    case 'percent_salary':
      return roundUsd((base * num(cfg.percent)) / 100);
    case 'service_tiers': {
      const rawTiers = Array.isArray(cfg.tiers) ? cfg.tiers : [];
      return roundUsd(pickTier(rawTiers, params.serviceYears));
    }
    case 'hybrid': {
      const baseAmt = num(cfg.baseAmountUsd);
      const mult = Math.min(
        num(cfg.maxMultiplier, 99),
        1 + params.serviceYears * num(cfg.serviceMultiplierPerYear, 0)
      );
      return roundUsd(baseAmt * mult);
    }
    default:
      return 0;
  }
}

export function applySeniorityProration(params: {
  fullMonthAccrualUsd: number;
  prorationEnabled: boolean;
  eligiblePayrollDays: number;
  totalPayrollDays: number;
}): { proratedUsd: number; factor: number } {
  const full = Math.max(0, params.fullMonthAccrualUsd);
  const total = Math.max(1, Math.floor(params.totalPayrollDays));
  const eligible = Math.max(0, Math.min(Math.floor(params.eligiblePayrollDays), total));

  if (!params.prorationEnabled) {
    return { proratedUsd: full, factor: 1 };
  }

  const factor = Math.round((eligible / total) * 10000) / 10000;
  return { proratedUsd: roundUsd(full * factor), factor };
}
