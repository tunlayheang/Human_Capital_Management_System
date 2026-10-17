import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getReportDefinition, listReportCatalog } from './reportCatalog.js';
import { normalizeReportFilters, ReportValidationError } from './reportFilterUtils.js';

describe('report catalog registry', () => {
  it('lists Reports Module Structure ids under Workforce and Forecast groups', () => {
    const catalog = listReportCatalog();
    const ids = catalog.map((r) => r.id);
    for (const id of [
      'headcount-summary',
      'attrition-by-department',
      'workforce-composition',
      'leave-utilization',
      'ot-by-department',
      'payroll-by-department',
      'payroll-and-rule',
      'nssf-contributions',
      'tax-withholding',
      'abandonment-absence-alerts',
      'org-monthly-kpis',
      'headcount-outlook',
      'payroll-cost-outlook',
      'ot-cost-outlook',
      'attendance-risk-outlook',
    ]) {
      assert.ok(ids.includes(id), `missing ${id}`);
    }

    // Merged / removed from catalog surface
    for (const gone of [
      'attendance-by-department',
      'government-remittance',
      'seniority-indemnity',
      'salary-movement-summary',
      'kpi-outlook',
      'leave-balance-outlook',
      'probation-pipeline',
      'seniority-payout-outlook',
    ]) {
      assert.ok(!ids.includes(gone), `should not list ${gone}`);
    }

    for (const dump of [
      'employee-roster',
      'attendance-register',
      'leave-requests',
      'leave-balances',
      'overtime-requests',
      'payroll-register',
      'final-settlements',
      'salary-history',
      'abandonment-absconded',
      'appraisal-grades',
      'compliance-audit',
    ]) {
      assert.ok(!ids.includes(dump), `should not list dump ${dump}`);
    }

    const labels = [...new Set(catalog.map((r) => r.categoryLabel))];
    assert.deepEqual(labels, ['Workforce Reports', 'Forecast & Planning Reports']);
  });

  it('uses renamed report titles', () => {
    assert.equal(getReportDefinition('headcount-summary')?.title, 'Department');
    assert.equal(getReportDefinition('attrition-by-department')?.title, 'Leaving by Department');
    assert.equal(getReportDefinition('leave-utilization')?.title, 'Leave');
    assert.equal(getReportDefinition('ot-by-department')?.title, 'OT');
    assert.equal(getReportDefinition('payroll-by-department')?.title, 'Payroll');
    assert.equal(getReportDefinition('payroll-and-rule')?.title, 'Payroll & Rule');
    assert.equal(getReportDefinition('nssf-contributions')?.title, 'NSSF Contribution Report');
    assert.equal(getReportDefinition('tax-withholding')?.title, 'Tax Withholding Report');
    assert.equal(getReportDefinition('abandonment-absence-alerts')?.title, 'Absence Risk Report');
    assert.equal(getReportDefinition('org-monthly-kpis')?.title, 'Monthly Workforce KPI');
    assert.equal(getReportDefinition('payroll-cost-outlook')?.title, 'Payroll Cost Forecast Report');
  });

  it('normalizes defaults for date-range reports', () => {
    const def = getReportDefinition('org-monthly-kpis');
    assert.ok(def);
    const filters = normalizeReportFilters(def!, {});
    assert.match(filters.startDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(filters.endDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(filters.startDate <= filters.endDate);
  });

  it('rejects inverted date ranges', () => {
    const def = getReportDefinition('leave-utilization');
    assert.ok(def);
    assert.throws(
      () =>
        normalizeReportFilters(def!, {
          startDate: '2026-06-01',
          endDate: '2026-01-01',
        }),
      (err: unknown) => err instanceof ReportValidationError
    );
  });

  it('requires payroll month and normalizes YYYY-MM', () => {
    const def = getReportDefinition('payroll-by-department');
    assert.ok(def);
    const filters = normalizeReportFilters(def!, { month: '2026-07-15' });
    assert.equal(filters.month, '2026-07');
  });
});
