import {
  resolveDashboardDateRange,
  startOfYear,
  todayYmd,
} from '../dashboardDateRange.js';
import type { ReportDefinition, ReportFilterField } from './reportTypes.js';

export class ReportValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ReportValidationError';
  }
}

export function currentMonthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function currentYearKey(d = new Date()): string {
  return String(d.getFullYear());
}

function defaultForField(field: ReportFilterField): string {
  if (field.defaultValue != null && field.defaultValue !== '') return field.defaultValue;
  switch (field.type) {
    case 'date':
      return field.key.toLowerCase().includes('end') ? todayYmd() : startOfYear();
    case 'month':
      return currentMonthKey();
    case 'year':
      return currentYearKey();
    default:
      return '';
  }
}

/** Merge client filters with catalog defaults; validate required fields. */
export function normalizeReportFilters(
  definition: ReportDefinition,
  raw: Record<string, unknown> | null | undefined
): Record<string, string> {
  const input = raw && typeof raw === 'object' ? raw : {};
  const out: Record<string, string> = {};

  for (const field of definition.filters) {
    const rawVal = input[field.key];
    let value =
      rawVal == null || rawVal === ''
        ? defaultForField(field)
        : String(rawVal).trim();

    if (field.type === 'month' && value) {
      value = value.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(value)) {
        throw new ReportValidationError(`Invalid month for ${field.label}`);
      }
    }
    if (field.type === 'year' && value) {
      value = value.slice(0, 4);
      if (!/^\d{4}$/.test(value)) {
        throw new ReportValidationError(`Invalid year for ${field.label}`);
      }
    }
    if (field.type === 'date' && value) {
      value = value.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new ReportValidationError(`Invalid date for ${field.label}`);
      }
    }
    if (field.type === 'select' && value && field.options?.length) {
      const ok = field.options.some((o) => o.value === value);
      if (!ok) throw new ReportValidationError(`Invalid value for ${field.label}`);
    }

    if (field.required && !value) {
      throw new ReportValidationError(`${field.label} is required`);
    }
    out[field.key] = value;
  }

  if (out.startDate && out.endDate && out.startDate > out.endDate) {
    throw new ReportValidationError('Start date must be on or before end date');
  }

  return out;
}

export function resolveDateRangeFromFilters(filters: Record<string, string>) {
  return resolveDashboardDateRange(filters.startDate, filters.endDate);
}

export function str(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  return String(value);
}

export function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Normalize Sequelize DATE / ISO / display strings to YYYY-MM-DD. */
export function toYmd(value: unknown): string {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return '';
}
