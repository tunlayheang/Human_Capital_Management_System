import type {
  ReportColumn,
  ReportRow,
  ReportSummary,
  ReportSummaryCard,
} from './reportTypes.js';

export type { ReportSummary, ReportSummaryCard };

export type ColumnAggregate = 'sum' | 'avg' | 'count' | 'omit';

function inferAggregate(col: ReportColumn): ColumnAggregate {
  if (col.aggregate) return col.aggregate;
  if (col.format === 'currency' || col.format === 'number') return 'sum';
  if (col.format === 'percent') return 'avg';
  return 'omit';
}

function isFiniteNumber(value: unknown): value is number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n);
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build a totals footer row + summary KPI cards from numeric columns.
 * Runners can pass extra cards (status breakdowns, risk counts, etc.).
 */
export function buildReportSummary(
  columns: ReportColumn[],
  rows: ReportRow[],
  extras?: { cards?: ReportSummaryCard[]; totalsRow?: ReportRow | null }
): ReportSummary {
  const dataRows = rows.filter((r) => r._isTotals !== true);
  const extraCards = extras?.cards || [];
  const cards: ReportSummaryCard[] = [
    { key: 'rows', label: 'Rows', value: dataRows.length, format: 'number' },
    ...extraCards,
  ];

  if (extras && 'totalsRow' in extras) {
    const override = extras.totalsRow;
    if (!override) return { cards, totalsRow: null };
    return { cards, totalsRow: { ...override, _isTotals: true } };
  }

  if (!dataRows.length) {
    return { cards, totalsRow: null };
  }

  const totalsRow: ReportRow = { _isTotals: true };
  let labeled = false;
  const autoCards: ReportSummaryCard[] = [];

  for (const col of columns) {
    const agg = inferAggregate(col);
    if (agg === 'omit') {
      if (!labeled && (col.format === 'text' || !col.format)) {
        totalsRow[col.key] = 'Total';
        labeled = true;
      } else {
        totalsRow[col.key] = '';
      }
      continue;
    }

    const values = dataRows
      .map((r) => r[col.key])
      .filter((v) => v != null && v !== '' && isFiniteNumber(v))
      .map((v) => toNumber(v));

    if (!values.length) {
      totalsRow[col.key] = '';
      continue;
    }

    if (agg === 'count') {
      totalsRow[col.key] = values.length;
    } else if (agg === 'avg') {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      totalsRow[col.key] = Math.round(avg * 100) / 100;
    } else {
      const sum = values.reduce((a, b) => a + b, 0);
      totalsRow[col.key] = Math.round(sum * 100) / 100;
    }

    if (agg === 'sum' && (col.format === 'currency' || col.format === 'number')) {
      autoCards.push({
        key: `sum_${col.key}`,
        label: col.label,
        value: totalsRow[col.key] as number,
        format: col.format === 'currency' ? 'currency' : 'number',
      });
    } else if (agg === 'avg' && col.format === 'percent') {
      autoCards.push({
        key: `avg_${col.key}`,
        label: `Avg ${col.label}`,
        value: totalsRow[col.key] as number,
        format: 'percent',
      });
    }
  }

  if (!labeled) {
    const first = columns[0];
    if (first) totalsRow[first.key] = 'Total';
  }

  // Prefer runner extras; only auto-fill column totals when the runner did not
  // already supply metric cards (avoids duplicate Leave days / OT hours cards).
  const maxCards = 8;
  const runnerProvidedMetrics = extraCards.some(
    (c) => c.key !== 'rows' && !/^rows?$/i.test(String(c.label || ''))
  );
  if (runnerProvidedMetrics) {
    return { cards: cards.slice(0, maxCards), totalsRow };
  }
  const remaining = Math.max(0, maxCards - cards.length);
  return {
    cards: [...cards, ...autoCards.slice(0, remaining)],
    totalsRow,
  };
}

/** Count rows matching a predicate — for runner extra cards. */
export function countWhere(rows: ReportRow[], pred: (r: ReportRow) => boolean): number {
  return rows.filter(pred).length;
}
