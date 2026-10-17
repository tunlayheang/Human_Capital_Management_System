/** Lightweight analyst projections — linear trend + moving average (no ML deps). */

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Ordinary least-squares slope/intercept for y over index 0..n-1. */
export function linearFit(values: number[]): { slope: number; intercept: number; mean: number } {
  const n = values.length;
  if (n === 0) return { slope: 0, intercept: 0, mean: 0 };
  if (n === 1) return { slope: 0, intercept: values[0], mean: values[0] };
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = values[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept, mean: sumY / n };
}

export function movingAverage(values: number[], window = 3): number {
  if (!values.length) return 0;
  const w = Math.max(1, Math.min(window, values.length));
  const slice = values.slice(-w);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/**
 * Blend linear trend with recent moving average for stable short-horizon forecasts.
 * Clamps negatives when `minZero` is true.
 */
export function projectNext(
  values: number[],
  steps: number,
  opts?: { minZero?: boolean; blend?: number }
): number[] {
  const blend = opts?.blend ?? 0.55;
  const { slope, intercept } = linearFit(values);
  const ma = movingAverage(values, Math.min(3, values.length || 1));
  const n = values.length;
  const out: number[] = [];
  for (let s = 1; s <= steps; s++) {
    const linear = intercept + slope * (n - 1 + s);
    let projected = blend * linear + (1 - blend) * ma;
    if (opts?.minZero !== false) projected = Math.max(0, projected);
    out.push(projected);
  }
  return out;
}

export function addMonthsKey(monthKey: string, delta: number): string {
  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function formatMonthLabel(monthKey: string): string {
  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function trendLabel(slope: number, scale = 1): string {
  const s = slope * scale;
  if (Math.abs(s) < 0.05) return 'Stable';
  return s > 0 ? 'Rising' : 'Falling';
}

export function riskBand(score: number): 'Low' | 'Medium' | 'High' {
  if (score >= 70) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
}
