/** MLVT/RGC paid public holidays (rest days only) — Team Leave Calendar / roster / payroll. */
export type PublicHoliday = { date: string; nameEn: string };

/**
 * Sub-Decree No. 167 / MLVT Prakas No. 216/25 — 22 paid rest days in 2026.
 * Includes only days employees are entitled to rest (not ceremonial-only observances).
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

/**
 * MLVT Prakas on Paid Public Holidays 2025 — paid rest days only.
 */
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
  // Other years: remap the nearest known calendar (lunar festivals will need a yearly update).
  const base = year < 2026 ? HOLIDAYS_2025 : HOLIDAYS_2026;
  return base.map((h) => ({
    ...h,
    date: h.date.replace(/^\d{4}/, String(year)),
  }));
}
