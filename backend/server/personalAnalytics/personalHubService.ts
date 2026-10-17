import crypto from 'crypto';
import { Op } from 'sequelize';
import {
  FixedRoster,
  LeaveRequest,
  OvertimeRequest,
  RosterAssignment,
  RosterException,
  User,
} from '../db.js';
import {
  findEmployeeByUserId,
  getEmployeeScheduleForUser,
} from '../employeeAttendanceSchedule.js';
import {
  listEmployeeMovements,
  listEmployeeMovementsForViewer,
  resolveEmployeePublicIdForUserAccount,
} from '../employeeMovementService.js';
import { isAdminRole } from '../adminNavScope.js';
import { fetchPlanningRosterEntriesMap } from '../monthlyPlanningRosterService.js';
import { findActivePlanningRostersForMonth } from '../planningRosterMonthQuery.js';
import {
  dateKeyFromYmd,
  isPlanningRosterNonWorkingEntry,
  isRosterHoliday,
  isRosterScheduledOffDay,
  parseMonthPrefix,
} from '../rosterOffDays.js';
import {
  PersonalHubItem,
  ensurePersonalHubSchema,
  type PersonalHubItemKind,
} from './personalHubSchema.js';

export type PersonalHubNoteDto = {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
  createdAt: string;
};

export type PersonalHubAlertDto = {
  id: string;
  title: string;
  alertAt: string;
  notes: string | null;
  isDone: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkRosterDayDto = {
  date: string;
  day: number;
  leaveType: string;
  category: 'working' | 'off' | 'leave' | 'holiday';
};

export type PersonalRequestItemDto = {
  id: string;
  kind: 'leave' | 'overtime' | 'movement';
  title: string;
  status: string;
  dateLabel: string;
  submittedAt: string;
  detail?: string;
};

export type BirthdayInfoDto = {
  hasBirthDate: boolean;
  birthDate?: string;
  displayName?: string;
  isToday?: boolean;
  isUpcoming?: boolean;
  daysUntil?: number;
  age?: number;
  messageKey?: 'today' | 'upcoming' | 'none';
};

export type PersonalHubOverviewDto = {
  birthday: BirthdayInfoDto;
  schedule: Awaited<ReturnType<typeof getEmployeeScheduleForUser>>;
  upcomingAlerts: PersonalHubAlertDto[];
  requestCount: number;
};

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function resolvePublicEmployeeCodeForUser(userId: string): Promise<string | null> {
  const user = await User.findByPk(userId, { attributes: ['employeeId'] });
  if (!user) return null;
  return resolveEmployeePublicIdForUserAccount({
    employeeId: user.get('employeeId') as string | null,
  });
}

function parseIsoDate(value: unknown, fallback?: unknown): string {
  for (const candidate of [value, fallback]) {
    if (candidate == null) continue;
    const d = candidate instanceof Date ? candidate : new Date(String(candidate));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function noteDto(row: PersonalHubItem): PersonalHubNoteDto {
  const p = row.get({ plain: true }) as Record<string, unknown>;
  const createdAt = parseIsoDate(p.createdAt);
  return {
    id: String(p.id),
    title: String(p.title ?? ''),
    body: String(p.body ?? ''),
    updatedAt: parseIsoDate(p.updatedAt, p.createdAt),
    createdAt,
  };
}

function alertDto(row: PersonalHubItem): PersonalHubAlertDto {
  const p = row.get({ plain: true }) as Record<string, unknown>;
  const createdAt = parseIsoDate(p.createdAt);
  return {
    id: String(p.id),
    title: String(p.title),
    alertAt: parseIsoDate(p.alertAt, p.createdAt),
    notes: p.body != null ? String(p.body) : null,
    isDone: Boolean(p.isDone),
    createdAt,
    updatedAt: parseIsoDate(p.updatedAt, p.createdAt),
  };
}

function hubItemWhere(userId: string, kind: PersonalHubItemKind) {
  return { userId, kind };
}

function classifyRosterType(leaveType: string): WorkRosterDayDto['category'] {
  if (isRosterHoliday(leaveType)) return 'holiday';
  if (isRosterScheduledOffDay(leaveType)) return 'off';
  if (isPlanningRosterNonWorkingEntry(leaveType)) return 'leave';
  return 'working';
}

async function weeklyOffWeekdays(employeePk: string): Promise<Set<number>> {
  const assignments = await RosterAssignment.findAll({
    where: { entityType: 'EMPLOYEE', entityId: employeePk },
  });
  const off = new Set<number>();
  for (const row of assignments) {
    const plain = row.get({ plain: true }) as { rosterId: string };
    const roster = await FixedRoster.findByPk(plain.rosterId);
    if (!roster) continue;
    const r = roster.get({ plain: true }) as {
      isActive?: boolean;
      schedule?: { days?: number[] };
    };
    if (r.isActive === false) continue;
    for (const d of r.schedule?.days ?? []) {
      if (Number.isFinite(d) && d >= 0 && d <= 6) off.add(Number(d));
    }
  }
  return off;
}

function matchesEmployee(
  entryEmployeeId: string,
  employeePk: string | null,
  userId: string,
  employeeDisplayId?: string | null
): boolean {
  const eid = String(entryEmployeeId || '').trim();
  if (!eid) return false;
  if (employeePk && eid === employeePk) return true;
  if (employeeDisplayId && eid === employeeDisplayId) return true;
  if (userId && eid === userId) return true;
  return false;
}

export async function buildBirthdayInfo(userId: string): Promise<BirthdayInfoDto> {
  const { getUserDisplayName } = await import('../notificationService.js');
  const employee = await findEmployeeByUserId(userId);
  const plain = employee?.get({ plain: true }) as Record<string, unknown> | undefined;
  const birthRaw = plain?.birth_date;
  let displayName = [plain?.last_name, plain?.first_name].filter(Boolean).join(' ').trim();
  if (!displayName) {
    displayName = (await getUserDisplayName(userId).catch(() => '')) || 'Colleague';
  }

  if (!birthRaw) {
    return { hasBirthDate: false, displayName, messageKey: 'none' };
  }

  const birth = new Date(String(birthRaw));
  if (Number.isNaN(birth.getTime())) {
    return { hasBirthDate: false, displayName, messageKey: 'none' };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let year = today.getFullYear();
  let nextBirthday = new Date(year, birth.getMonth(), birth.getDate());
  nextBirthday.setHours(0, 0, 0, 0);
  if (nextBirthday < today) {
    year += 1;
    nextBirthday = new Date(year, birth.getMonth(), birth.getDate());
    nextBirthday.setHours(0, 0, 0, 0);
  }

  const daysUntil = Math.round((nextBirthday.getTime() - today.getTime()) / 86_400_000);
  const isToday = daysUntil === 0;
  const isUpcoming = daysUntil > 0 && daysUntil <= 14;
  let age = year - birth.getFullYear();
  if (nextBirthday > today && birth.getMonth() > today.getMonth()) age -= 1;
  if (isToday) age = today.getFullYear() - birth.getFullYear();

  return {
    hasBirthDate: true,
    birthDate: birth.toISOString().slice(0, 10),
    displayName,
    isToday,
    isUpcoming,
    daysUntil,
    age,
    messageKey: isToday ? 'today' : isUpcoming ? 'upcoming' : 'none',
  };
}

export async function buildWorkRosterForUser(
  userId: string,
  month: string
): Promise<{ month: string; days: WorkRosterDayDto[] }> {
  const monthKey = month.slice(0, 7);
  const { year, monthIndex } = parseMonthPrefix(monthKey);
  const employee = await findEmployeeByUserId(userId);
  const empPlain = employee?.get({ plain: true }) as Record<string, unknown> | undefined;
  const employeePk = empPlain ? String(empPlain.id ?? '') : null;
  const employeeDisplayId = empPlain ? String(empPlain.employee_id ?? '') : null;

  const monthlyByDay = new Map<number, string>();
  const planningRows = await findActivePlanningRostersForMonth(year, monthIndex);
  const entryMap = await fetchPlanningRosterEntriesMap(
    planningRows.map((r) => String((r.get({ plain: true }) as { id: string }).id))
  );

  for (const row of planningRows) {
    const rid = String((row.get({ plain: true }) as { id: string }).id);
    for (const ent of entryMap.get(rid) ?? []) {
      if (!matchesEmployee(ent.employeeId, employeePk, userId, employeeDisplayId)) continue;
      monthlyByDay.set(ent.day, ent.leaveType);
    }
  }

  const weeklyOff = employeePk ? await weeklyOffWeekdays(employeePk) : new Set<number>();
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const days: WorkRosterDayDto[] = [];

  for (let day = 1; day <= lastDay; day++) {
    const date = dateKeyFromYmd(year, monthIndex, day);
    let leaveType = 'Working';

    if (monthlyByDay.has(day)) {
      leaveType = monthlyByDay.get(day)!;
    } else if (weeklyOff.has(new Date(year, monthIndex, day, 12, 0, 0).getDay())) {
      leaveType = 'Day Off';
    }

    days.push({
      date,
      day,
      leaveType,
      category: classifyRosterType(leaveType),
    });
  }

  if (employeePk) {
    const exceptions = await RosterException.findAll({
      where: {
        employeeId: employeePk,
        date: {
          [Op.gte]: new Date(year, monthIndex, 1),
          [Op.lt]: new Date(year, monthIndex + 1, 1),
        },
      },
    });
    for (const ex of exceptions) {
      const p = ex.get({ plain: true }) as { date: string | Date; isWorking?: boolean };
      const key = String(p.date).slice(0, 10);
      const idx = days.findIndex((d) => d.date === key);
      if (idx < 0) continue;
      if (p.isWorking === false) {
        days[idx] = { ...days[idx], leaveType: 'Day Off', category: 'off' };
      } else if (p.isWorking === true) {
        days[idx] = { ...days[idx], leaveType: 'Working', category: 'working' };
      }
    }
  }

  return { month: monthKey, days };
}

const MOVEMENT_LABELS: Record<string, string> = {
  transfer: 'Transfer',
  promotion: 'Promotion',
  salary_update: 'Salary update',
};

export async function buildRequestTracker(
  viewer: { id: string; role?: string; employeeId?: string | null },
  targetUserId: string,
  limit = 40
): Promise<PersonalRequestItemDto[]> {
  const items: PersonalRequestItemDto[] = [];

  const leaves = await LeaveRequest.findAll({
    where: { userId: targetUserId },
    order: [['createdAt', 'DESC']],
    limit: 30,
  });
  for (const row of leaves) {
    const p = row.get({ plain: true }) as Record<string, unknown>;
    const start = String(p.startDate ?? '').slice(0, 10);
    const end = String(p.endDate ?? '').slice(0, 10);
    items.push({
      id: String(p.id),
      kind: 'leave',
      title: String(p.type ?? 'Leave'),
      status: String(p.status ?? 'PENDING'),
      dateLabel: start === end ? start : `${start} – ${end}`,
      submittedAt: String(p.appliedOn ?? p.createdAt ?? ''),
      detail: p.reason != null ? String(p.reason).slice(0, 120) : undefined,
    });
  }

  const otRows = await OvertimeRequest.findAll({
    where: { userId: targetUserId },
    order: [['createdAt', 'DESC']],
    limit: 30,
  });
  for (const row of otRows) {
    const p = row.get({ plain: true }) as Record<string, unknown>;
    items.push({
      id: String(p.id),
      kind: 'overtime',
      title: 'Overtime',
      status: String(p.status ?? 'PENDING'),
      dateLabel: String(p.workDate ?? '').slice(0, 10),
      submittedAt: String(p.appliedOn ?? p.createdAt ?? ''),
      detail: p.hours != null ? `${p.hours} h` : undefined,
    });
  }

  const targetEmpCode = await resolvePublicEmployeeCodeForUser(targetUserId);
  const viewerRole = String(viewer.role ?? '').toUpperCase();
  const canViewMovements =
    viewer.id === targetUserId ||
    viewerRole === 'HR' ||
    viewerRole === 'MANAGER' ||
    isAdminRole(viewerRole);

  if (targetEmpCode && canViewMovements) {
    const movements =
      viewer.id === targetUserId
        ? await listEmployeeMovementsForViewer(viewer, { limit: 20 })
        : await listEmployeeMovements({ employeeId: targetEmpCode, limit: 20 });
    for (const m of movements) {
      const typeLabel = MOVEMENT_LABELS[m.movementType] ?? m.movementType;
      items.push({
        id: m.id,
        kind: 'movement',
        title: typeLabel,
        status: m.status,
        dateLabel: m.effectiveDate.slice(0, 10),
        submittedAt: m.createdAt,
        detail: m.toDepartmentName ? `→ ${m.toDepartmentName}` : undefined,
      });
    }
  }

  items.sort((a, b) => {
    const ta = new Date(a.submittedAt || a.dateLabel).getTime() || 0;
    const tb = new Date(b.submittedAt || b.dateLabel).getTime() || 0;
    return tb - ta;
  });

  return items.slice(0, limit);
}

export async function buildPersonalHubOverview(
  viewer: { id: string; role?: string; employeeId?: string | null },
  targetUserId: string
): Promise<PersonalHubOverviewDto> {
  await ensurePersonalHubSchema();
  const isSelf = viewer.id === targetUserId;
  const [birthday, schedule, alerts, requests] = await Promise.all([
    buildBirthdayInfo(targetUserId),
    getEmployeeScheduleForUser(targetUserId),
    isSelf ? listPersonalAlerts(viewer.id) : Promise.resolve([]),
    buildRequestTracker(viewer, targetUserId, 5),
  ]);

  const now = new Date();
  const pendingAlerts = isSelf
    ? alerts
        .filter((a) => !a.isDone)
        .sort((a, b) => {
          const aOver = new Date(a.alertAt).getTime() < now.getTime();
          const bOver = new Date(b.alertAt).getTime() < now.getTime();
          if (aOver !== bOver) return aOver ? -1 : 1;
          return new Date(a.alertAt).getTime() - new Date(b.alertAt).getTime();
        })
        .slice(0, 5)
    : [];

  return {
    birthday,
    schedule,
    upcomingAlerts: pendingAlerts,
    requestCount: requests.length,
  };
}

export async function listPersonalNotes(userId: string): Promise<PersonalHubNoteDto[]> {
  await ensurePersonalHubSchema();
  const rows = await PersonalHubItem.findAll({
    where: hubItemWhere(userId, 'note'),
    order: [['updatedAt', 'DESC']],
  });
  return rows.map(noteDto);
}

export async function createPersonalNote(
  userId: string,
  body: { title?: string; body?: string }
): Promise<PersonalHubNoteDto> {
  await ensurePersonalHubSchema();
  const row = await PersonalHubItem.create({
    id: newId('phi'),
    userId,
    kind: 'note',
    title: String(body.title ?? '').trim() || 'Note',
    body: String(body.body ?? ''),
    alertAt: null,
    isDone: false,
  });
  return noteDto(row);
}

export async function updatePersonalNote(
  userId: string,
  noteId: string,
  body: { title?: string; body?: string }
): Promise<PersonalHubNoteDto | null> {
  await ensurePersonalHubSchema();
  const row = await PersonalHubItem.findOne({
    where: { id: noteId, ...hubItemWhere(userId, 'note') },
  });
  if (!row) return null;
  if (body.title !== undefined) row.set('title', String(body.title).trim() || 'Note');
  if (body.body !== undefined) row.set('body', String(body.body));
  await row.save();
  return noteDto(row);
}

export async function deletePersonalNote(userId: string, noteId: string): Promise<boolean> {
  await ensurePersonalHubSchema();
  const n = await PersonalHubItem.destroy({
    where: { id: noteId, ...hubItemWhere(userId, 'note') },
  });
  return n > 0;
}

export async function listPersonalAlerts(userId: string): Promise<PersonalHubAlertDto[]> {
  await ensurePersonalHubSchema();
  const { dispatchPersonalHubAlertNotifications } = await import(
    './personalHubAlertReminderService.js'
  );
  await dispatchPersonalHubAlertNotifications(userId);
  const rows = await PersonalHubItem.findAll({
    where: hubItemWhere(userId, 'alert'),
    order: [['alertAt', 'ASC']],
  });
  return rows.map(alertDto);
}

export async function createPersonalAlert(
  userId: string,
  body: { title: string; alertAt: string; notes?: string }
): Promise<PersonalHubAlertDto> {
  await ensurePersonalHubSchema();
  const at = new Date(body.alertAt);
  if (Number.isNaN(at.getTime())) {
    throw Object.assign(new Error('Invalid alert date/time'), { status: 400 });
  }
  const row = await PersonalHubItem.create({
    id: newId('phi'),
    userId,
    kind: 'alert',
    title: String(body.title).trim(),
    body: body.notes != null ? String(body.notes) : null,
    alertAt: at,
    isDone: false,
    alertNotifiedAt: null,
  });
  const { dispatchPersonalHubAlertNotifications } = await import(
    './personalHubAlertReminderService.js'
  );
  await dispatchPersonalHubAlertNotifications(userId);
  return alertDto(row);
}

export async function updatePersonalAlert(
  userId: string,
  alertId: string,
  body: { title?: string; alertAt?: string; notes?: string; isDone?: boolean }
): Promise<PersonalHubAlertDto | null> {
  await ensurePersonalHubSchema();
  const row = await PersonalHubItem.findOne({
    where: { id: alertId, ...hubItemWhere(userId, 'alert') },
  });
  if (!row) return null;
  if (body.title !== undefined) row.set('title', String(body.title).trim());
  if (body.notes !== undefined) row.set('body', body.notes != null ? String(body.notes) : null);
  if (body.isDone !== undefined) row.set('isDone', Boolean(body.isDone));
  if (body.alertAt !== undefined) {
    const at = new Date(body.alertAt);
    if (Number.isNaN(at.getTime())) {
      throw Object.assign(new Error('Invalid alert date/time'), { status: 400 });
    }
    row.set('alertAt', at);
    row.set('alertNotifiedAt', null);
  }
  await row.save();
  const { dispatchPersonalHubAlertNotifications } = await import(
    './personalHubAlertReminderService.js'
  );
  await dispatchPersonalHubAlertNotifications(userId);
  return alertDto(row);
}

export async function deletePersonalAlert(userId: string, alertId: string): Promise<boolean> {
  await ensurePersonalHubSchema();
  const n = await PersonalHubItem.destroy({
    where: { id: alertId, ...hubItemWhere(userId, 'alert') },
  });
  return n > 0;
}
