import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildReportSummary } from './reportSummary.js';
import type { ReportColumn, ReportRow } from './reportTypes.js';

describe('buildReportSummary', () => {
  it('sums currency columns and averages percents into totals + cards', () => {
    const columns: ReportColumn[] = [
      { key: 'name', label: 'Name' },
      { key: 'gross', label: 'Gross', format: 'currency' },
      { key: 'rate', label: 'Rate', format: 'percent' },
      { key: 'year', label: 'Year', format: 'number', aggregate: 'omit' },
    ];
    const rows: ReportRow[] = [
      { name: 'A', gross: 100, rate: 90, year: 2026 },
      { name: 'B', gross: 50.5, rate: 80, year: 2026 },
    ];
    const summary = buildReportSummary(columns, rows, {
      cards: [{ key: 'paid', label: 'Paid', value: 2, format: 'number' }],
    });

    assert.equal(summary.cards[0]?.label, 'Rows');
    assert.equal(summary.cards[0]?.value, 2);
    assert.equal(summary.cards[1]?.label, 'Paid');
    assert.equal(summary.cards.length, 2, 'runner metric cards should not be duplicated by auto column cards');
    assert.ok(summary.totalsRow);
    assert.equal(summary.totalsRow!.name, 'Total');
    assert.equal(summary.totalsRow!.gross, 150.5);
    assert.equal(summary.totalsRow!.rate, 85);
    assert.equal(summary.totalsRow!.year, '');
  });

  it('auto-fills column sum cards when the runner provides no metrics', () => {
    const columns: ReportColumn[] = [
      { key: 'name', label: 'Name' },
      { key: 'gross', label: 'Gross', format: 'currency' },
    ];
    const rows: ReportRow[] = [
      { name: 'A', gross: 10 },
      { name: 'B', gross: 20 },
    ];
    const summary = buildReportSummary(columns, rows);
    assert.equal(summary.cards[0]?.label, 'Rows');
    assert.ok(summary.cards.some((c) => c.label === 'Gross'));
  });

  it('returns cards only when there are no data rows', () => {
    const summary = buildReportSummary([{ key: 'a', label: 'A', format: 'number' }], []);
    assert.equal(summary.totalsRow, null);
    assert.equal(summary.cards[0]?.value, 0);
  });

  it('uses an explicit totalsRow override (e.g. organization as total)', () => {
    const columns: ReportColumn[] = [
      { key: 'dimension', label: 'Dimension' },
      { key: 'total', label: 'Total', format: 'number' },
    ];
    const rows: ReportRow[] = [
      { dimension: 'Department', total: 3 },
      { dimension: 'Department', total: 6 },
    ];
    const summary = buildReportSummary(columns, rows, {
      totalsRow: { dimension: 'Total', label: 'Organization', total: 28 },
    });
    assert.equal(summary.totalsRow?.dimension, 'Total');
    assert.equal(summary.totalsRow?.total, 28);
    assert.equal(summary.totalsRow?._isTotals, true);
  });
});
