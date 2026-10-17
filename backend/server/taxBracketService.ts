import { SystemSetting, TaxBracket, sequelize } from './db.js';

const LEGACY_PAYROLL_TAX_BRACKETS_KEY = 'payroll.taxBrackets.usd';
import {
  GDT_TAX_BRACKETS_KHR,
  gdtBracketsToUsd,
  khrBracketRangeLabel,
  type SalaryTaxBracketKhr,
  type SalaryTaxBracketUsd,
} from './cambodiaSalaryTax.js';
import { sanitizeTaxBracketApiRows } from './payroll/taxBracketSanitize.js';
import { usdToKhr } from './usdToKhr.js';

const DEFAULT_EXCHANGE_RATE = 4100;

function usdRowToDb(
  row: SalaryTaxBracketUsd,
  id: string
): {
  id: string;
  minIncome: number;
  maxIncome: number | null;
  rate: number;
  baseTax: number;
  currency: string;
  isActive: boolean;
} {
  return {
    id,
    minIncome: row.min,
    maxIncome: row.max >= 9_999_999 ? null : row.max,
    rate: row.rate,
    baseTax: row.deduction,
    currency: 'USD',
    isActive: true,
  };
}

const GDT_USD_AT_4100 = gdtBracketsToUsd(DEFAULT_EXCHANGE_RATE);

/** GDT monthly ToS brackets (USD @ 4,100 KHR/USD) — matches cambodiaSalaryTax. */
export const DEFAULT_TAX_BRACKETS_USD = [
  {
    id: 'tb-1',
    minIncome: GDT_USD_AT_4100[0].min,
    maxIncome: GDT_USD_AT_4100[0].max >= 9_999_999 ? GDT_USD_AT_4100[0].max : GDT_USD_AT_4100[0].max,
    rate: 0,
    baseTax: 0,
    currency: 'USD',
    isActive: true,
  },
  {
    id: 'tb-2',
    minIncome: GDT_USD_AT_4100[1].min,
    maxIncome: GDT_USD_AT_4100[1].max,
    rate: 5,
    baseTax: GDT_USD_AT_4100[1].deduction,
    currency: 'USD',
    isActive: true,
  },
  {
    id: 'tb-3',
    minIncome: GDT_USD_AT_4100[2].min,
    maxIncome: GDT_USD_AT_4100[2].max,
    rate: 10,
    baseTax: GDT_USD_AT_4100[2].deduction,
    currency: 'USD',
    isActive: true,
  },
  {
    id: 'tb-4',
    minIncome: GDT_USD_AT_4100[3].min,
    maxIncome: GDT_USD_AT_4100[3].max,
    rate: 15,
    baseTax: GDT_USD_AT_4100[3].deduction,
    currency: 'USD',
    isActive: true,
  },
  {
    id: 'tb-5',
    minIncome: GDT_USD_AT_4100[4].min,
    maxIncome: null,
    rate: 20,
    baseTax: GDT_USD_AT_4100[4].deduction,
    currency: 'USD',
    isActive: true,
  },
] as const;

export type PayrollTaxBracketApiRow = {
  /** Bracket floor (KHR). */
  min: number;
  /** Bracket ceiling (KHR); 9_999_999_999 = open-ended. */
  max: number;
  rate: number;
  /** GDT deduction (KHR). */
  deduction: number;
  range: string;
  currency: 'KHR';
};

function openEndedMaxKhr(max: number | null | undefined): number {
  if (max == null || max >= 9_999_999_999) return 9_999_999_999;
  return max;
}

export function khrRowsToPayrollApi(rows: SalaryTaxBracketKhr[]): PayrollTaxBracketApiRow[] {
  return rows.map((b) => {
    const min = Math.round(b.minKhr);
    const max = openEndedMaxKhr(b.maxKhr);
    const deduction = Math.round(b.deductionKhr);
    return {
      min,
      max,
      rate: b.rate,
      deduction,
      range: khrBracketRangeLabel(b),
      currency: 'KHR',
    };
  });
}

/** Legacy USD policy rows → KHR for editing / calculation. */
export function usdApiRowsToKhr(
  rows: Array<{ min: number; max: number; rate: number; deduction: number }>,
  exchangeRateKhrPerUsd: number
): SalaryTaxBracketKhr[] {
  const ex = Math.max(1, Number(exchangeRateKhrPerUsd) || DEFAULT_EXCHANGE_RATE);
  return rows.map((b) => ({
    minKhr: usdToKhr(b.min, ex),
    maxKhr: b.max >= 9_999_999 ? null : usdToKhr(b.max, ex),
    rate: b.rate,
    deductionKhr: usdToKhr(b.deduction ?? 0, ex),
  }));
}

export function isLikelyUsdBracketRow(row: { min?: number; max?: number; currency?: string }): boolean {
  if (String(row.currency ?? '').toUpperCase() === 'KHR') return false;
  if (String(row.currency ?? '').toUpperCase() === 'USD') return true;
  const min = Number(row.min ?? 0);
  const max = Number(row.max ?? 0);
  return max > 0 && max < 500_000 && min < 50_000;
}

function rowLooksKhr(row: { min?: number; max?: number; currency?: string }): boolean {
  if (String(row.currency ?? '').toUpperCase() === 'KHR') return true;
  if (String(row.currency ?? '').toUpperCase() === 'USD') return false;
  return Number(row.min ?? 0) > 500_000 || Number(row.max ?? 0) > 500_000;
}

export function normalizeTaxBracketPolicyRows(
  rows: PayrollTaxBracketApiRow[],
  exchangeRateKhrPerUsd = DEFAULT_EXCHANGE_RATE
): PayrollTaxBracketApiRow[] {
  if (!rows.length) return khrRowsToPayrollApi(GDT_TAX_BRACKETS_KHR);
  if (rows.every(rowLooksKhr)) {
    return sanitizeTaxBracketApiRows(rows);
  }
  return sanitizeTaxBracketApiRows(
    khrRowsToPayrollApi(usdApiRowsToKhr(rows, exchangeRateKhrPerUsd))
  );
}

export function taxBracketsToPayrollApi(
  rows: Array<{
    minIncome: number | string;
    maxIncome?: number | string | null;
    rate: number | string;
    baseTax?: number | string;
    currency?: string;
  }>,
  exchangeRateKhrPerUsd = DEFAULT_EXCHANGE_RATE
): PayrollTaxBracketApiRow[] {
  const mapped = rows.map((b) => {
    const min = Number(b.minIncome);
    const max = b.maxIncome == null ? 9_999_999_999 : Number(b.maxIncome);
    const rate = Number(b.rate);
    const deduction = Number(b.baseTax ?? 0);
    return { min, max, rate, deduction, currency: String(b.currency ?? '') };
  });
  return normalizeTaxBracketPolicyRows(
    mapped.map((b) => ({
      min: b.min,
      max: b.max,
      rate: b.rate,
      deduction: b.deduction,
      range: '',
      currency: b.currency === 'KHR' ? 'KHR' : 'USD',
    })),
    exchangeRateKhrPerUsd
  );
}

export function apiRowsToKhrBrackets(rows: PayrollTaxBracketApiRow[]): SalaryTaxBracketKhr[] {
  return rows.map((b) => ({
    minKhr: Math.round(b.min),
    maxKhr: b.max >= 9_999_999_999 ? null : Math.round(b.max),
    rate: b.rate,
    deductionKhr: Math.round(b.deduction ?? 0),
  }));
}

export type TaxBracketPolicySnapshot = {
  brackets: PayrollTaxBracketApiRow[];
  effectiveFrom: string | null;
  scheduledEffectiveFrom: string | null;
  lastUpdatedAt: string | null;
  lastUpdatedBy: string | null;
};

async function loadLegacyTaxBracketsFromDb(): Promise<PayrollTaxBracketApiRow[]> {
  const dbRows = await TaxBracket.findAll({
    where: { isActive: true },
    order: [['minIncome', 'ASC']],
  });
  if (dbRows.length) {
    return taxBracketsToPayrollApi(
      dbRows.map((r) => r.get({ plain: true }) as Record<string, unknown>)
    );
  }
  return taxBracketsToPayrollApi([...DEFAULT_TAX_BRACKETS_USD]);
}

export async function listTaxBracketsForApi(month?: string): Promise<TaxBracketPolicySnapshot> {
  const monthKey = (month ?? new Date().toISOString().slice(0, 7)).slice(0, 7);
  const { ensureInitialPayrollPolicyVersions } = await import(
    './payroll/payrollPolicyVersionBootstrap.js'
  );
  const { resolvePolicyPayloadForMonth, getPolicyVersionDisplayMeta } = await import(
    './payroll/payrollPolicyVersionService.js'
  );
  await ensureInitialPayrollPolicyVersions();

  const resolved = await resolvePolicyPayloadForMonth<{ brackets: PayrollTaxBracketApiRow[] }>({
    policyType: 'tax_brackets',
    month: monthKey,
  });
  const meta = await getPolicyVersionDisplayMeta({ policyType: 'tax_brackets', month: monthKey });

  const { getPayrollExchangeRateKhrPerUsd } = await import('./payrollExchangeRateService.js');
  const exchangeRate = await getPayrollExchangeRateKhrPerUsd(monthKey);

  const rawBrackets =
    resolved?.payload?.brackets?.length
      ? resolved.payload.brackets
      : await loadLegacyTaxBracketsFromDb();

  const brackets = normalizeTaxBracketPolicyRows(rawBrackets, exchangeRate);

  return {
    brackets,
    effectiveFrom: meta.effectiveFrom,
    scheduledEffectiveFrom: meta.scheduledEffectiveFrom,
    lastUpdatedAt: meta.lastUpdatedAt,
    lastUpdatedBy: meta.lastUpdatedBy,
  };
}

export async function saveTaxBrackets(
  brackets: PayrollTaxBracketApiRow[],
  effectiveFrom: string,
  createdBy?: string | null
): Promise<TaxBracketPolicySnapshot> {
  const { createPolicyVersion, parseEffectiveFrom } = await import(
    './payroll/payrollPolicyVersionService.js'
  );
  const { getPayrollExchangeRateKhrPerUsd } = await import('./payrollExchangeRateService.js');
  const effective_from = parseEffectiveFrom(effectiveFrom);
  const exchangeRate = await getPayrollExchangeRateKhrPerUsd(effective_from.slice(0, 7));
  const normalized = sanitizeTaxBracketApiRows(
    normalizeTaxBracketPolicyRows(brackets, exchangeRate)
  );
  await createPolicyVersion({
    policyType: 'tax_brackets',
    effectiveFrom: effective_from,
    payload: { brackets: normalized, currency: 'KHR' },
    notes: 'Tax bracket table update',
    createdBy: createdBy ?? null,
  });
  return listTaxBracketsForApi(effective_from.slice(0, 7));
}

export async function getTaxBracketsForPayroll(
  exchangeRateKhrPerUsd = DEFAULT_EXCHANGE_RATE,
  month?: string
): Promise<SalaryTaxBracketUsd[]> {
  const snapshot = await listTaxBracketsForApi(month);
  if (snapshot.brackets.length) {
    const khr = apiRowsToKhrBrackets(snapshot.brackets);
    return gdtBracketsToUsd(exchangeRateKhrPerUsd).map((_, i) => {
      const row = khr[i];
      if (!row) return gdtBracketsToUsd(exchangeRateKhrPerUsd)[i];
      const ex = exchangeRateKhrPerUsd;
      return {
        min: Math.round((row.minKhr / ex) * 100) / 100,
        max: row.maxKhr == null ? 9_999_999 : Math.round((row.maxKhr / ex) * 100) / 100,
        rate: row.rate,
        deduction: Math.round((row.deductionKhr / ex) * 100) / 100,
        range: khrBracketRangeLabel(row),
      };
    });
  }
  return gdtBracketsToUsd(exchangeRateKhrPerUsd);
}

export async function getTaxBracketsKhrForPayroll(month?: string): Promise<SalaryTaxBracketKhr[]> {
  const snapshot = await listTaxBracketsForApi(month);
  if (snapshot.brackets.length) {
    return apiRowsToKhrBrackets(snapshot.brackets);
  }
  return GDT_TAX_BRACKETS_KHR;
}

/** One-time: copy legacy systemsettings JSON into taxbrackets if table is empty, then delete the row. */
export async function removeLegacyPayrollTaxBracketsFromSystemSettings(): Promise<void> {
  const legacy = await SystemSetting.findOne({ where: { key: LEGACY_PAYROLL_TAX_BRACKETS_KEY } });
  if (!legacy) return;

  const count = await TaxBracket.count();
  if (count === 0) {
    try {
      const raw = legacy.get('value');
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed) && parsed.length) {
        const ids = ['tb-1', 'tb-2', 'tb-3', 'tb-4', 'tb-5'];
        for (let i = 0; i < parsed.length; i += 1) {
          const b = parsed[i] as {
            min?: number;
            max?: number;
            rate?: number;
            deduction?: number;
          };
          const id = ids[i] ?? `tb-${i + 1}`;
          await TaxBracket.upsert({
            id,
            minIncome: Number(b.min) || 0,
            maxIncome: Number(b.max) >= 9_999_999 ? null : Number(b.max) || 0,
            rate: Number(b.rate) || 0,
            baseTax: Number(b.deduction ?? 0),
            currency: 'USD',
            isActive: true,
          });
        }
        console.log('[db] Migrated payroll tax brackets from systemsettings into taxbrackets.');
      }
    } catch (e) {
      console.warn(
        '[db] Could not migrate legacy payroll.taxBrackets.usd:',
        (e as Error)?.message || e
      );
    }
  }

  await SystemSetting.destroy({ where: { key: LEGACY_PAYROLL_TAX_BRACKETS_KEY } });
}

export async function ensureTaxBracketSchema(): Promise<void> {
  await TaxBracket.sync();
  await removeLegacyPayrollTaxBracketsFromSystemSettings();

  const [cols] = (await sequelize.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'taxbrackets'`
  )) as [{ COLUMN_NAME: string }[], unknown];

  const names = new Set((cols ?? []).map((c) => c.COLUMN_NAME));

  const droppedCols: string[] = [];
  if (names.has('effectiveFrom')) {
    await sequelize.query(`ALTER TABLE taxbrackets DROP COLUMN effectiveFrom`);
    droppedCols.push('effectiveFrom');
  }
  if (names.has('createdAt')) {
    await sequelize.query(`ALTER TABLE taxbrackets DROP COLUMN createdAt`);
    droppedCols.push('createdAt');
  }
  if (names.has('updatedAt')) {
    await sequelize.query(`ALTER TABLE taxbrackets DROP COLUMN updatedAt`);
    droppedCols.push('updatedAt');
  }
  if (droppedCols.length) {
    console.log(`[db] taxbrackets: dropped ${droppedCols.join(', ')}.`);
  }

  const gdtDbRows = GDT_TAX_BRACKETS_KHR.map((row, i) => ({
    id: `tb-${i + 1}`,
    minIncome: row.minKhr,
    maxIncome: row.maxKhr,
    rate: row.rate,
    baseTax: row.deductionKhr,
    currency: 'KHR',
    isActive: true,
  }));

  const count = await TaxBracket.count();
  if (count === 0) {
    await TaxBracket.bulkCreate(gdtDbRows);
    console.log('[db] Seeded taxbrackets (GDT ToS, USD @ 4100 KHR/USD).');
    return;
  }

  const rows = (await TaxBracket.findAll({ raw: true })) as Array<{
    id: string;
    currency?: string;
    minIncome?: number;
    baseTax?: number;
  }>;
  const needsGdtMigration = rows.some(
    (r) =>
      String(r.currency || '').toUpperCase() === 'KHR' ||
      Number(r.minIncome) > 10_000 ||
      Number(r.baseTax ?? 0) === 0 && Number(r.minIncome) === 376
  );

  if (needsGdtMigration) {
    for (const row of gdtDbRows) {
      await TaxBracket.upsert(row);
    }
    console.log('[db] Migrated taxbrackets to GDT ToS (USD @ 4100 KHR/USD).');
  }
}

export { GDT_TAX_BRACKETS_KHR };
