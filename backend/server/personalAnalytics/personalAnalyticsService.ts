import { Op, QueryTypes } from 'sequelize';
import {
  AttendanceRecord,
  Employee,
  EmployeeReview,
  LeaveRequest,
  OvertimeRequest,
  User,
  sequelize,
} from '../db.js';
import { findEmployeeByUserId } from '../employeeAttendanceSchedule.js';
import { getLeaveBalancesForUser } from '../leaveBalanceService.js';
import { monthKeysInRange } from '../dashboardDateRange.js';
import { getAttendancePeriod } from '../payroll/attendanceFinalizationService.js';
import { formatMonthShort } from '../dashboardChartStats.js';
import {
  computeOtTrend,
  computeTrend,
  previousPeriodRange,
  type PersonalAnalyticsRange,
  type TrendDirection,
} from './personalAnalyticsDateRange.js';
import {
  deriveCategoryScoresFromOverall,
  gradeToNumeric,
  KPI_CATEGORY_KEYS,
  KPI_CATEGORY_LABELS,
  loadKpiGradeDefinitions,
  scoreToGrade,
  type KpiCategoryKey,
} from './kpiGradeSettings.js';

type AttendanceMetrics = {
  workingDays: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
  earlyDepartures: number;
  attendanceRatePct: number;
  punctualityRatePct: number;
};

function parseCategoryScores(raw: unknown): Partial<Record<KpiCategoryKey, number>> {
  if (!raw) return {};
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!o || typeof o !== 'object') return {};
    const out: Partial<Record<KpiCategoryKey, number>> = {};
    for (const key of KPI_CATEGORY_KEYS) {
      const v = (o as Record<string, unknown>)[key];
      if (v != null && Number.isFinite(Number(v))) out[key] = Number(v);
    }
    return out;
  } catch {
    return {};
  }
}

async function isMonthReadyForAnalytics(monthKey: string, endDate: string): Promise<boolean> {
  const currentMonth = endDate.slice(0, 7);
  if (monthKey === currentMonth) return true;
  const period = await getAttendancePeriod(monthKey);
  const st = String(period?.status ?? 'OPEN').toUpperCase();
  return st === 'FINALIZED' || st === 'LOCKED';
}

function computeAttendanceMetrics(
  records: AttendanceRecord[],
  stdHoursPerDay: number
): AttendanceMetrics {
  let presentDays = 0;
  let absentDays = 0;
  let lateDays = 0;
  let earlyDepartures = 0;
  const dates = new Set<string>();

  for (const rec of records) {
    const date = String(rec.get('date')).slice(0, 10);
    dates.add(date);
    const st = String(rec.get('status') ?? '').toUpperCase();
    const clockIn = rec.get('clockIn');
    const workHours = Number(rec.get('workHours') ?? 0);

    if (st === 'ABSENT') absentDays += 1;
    if (st === 'PRESENT' || st === 'LATE' || (clockIn && st !== 'ABSENT')) {
      presentDays += 1;
    }
    if (st === 'LATE') lateDays += 1;
    if (
      clockIn &&
      workHours > 0 &&
      stdHoursPerDay > 0 &&
      workHours < stdHoursPerDay * 0.85 &&
      st !== 'ABSENT'
    ) {
      earlyDepartures += 1;
    }
  }

  const workingDays = dates.size || presentDays + absentDays;
  const attendanceRatePct =
    workingDays > 0 ? Math.round((presentDays / workingDays) * 1000) / 10 : 0;
  const punctualityRatePct =
    presentDays > 0
      ? Math.round(((presentDays - lateDays) / presentDays) * 1000) / 10
      : 100;

  return {
    workingDays,
    presentDays,
    absentDays,
    lateDays,
    earlyDepartures,
    attendanceRatePct,
    punctualityRatePct,
  };
}

async function buildMonthlyAttendanceTrend(
  records: AttendanceRecord[],
  range: PersonalAnalyticsRange,
  stdHours: number
) {
  const months = monthKeysInRange(range.startDate, range.endDate);
  const byMonth = new Map<string, AttendanceRecord[]>();
  for (const rec of records) {
    const mk = String(rec.get('date')).slice(0, 7);
    const list = byMonth.get(mk) ?? [];
    list.push(rec);
    byMonth.set(mk, list);
  }

  const periodReady = new Map<string, boolean>();
  const points: Array<{
    month: string;
    monthKey: string;
    present: number;
    absent: number;
    late: number;
    attendanceRatePct: number;
    finalized: boolean;
  }> = [];

  for (const monthKey of months) {
    let ready = periodReady.get(monthKey);
    if (ready === undefined) {
      ready = await isMonthReadyForAnalytics(monthKey, range.endDate);
      periodReady.set(monthKey, ready);
    }
    if (!ready) continue;

    const monthStart = `${monthKey}-01`;
    const y = Number(monthKey.slice(0, 4));
    const monthNum = Number(monthKey.slice(5, 7));
    const lastDay = new Date(y, monthNum, 0).getDate();
    const monthEnd =
      monthKey === range.endDate.slice(0, 7)
        ? range.endDate
        : `${monthKey}-${String(lastDay).padStart(2, '0')}`;

    const recs = (byMonth.get(monthKey) ?? []).filter((rec) => {
      const d = String(rec.get('date')).slice(0, 10);
      return d >= monthStart && d <= monthEnd;
    });
    const metrics = computeAttendanceMetrics(recs, stdHours);
    points.push({
      month: formatMonthShort(monthKey),
      monthKey,
      present: metrics.presentDays,
      absent: metrics.absentDays,
      late: metrics.lateDays,
      attendanceRatePct: metrics.attendanceRatePct,
      finalized: monthKey !== range.endDate.slice(0, 7),
    });
  }
  return points;
}

function recordsInRange(records: AttendanceRecord[], start: string, end: string) {
  return records.filter((rec) => {
    const d = String(rec.get('date')).slice(0, 10);
    return d >= start && d <= end;
  });
}

async function portalUserIdsForEmployees(employeeIds: string[]): Promise<string[]> {
  if (!employeeIds.length) return [];
  const users = await User.findAll({
    where: { employeeId: { [Op.in]: employeeIds } },
    attributes: ['id'],
  });
  return users.map((u) => String(u.get('id'))).filter(Boolean);
}

async function buildAttendanceSection(userId: string, range: PersonalAnalyticsRange) {
  const emp = await findEmployeeByUserId(userId);
  const stdHours = Number(emp?.get?.('work_hours') ?? 8) || 8;
  const prevRange = previousPeriodRange(range);
  const allRecords = await AttendanceRecord.findAll({
    where: {
      userId,
      date: { [Op.between]: [prevRange.startDate, range.endDate] },
    },
    order: [['date', 'ASC']],
  });
  const records = recordsInRange(allRecords, range.startDate, range.endDate);
  const prevRecords = recordsInRange(allRecords, prevRange.startDate, prevRange.endDate);
  const metrics = computeAttendanceMetrics(records, stdHours);
  const prevMetrics = computeAttendanceMetrics(prevRecords, stdHours);

  const monthlyTrend = await buildMonthlyAttendanceTrend(records, range, stdHours);

  return {
    summary: metrics,
    trends: {
      attendanceRate: computeTrend(metrics.attendanceRatePct, prevMetrics.attendanceRatePct, true),
      punctuality: computeTrend(metrics.punctualityRatePct, prevMetrics.punctualityRatePct, true),
      presentDays: computeTrend(metrics.presentDays, prevMetrics.presentDays, true),
    },
    monthlyTrend,
    lateTrend: monthlyTrend.map((p) => ({
      month: p.month,
      late: p.late,
    })),
  };
}

async function buildLeaveSection(userId: string, range: PersonalAnalyticsRange) {
  const emp = await findEmployeeByUserId(userId);
  const empPk = emp?.get?.('id');
  const year = Number(range.endDate.slice(0, 4));

  let balances: Awaited<ReturnType<typeof getLeaveBalancesForUser>> = [];
  if (empPk) {
    try {
      // getLeaveBalancesForUser expects portal userId, not employee PK.
      balances = await getLeaveBalancesForUser(String(userId), year);
    } catch {
      balances = [];
    }
  }

  const approvedLeaves = await LeaveRequest.findAll({
    where: {
      userId,
      status: 'APPROVED',
      startDate: { [Op.lte]: range.endDate },
      endDate: { [Op.gte]: range.startDate },
    },
  });

  const byType = new Map<string, number>();
  const byMonth = new Map<string, number>();
  let annualUsed = 0;
  let sickUsed = 0;
  let unpaidUsed = 0;

  for (const row of approvedLeaves) {
    const type = String(row.get('type') ?? 'Other');
    const days = Number(row.get('days') ?? 1) || 1;
    byType.set(type, (byType.get(type) ?? 0) + days);

    const start = String(row.get('startDate')).slice(0, 7);
    byMonth.set(start, (byMonth.get(start) ?? 0) + days);

    const lower = type.toLowerCase();
    if (lower.includes('annual') || lower.includes('vacation')) annualUsed += days;
    else if (lower.includes('sick')) sickUsed += days;
    else if (lower.includes('unpaid')) unpaidUsed += days;
  }

  const annualBalance = balances.find(
    (b) =>
      b.code?.toLowerCase().includes('annual') ||
      b.leaveTypeName?.toLowerCase().includes('annual')
  );
  const annualRemaining = annualBalance?.remaining ?? null;

  const distribution = [...byType.entries()].map(([name, value]) => ({ name, value }));
  const monthlyUsage = monthKeysInRange(range.startDate, range.endDate).map((mk) => ({
    month: formatMonthShort(mk),
    days: byMonth.get(mk) ?? 0,
  }));

  const prevYearStart = `${year - 1}-01-01`;
  const prevYearEnd = `${year - 1}-12-31`;
  const prevYearLeaves = await LeaveRequest.count({
    where: {
      userId,
      status: 'APPROVED',
      startDate: { [Op.lte]: prevYearEnd },
      endDate: { [Op.gte]: prevYearStart },
    },
  });

  const mostUsed = distribution.sort((a, b) => b.value - a.value)[0]?.name ?? null;
  const peakMonth = [...byMonth.entries()].sort((a, b) => b[1] - a[1])[0];

  const insights: string[] = [];
  if (mostUsed) insights.push(`Most used leave type: ${mostUsed}.`);
  if (peakMonth && peakMonth[1] > 0) {
    insights.push(`Peak leave month: ${formatMonthShort(peakMonth[0])} (${peakMonth[1]} day(s)).`);
  }
  if (prevYearLeaves > 0 && approvedLeaves.length > 0) {
    const cmp =
      approvedLeaves.length > prevYearLeaves
        ? 'higher'
        : approvedLeaves.length < prevYearLeaves
          ? 'lower'
          : 'similar';
    insights.push(`Leave usage this period is ${cmp} than the same window last year.`);
  }

  return {
    balances: {
      annualRemaining,
      annualUsed,
      sickUsed,
      unpaidUsed,
      otherUsed: Math.max(
        0,
        [...byType.values()].reduce((s, v) => s + v, 0) - annualUsed - sickUsed - unpaidUsed
      ),
      rows: balances,
    },
    distribution,
    monthlyUsage,
    insights,
  };
}

async function buildOvertimeSection(userId: string, range: PersonalAnalyticsRange) {
  const months = monthKeysInRange(range.startDate, range.endDate);
  const prevRange = previousPeriodRange(range);
  const periodReady = new Map<string, boolean>();
  for (const monthKey of months) {
    const ready =
      monthKey === range.endDate.slice(0, 7) ||
      (await isMonthReadyForAnalytics(monthKey, range.endDate));
    periodReady.set(monthKey, ready);
  }

  const otRows = await OvertimeRequest.findAll({
    where: {
      userId,
      status: 'APPROVED',
      workDate: { [Op.between]: [prevRange.startDate, range.endDate] },
    },
  });

  const hoursByMonth = new Map<string, number>();
  let totalHours = 0;
  let prevTotal = 0;
  let compensationUsd = 0;

  for (const row of otRows) {
    const workDate = String(row.get('workDate')).slice(0, 10);
    const hours = Number(row.get('hours') ?? 0);
    const tier = String(row.get('rateTier') ?? '');
    const h = hours;

    if (workDate >= prevRange.startDate && workDate <= prevRange.endDate) {
      prevTotal += h;
    }
    if (workDate < range.startDate || workDate > range.endDate) continue;

    const mk = workDate.slice(0, 7);
    if (!periodReady.get(mk)) continue;

    totalHours += h;
    hoursByMonth.set(mk, (hoursByMonth.get(mk) ?? 0) + h);
    const mult = tier.includes('200') ? 2 : 1.5;
    compensationUsd += hours * mult;
  }

  const monthly = months
    .filter((mk) => periodReady.get(mk))
    .map((monthKey) => ({
      month: formatMonthShort(monthKey),
      monthKey,
      hours: Math.round((hoursByMonth.get(monthKey) ?? 0) * 10) / 10,
    }));

  const readyMonthCount = monthly.length || 1;
  const avgPerMonth = Math.round((totalHours / readyMonthCount) * 10) / 10;

  return {
    totalHours: Math.round(totalHours * 10) / 10,
    averageMonthlyHours: avgPerMonth,
    approvedHours: Math.round(totalHours * 10) / 10,
    compensationEstimateUsd: Math.round(compensationUsd * 100) / 100,
    monthlyTrend: monthly,
    trend: computeOtTrend(totalHours, prevTotal),
  };
}

async function averagePerformanceScore(userIds: string[]): Promise<number | null> {
  if (!userIds.length) return null;
  const reviews = await EmployeeReview.findAll({
    where: {
      userId: { [Op.in]: userIds },
      reviewType: 'PERFORMANCE',
      status: { [Op.in]: ['PASSED', 'IN_PROGRESS'] },
      score: { [Op.neither]: null },
    },
    order: [['reviewedAt', 'DESC']],
  });
  const latestByUser = new Map<string, number>();
  for (const r of reviews) {
    const uid = String(r.get('userId'));
    if (!latestByUser.has(uid)) latestByUser.set(uid, Number(r.get('score')));
  }
  const scores = [...latestByUser.values()].filter((s) => Number.isFinite(s));
  if (!scores.length) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

async function buildKpiSection(userId: string, range: PersonalAnalyticsRange) {
  const grades = await loadKpiGradeDefinitions();

  type AppraisalHistoryRow = {
    id: string;
    weighted_score: number;
    final_grade: string | null;
    periodName: string;
    end_date: string;
    ranking_position: number | null;
    strengths: string | null;
    weaknesses: string | null;
  };

  const appraisalRows = (await sequelize.query(
    `SELECT ea.id, ea.weighted_score, ea.final_grade, ea.ranking_position,
            ea.strengths, ea.weaknesses, ap.name AS periodName, ap.end_date
     FROM employee_appraisals ea
     JOIN appraisal_periods ap ON ap.id = ea.period_id
     WHERE ea.user_id = :userId AND ea.weighted_score IS NOT NULL
       AND ea.workflow_status IN ('APPROVED', 'CLOSED')
     ORDER BY ap.end_date ASC`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  )) as AppraisalHistoryRow[];

  const filteredAppraisals = appraisalRows.filter((a) => {
    const end = String(a.end_date).slice(0, 10);
    return end >= range.startDate && end <= range.endDate;
  });

  const history: Array<{
    period: string;
    grade: string;
    scorePct: number;
    numeric: number;
  }> = [];
  const gradeCounts = new Map<string, number>();

  if (filteredAppraisals.length) {
    for (const a of filteredAppraisals) {
      const score = Number(a.weighted_score);
      const grade = String(a.final_grade ?? scoreToGrade(score, grades));
      history.push({
        period: String(a.periodName ?? a.end_date).slice(0, 20),
        grade,
        scorePct: score,
        numeric: gradeToNumeric(grade, grades),
      });
      gradeCounts.set(grade, (gradeCounts.get(grade) ?? 0) + 1);
    }
  } else {
    const reviews = await EmployeeReview.findAll({
      where: {
        userId,
        reviewType: 'PERFORMANCE',
        status: { [Op.in]: ['PASSED', 'IN_PROGRESS'] },
      },
      order: [['periodEnd', 'ASC'], ['reviewedAt', 'ASC']],
    });

    for (const r of reviews) {
      const score = Number(r.get('score'));
      if (!Number.isFinite(score)) continue;
      const periodEnd = String(r.get('periodEnd') ?? r.get('periodMonth') ?? '').slice(0, 10);
      const periodMonth = String(r.get('periodMonth') ?? periodEnd.slice(0, 7));
      if (
        periodMonth &&
        (periodMonth < range.startDate.slice(0, 7) || periodMonth > range.endDate.slice(0, 7))
      ) {
        continue;
      }
      const grade = String(r.get('grade') ?? scoreToGrade(score, grades));
      history.push({
        period: periodMonth || formatMonthShort(periodEnd.slice(0, 7)),
        grade,
        scorePct: score,
        numeric: gradeToNumeric(grade, grades),
      });
      gradeCounts.set(grade, (gradeCounts.get(grade) ?? 0) + 1);
    }
  }

  const latest = history[history.length - 1];
  const latestAppraisal = filteredAppraisals[filteredAppraisals.length - 1];

  let categories: Partial<Record<KpiCategoryKey, number>> = {};
  let categoryBreakdown: Array<{ key: string; label: string; scorePct: number | null }> = [];

  if (latestAppraisal) {
    const compScores = (await sequelize.query(
      `SELECT acs.raw_score, kc.name AS componentName, kc.id AS componentId
       FROM appraisal_component_scores acs
       JOIN kpi_config_items kc ON kc.id = acs.component_id AND kc.kind = 'component'
       WHERE acs.appraisal_id = :id
       ORDER BY kc.sort_order ASC`,
      { replacements: { id: latestAppraisal.id }, type: QueryTypes.SELECT }
    )) as Array<{ raw_score: number; componentName: string; componentId: string }>;

    categoryBreakdown = compScores.map((c) => ({
      key: c.componentId,
      label: c.componentName,
      scorePct: Number(c.raw_score),
    }));
  } else {
    const reviews = await EmployeeReview.findAll({
      where: {
        userId,
        reviewType: 'PERFORMANCE',
        status: { [Op.in]: ['PASSED', 'IN_PROGRESS'] },
      },
      order: [['reviewedAt', 'DESC']],
      limit: 1,
    });
    const categoryScoresRaw = reviews[0]?.get('categoryScoresJson');
    categories = parseCategoryScores(categoryScoresRaw);
    if (!Object.keys(categories).length && latest) {
      categories = deriveCategoryScoresFromOverall(latest.scorePct);
    }
    categoryBreakdown = KPI_CATEGORY_KEYS.map((key) => ({
      key,
      label: KPI_CATEGORY_LABELS[key],
      scorePct: categories[key] ?? null,
    })).filter((c) => c.scorePct != null);
  }

  const strengthAreas: string[] = [];
  const improvementAreas: string[] = [];
  if (latestAppraisal?.strengths) {
    for (const line of latestAppraisal.strengths.split('\n')) {
      const t = line.trim();
      if (t) strengthAreas.push(t);
    }
  }
  if (latestAppraisal?.weaknesses) {
    for (const line of latestAppraisal.weaknesses.split('\n')) {
      const t = line.trim();
      if (t) improvementAreas.push(t);
    }
  }
  for (const c of categoryBreakdown) {
    if ((c.scorePct ?? 0) >= 85 && !strengthAreas.includes(c.label)) {
      strengthAreas.push(c.label);
    }
    if ((c.scorePct ?? 100) < 70 && !improvementAreas.includes(c.label)) {
      improvementAreas.push(c.label);
    }
  }

  const emp = await findEmployeeByUserId(userId);
  const deptId = emp?.get?.('department_id');
  let deptAvg: number | null = null;
  let companyAvg: number | null = null;

  async function avgAppraisalScoreForUsers(ids: string[]): Promise<number | null> {
    if (!ids.length) return null;
    const rows = (await sequelize.query(
      `SELECT ea.user_id, ea.weighted_score
       FROM employee_appraisals ea
       INNER JOIN (
         SELECT user_id, MAX(ap.end_date) AS max_end
         FROM employee_appraisals ea2
         JOIN appraisal_periods ap ON ap.id = ea2.period_id
         WHERE ea2.weighted_score IS NOT NULL AND ea2.user_id IN (:ids)
           AND ea2.workflow_status IN ('APPROVED', 'CLOSED')
         GROUP BY ea2.user_id
       ) latest ON latest.user_id = ea.user_id
       JOIN appraisal_periods ap ON ap.id = ea.period_id AND ap.end_date = latest.max_end
       WHERE ea.weighted_score IS NOT NULL
         AND ea.workflow_status IN ('APPROVED', 'CLOSED')`,
      { replacements: { ids }, type: QueryTypes.SELECT }
    )) as Array<{ weighted_score: number }>;
    if (rows.length) {
      const total = rows.reduce((s, r) => s + Number(r.weighted_score), 0);
      return Math.round((total / rows.length) * 100) / 100;
    }
    return averagePerformanceScore(ids);
  }

  if (deptId) {
    const deptEmployees = await Employee.findAll({
      where: { department_id: deptId, status: { [Op.in]: ['active', 'ACTIVE'] } },
      attributes: ['id'],
    });
    const deptUserIds = await portalUserIdsForEmployees(
      deptEmployees.map((e) => String(e.get('id')))
    );
    deptAvg = await avgAppraisalScoreForUsers(deptUserIds);
  }

  const allStaff = await Employee.findAll({
    where: { status: { [Op.in]: ['active', 'ACTIVE'] } },
    attributes: ['id'],
    limit: 200,
  });
  const allUserIds = await portalUserIdsForEmployees(
    allStaff.map((e) => String(e.get('id')))
  );
  companyAvg = await avgAppraisalScoreForUsers(allUserIds);

  const insights: string[] = [];
  if (history.length >= 2) {
    const first = history[0].scorePct;
    const last = history[history.length - 1].scorePct;
    const delta = last - first;
    if (Math.abs(delta) >= 1) {
      insights.push(
        `Your KPI performance ${delta > 0 ? 'improved' : 'declined'} by ${Math.abs(Math.round(delta))}% compared to the start of this period.`
      );
    }
  }
  const topCat = [...categoryBreakdown].sort((a, b) => (b.scorePct ?? 0) - (a.scorePct ?? 0))[0];
  const lowCat = [...categoryBreakdown].sort((a, b) => (a.scorePct ?? 0) - (b.scorePct ?? 0))[0];
  if (topCat?.label) insights.push(`Strongest KPI component: ${topCat.label}.`);
  if (lowCat?.label && (lowCat.scorePct ?? 100) < (topCat?.scorePct ?? 100) - 5) {
    insights.push(`Improvement opportunity: ${lowCat.label}.`);
  }
  if (latestAppraisal?.ranking_position) {
    insights.push(`Your ranking in the latest appraisal period: #${latestAppraisal.ranking_position}.`);
  }

  return {
    currentGrade: latest?.grade ?? null,
    performanceScorePct: latest?.scorePct ?? null,
    departmentAveragePct: deptAvg,
    companyAveragePct: companyAvg,
    rankingPosition: latestAppraisal?.ranking_position ?? null,
    gradeScale: grades,
    history,
    gradeDistribution: [...gradeCounts.entries()].map(([grade, count]) => ({ grade, count })),
    categoryBreakdown,
    strengthAreas,
    improvementAreas,
    insights,
  };
}

export async function buildPersonalAnalytics(
  userId: string,
  range: PersonalAnalyticsRange
): Promise<Record<string, unknown>> {
  const [attendance, leave, overtime, kpi] = await Promise.all([
    buildAttendanceSection(userId, range),
    buildLeaveSection(userId, range),
    buildOvertimeSection(userId, range),
    buildKpiSection(userId, range),
  ]);

  const summary = {
    attendanceRatePct: attendance.summary.attendanceRatePct,
    leaveBalanceDays: leave.balances.annualRemaining,
    otHours: overtime.totalHours,
    kpiGrade: kpi.currentGrade,
    trends: {
      attendance: attendance.trends.attendanceRate as TrendDirection,
      overtime: overtime.trend as TrendDirection,
    },
  };

  return {
    userId,
    range,
    readOnly: true,
    summary,
    attendance,
    leave,
    overtime,
    kpi,
  };
}
