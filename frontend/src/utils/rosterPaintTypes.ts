import type { LeaveType } from '../types';
import {
  leaveColorForKind,
  resolveLeaveColorKind,
  ROSTER_DAY_OFF_COLOR,
  ROSTER_HOLIDAY_COLOR,
  ROSTER_MISSION_COLOR,
  ROSTER_WORKING_COLOR,
  type LeaveColorStyle,
} from './leaveTypeColors.js';

/** Grid cell id prefix for configured leave types from Leave Type Configuration. */
export const ROSTER_LEAVE_ID_PREFIX = 'leave:';

export type RosterPaintType = {
  id: string;
  name: string;
  nameKh?: string;
  code: string;
  color: string;
  swatch: string;
  exportStyle: { bg: string; color: string; border: string };
  /** Set when id is leave:{leaveTypeId} */
  leaveTypeId?: string;
  /** False for configured leave types (Planning shows them; paint Day Off / Working only). */
  paintable?: boolean;
};

export type RosterTypeId = string;

function paintFromColorStyle(style: LeaveColorStyle): Pick<RosterPaintType, 'color' | 'swatch' | 'exportStyle'> {
  return {
    color: style.chip,
    swatch: style.swatch,
    exportStyle: style.exportStyle,
  };
}

const SYSTEM_TYPES: RosterPaintType[] = [
  {
    id: 'working',
    name: 'Working',
    code: 'W',
    ...paintFromColorStyle(ROSTER_WORKING_COLOR),
    paintable: true,
  },
  {
    id: 'dayoff',
    name: 'Day Off',
    code: 'DO',
    ...paintFromColorStyle(ROSTER_DAY_OFF_COLOR),
    paintable: true,
  },
  {
    id: 'holiday',
    name: 'Public Holiday',
    code: 'PH',
    ...paintFromColorStyle(ROSTER_HOLIDAY_COLOR),
    paintable: true,
  },
  {
    id: 'mission',
    name: 'Mission',
    code: 'M',
    ...paintFromColorStyle(ROSTER_MISSION_COLOR),
    paintable: true,
  },
];

function isConfiguredPublicHolidayLeaveType(lt: Pick<LeaveType, 'name' | 'code'>): boolean {
  const kind = resolveLeaveColorKind(lt);
  if (kind === 'holiday') return true;
  const name = String(lt.name ?? '').trim().toLowerCase();
  const code = String(lt.code ?? '')
    .trim()
    .toUpperCase();
  return (
    name === 'public holiday' ||
    name.includes('public holiday') ||
    code === 'PH' ||
    code === 'PUBLIC_HOLIDAY'
  );
}

/** Types the user can paint on the planning grid (staffing). */
export function buildRosterPaintableTypes(): RosterPaintType[] {
  return SYSTEM_TYPES.filter((t) => t.paintable);
}

/** Configured leave types — legend only; use Leave requests / calendar for actual leave. */
export function buildRosterViewOnlyLeaveTypes(leaveTypes: LeaveType[]): RosterPaintType[] {
  const active = leaveTypes.filter(
    (lt) => lt.isActive !== false && String(lt.name ?? '').trim() && !isConfiguredPublicHolidayLeaveType(lt)
  );
  return active.map((lt, index) => {
    const kind = resolveLeaveColorKind(lt);
    const palette = leaveColorForKind(kind, index);
    return {
      id: leaveTypeToRosterId(lt.id),
      name: lt.name.trim(),
      nameKh: lt.nameKh?.trim() || undefined,
      code: rosterCodeForLeaveType(lt),
      ...paintFromColorStyle(palette),
      leaveTypeId: lt.id,
      paintable: false,
    };
  });
}

/** Legacy grid ids from older hard-coded roster palette → leave type display name. */
const LEGACY_ROSTER_ID_TO_LEAVE_NAME: Record<string, string> = {
  annual: 'Annual Leave',
  sick: 'Sick Leave',
  unpaid: 'Unpaid Leave',
  personal: 'Personal Leave',
};

export function leaveTypeToRosterId(leaveTypeId: string): string {
  return `${ROSTER_LEAVE_ID_PREFIX}${leaveTypeId}`;
}

export function rosterCodeForLeaveType(lt: Pick<LeaveType, 'name' | 'code'>): string {
  const fromDb = String(lt.code ?? '')
    .trim()
    .toUpperCase();
  if (fromDb.length >= 2 && fromDb.length <= 4) return fromDb.slice(0, 4);
  const words = String(lt.name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'LV';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 4);
}

/** Paintable staffing types + view-only configured leave types. */
export function buildRosterPaintTypes(leaveTypes: LeaveType[]): RosterPaintType[] {
  return [...buildRosterPaintableTypes(), ...buildRosterViewOnlyLeaveTypes(leaveTypes)];
}

/** All types for grid display, export, and loading saved cells. */
export function buildRosterPaintTypesWithHoliday(leaveTypes: LeaveType[]): RosterPaintType[] {
  return buildRosterPaintTypes(leaveTypes);
}

export function isRosterPaintableType(
  typeId: string,
  paintTypes: RosterPaintType[] = []
): boolean {
  const hit = paintTypes.find((t) => t.id === typeId);
  if (hit) return hit.paintable !== false;
  return typeId === 'working' || typeId === 'dayoff' || typeId === 'holiday' || typeId === 'mission';
}

export function findRosterPaintType(
  paintTypes: RosterPaintType[],
  typeId: string
): RosterPaintType | undefined {
  return paintTypes.find((t) => t.id === typeId);
}

/** Map saved roster entry label to a grid cell type id. */
export function resolveEntryToRosterTypeId(
  leaveTypeLabel: string,
  paintTypes: RosterPaintType[]
): string {
  const label = String(leaveTypeLabel ?? '').trim();
  if (!label) return 'dayoff';

  const lower = label.toLowerCase();
  if (lower === 'working' || lower === 'w') return 'working';
  if (lower === 'holiday' || lower === 'h' || lower === 'ph' || lower === 'public holiday') return 'holiday';
  if (lower === 'dayoff' || lower === 'day off' || lower === 'do') return 'dayoff';
  if (lower === 'mission' || lower === 'm' || lower === 'business trip') return 'mission';

  const byPaint = paintTypes.find(
    (t) =>
      t.id === label ||
      t.name.toLowerCase() === lower ||
      t.code.toLowerCase() === lower
  );
  if (byPaint) return byPaint.id;

  const legacyName = LEGACY_ROSTER_ID_TO_LEAVE_NAME[lower] ?? LEGACY_ROSTER_ID_TO_LEAVE_NAME[label];
  if (legacyName) {
    const byLegacy = paintTypes.find((t) => t.name.toLowerCase() === legacyName.toLowerCase());
    if (byLegacy) return byLegacy.id;
  }

  if (LEGACY_ROSTER_ID_TO_LEAVE_NAME[label]) {
    const byLegacyId = paintTypes.find(
      (t) => t.name.toLowerCase() === LEGACY_ROSTER_ID_TO_LEAVE_NAME[label].toLowerCase()
    );
    if (byLegacyId) return byLegacyId.id;
  }

  return 'dayoff';
}

/** @deprecated Use buildRosterPaintTypes — static list for tests / fallback export. */
export const ROSTER_TYPES: RosterPaintType[] = buildRosterPaintTypesWithHoliday([
  { id: 'lt-annual', name: 'Annual Leave', code: 'ANNUAL', isPaid: true, daysAllowed: 18 },
  { id: 'lt-sick', name: 'Sick Leave', code: 'SICK', isPaid: true, daysAllowed: 14 },
  { id: 'lt-unpaid', name: 'Unpaid Leave', code: 'UNPAID', isPaid: false, daysAllowed: 0 },
]);
