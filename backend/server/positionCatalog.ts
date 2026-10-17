/** Organizational job level on a position (not portal access role). */

import type { StructureTier } from './companyStructureService.js';
import {
  DEFAULT_POSITION_LEVELS,
  getCachedPositionLevels,
  type PositionLevelRecord,
} from './positionLevelSettingsService.js';

export type PositionLevel = string;

const DEFAULT_LABELS = Object.fromEntries(
  DEFAULT_POSITION_LEVELS.map((l) => [l.code, l.label])
) as Record<string, string>;

export function getPositionLevelCatalog(): PositionLevelRecord[] {
  return getCachedPositionLevels();
}

export const POSITION_LEVEL_VALUES = DEFAULT_POSITION_LEVELS.map(
  (l) => l.code
) as readonly string[];

export const POSITION_LEVEL_OPTIONS = () =>
  getPositionLevelCatalog().map((l) => ({ value: l.code, label: l.label }));

export function structureTierForLevelCode(code: string | null | undefined): StructureTier {
  const hit = getPositionLevelCatalog().find((l) => l.code === code);
  return hit?.structureTier ?? 'staff';
}

export function tierForLevelCode(code: string | null | undefined): number {
  const normalized = String(code ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
  if (!normalized) return 999;
  const hit = getPositionLevelCatalog().find((l) => l.code === normalized);
  return hit?.tier ?? hit?.sortOrder ?? 999;
}

export function normalizePositionLevel(raw: unknown): PositionLevel | null {
  const v = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
  const catalog = getPositionLevelCatalog();
  const codes = new Set(catalog.map((l) => l.code));
  if (codes.has(v)) return v;
  const byLabel = catalog.find(
    (o) => o.label.toLowerCase() === String(raw ?? '').trim().toLowerCase()
  );
  return byLabel ? byLabel.code : null;
}

export function positionLevelLabel(raw: unknown): string {
  const code = normalizePositionLevel(raw);
  if (!code) return String(raw ?? '').trim();
  const hit = getPositionLevelCatalog().find((l) => l.code === code);
  return hit?.label ?? DEFAULT_LABELS[code] ?? code;
}
