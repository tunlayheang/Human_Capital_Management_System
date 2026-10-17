export const formatUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(
    Number(n) || 0
  );

export const formatKhr = (n: number) =>
  new Intl.NumberFormat('en-KH', { style: 'decimal', maximumFractionDigits: 0 }).format(Number(n) || 0) +
  ' ៛';
