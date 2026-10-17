export type PublicHoliday = { date: string; nameEn: string };

/**
 * Sub-Decree No. 167 / MLVT Prakas No. 216/25 — 22 paid rest days in 2026.
 * Rest/paid public holidays only (used by payroll working-days and roster PH).
 */
const HOLIDAYS_2026: PublicHoliday[] = [
  { date: '2026-01-01', nameEn: "New Year's Day" },
  { date: '2026-01-07', nameEn: 'Victory over Genocide Day' },
  { date: '2026-03-08', nameEn: "International Women's Day" },
  { date: '2026-04-14', nameEn: 'Khmer New Year' },
  { date: '2026-04-15', nameEn: 'Khmer New Year' },
  { date: '2026-04-16', nameEn: 'Khmer New Year' },
  { date: '2026-05-01', nameEn: 'International Labour Day & Visak Bochea' },
  { date: '2026-05-05', nameEn: 'Royal Ploughing Ceremony' },
  { date: '2026-05-14', nameEn: "King's Birthday" },
  { date: '2026-06-18', nameEn: "Queen Mother's Birthday" },
  { date: '2026-09-24', nameEn: 'Constitution Day' },
  { date: '2026-10-10', nameEn: 'Pchum Ben' },
  { date: '2026-10-11', nameEn: 'Pchum Ben' },
  { date: '2026-10-12', nameEn: 'Pchum Ben' },
  { date: '2026-10-15', nameEn: 'Commemoration Day of King Father' },
  { date: '2026-10-29', nameEn: 'King Coronation Day' },
  { date: '2026-11-09', nameEn: 'Independence Day' },
  { date: '2026-11-23', nameEn: 'Water Festival' },
  { date: '2026-11-24', nameEn: 'Water Festival' },
  { date: '2026-11-25', nameEn: 'Water Festival' },
  { date: '2026-12-29', nameEn: 'Peace Day' },
];

/** MLVT Prakas on Paid Public Holidays 2025 — paid rest days only. */
const HOLIDAYS_2025: PublicHoliday[] = [
  { date: '2025-01-01', nameEn: "New Year's Day" },
  { date: '2025-01-07', nameEn: 'Victory over Genocide Day' },
  { date: '2025-03-08', nameEn: "International Women's Day" },
  { date: '2025-04-14', nameEn: 'Khmer New Year' },
  { date: '2025-04-15', nameEn: 'Khmer New Year' },
  { date: '2025-04-16', nameEn: 'Khmer New Year' },
  { date: '2025-05-01', nameEn: 'International Labour Day' },
  { date: '2025-05-11', nameEn: 'Visak Bochea' },
  { date: '2025-05-14', nameEn: "King's Birthday" },
  { date: '2025-05-15', nameEn: 'Royal Ploughing Ceremony' },
  { date: '2025-06-18', nameEn: "Queen Mother's Birthday" },
  { date: '2025-09-21', nameEn: 'Pchum Ben' },
  { date: '2025-09-22', nameEn: 'Pchum Ben' },
  { date: '2025-09-23', nameEn: 'Pchum Ben' },
  { date: '2025-09-24', nameEn: 'Constitution Day' },
  { date: '2025-10-15', nameEn: 'Commemoration Day of King Father' },
  { date: '2025-10-29', nameEn: 'King Coronation Day' },
  { date: '2025-11-04', nameEn: 'Water Festival' },
  { date: '2025-11-05', nameEn: 'Water Festival' },
  { date: '2025-11-06', nameEn: 'Water Festival' },
  { date: '2025-11-09', nameEn: 'Independence Day' },
  { date: '2025-12-29', nameEn: 'Peace Day' },
];

export function getCambodiaPublicHolidays(year: number): PublicHoliday[] {
  if (year === 2026) return HOLIDAYS_2026;
  if (year === 2025) return HOLIDAYS_2025;
  const base = year < 2026 ? HOLIDAYS_2025 : HOLIDAYS_2026;
  return base.map((h) => ({
    ...h,
    date: h.date.replace(/^\d{4}/, String(year)),
  }));
}

export const DEFAULT_PAYROLL_TAX_BRACKETS_USD = [
  { min: 0, max: 375, rate: 0, label: '$0 – $375' },
  { min: 376, max: 500, rate: 5, label: '$376 – $500' },
  { min: 501, max: 2125, rate: 10, label: '$501 – $2,125' },
  { min: 2126, max: 3125, rate: 15, label: '$2,126 – $3,125' },
  { min: 3126, max: 9999999, rate: 20, label: '> $3,125' },
];
