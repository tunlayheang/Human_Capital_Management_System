import { Op } from 'sequelize';
import { Department, Employee, Position } from '../../db.js';
import { resolveDepartmentHeadsBatch } from '../../departmentManager.js';
import { getEmployeeSummaryCounts } from '../../employeeSummaryCounts.js';
import type { ReportRunner, ReportRow } from '../reportTypes.js';
import { num, str } from '../reportFilterUtils.js';

/** Department report — one row per department: Department, Position, Manager, Total staff. */
export const runHeadcountSummary: ReportRunner = async (filters) => {
  const summary = await getEmployeeSummaryCounts({
    department_id: filters.departmentId || undefined,
  });

  const deptWhere = filters.departmentId
    ? { id: filters.departmentId }
    : { isActive: { [Op.ne]: false } };
  const departments = await Department.findAll({
    where: deptWhere as Record<string, unknown>,
    attributes: ['id', 'name', 'managerId', 'department_head_id', 'isActive'],
    limit: 2000,
  });

  const deptIds = departments.map((d) => str(d.get('id'))).filter(Boolean);
  const headMap = await resolveDepartmentHeadsBatch(departments);

  const employees = await Employee.findAll({
    attributes: ['id', 'department_id', 'position_id', 'job_position', 'status'],
    where: filters.departmentId ? { department_id: filters.departmentId } : undefined,
    limit: 8000,
  });

  const positions = await Position.findAll({
    attributes: ['id', 'title', 'department_id'],
    where: deptIds.length ? { department_id: { [Op.in]: deptIds } } : undefined,
    limit: 5000,
  });
  const positionTitle = new Map(positions.map((p) => [str(p.get('id')), str(p.get('title'))]));

  type Bucket = {
    department: string;
    positionTitles: Set<string>;
    totalStaff: number;
  };
  const byDept = new Map<string, Bucket>();

  for (const dept of departments) {
    const id = str(dept.get('id'));
    byDept.set(id, {
      department: str(dept.get('name')) || id,
      positionTitles: new Set(),
      totalStaff: 0,
    });
  }

  for (const e of employees) {
    const deptId = str(e.get('department_id')) || '_none';
    if (filters.departmentId && deptId !== filters.departmentId) continue;
    const status = str(e.get('status')).toLowerCase();
    if (status !== 'active' && status !== 'probation') continue;

    let bucket = byDept.get(deptId);
    if (!bucket) {
      bucket = {
        department: deptId === '_none' ? '(No department)' : deptId,
        positionTitles: new Set(),
        totalStaff: 0,
      };
      byDept.set(deptId, bucket);
    }
    bucket.totalStaff += 1;
    const posId = str(e.get('position_id'));
    const title =
      (posId && positionTitle.get(posId)) || str(e.get('job_position')).trim() || '';
    if (title) bucket.positionTitles.add(title);
  }

  const rows: ReportRow[] = [...byDept.entries()]
    .filter(([id, b]) => id !== '_none' || b.totalStaff > 0)
    .map(([deptId, b]) => {
      const head = headMap.get(deptId);
      const titles = [...b.positionTitles].sort((a, c) => a.localeCompare(c));
      return {
        department: b.department,
        position:
          titles.length === 0
            ? '—'
            : titles.length <= 3
              ? titles.join(', ')
              : `${titles.slice(0, 3).join(', ')} (+${titles.length - 3})`,
        manager: head?.managerName || '—',
        totalStaff: b.totalStaff,
      };
    })
    .sort((a, b) => String(a.department).localeCompare(String(b.department)));

  const orgTotal = num(summary.active) + num(summary.probation);

  return {
    columns: [
      { key: 'department', label: 'Department' },
      { key: 'position', label: 'Position' },
      { key: 'manager', label: 'Manager' },
      { key: 'totalStaff', label: 'Total staff', align: 'right', format: 'number' },
    ],
    rows,
    totalsRow: {
      department: 'Total',
      position: '—',
      manager: '—',
      totalStaff: rows.reduce((s, r) => s + num(r.totalStaff), 0) || orgTotal,
    },
    note: 'Active and probation staff only. Position lists distinct job titles in the department; Manager is the department head.',
    summaryCards: [
      { key: 'depts', label: 'Departments', value: rows.length, format: 'number' },
      {
        key: 'staff',
        label: 'Total staff',
        value: rows.reduce((s, r) => s + num(r.totalStaff), 0),
        format: 'number',
      },
    ],
  };
};
