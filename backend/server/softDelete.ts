import { Op, type WhereOptions } from 'sequelize';

export type SoftDeleteListMode = 'exclude' | 'only' | 'include';

/** Parse `?deleted=exclude|only|include` (default exclude). */
export function parseSoftDeleteMode(raw: unknown): SoftDeleteListMode {
  const v = String(raw ?? 'exclude').trim().toLowerCase();
  if (v === 'only' || v === 'include') return v;
  return 'exclude';
}

/** True when a row has a soft-delete timestamp. */
export function isSoftDeleted(row: { deletedAt?: unknown } | null | undefined): boolean {
  const v = row?.deletedAt;
  return v != null && String(v).trim() !== '';
}

/** Sequelize where fragment for soft-delete listing. */
export function softDeleteWhere(mode: SoftDeleteListMode = 'exclude'): WhereOptions {
  if (mode === 'include') return {};
  if (mode === 'only') {
    return {
      deletedAt: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] },
    };
  }
  return {
    [Op.or]: [{ deletedAt: null }, { deletedAt: '' }],
  };
}

export function softDeleteTimestamp(): string {
  return new Date().toISOString();
}
