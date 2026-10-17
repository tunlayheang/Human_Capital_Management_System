import { QueryTypes } from 'sequelize';
import { sequelize } from '../db.js';
import {
  APPRAISAL_DEPARTMENT_ID_EXPR,
  APPRAISAL_EMPLOYEE_JOINS,
  APPRAISAL_EMPLOYEE_NAME_EXPR,
} from './appraisalQuerySql.js';
import { FINALIZED_APPRAISAL_STATUSES } from './appraisalTypes.js';

export async function buildAppraisalAnalytics(filters?: {
  periodId?: string;
  departmentId?: string;
}) {
  const clauses: string[] = [
    'ea.weighted_score IS NOT NULL',
    `ea.workflow_status IN (${FINALIZED_APPRAISAL_STATUSES.map((s) => `'${s}'`).join(', ')})`,
  ];
  const replacements: Record<string, unknown> = {};
  if (filters?.periodId) {
    clauses.push('ea.period_id = :periodId');
    replacements.periodId = filters.periodId;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = (await sequelize.query(
    `SELECT ea.*, ${APPRAISAL_EMPLOYEE_NAME_EXPR}, ${APPRAISAL_DEPARTMENT_ID_EXPR}, ap.name AS periodName
     FROM employee_appraisals ea
     ${APPRAISAL_EMPLOYEE_JOINS}
     LEFT JOIN appraisal_periods ap ON ap.id = ea.period_id
     ${where}`,
    { replacements, type: QueryTypes.SELECT }
  )) as Array<{
    user_id: string;
    employeeName: string;
    departmentId: string | null;
    weighted_score: number;
    final_grade: string;
    period_id: string;
    periodName: string;
  }>;

  let filtered = rows;
  if (filters?.departmentId) {
    filtered = rows.filter((r) => r.departmentId === filters.departmentId);
  }

  const gradeDistribution = new Map<string, number>();
  let totalScore = 0;
  for (const r of filtered) {
    const grade = String(r.final_grade ?? '—');
    gradeDistribution.set(grade, (gradeDistribution.get(grade) ?? 0) + 1);
    totalScore += Number(r.weighted_score) || 0;
  }

  const avgScore = filtered.length ? Math.round((totalScore / filtered.length) * 100) / 100 : 0;

  const ranked = [...filtered]
    .sort((a, b) => Number(b.weighted_score) - Number(a.weighted_score))
    .map((r, i) => ({
      rank: i + 1,
      userId: r.user_id,
      employeeName: r.employeeName,
      departmentId: r.departmentId,
      score: Number(r.weighted_score),
      grade: r.final_grade,
    }));

  const topPerformers = ranked.slice(0, 5);
  const lowPerformers = [...ranked].reverse().slice(0, 5);

  const byDepartment = new Map<string, { count: number; total: number }>();
  for (const r of filtered) {
    const dept = r.departmentId ?? 'unassigned';
    const cur = byDepartment.get(dept) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(r.weighted_score) || 0;
    byDepartment.set(dept, cur);
  }

  const departmentAverages = [...byDepartment.entries()].map(([departmentId, v]) => ({
    departmentId,
    averageScore: v.count ? Math.round((v.total / v.count) * 100) / 100 : 0,
    headcount: v.count,
  }));

  return {
    summary: {
      totalAppraisals: filtered.length,
      averageScore: avgScore,
    },
    gradeDistribution: [...gradeDistribution.entries()].map(([grade, count]) => ({ grade, count })),
    topPerformers,
    lowPerformers,
    departmentAverages,
    companyRanking: ranked,
  };
}

export async function buildEmployeeAppraisalTrend(userId: string) {
  const history = (await sequelize.query(
    `SELECT ea.weighted_score, ea.final_grade, ea.updated_at, ap.name AS periodName,
            ap.start_date, ap.end_date, ap.period_type
     FROM employee_appraisals ea
     JOIN appraisal_periods ap ON ap.id = ea.period_id
     WHERE ea.user_id = :userId AND ea.weighted_score IS NOT NULL
       AND ea.workflow_status IN ('APPROVED', 'CLOSED')
     ORDER BY ap.start_date ASC`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  )) as Array<Record<string, unknown>>;

  return { history };
}
