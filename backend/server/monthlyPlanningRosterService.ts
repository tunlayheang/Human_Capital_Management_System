import crypto from 'crypto';
import { Op } from 'sequelize';
import {
  Employee,
  MonthlyPlanningRoster,
  MonthlyPlanningRosterEntry,
  sequelize,
} from './db.js';
import {
  apiMonthToIndex,
  dbMonthToIndex,
  findActivePlanningRostersForMonth,
} from './planningRosterMonthQuery.js';

export type MonthlyRosterEntryRow = {
  employeeId: string;
  day: number;
  leaveType: string;
  isLocked?: boolean;
  sourceLeaveRequestId?: string | null;
};

export type MonthlyPlanningRosterDto = {
  id: string;
  month: number;
  year: number;
  name: string;
  entries: MonthlyRosterEntryRow[];
  createdAt: string;
  updatedAt: string;
};

const CREATE_ROSTER_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS monthlyplanningrosters (
  id VARCHAR(64) NOT NULL,
  month INT NOT NULL,
  year INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  isActive TINYINT(1) NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_mpr_year_month (year, month),
  KEY idx_mpr_active (isActive)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const CREATE_ENTRIES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS monthlyplanningrosterentries (
  id VARCHAR(96) NOT NULL,
  rosterId VARCHAR(64) NOT NULL,
  employeeId VARCHAR(255) NOT NULL,
  day INT NOT NULL,
  leaveType VARCHAR(128) NOT NULL,
  isLocked TINYINT(1) NOT NULL DEFAULT 1,
  sourceLeaveRequestId VARCHAR(64) NULL,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mpre_roster_employee_day (rosterId, employeeId, day),
  KEY idx_mpre_roster (rosterId),
  KEY idx_mpre_employee (employeeId),
  KEY idx_mpre_leave_request (sourceLeaveRequestId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

/** Stable short id (fits VARCHAR(96)) even for long employee keys. */
function rosterEntryId(rosterId: string, employeeId: string, day: number): string {
  const digest = crypto
    .createHash('sha256')
    .update(`${rosterId}|${employeeId}|${day}`)
    .digest('hex')
    .slice(0, 40);
  return `mpre-${digest}`;
}

/** Persist internal employee pk so payroll and reload always match the employee list. */
async function canonicalizeRosterEntryEmployeeIds(
  entries: MonthlyRosterEntryRow[]
): Promise<MonthlyRosterEntryRow[]> {
  if (!entries.length) return entries;
  const keys = [...new Set(entries.map((e) => e.employeeId).filter(Boolean))];
  const rows = await Employee.findAll({
    where: {
      [Op.or]: [{ id: { [Op.in]: keys } }, { employee_id: { [Op.in]: keys } }],
    },
    attributes: ['id', 'employee_id'],
  });
  const map = new Map<string, string>();
  for (const row of rows) {
    const p = row.get({ plain: true }) as { id: string; employee_id: string };
    map.set(String(p.id), String(p.id));
    if (p.employee_id) map.set(String(p.employee_id), String(p.id));
  }
  return entries.map((e) => ({
    ...e,
    employeeId: map.get(e.employeeId) ?? e.employeeId,
  }));
}

/** Calendar month for DB/phpMyAdmin: Jan=1 … May=5 … Dec=12. */
function monthIndexToCalendarMonth(monthIndex: number): number {
  return apiMonthToIndex(monthIndex) + 1;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function sanitizeRosterEntries(
  entries: unknown,
  year: number,
  monthIndex: number
): MonthlyRosterEntryRow[] {
  if (!Array.isArray(entries)) return [];
  const maxDay = daysInMonth(year, monthIndex);
  const out: MonthlyRosterEntryRow[] = [];
  const seen = new Set<string>();

  for (const raw of entries) {
    const e = (raw ?? {}) as Record<string, unknown>;
    const employeeId = String(e.employeeId ?? e.employee_id ?? '').trim();
    const day = Math.floor(Number(e.day));
    const leaveType = String(e.leaveType ?? e.leave_type ?? '').trim();
    if (!employeeId || !leaveType || !Number.isFinite(day) || day < 1 || day > maxDay) continue;
    const key = `${employeeId}:${day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sourceLeaveRequestId = String(
      e.sourceLeaveRequestId ?? e.source_leave_request_id ?? ''
    ).trim();
    out.push({
      employeeId,
      day,
      leaveType,
      isLocked: Boolean(e.isLocked ?? e.is_locked ?? true),
      sourceLeaveRequestId: sourceLeaveRequestId || null,
    });
  }
  return out;
}

/** Legacy JSON column parser (migration only). */
function parseLegacyEntriesField(raw: unknown): MonthlyRosterEntryRow[] {
  let value = raw;
  for (let depth = 0; depth < 4; depth++) {
    if (value == null) return [];
    if (Array.isArray(value)) return value as MonthlyRosterEntryRow[];
    if (typeof value !== 'string') return [];
    const trimmed = value.trim();
    if (!trimmed || trimmed === 'null') return [];
    try {
      value = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? (value as MonthlyRosterEntryRow[]) : [];
}

function rowToEntryDto(row: {
  get: (opts?: { plain: true }) => unknown;
}): MonthlyRosterEntryRow {
  const p = row.get({ plain: true }) as Record<string, unknown>;
  const sourceLeaveRequestId = String(
    p.sourceLeaveRequestId ?? p.source_leave_request_id ?? ''
  ).trim();
  return {
    employeeId: String(p.employeeId ?? p.employee_id ?? ''),
    day: Number(p.day),
    leaveType: String(p.leaveType ?? p.leave_type ?? ''),
    isLocked: Boolean(p.isLocked ?? p.is_locked ?? true),
    sourceLeaveRequestId: sourceLeaveRequestId || null,
  };
}

/** Load all entry rows for one or more planning rosters. */
export async function fetchPlanningRosterEntriesMap(
  rosterIds: string[]
): Promise<Map<string, MonthlyRosterEntryRow[]>> {
  await ensureMonthlyPlanningRosterSchema();
  const map = new Map<string, MonthlyRosterEntryRow[]>();
  if (!rosterIds.length) return map;
  const rows = await MonthlyPlanningRosterEntry.findAll({
    where: { rosterId: { [Op.in]: rosterIds } },
    order: [
      ['day', 'ASC'],
      ['employeeId', 'ASC'],
    ],
  });
  for (const row of rows) {
    const p = row.get({ plain: true }) as { rosterId: string };
    const rid = String(p.rosterId);
    const list = map.get(rid) ?? [];
    list.push(rowToEntryDto(row));
    map.set(rid, list);
  }
  return map;
}

async function replaceRosterEntries(
  rosterId: string,
  entries: MonthlyRosterEntryRow[],
  updatedAt: Date
): Promise<void> {
  const canonical = await canonicalizeRosterEntryEmployeeIds(entries);
  await sequelize.transaction(async (transaction) => {
    await MonthlyPlanningRosterEntry.destroy({
      where: { rosterId },
      transaction,
    });
    if (canonical.length > 0) {
      const now = updatedAt;
      await MonthlyPlanningRosterEntry.bulkCreate(
        canonical.map((e) => ({
          id: rosterEntryId(rosterId, e.employeeId, e.day),
          rosterId,
          employeeId: e.employeeId,
          day: e.day,
          leaveType: e.leaveType,
          isLocked: e.isLocked ?? true,
          sourceLeaveRequestId: e.sourceLeaveRequestId ?? null,
          createdAt: now,
          updatedAt: now,
        })),
        { transaction }
      );
    }
  });
}

function toDto(
  row: { get: (opts?: { plain: true }) => unknown },
  entries: MonthlyRosterEntryRow[]
): MonthlyPlanningRosterDto {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const monthIndex = dbMonthToIndex(Number(plain.month));
  const year = Number(plain.year);
  return {
    id: String(plain.id),
    month: monthIndex,
    year,
    name: String(plain.name),
    entries: sanitizeRosterEntries(entries, year, monthIndex),
    createdAt: String(plain.createdAt ?? plain.created_at ?? new Date().toISOString()),
    updatedAt: String(plain.updatedAt ?? plain.updated_at ?? new Date().toISOString()),
  };
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

/** Move legacy JSON \`entries\` blob into normalized rows, then drop the column. */
async function migrateLegacyJsonEntriesColumn(): Promise<number> {
  const hasLegacy = await columnExists('monthlyplanningrosters', 'entries');
  if (!hasLegacy) return 0;

  const [rawRows]: unknown = await sequelize.query(
    'SELECT id, month, year, entries FROM monthlyplanningrosters WHERE isActive = 1'
  );
  const rows = (Array.isArray(rawRows) ? rawRows : []) as Array<{
    id: string;
    month: number;
    year: number;
    entries: unknown;
  }>;

  let migrated = 0;
  for (const row of rows) {
    const existing = await MonthlyPlanningRosterEntry.count({
      where: { rosterId: row.id },
    });
    if (existing > 0) continue;
    const monthIndex = dbMonthToIndex(Number(row.month));
    const entries = sanitizeRosterEntries(
      parseLegacyEntriesField(row.entries),
      Number(row.year),
      monthIndex
    );
    if (!entries.length) continue;
    await replaceRosterEntries(row.id, entries, new Date());
    migrated++;
  }

  try {
    await sequelize.query('ALTER TABLE monthlyplanningrosters DROP COLUMN entries');
    console.log('[roster] Dropped legacy monthlyplanningrosters.entries JSON column.');
  } catch (err) {
    console.warn(
      '[roster] Could not drop legacy entries column:',
      (err as Error)?.message || err
    );
  }
  if (migrated > 0) {
    console.log(`[roster] Migrated ${migrated} planning roster(s) from JSON to entry rows.`);
  }
  return migrated;
}

function monthLabelForIndex(monthIndex: number): string {
  return new Date(2000, apiMonthToIndex(monthIndex), 1).toLocaleString('en', {
    month: 'long',
  });
}

function monthLabelForCalendarMonth(calendarMonth: number): string {
  return new Date(2000, calendarMonth - 1, 1).toLocaleString('en', { month: 'long' });
}

function rosterNameMatchesMonth(name: string, label: string): boolean {
  return name.toLowerCase().includes(label.toLowerCase());
}

/** 0-indexed DB months (May=4) → calendar months (May=5); skips rows already aligned with name. */
async function migrateZeroIndexedMonthsToCalendarMonth(): Promise<void> {
  const [rawRows]: unknown = await sequelize.query(
    'SELECT id, month, name FROM monthlyplanningrosters'
  );
  const rows = (Array.isArray(rawRows) ? rawRows : []) as Array<{
    id: string;
    month: number;
    name: string;
  }>;

  let fixed = 0;
  for (const row of rows) {
    const stored = Number(row.month);
    const name = String(row.name ?? '');

    if (stored >= 1 && stored <= 12) {
      const calendarLabel = monthLabelForCalendarMonth(stored);
      if (rosterNameMatchesMonth(name, calendarLabel)) continue;
    }

    if (stored >= 0 && stored <= 11) {
      const zeroLabel = monthLabelForIndex(stored);
      if (rosterNameMatchesMonth(name, zeroLabel)) {
        await sequelize.query(
          'UPDATE monthlyplanningrosters SET month = ? WHERE id = ?',
          { replacements: [stored + 1, row.id] }
        );
        fixed++;
        continue;
      }
    }

    // Heal double-migrated row (e.g. May name but month=6 after running +1 twice)
    for (const candidateIndex of [stored - 2, stored - 1, stored]) {
      if (candidateIndex < 0 || candidateIndex > 11) continue;
      const label = monthLabelForIndex(candidateIndex);
      if (rosterNameMatchesMonth(name, label)) {
        await sequelize.query(
          'UPDATE monthlyplanningrosters SET month = ? WHERE id = ?',
          { replacements: [candidateIndex + 1, row.id] }
        );
        fixed++;
        break;
      }
    }
  }

  if (fixed > 0) {
    console.log(
      `[roster] Aligned ${fixed} roster month value(s) to calendar month (1–12, May=5).`
    );
  }
}

async function ensureSourceLeaveRequestIdColumn(): Promise<void> {
  if (await columnExists('monthlyplanningrosterentries', 'sourceLeaveRequestId')) return;
  await sequelize.query(
    `ALTER TABLE monthlyplanningrosterentries
     ADD COLUMN sourceLeaveRequestId VARCHAR(64) NULL AFTER isLocked`
  );
  const hasIndex = await columnExists('monthlyplanningrosterentries', 'sourceLeaveRequestId');
  if (!hasIndex) {
    throw new Error('sourceLeaveRequestId column missing after ALTER');
  }
  try {
    await sequelize.query(
      `ALTER TABLE monthlyplanningrosterentries
       ADD KEY idx_mpre_leave_request (sourceLeaveRequestId)`
    );
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (!/Duplicate key name/i.test(msg)) throw err;
  }
  console.log('[roster] Added monthlyplanningrosterentries.sourceLeaveRequestId');
}

export async function ensureMonthlyPlanningRosterSchema(): Promise<void> {
  await sequelize.query(CREATE_ROSTER_TABLE_SQL);
  await sequelize.query(CREATE_ENTRIES_TABLE_SQL);
  await ensureSourceLeaveRequestIdColumn();
  await MonthlyPlanningRoster.sync({ alter: false });
  await MonthlyPlanningRosterEntry.sync({ alter: false });
  await migrateLegacyJsonEntriesColumn();
  await migrateZeroIndexedMonthsToCalendarMonth();
}

export function normalizePlanningRosterInput(body: Record<string, unknown>): {
  month: number;
  year: number;
  name: string;
  entries: MonthlyRosterEntryRow[];
} {
  const year = Number(body.year);
  const monthRaw = Number(body.month);
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    throw new Error('Valid roster year is required');
  }
  if (!Number.isFinite(monthRaw)) {
    throw new Error('Valid roster month is required (0–11 or 1–12)');
  }
  const monthIndex = apiMonthToIndex(monthRaw);

  const name = String(body.name ?? '').trim();
  if (!name) throw new Error('Roster name is required');

  const entries = sanitizeRosterEntries(body.entries, year, monthIndex);
  return { month: monthIndex, year, name, entries };
}

function normalizeMonthQuery(month: number): number {
  return apiMonthToIndex(month);
}

export async function listMonthlyPlanningRosters(query?: {
  year?: number;
  month?: number;
}): Promise<MonthlyPlanningRosterDto[]> {
  await ensureMonthlyPlanningRosterSchema();
  let rows: InstanceType<typeof MonthlyPlanningRoster>[];
  if (query?.year != null && query?.month != null) {
    rows = await findActivePlanningRostersForMonth(
      query.year,
      normalizeMonthQuery(query.month)
    );
  } else if (query?.year != null) {
    rows = await MonthlyPlanningRoster.findAll({
      where: { year: query.year, isActive: true },
      order: [
        ['month', 'DESC'],
        ['updatedAt', 'DESC'],
      ],
    });
  } else {
    rows = await MonthlyPlanningRoster.findAll({
      where: { isActive: true },
      order: [
        ['year', 'DESC'],
        ['month', 'DESC'],
        ['updatedAt', 'DESC'],
      ],
    });
  }
  const entryMap = await fetchPlanningRosterEntriesMap(rows.map((r) => String(r.get('id'))));
  return rows.map((r) => {
    const id = String(r.get('id'));
    return toDto(r, entryMap.get(id) ?? []);
  });
}

export async function createMonthlyPlanningRoster(
  body: Record<string, unknown>
): Promise<MonthlyPlanningRosterDto> {
  await ensureMonthlyPlanningRosterSchema();
  const normalized = normalizePlanningRosterInput(body);
  const existing = await findActivePlanningRostersForMonth(
    normalized.year,
    normalized.month
  );
  if (existing.length > 0) {
    const label = monthLabelForIndex(normalized.month);
    throw new Error(
      `A planning roster already exists for ${label} ${normalized.year}. Edit the existing roster instead of creating another.`
    );
  }
  const now = new Date();
  const id = `mpr-${Date.now()}`;
  const row = await MonthlyPlanningRoster.create({
    id,
    month: monthIndexToCalendarMonth(normalized.month),
    year: normalized.year,
    name: normalized.name,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await replaceRosterEntries(id, normalized.entries, now);
  console.log(
    `[roster] Created ${id} (${normalized.name}): ${normalized.entries.length} entries`
  );
  const entryMap = await fetchPlanningRosterEntriesMap([id]);
  const dto = toDto(row, entryMap.get(id) ?? []);
  const { writeDomainAudit, pickAuditFields } = await import('./domainAuditService.js');
  await writeDomainAudit({
    entityType: 'planning_roster',
    entityId: id,
    action: 'CREATE',
    newValue: pickAuditFields(dto as unknown as Record<string, unknown>),
    reason: 'Monthly planning roster created',
  });
  return dto;
}

export async function updateMonthlyPlanningRoster(
  id: string,
  body: Record<string, unknown>
): Promise<MonthlyPlanningRosterDto | null> {
  await ensureMonthlyPlanningRosterSchema();
  const row = await MonthlyPlanningRoster.findByPk(id);
  if (!row) return null;

  const existing = row.get({ plain: true }) as Record<string, unknown>;
  const year = body.year !== undefined ? Number(body.year) : Number(existing.year);
  const monthIndex =
    body.month !== undefined
      ? apiMonthToIndex(Number(body.month))
      : dbMonthToIndex(Number(existing.month));

  let entries: MonthlyRosterEntryRow[];
  if (Array.isArray(body.entries)) {
    entries = sanitizeRosterEntries(body.entries, year, monthIndex);
  } else if (body.entries !== undefined) {
    entries = sanitizeRosterEntries(body.entries, year, monthIndex);
  } else {
    const entryMap = await fetchPlanningRosterEntriesMap([id]);
    entries = entryMap.get(id) ?? [];
  }

  const name =
    body.name !== undefined ? String(body.name).trim() : String(existing.name);
  if (!name) throw new Error('Roster name is required');

  const updatedAt = new Date();
  await row.update({
    month: monthIndexToCalendarMonth(monthIndex),
    year,
    name,
    updatedAt,
  });
  await replaceRosterEntries(id, entries, updatedAt);
  console.log(`[roster] Updated ${id}: ${entries.length} entries`);
  const entryMap = await fetchPlanningRosterEntriesMap([id]);
  const dto = toDto(row, entryMap.get(id) ?? []);
  const { writeDomainAudit, pickAuditFields } = await import('./domainAuditService.js');
  await writeDomainAudit({
    entityType: 'planning_roster',
    entityId: id,
    action: 'UPDATE',
    newValue: pickAuditFields(dto as unknown as Record<string, unknown>),
    reason: 'Monthly planning roster updated',
  });
  return dto;
}

export async function deleteMonthlyPlanningRoster(id: string): Promise<boolean> {
  const row = await MonthlyPlanningRoster.findByPk(id);
  if (!row) return false;
  const { writeDomainAudit } = await import('./domainAuditService.js');
  await writeDomainAudit({
    entityType: 'planning_roster',
    entityId: id,
    action: 'DELETE',
    reason: 'Monthly planning roster deactivated',
  });
  await row.update({ isActive: false, updatedAt: new Date() });
  return true;
}
