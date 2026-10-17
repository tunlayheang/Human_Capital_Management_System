import { Op } from 'sequelize';
import { Position } from './db.js';
import {
  DEFAULT_POSITION_LEVELS,
  assignTiersFromOrder,
  sortPositionLevels,
  type PositionLevelRecord,
} from './positionLevelDefaults.js';
import {
  loadPositionLevelsFromTable,
  savePositionLevelsToTable,
} from './organizationSettingsService.js';

export type { PositionLevelRecord } from './positionLevelDefaults.js';
export { DEFAULT_POSITION_LEVELS } from './positionLevelDefaults.js';

let cachedLevels: PositionLevelRecord[] | null = null;

export function setPositionLevelCache(levels: PositionLevelRecord[]): PositionLevelRecord[] {
  cachedLevels = sortPositionLevels(levels);
  return cachedLevels;
}

export function getCachedPositionLevels(): PositionLevelRecord[] {
  return cachedLevels ?? DEFAULT_POSITION_LEVELS;
}

export async function loadPositionLevelsFromDb(): Promise<PositionLevelRecord[]> {
  try {
    const levels = await loadPositionLevelsFromTable();
    return setPositionLevelCache(levels);
  } catch {
    return setPositionLevelCache(DEFAULT_POSITION_LEVELS);
  }
}

export async function savePositionLevelsToDb(
  levels: PositionLevelRecord[],
  options?: { userId?: string; previous?: PositionLevelRecord[] }
): Promise<PositionLevelRecord[]> {
  const sorted = await savePositionLevelsToTable(levels, options);
  return setPositionLevelCache(sorted);
}

function normalizeTier(raw: unknown): 'manager' | 'officer' | 'staff' {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'manager' || v === 'officer') return v;
  return 'staff';
}

function parseLevelsPayload(raw: unknown): PositionLevelRecord[] | null {
  if (!Array.isArray(raw)) return null;
  const out: PositionLevelRecord[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const label = String(rec.label ?? '').trim();
    const code = String(rec.code ?? label)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    if (!code || !label) continue;
    out.push({
      code,
      label,
      tier: Number.isFinite(Number(rec.tier)) ? Number(rec.tier) : out.length + 1,
      sortOrder: Number.isFinite(Number(rec.sortOrder)) ? Number(rec.sortOrder) : out.length + 1,
      structureTier: normalizeTier(rec.structureTier ?? rec.structure_tier),
    });
  }
  return out.length ? out : null;
}

export function validatePositionLevelsForSave(levels: unknown): PositionLevelRecord[] {
  const parsed = parseLevelsPayload(levels);
  if (!parsed?.length) {
    throw new Error('At least one position level is required.');
  }
  const codes = new Set<string>();
  for (const level of parsed) {
    if (codes.has(level.code)) {
      throw new Error(`Duplicate level code: ${level.code}`);
    }
    codes.add(level.code);
  }
  return assignTiersFromOrder(parsed);
}

export async function assertPositionLevelsCanBeRemoved(codesToRemove: string[]): Promise<void> {
  if (!codesToRemove.length) return;
  const inUse = await Position.findAll({
    where: { level: { [Op.in]: codesToRemove } },
    attributes: ['level'],
    limit: 20,
  });
  if (inUse.length) {
    const used = [...new Set(inUse.map((p) => String((p.get({ plain: true }) as any).level)))];
    throw new Error(`Cannot remove level(s) still assigned to positions: ${used.join(', ')}`);
  }
}

export function codesRemovedFromCatalog(
  previous: PositionLevelRecord[],
  next: PositionLevelRecord[]
): string[] {
  const nextCodes = new Set(next.map((l) => l.code));
  return previous.filter((l) => !nextCodes.has(l.code)).map((l) => l.code);
}
