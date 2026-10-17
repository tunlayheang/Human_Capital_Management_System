import { Op } from 'sequelize';
import { sequelize } from './db.js';
import { employeeDisplayIdLookupVariants, isEmployeeBadgeDisplayId } from './employeeIdFormat.js';

/** Collapse whitespace; keep Unicode letters (incl. Khmer) intact. */
export function normalizeEmployeeSearchQuery(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function col(name: string) {
  // Unqualified column — used inside Employee.findAll / count where clauses.
  return sequelize.col(name);
}

function coalesceCol(name: string) {
  return sequelize.fn('COALESCE', col(name), '');
}

/** CONCAT(a, ' ', b) LIKE pattern */
function namePairLike(a: string, b: string, pattern: string) {
  return sequelize.where(
    sequelize.fn('CONCAT', coalesceCol(a), ' ', coalesceCol(b)),
    { [Op.like]: pattern }
  );
}

/** CONCAT without spaces — helps Khmer / glued name queries. */
function namePairCompactLike(a: string, b: string, pattern: string) {
  return sequelize.where(
    sequelize.fn('REPLACE', sequelize.fn('CONCAT', coalesceCol(a), coalesceCol(b)), ' ', ''),
    { [Op.like]: pattern }
  );
}

function allNameBlob() {
  return sequelize.fn(
    'CONCAT',
    coalesceCol('first_name'),
    ' ',
    coalesceCol('last_name'),
    ' ',
    coalesceCol('first_name_kh'),
    ' ',
    coalesceCol('last_name_kh')
  );
}

/**
 * Apply employee list text search to a Sequelize `where` object.
 * Matches full name (EN + KH, either order), parts, EmpID, email, phones, national ID.
 */
export function applyEmployeeTextSearch(
  where: Record<string, unknown>,
  searchRaw: unknown
): void {
  const search = normalizeEmployeeSearchQuery(searchRaw);
  if (!search) return;

  const like = `%${escapeLike(search)}%`;
  const compact = search.replace(/\s+/g, '');
  const likeCompact = `%${escapeLike(compact)}%`;

  const ors: unknown[] = [
    { first_name: { [Op.like]: like } },
    { last_name: { [Op.like]: like } },
    { first_name_kh: { [Op.like]: like } },
    { last_name_kh: { [Op.like]: like } },
    { email: { [Op.like]: like } },
    { employee_id: { [Op.like]: like } },
    { phone: { [Op.like]: like } },
    { work_phone: { [Op.like]: like } },
    { telegram_number: { [Op.like]: like } },
    { national_id: { [Op.like]: like } },
    // Full name EN / KH (both word orders)
    namePairLike('first_name', 'last_name', like),
    namePairLike('last_name', 'first_name', like),
    namePairLike('first_name_kh', 'last_name_kh', like),
    namePairLike('last_name_kh', 'first_name_kh', like),
    // No-space variants (Khmer pasted without spaces, or compacted Latin)
    namePairCompactLike('first_name', 'last_name', likeCompact),
    namePairCompactLike('last_name', 'first_name', likeCompact),
    namePairCompactLike('first_name_kh', 'last_name_kh', likeCompact),
    namePairCompactLike('last_name_kh', 'first_name_kh', likeCompact),
    sequelize.where(allNameBlob(), { [Op.like]: like }),
  ];

  // Badge-like queries (ROC / legacy IROC / EMP) — expand to canonical + legacy
  // variants so searching "IROC00035" finds the stored "ROC00035" (and vice-versa).
  if (isEmployeeBadgeDisplayId(search)) {
    const variants = employeeDisplayIdLookupVariants(search);
    if (variants.length) {
      ors.push({ employee_id: { [Op.in]: variants } });
      for (const variant of variants) {
        ors.push({ employee_id: { [Op.like]: `%${escapeLike(variant)}%` } });
      }
    }
  }

  // Multi-word: every token must appear somewhere in the combined name blob
  // so "Sokha Chan" / Khmer multi-part names match even if spacing differs slightly.
  const tokens = search.split(' ').filter((t) => t.length > 0);
  if (tokens.length > 1) {
    ors.push(
      sequelize.and(
        ...tokens.map((token) =>
          sequelize.where(allNameBlob(), { [Op.like]: `%${escapeLike(token)}%` })
        )
      )
    );
  }

  const priorAnd = where[Op.and] ? [...(where[Op.and] as unknown[])] : [];
  // Keep any existing Op.or from callers by nesting under AND.
  if (where[Op.or]) {
    priorAnd.push({ [Op.or]: where[Op.or] });
    delete where[Op.or];
  }
  priorAnd.push({ [Op.or]: ors });
  where[Op.and] = priorAnd;
}
