import { SystemSetting } from '../db.js';

export const KPI_GRADES_SETTING_KEY = 'performance.kpiGrades';
export const KPI_GRADES_SETTING_ID = 'ss-performance-kpi-grades';

export type KpiGradeDefinition = {
  code: string;
  label: string;
  minScore: number;
  numeric: number;
  /** Suggested salary increase percent for this grade (0–100). */
  payRaiseRate: number;
};

export const DEFAULT_KPI_GRADES: KpiGradeDefinition[] = [
  { code: 'A+', label: 'Outstanding', minScore: 95, numeric: 8, payRaiseRate: 10 },
  { code: 'A', label: 'Excellent', minScore: 90, numeric: 7, payRaiseRate: 8 },
  { code: 'B+', label: 'Very Good', minScore: 85, numeric: 6, payRaiseRate: 6 },
  { code: 'B', label: 'Good', minScore: 80, numeric: 5, payRaiseRate: 5 },
  { code: 'C+', label: 'Above Average', minScore: 75, numeric: 4, payRaiseRate: 3 },
  { code: 'C', label: 'Satisfactory', minScore: 70, numeric: 3, payRaiseRate: 2 },
  { code: 'D', label: 'Needs Improvement', minScore: 60, numeric: 2, payRaiseRate: 0 },
  { code: 'F', label: 'Unsatisfactory', minScore: 0, numeric: 1, payRaiseRate: 0 },
];

const DEFAULT_RATE_BY_CODE = new Map(
  DEFAULT_KPI_GRADES.map((g) => [g.code.toUpperCase(), g.payRaiseRate])
);

export const KPI_CATEGORY_KEYS = [
  'productivity',
  'attendance',
  'quality',
  'teamwork',
  'discipline',
  'customerService',
  'leadership',
] as const;

export type KpiCategoryKey = (typeof KPI_CATEGORY_KEYS)[number];

export const KPI_CATEGORY_LABELS: Record<KpiCategoryKey, string> = {
  productivity: 'Productivity',
  attendance: 'Attendance',
  quality: 'Quality',
  teamwork: 'Teamwork',
  discipline: 'Discipline',
  customerService: 'Customer Service',
  leadership: 'Leadership',
};

function normalizePayRaiseRate(raw: unknown, code: string): number {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.round(n * 100) / 100;
  return DEFAULT_RATE_BY_CODE.get(String(code).trim().toUpperCase()) ?? 0;
}

function normalizeGradeRow(g: Record<string, unknown>): KpiGradeDefinition | null {
  const code = String(g.code ?? '').trim();
  if (!code) return null;
  return {
    code,
    label: String(g.label ?? g.code ?? '').trim() || code,
    minScore: Number(g.minScore) || 0,
    numeric: Number(g.numeric) || 1,
    payRaiseRate: normalizePayRaiseRate(
      g.payRaiseRate ?? g.pay_raise_rate ?? g.salaryIncreasePercent,
      code
    ),
  };
}

function parseSettingValue(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  return raw;
}

function gradesFromParsed(parsed: unknown): KpiGradeDefinition[] | null {
  if (!Array.isArray(parsed) || !parsed.length) return null;
  const grades = parsed
    .map((g: Record<string, unknown>) => normalizeGradeRow(g))
    .filter((g): g is KpiGradeDefinition => Boolean(g))
    .sort((a, b) => b.minScore - a.minScore);
  return grades.length ? grades : null;
}

export async function loadKpiGradeDefinitions(): Promise<KpiGradeDefinition[]> {
  const row: any = await SystemSetting.findOne({ where: { key: KPI_GRADES_SETTING_KEY } });
  if (!row?.value && row?.value !== 0) return [...DEFAULT_KPI_GRADES];
  const grades = gradesFromParsed(parseSettingValue(row.value));
  return grades ?? [...DEFAULT_KPI_GRADES];
}

export async function saveKpiGradeDefinitions(grades: KpiGradeDefinition[]): Promise<void> {
  const normalized = (grades?.length ? grades : DEFAULT_KPI_GRADES)
    .map((g) => normalizeGradeRow(g as unknown as Record<string, unknown>))
    .filter((g): g is KpiGradeDefinition => Boolean(g))
    .sort((a, b) => b.minScore - a.minScore);
  const payload = normalized.length ? normalized : [...DEFAULT_KPI_GRADES];

  const existing = await SystemSetting.findOne({ where: { key: KPI_GRADES_SETTING_KEY } });
  if (existing) {
    await existing.update({
      value: payload,
      category: 'performance',
      description: 'KPI letter grade scale (HR customizable)',
    });
    return;
  }

  await SystemSetting.create({
    id: KPI_GRADES_SETTING_ID,
    key: KPI_GRADES_SETTING_KEY,
    value: payload,
    category: 'performance',
    description: 'KPI letter grade scale (HR customizable)',
    isPublic: false,
  });
}

export function scoreToGrade(score: number, grades = DEFAULT_KPI_GRADES): string {
  const s = Number(score);
  if (!Number.isFinite(s)) return '—';
  const sorted = [...grades].sort((a, b) => b.minScore - a.minScore);
  for (const g of sorted) {
    if (s >= g.minScore) return g.code;
  }
  return sorted[sorted.length - 1]?.code ?? 'E';
}

export function gradeToNumeric(grade: string, grades = DEFAULT_KPI_GRADES): number {
  const found = grades.find((g) => g.code === grade);
  return found?.numeric ?? 0;
}

export function gradeToPayRaiseRate(grade: string, grades = DEFAULT_KPI_GRADES): number {
  const code = String(grade ?? '').trim().toUpperCase();
  const found = grades.find((g) => g.code.toUpperCase() === code);
  if (found) return Number(found.payRaiseRate) || 0;
  return DEFAULT_RATE_BY_CODE.get(code) ?? 0;
}

export function deriveCategoryScoresFromOverall(
  score: number
): Partial<Record<KpiCategoryKey, number>> {
  const base = Math.max(0, Math.min(100, Math.round(score)));
  return {
    productivity: base,
    attendance: base,
    quality: Math.max(0, base - 2),
    teamwork: Math.max(0, base - 5),
    discipline: base,
    customerService: Math.max(0, base - 3),
    leadership: Math.max(0, base - 8),
  };
}
