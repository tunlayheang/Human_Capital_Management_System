import { describe, expect, it } from 'vitest';
import {
  buildAllowanceOverviewLines,
  pickBestAllowanceTemplate,
} from './allowancePayPreview';
import type { AllowanceTemplate, AllowanceType } from '../types';

const types: AllowanceType[] = [
  {
    id: 't-meal',
    code: 'MEAL',
    name: 'Meal Allowance',
    category: 'fixed',
    calculation_type: 'fixed',
    taxable: true,
    active: true,
  },
  {
    id: 't-transport',
    code: 'TRANSPORT',
    name: 'Transportation Allowance',
    category: 'fixed',
    calculation_type: 'fixed',
    taxable: true,
    active: true,
  },
];

describe('buildAllowanceOverviewLines', () => {
  const engineLines = [
    { code: 'MEAL', name: 'Meal Allowance', amount: 30 },
    { code: 'TRANSPORT', name: 'Transportation Allowance', amount: 20 },
  ];

  it('shows engine amounts when packageTypeIds is null', () => {
    const rows = buildAllowanceOverviewLines(types, engineLines, null);
    expect(rows.find((r) => r.code === 'MEAL')?.amount).toBe(30);
    expect(rows.find((r) => r.code === 'TRANSPORT')?.amount).toBe(20);
  });

  it('zeros all amounts for an empty package set', () => {
    const rows = buildAllowanceOverviewLines(types, engineLines, new Set());
    expect(rows.every((r) => r.amount === 0)).toBe(true);
  });

  it('keeps only package type amounts for a non-empty set', () => {
    const rows = buildAllowanceOverviewLines(types, engineLines, new Set(['t-meal']));
    expect(rows.find((r) => r.code === 'MEAL')?.amount).toBe(30);
    expect(rows.find((r) => r.code === 'TRANSPORT')?.amount).toBe(0);
  });
});

describe('pickBestAllowanceTemplate', () => {
  const templates: AllowanceTemplate[] = [
    {
      id: 'atpl-standard',
      template_name: 'Company default',
      department_id: null,
      role_id: null,
      active: true,
      items: [],
    },
    {
      id: 'ops',
      template_name: 'Operations',
      department_id: 'dept-ops',
      role_id: null,
      active: true,
      items: [],
    },
  ];

  it('never auto-matches — packages must be assigned explicitly', () => {
    expect(pickBestAllowanceTemplate(templates, 'dept-ops')).toBeNull();
    expect(pickBestAllowanceTemplate(templates, null)).toBeNull();
  });
});
