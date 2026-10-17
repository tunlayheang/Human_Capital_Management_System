import { QueryTypes } from 'sequelize';
import { sequelize } from '../../db.js';
import type { ReportRunner, ReportRow } from '../reportTypes.js';
import { num, resolveDateRangeFromFilters, str } from '../reportFilterUtils.js';

type LeavingRow = {
  department: string;
  departmentId: string;
  headcount: string | number;
  present: string | number;
  absent: string | number;
  late: string | number;
  earlyLeave: string | number;
  onLeave: string | number;
};

/**
 * Leaving by Department — attendance metrics by department for the period.
 * (Catalog title; replaces attrition-focused layout.)
 */
export const runLeavingByDepartment: ReportRunner = async (filters) => {
  const range = resolveDateRangeFromFilters(filters);
  const rowsRaw = (await sequelize.query(
    `
    SELECT
      COALESCE(d.name, 'Unassigned') AS department,
      COALESCE(d.id, '_none') AS departmentId,
      (
        SELECT COUNT(*)
        FROM employees e2
        WHERE e2.department_id <=> d.id
          AND LOWER(COALESCE(e2.status, '')) IN ('active', 'probation')
      ) AS headcount,
      SUM(CASE WHEN ar.status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) AS present,
      SUM(CASE WHEN ar.status = 'ABSENT' THEN 1 ELSE 0 END) AS absent,
      SUM(CASE WHEN ar.status = 'LATE' THEN 1 ELSE 0 END) AS late,
      SUM(
        CASE
          WHEN ar.clockIn IS NOT NULL
            AND COALESCE(ar.workHours, 0) > 0
            AND COALESCE(ar.workHours, 0) < 6
            AND UPPER(COALESCE(ar.status, '')) NOT IN ('ABSENT', 'ON_LEAVE', 'PAID_LEAVE', 'UNPAID_LEAVE', 'DAY_OFF', 'PH', 'MISSION')
          THEN 1 ELSE 0
        END
      ) AS earlyLeave,
      SUM(
        CASE
          WHEN UPPER(COALESCE(ar.status, '')) IN ('ON_LEAVE', 'PAID_LEAVE', 'UNPAID_LEAVE')
          THEN 1 ELSE 0
        END
      ) AS onLeave
    FROM attendancerecords ar
    INNER JOIN users u ON u.id = ar.userId
    LEFT JOIN employees e ON e.id = u.employeeId
    LEFT JOIN departments d ON d.id = e.department_id
    WHERE ar.date BETWEEN :startDate AND :endDate
      AND (:departmentId = '' OR e.department_id = :departmentId)
    GROUP BY d.id, d.name
    ORDER BY present DESC
    `,
    {
      replacements: {
        startDate: range.startDate,
        endDate: range.endDate,
        departmentId: filters.departmentId || '',
      },
      type: QueryTypes.SELECT,
      logging: false,
    }
  )) as LeavingRow[];

  const rows: ReportRow[] = rowsRaw
    .map((r) => {
      const present = parseInt(String(r.present), 10) || 0;
      const absent = parseInt(String(r.absent), 10) || 0;
      const late = parseInt(String(r.late), 10) || 0;
      const earlyLeave = parseInt(String(r.earlyLeave), 10) || 0;
      const onLeave = parseInt(String(r.onLeave), 10) || 0;
      const headcount = parseInt(String(r.headcount), 10) || 0;
      const denom = present + absent;
      const attendanceRate =
        denom > 0 ? Math.round((present / denom) * 1000) / 10 : 0;
      return {
        department: str(r.department) || 'Unassigned',
        headcount,
        present,
        absent,
        late,
        earlyLeave,
        onLeave,
        attendanceRate,
      };
    })
    .filter(
      (r) =>
        num(r.present) +
          num(r.absent) +
          num(r.late) +
          num(r.earlyLeave) +
          num(r.onLeave) >
          0 || num(r.headcount) > 0
    )
    .sort((a, b) => String(a.department).localeCompare(String(b.department)));

  const present = rows.reduce((s, r) => s + num(r.present), 0);
  const absent = rows.reduce((s, r) => s + num(r.absent), 0);
  const denom = present + absent;

  return {
    columns: [
      { key: 'department', label: 'Department' },
      { key: 'headcount', label: 'Headcount', align: 'right', format: 'number' },
      { key: 'present', label: 'Present', align: 'right', format: 'number' },
      { key: 'absent', label: 'Absent', align: 'right', format: 'number' },
      { key: 'late', label: 'Late', align: 'right', format: 'number' },
      { key: 'earlyLeave', label: 'Early Leave', align: 'right', format: 'number' },
      { key: 'onLeave', label: 'On Leave', align: 'right', format: 'number' },
      {
        key: 'attendanceRate',
        label: 'Attendance Rate (%)',
        align: 'right',
        format: 'percent',
        aggregate: 'avg',
      },
    ],
    rows,
    note: `Period ${range.startDate} → ${range.endDate}. Early leave ≈ clocked days with work hours under 6.`,
    summaryCards: [
      { key: 'depts', label: 'Departments', value: rows.length, format: 'number' },
      { key: 'present', label: 'Present', value: present, format: 'number' },
      { key: 'absent', label: 'Absent', value: absent, format: 'number' },
      {
        key: 'overallRate',
        label: 'Attendance Rate (%)',
        value: denom > 0 ? Math.round((present / denom) * 1000) / 10 : 0,
        format: 'percent',
      },
    ],
  };
};

/** @deprecated Prefer runLeavingByDepartment — kept for older imports. */
export const runAttendanceByDepartment = runLeavingByDepartment;
