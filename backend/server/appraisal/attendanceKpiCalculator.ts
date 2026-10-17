import { QueryTypes } from 'sequelize';
import { AttendanceRecord, sequelize } from '../db.js';
import { Op } from 'sequelize';
import { clampScore } from './appraisalTypes.js';
import { listAttendanceDeductionRules } from './kpiComponentService.js';

type AttendanceCounts = {
  presentDays: number;
  lateDays: number;
  absentDays: number;
  earlyLeaveDays: number;
  unpaidLeaveDays: number;
};

async function countAttendanceMetrics(
  userId: string,
  startDate: string,
  endDate: string
): Promise<AttendanceCounts> {
  const records = await AttendanceRecord.findAll({
    where: {
      userId,
      date: { [Op.between]: [startDate, endDate] },
    },
  });

  let presentDays = 0;
  let lateDays = 0;
  let absentDays = 0;
  let earlyLeaveDays = 0;
  let unpaidLeaveDays = 0;

  for (const rec of records) {
    const st = String(rec.get('status') ?? '').toUpperCase();
    const workHours = Number(rec.get('workHours') ?? 0);
    const clockIn = rec.get('clockIn');

    if (st === 'ABSENT') absentDays += 1;
    if (st === 'UNPAID_LEAVE' || st === 'UNPAID LEAVE') unpaidLeaveDays += 1;
    if (st === 'LATE') lateDays += 1;
    if (st === 'PRESENT' || st === 'LATE' || (clockIn && st !== 'ABSENT')) {
      presentDays += 1;
    }
    if (clockIn && workHours > 0 && workHours < 6 && st !== 'ABSENT') {
      earlyLeaveDays += 1;
    }
  }

  return { presentDays, lateDays, absentDays, earlyLeaveDays, unpaidLeaveDays };
}

function applyDeductionRules(
  baseScore: number,
  count: number,
  rules: Awaited<ReturnType<typeof listAttendanceDeductionRules>>,
  ruleType: string
): number {
  if (count <= 0) return baseScore;
  let score = baseScore;
  const typeRules = rules.filter((r) => r.rule_type === ruleType);
  for (const rule of typeRules) {
    const mode = String(rule.deduction_mode ?? 'RANGE').toUpperCase();
    const points = Number(rule.deduction_points) || 0;
    if (mode === 'PER_OCCURRENCE') {
      score -= count * points;
      continue;
    }
    const min = Number(rule.min_count);
    const max = rule.max_count != null ? Number(rule.max_count) : null;
    if (count >= min && (max == null || count <= max)) {
      score -= points;
    }
  }
  return score;
}

export async function calculateAttendanceKpiScore(
  userId: string,
  startDate: string,
  endDate: string
): Promise<{ score: number; breakdown: Record<string, number> }> {
  const counts = await countAttendanceMetrics(userId, startDate, endDate);
  const rules = await listAttendanceDeductionRules();

  let score = 100;
  score = applyDeductionRules(score, counts.lateDays, rules, 'LATE');
  score = applyDeductionRules(score, counts.absentDays, rules, 'ABSENCE');
  score = applyDeductionRules(score, counts.earlyLeaveDays, rules, 'EARLY_LEAVE');
  score = applyDeductionRules(score, counts.unpaidLeaveDays, rules, 'UNPAID_LEAVE');

  return {
    score: clampScore(score),
    breakdown: {
      presentDays: counts.presentDays,
      lateDays: counts.lateDays,
      absentDays: counts.absentDays,
      earlyLeaveDays: counts.earlyLeaveDays,
      unpaidLeaveDays: counts.unpaidLeaveDays,
    },
  };
}

export async function previewAttendanceKpiForPeriod(
  userId: string,
  periodId: string
): Promise<{ score: number; breakdown: Record<string, number> }> {
  const rows = (await sequelize.query(
    `SELECT start_date, end_date FROM appraisal_periods WHERE id = :id LIMIT 1`,
    { replacements: { id: periodId }, type: QueryTypes.SELECT }
  )) as Array<{ start_date: string; end_date: string }>;
  const period = rows[0];
  if (!period) throw new Error('Appraisal period not found');
  return calculateAttendanceKpiScore(userId, String(period.start_date), String(period.end_date));
}
