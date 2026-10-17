/**
 * Convert USD → whole KHR by always rounding UP (ceiling).
 * Fractional riels after FX never short the employee/display amount.
 * Exact integers stay exact (tiny epsilon guards float noise).
 */
export function usdToKhr(usd: number, exchangeRateKhrPerUsd: number): number {
  const u = Number(usd);
  const rate = Number(exchangeRateKhrPerUsd);
  if (!Number.isFinite(u) || !Number.isFinite(rate) || u <= 0 || rate <= 0) return 0;
  return Math.ceil(u * rate - 1e-9);
}
