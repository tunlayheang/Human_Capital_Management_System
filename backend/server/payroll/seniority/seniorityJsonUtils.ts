import type {
  SeniorityAccrualConfig,
  SeniorityAccrualType,
  SeniorityApplicableGroups,
  SeniorityEligibilityRules,
  SeniorityProrationRules,
} from './seniorityTypes.js';

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Detect JSON stored as character-index object (double-encoding bug). */
function isCharIndexedCorruption(value: Record<string, unknown>): boolean {
  return '0' in value && '1' in value && typeof value['0'] === 'string';
}

function reconstructFromCharIndexed(value: Record<string, unknown>): unknown {
  const keys = Object.keys(value)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b));
  if (!keys.length) return null;
  const raw = keys.map((k) => String(value[k])).join('');
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Parse JSON column values from Sequelize / MySQL into plain objects. */
export function parseJsonColumn<T extends Record<string, unknown>>(
  value: unknown,
  fallback: T
): T {
  if (value == null || value === '') return fallback;

  if (typeof value === 'string') {
    try {
      return parseJsonColumn(JSON.parse(value), fallback);
    } catch {
      return fallback;
    }
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (isCharIndexedCorruption(obj)) {
      const reconstructed = reconstructFromCharIndexed(obj);
      if (reconstructed && typeof reconstructed === 'object' && !Array.isArray(reconstructed)) {
        return reconstructed as T;
      }
      // Preserve scalar fields that survived corruption (e.g. percent: 100)
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (!/^\d+$/.test(k)) clean[k] = v;
      }
      return (Object.keys(clean).length ? clean : fallback) as T;
    }
    return obj as T;
  }

  return fallback;
}

export function buildAccrualConfigForType(
  accrualType: SeniorityAccrualType,
  raw: unknown
): SeniorityAccrualConfig {
  const cfg = parseJsonColumn<SeniorityAccrualConfig>(raw, {});

  switch (accrualType) {
    case 'fixed_monthly':
      return { amountUsd: num(cfg.amountUsd) };
    case 'percent_salary':
      return { percent: num(cfg.percent) };
    case 'service_tiers': {
      const tiers = Array.isArray(cfg.tiers) ? cfg.tiers : [];
      return {
        tiers: tiers.map((t) => {
          const row = t as Record<string, unknown>;
          return {
            yearsMin: num(row.yearsMin ?? row.years_min),
            yearsMax: num(row.yearsMax ?? row.years_max, 99),
            amountUsd: num(row.amountUsd ?? row.amount_usd),
          };
        }),
      };
    }
    case 'hybrid':
      return {
        baseAmountUsd: num(cfg.baseAmountUsd),
        serviceMultiplierPerYear: num(cfg.serviceMultiplierPerYear),
        maxMultiplier: num(cfg.maxMultiplier, 99),
      };
    default:
      return cfg;
  }
}

export function normalizeEligibilityRules(raw: unknown): SeniorityEligibilityRules {
  return parseJsonColumn<SeniorityEligibilityRules>(raw, {
    employeeStatuses: ['active'],
    excludeProbation: true,
    minWorkingDaysInMonth: 0,
  });
}

export function normalizeProrationRules(raw: unknown): SeniorityProrationRules {
  return parseJsonColumn<SeniorityProrationRules>(raw, {
    enabled: true,
    basis: 'eligible_payroll_days',
  });
}

export function normalizeApplicableGroups(raw: unknown): SeniorityApplicableGroups {
  return parseJsonColumn<SeniorityApplicableGroups>(raw, { allEmployees: true });
}

export function jsonFieldsNeedRepair(
  accrualType: SeniorityAccrualType,
  plain: Record<string, unknown>
): boolean {
  const check = (value: unknown) => {
    if (typeof value === 'string') return true;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return isCharIndexedCorruption(value as Record<string, unknown>);
    }
    return false;
  };

  if (check(plain.accrual_config) || check(plain.eligibility_rules)) return true;

  if (accrualType === 'percent_salary') {
    const cfg = parseJsonColumn<SeniorityAccrualConfig>(plain.accrual_config, {});
    if (Array.isArray(cfg.tiers) && cfg.tiers.length > 0) return true;
  }
  if (accrualType === 'fixed_monthly') {
    const cfg = parseJsonColumn<SeniorityAccrualConfig>(plain.accrual_config, {});
    if (Array.isArray(cfg.tiers) && cfg.tiers.length > 0) return true;
  }

  return false;
}
