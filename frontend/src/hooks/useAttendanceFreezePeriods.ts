import { useEffect, useMemo, useState } from 'react';
import { Api } from '../services/api';
import type { PayrollAttendancePeriod } from '../types';

const periodCache = new Map<string, PayrollAttendancePeriod | null>();
const PERIOD_CACHE_TTL_MS = 5 * 60 * 1000;
const periodCacheAt = new Map<string, number>();

async function loadAttendancePeriod(month: string): Promise<PayrollAttendancePeriod | null> {
  const key = month.slice(0, 7);
  const cachedAt = periodCacheAt.get(key);
  if (cachedAt != null && Date.now() - cachedAt < PERIOD_CACHE_TTL_MS && periodCache.has(key)) {
    return periodCache.get(key) ?? null;
  }
  try {
    const row = (await Api.payroll.getAttendancePeriod(key)) as PayrollAttendancePeriod;
    periodCache.set(key, row);
    periodCacheAt.set(key, Date.now());
    return row;
  } catch {
    periodCache.set(key, null);
    periodCacheAt.set(key, Date.now());
    return null;
  }
}

function adjacentMonthKeys(monthKeys: string[]): string[] {
  const out = new Set<string>();
  for (const raw of monthKeys) {
    const key = raw.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    out.add(key);
    const y = Number(key.slice(0, 4));
    const m = Number(key.slice(5, 7));
    const prev =
      m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    const next =
      m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    out.add(prev);
    out.add(next);
  }
  return [...out].sort();
}

/** Load payroll attendance-period metadata for the given YYYY-MM month keys. */
export function useAttendanceFreezePeriods(
  monthKeys: string[],
  enabled = true
): {
  periodByMonth: Map<string, PayrollAttendancePeriod | null>;
  loading: boolean;
  anyReviewFrozen: boolean;
} {
  // Include adjacent months so cutoff spillover days (e.g. Jun 26–30 → July salary) resolve correctly.
  const normalized = useMemo(() => adjacentMonthKeys(monthKeys), [monthKeys]);
  const cacheKey = normalized.join(',');
  const [periodByMonth, setPeriodByMonth] = useState<Map<string, PayrollAttendancePeriod | null>>(
    () => new Map()
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !normalized.length) {
      setPeriodByMonth(new Map());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void Promise.all(
      normalized.map(async (month) => [month, await loadAttendancePeriod(month)] as const)
    )
      .then((rows) => {
        if (cancelled) return;
        setPeriodByMonth(new Map(rows));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, normalized, enabled]);

  const anyReviewFrozen = useMemo(() => {
    for (const period of periodByMonth.values()) {
      if (!period) continue;
      if (period.reviewFrozen) return true;
      if (period.status === 'FINALIZED' || period.status === 'LOCKED') return true;
    }
    return false;
  }, [periodByMonth]);

  return { periodByMonth, loading, anyReviewFrozen };
}
