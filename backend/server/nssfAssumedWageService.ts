import { NssfAssumedWageBracket, sequelize } from './db.js';
import {
  NSSF_ASSUMED_WAGE_BRACKETS,
  type NssfWageBracket,
  resolveAssumedWageKhr as resolveFromBrackets,
} from './nssfAssumedWage.js';

export type PayrollNssfWageBracketApiRow = {
  level: number;
  wageMinKhr: number;
  wageMaxKhr: number | null;
  assumedWageKhr: number;
  range: string;
};

export function formatNssfWageRange(wageMinKhr: number, wageMaxKhr: number | null): string {
  if (wageMaxKhr == null) {
    return `${wageMinKhr.toLocaleString()} Up`;
  }
  if (wageMinKhr <= 0) {
    return `Below ${wageMaxKhr.toLocaleString()}`;
  }
  return `${wageMinKhr.toLocaleString()} - ${wageMaxKhr.toLocaleString()}`;
}

export function nssfBracketsToPayrollApi(brackets: NssfWageBracket[]): PayrollNssfWageBracketApiRow[] {
  return [...brackets]
    .sort((a, b) => a.level - b.level)
    .map((b) => ({
      level: b.level,
      wageMinKhr: b.wageMinKhr,
      wageMaxKhr: b.wageMaxKhr,
      assumedWageKhr: b.assumedWageKhr,
      range: formatNssfWageRange(b.wageMinKhr, b.wageMaxKhr),
    }));
}

export function apiRowsToNssfBrackets(rows: PayrollNssfWageBracketApiRow[]): NssfWageBracket[] {
  return rows.map((r) => ({
    level: Number(r.level),
    wageMinKhr: Number(r.wageMinKhr),
    wageMaxKhr: r.wageMaxKhr == null || r.wageMaxKhr >= 9_999_999_999 ? null : Number(r.wageMaxKhr),
    assumedWageKhr: Number(r.assumedWageKhr),
  }));
}

function rowToBracket(row: Record<string, unknown>): NssfWageBracket {
  return {
    level: Number(row.level),
    wageMinKhr: Number(row.wageMinKhr),
    wageMaxKhr: row.wageMaxKhr == null ? null : Number(row.wageMaxKhr),
    assumedWageKhr: Number(row.assumedWageKhr),
  };
}

export const DEFAULT_NSSF_ASSUMED_WAGE_BRACKETS: NssfWageBracket[] = NSSF_ASSUMED_WAGE_BRACKETS;

const nssfCacheByMonth = new Map<string, NssfWageBracket[]>();

async function loadLegacyNssfBracketsFromDb(): Promise<NssfWageBracket[]> {
  const rows = await NssfAssumedWageBracket.findAll({
    where: { isActive: true },
    order: [['sortOrder', 'ASC'], ['level', 'ASC']],
  });
  if (rows.length === 0) return [...DEFAULT_NSSF_ASSUMED_WAGE_BRACKETS];
  return rows.map((r) => rowToBracket(r.get({ plain: true }) as Record<string, unknown>));
}

export type NssfWagePolicySnapshot = {
  brackets: PayrollNssfWageBracketApiRow[];
  effectiveFrom: string | null;
  scheduledEffectiveFrom: string | null;
  lastUpdatedAt: string | null;
  lastUpdatedBy: string | null;
};

export async function refreshNssfAssumedWageCache(month?: string): Promise<NssfWageBracket[]> {
  const monthKey = (month ?? new Date().toISOString().slice(0, 7)).slice(0, 7);
  const brackets = await resolveNssfBracketsForMonth(monthKey);
  nssfCacheByMonth.set(monthKey, brackets);
  return brackets;
}

async function resolveNssfBracketsForMonth(month: string): Promise<NssfWageBracket[]> {
  const { ensureInitialPayrollPolicyVersions } = await import(
    './payroll/payrollPolicyVersionBootstrap.js'
  );
  const { resolvePolicyPayloadForMonth } = await import('./payroll/payrollPolicyVersionService.js');
  await ensureInitialPayrollPolicyVersions();

  const resolved = await resolvePolicyPayloadForMonth<{ brackets: PayrollNssfWageBracketApiRow[] }>(
    {
      policyType: 'nssf_wage_table',
      month,
    }
  );
  if (resolved?.payload?.brackets?.length) {
    return apiRowsToNssfBrackets(resolved.payload.brackets);
  }
  return loadLegacyNssfBracketsFromDb();
}

export async function getNssfAssumedWageBrackets(month?: string): Promise<NssfWageBracket[]> {
  const monthKey = (month ?? new Date().toISOString().slice(0, 7)).slice(0, 7);
  const hit = nssfCacheByMonth.get(monthKey);
  if (hit) return hit;
  return refreshNssfAssumedWageCache(monthKey);
}

export function resolveAssumedWageKhrForPayroll(
  monthlyWageKhr: number,
  brackets?: NssfWageBracket[]
): number {
  return resolveFromBrackets(monthlyWageKhr, brackets ?? DEFAULT_NSSF_ASSUMED_WAGE_BRACKETS);
}

export async function listNssfAssumedWageBracketsApi(month?: string): Promise<NssfWagePolicySnapshot> {
  const monthKey = (month ?? new Date().toISOString().slice(0, 7)).slice(0, 7);
  const { ensureInitialPayrollPolicyVersions } = await import(
    './payroll/payrollPolicyVersionBootstrap.js'
  );
  const { resolvePolicyPayloadForMonth, getPolicyVersionDisplayMeta } = await import(
    './payroll/payrollPolicyVersionService.js'
  );
  await ensureInitialPayrollPolicyVersions();

  const resolved = await resolvePolicyPayloadForMonth<{ brackets: PayrollNssfWageBracketApiRow[] }>(
    {
      policyType: 'nssf_wage_table',
      month: monthKey,
    }
  );
  const meta = await getPolicyVersionDisplayMeta({ policyType: 'nssf_wage_table', month: monthKey });
  const brackets = resolved?.payload?.brackets?.length
    ? resolved.payload.brackets
    : nssfBracketsToPayrollApi(await loadLegacyNssfBracketsFromDb());

  return {
    brackets,
    effectiveFrom: meta.effectiveFrom,
    scheduledEffectiveFrom: meta.scheduledEffectiveFrom,
    lastUpdatedAt: meta.lastUpdatedAt,
    lastUpdatedBy: meta.lastUpdatedBy,
  };
}

export async function saveNssfAssumedWageBrackets(
  rows: PayrollNssfWageBracketApiRow[],
  effectiveFrom: string,
  createdBy?: string | null
): Promise<NssfWagePolicySnapshot> {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('At least one NSSF wage bracket is required');
  }

  const brackets = apiRowsToNssfBrackets(rows).sort((a, b) => a.level - b.level);
  const apiRows = nssfBracketsToPayrollApi(brackets);
  const { createPolicyVersion, parseEffectiveFrom } = await import(
    './payroll/payrollPolicyVersionService.js'
  );
  const effective_from = parseEffectiveFrom(effectiveFrom);
  nssfCacheByMonth.clear();

  await createPolicyVersion({
    policyType: 'nssf_wage_table',
    effectiveFrom: effective_from,
    payload: { brackets: apiRows },
    notes: 'NSSF assumed wage table update',
    createdBy: createdBy ?? null,
  });

  return listNssfAssumedWageBracketsApi(effective_from.slice(0, 7));
}

export async function ensureNssfAssumedWageBracketSchema(): Promise<void> {
  await NssfAssumedWageBracket.sync();

  const count = await NssfAssumedWageBracket.count();
  if (count === 0) {
    await NssfAssumedWageBracket.bulkCreate(
      DEFAULT_NSSF_ASSUMED_WAGE_BRACKETS.map((b, index) => ({
        id: `nssf-wb-${b.level}`,
        level: b.level,
        wageMinKhr: b.wageMinKhr,
        wageMaxKhr: b.wageMaxKhr,
        assumedWageKhr: b.assumedWageKhr,
        sortOrder: index + 1,
        isActive: true,
      }))
    );
    console.log('[db] Seeded nssfassumedwagebrackets (22 levels).');
  }

  await refreshNssfAssumedWageCache();
}
