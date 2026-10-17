import crypto from 'crypto';
import { QueryTypes } from 'sequelize';
import { sequelize } from './db.js';
import { DEFAULT_PAYROLL_EXCHANGE_RATE_KHR_PER_USD } from './payrollExchangeRateService.js';

export type ExchangeRateDto = {
  rateId: string;
  effectiveDate: string;
  khrPerUsd: number;
  active: boolean;
  createdBy?: string | null;
};

type ExchangeRateDbRow = {
  rate_id: string;
  effective_date: string;
  khr_per_usd: number;
  active: number | boolean;
  created_by?: string | null;
  is_deleted?: number | boolean;
};

function rowToDto(row: ExchangeRateDbRow): ExchangeRateDto {
  return {
    rateId: String(row.rate_id),
    effectiveDate: String(row.effective_date).slice(0, 10),
    khrPerUsd: Number(row.khr_per_usd) || DEFAULT_PAYROLL_EXCHANGE_RATE_KHR_PER_USD,
    active: row.active === true || row.active === 1,
    createdBy: row.created_by ?? null,
  };
}

const ACTIVE_NOT_DELETED = `(active = 1 AND (is_deleted IS NULL OR is_deleted = 0))`;

async function ensureExchangeRatesReady(): Promise<void> {
  const { ensureExchangeRateSchema } = await import('./exchangeRateSchema.js');
  await ensureExchangeRateSchema();
  const { ensureExchangeRateAuditColumns } = await import('./sensitiveModuleAuditSchema.js');
  await ensureExchangeRateAuditColumns();
}

/** Resolve KHR/USD for a calendar date from historical exchange_rates rows. */
export async function getExchangeRateForDate(dateIso: string): Promise<number | null> {
  await ensureExchangeRatesReady();
  const date = String(dateIso).slice(0, 10);
  try {
    const rows = (await sequelize.query(
      `SELECT rate_id, effective_date, khr_per_usd, active, created_by
       FROM exchange_rates
       WHERE ${ACTIVE_NOT_DELETED} AND effective_date <= :date
       ORDER BY effective_date DESC, created_at DESC
       LIMIT 1`,
      { replacements: { date }, type: QueryTypes.SELECT }
    )) as ExchangeRateDbRow[];
    if (!rows.length) return null;
    return rowToDto(rows[0]).khrPerUsd;
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    if (!/Unknown column|ER_BAD_FIELD_ERROR|ER_NO_SUCH_TABLE/i.test(msg)) throw err;
    console.warn('[exchange-rates] getExchangeRateForDate skipped:', msg);
    return null;
  }
}

export async function listExchangeRates(limit = 50): Promise<ExchangeRateDto[]> {
  await ensureExchangeRatesReady();
  try {
    const rows = (await sequelize.query(
      `SELECT rate_id, effective_date, khr_per_usd, active, created_by
       FROM exchange_rates
       WHERE (is_deleted IS NULL OR is_deleted = 0)
       ORDER BY effective_date DESC, created_at DESC
       LIMIT :limit`,
      { replacements: { limit: Math.min(limit, 200) }, type: QueryTypes.SELECT }
    )) as ExchangeRateDbRow[];
    return rows.map(rowToDto);
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    if (!/Unknown column|ER_BAD_FIELD_ERROR|ER_NO_SUCH_TABLE/i.test(msg)) throw err;
    console.warn('[exchange-rates] listExchangeRates skipped:', msg);
    return [];
  }
}

/** Append a new historical rate row — never overwrites prior payroll snapshots. */
export async function appendExchangeRate(input: {
  effectiveDate: string;
  khrPerUsd: number;
  rateId?: string;
  createdBy?: string | null;
}): Promise<ExchangeRateDto> {
  const effectiveDate = String(input.effectiveDate).slice(0, 10);
  const khrPerUsd = Math.round(Number(input.khrPerUsd));
  const rateId =
    input.rateId ?? `fx-${effectiveDate}-${khrPerUsd}-${crypto.randomBytes(3).toString('hex')}`;

  await sequelize.query(
    `INSERT INTO exchange_rates
      (rate_id, effective_date, khr_per_usd, active, created_by, created_at, is_deleted)
     VALUES (:rateId, :effectiveDate, :khrPerUsd, 1, :createdBy, NOW(), 0)`,
    {
      replacements: {
        rateId,
        effectiveDate,
        khrPerUsd,
        createdBy: input.createdBy ?? null,
      },
      type: QueryTypes.INSERT,
    }
  );

  const rows = (await sequelize.query(
    `SELECT rate_id, effective_date, khr_per_usd, active, created_by
     FROM exchange_rates WHERE rate_id = :rateId LIMIT 1`,
    { replacements: { rateId }, type: QueryTypes.SELECT }
  )) as ExchangeRateDbRow[];
  return rowToDto(rows[0]);
}

/** @deprecated Use appendExchangeRate — kept for callers; never updates historical rows. */
export async function upsertExchangeRate(input: {
  effectiveDate: string;
  khrPerUsd: number;
  rateId?: string;
  createdBy?: string | null;
}): Promise<ExchangeRateDto> {
  const effectiveDate = String(input.effectiveDate).slice(0, 10);
  const khrPerUsd = Math.round(Number(input.khrPerUsd));
  const existing = (await sequelize.query(
    `SELECT rate_id FROM exchange_rates
     WHERE effective_date = :effectiveDate AND khr_per_usd = :khrPerUsd
       AND (is_deleted IS NULL OR is_deleted = 0)
     LIMIT 1`,
    {
      replacements: { effectiveDate, khrPerUsd },
      type: QueryTypes.SELECT,
    }
  )) as Array<{ rate_id: string }>;
  if (existing.length) {
    const rows = (await sequelize.query(
      `SELECT rate_id, effective_date, khr_per_usd, active, created_by
       FROM exchange_rates WHERE rate_id = :rateId LIMIT 1`,
      { replacements: { rateId: existing[0].rate_id }, type: QueryTypes.SELECT }
    )) as ExchangeRateDbRow[];
    return rowToDto(rows[0]);
  }
  return appendExchangeRate(input);
}

export async function seedDefaultExchangeRateIfEmpty(): Promise<void> {
  const rows = (await sequelize.query(
    `SELECT COUNT(*) AS c FROM exchange_rates WHERE (is_deleted IS NULL OR is_deleted = 0)`,
    { type: QueryTypes.SELECT }
  )) as Array<{ c: number }>;
  if (Number(rows[0]?.c) > 0) return;
  await appendExchangeRate({
    rateId: 'fx-default-4100',
    effectiveDate: '2024-01-01',
    khrPerUsd: DEFAULT_PAYROLL_EXCHANGE_RATE_KHR_PER_USD,
    createdBy: 'system',
  });
}
