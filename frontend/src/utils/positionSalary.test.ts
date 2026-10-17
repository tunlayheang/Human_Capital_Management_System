import { describe, expect, it } from 'vitest';
import {
  formatPositionSalaryRange,
  hasPositionSalaryRange,
  positionSalaryBounds,
  validatePositionSalaryValue,
  validateSalaryInPositionRange,
} from './positionSalary';

describe('positionSalary', () => {
  it('formats a min–max range', () => {
    expect(formatPositionSalaryRange({ salaryMin: 400, salaryMax: 600 })).toContain('400');
    expect(formatPositionSalaryRange({ salaryMin: 400, salaryMax: 600 })).toContain('600');
  });

  it('validates salary within IT-style bounds', () => {
    const itRole = { title: 'IT Officer', salaryMin: 400, salaryMax: 600 };
    expect(validateSalaryInPositionRange(500, itRole)).toBeNull();
    expect(validateSalaryInPositionRange(399, itRole)).toMatch(/between/i);
    expect(validateSalaryInPositionRange(601, itRole)).toMatch(/between/i);
  });

  it('skips validation when no upper bound', () => {
    expect(hasPositionSalaryRange({ salaryMin: 0, salaryMax: 0 })).toBe(false);
    expect(validateSalaryInPositionRange(999, { salaryMin: 0, salaryMax: 0 })).toBeNull();
  });

  it('validatePositionSalaryValue returns error string for out-of-range HR salary', () => {
    const hr = { title: 'HR Manager', salaryMin: 500, salaryMax: 700 };
    expect(validatePositionSalaryValue(999, hr)).toMatch(/between/i);
    expect(validatePositionSalaryValue(600, hr)).toBe(true);
  });

  it('normalizes inverted bounds', () => {
    expect(positionSalaryBounds({ salaryMin: 600, salaryMax: 400 })).toEqual({
      min: 400,
      max: 600,
    });
  });
});
