import { QueryTypes } from 'sequelize';
import { sequelize } from './db.js';
import { appendExchangeRate } from './exchangeRateService.js';
import { businessDateKey, scheduleDailyAtBusinessMidnight } from './dailyJobScheduler.js';

let handle: ReturnType<typeof scheduleDailyAtBusinessMidnight> | null = null;

/**
 * Ensures each payroll policy exchange-rate version has a matching historical row.
 * Append-only — never mutates rates already referenced by finalized payroll.
 */
export async function syncExchangeRateHistoryFromPolicyVersions(): Promise<number> {
  try {
    const { ensurePayrollPolicyVersionSchema } = await import('./payroll/payrollPolicyVersionSchema.js');
    await ensurePayrollPolicyVersionSchema();
  } catch (err) {
    console.warn(
      '[exchange-rate] Policy schema ensure skipped:',
      (err as Error)?.message || err
    );
  }

  let rows: Array<{
    id: string;
    effective_from: string;
    payload: string | { exchangeRateKhrPerUsd?: number };
    created_by: string | null;
  }> = [];
  try {
    rows = (await sequelize.query(
      `SELECT id, effective_from, payload, created_by
       FROM payroll_policy_versions
       WHERE policy_type = 'exchange_rate'
         AND (is_deleted IS NULL OR is_deleted = 0)
       ORDER BY effective_from ASC, created_at ASC`,
      { type: QueryTypes.SELECT }
    )) as typeof rows;
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    if (!/Unknown column.*is_deleted|ER_BAD_FIELD_ERROR/i.test(msg)) {
      console.warn('[exchange-rate] History sync query failed:', msg);
      return 0;
    }
    rows = (await sequelize.query(
      `SELECT id, effective_from, payload, created_by
       FROM payroll_policy_versions
       WHERE policy_type = 'exchange_rate'
       ORDER BY effective_from ASC, created_at ASC`,
      { type: QueryTypes.SELECT }
    )) as typeof rows;
  }

  let inserted = 0;
  for (const row of rows) {
    let payload: { exchangeRateKhrPerUsd?: number } = {};
    if (typeof row.payload === 'string') {
      try {
        payload = JSON.parse(row.payload);
      } catch {
        payload = {};
      }
    } else if (row.payload && typeof row.payload === 'object') {
      payload = row.payload;
    }
    const rate = Number(payload.exchangeRateKhrPerUsd);
    if (!Number.isFinite(rate) || rate <= 0) continue;

    const effectiveDate = String(row.effective_from).slice(0, 10);
    const existing = (await sequelize.query(
      `SELECT rate_id FROM exchange_rates
       WHERE effective_date = :effectiveDate AND khr_per_usd = :rate
         AND (is_deleted IS NULL OR is_deleted = 0)
       LIMIT 1`,
      {
        replacements: { effectiveDate, rate: Math.round(rate) },
        type: QueryTypes.SELECT,
      }
    )) as Array<{ rate_id: string }>;
    if (existing.length) continue;

    await appendExchangeRate({
      effectiveDate,
      khrPerUsd: rate,
      rateId: `fx-policy-${row.id}`,
      createdBy: row.created_by,
    });
    inserted += 1;
  }
  return inserted;
}

export function startExchangeRateHistoryScheduler(): void {
  if (handle) return;
  handle = scheduleDailyAtBusinessMidnight('exchange-rate-history', async () => {
    const n = await syncExchangeRateHistoryFromPolicyVersions();
    if (n > 0) {
      console.log(
        `[exchange-rate] Preserved ${n} historical rate row(s) on ${businessDateKey()}`
      );
    }
  });
  console.log('[exchange-rate] Daily history preservation scheduler started (00:00 Phnom Penh).');
}

export async function runExchangeRateHistoryOnStartup(): Promise<void> {
  const n = await syncExchangeRateHistoryFromPolicyVersions();
  if (n > 0) console.log(`[exchange-rate] Startup preserved ${n} historical rate row(s)`);
}
