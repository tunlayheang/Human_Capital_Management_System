import { QueryTypes } from 'sequelize';
import { sequelize, Department, Position } from './db';

const DEPARTMENT_PREFIX = 'DEPT';
const POSITION_PREFIX = 'POS';
const PAD = 3;

type ColumnRef = {
  tableName: string;
  columnName: string;
};

function padId(prefix: string, value: number): string {
  return `${prefix}${String(value).padStart(PAD, '0')}`;
}

export function isCanonicalDepartmentId(value: string | null | undefined): boolean {
  return /^DEPT\d{3,}$/i.test(String(value || '').trim());
}

export function isCanonicalPositionId(value: string | null | undefined): boolean {
  return /^POS\d{3,}$/i.test(String(value || '').trim());
}

async function loadSimpleIds(model: typeof Department | typeof Position): Promise<string[]> {
  const rows = (await model.findAll({ attributes: ['id'], order: [['id', 'ASC']] })) as Array<{
    get: (name: string) => unknown;
  }>;
  return rows.map((row) => String(row.get('id') || '').trim()).filter(Boolean);
}

function nextIdFromExisting(ids: string[], prefix: string): string {
  const max = ids.reduce((highest, id) => {
    const match = String(id).match(new RegExp(`^${prefix}(\\d+)$`, 'i'));
    return match ? Math.max(highest, Number(match[1] || 0)) : highest;
  }, 0);
  return padId(prefix, max + 1);
}

export async function generateNextDepartmentId(): Promise<string> {
  return nextIdFromExisting(await loadSimpleIds(Department), DEPARTMENT_PREFIX);
}

export async function generateNextPositionId(): Promise<string> {
  return nextIdFromExisting(await loadSimpleIds(Position), POSITION_PREFIX);
}

async function findColumns(columnNames: string[]): Promise<ColumnRef[]> {
  if (!columnNames.length) return [];
  const rows = (await sequelize.query(
    `
      SELECT TABLE_NAME as tableName, COLUMN_NAME as columnName
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND COLUMN_NAME IN (:columnNames)
    `,
    {
      replacements: { columnNames },
      type: QueryTypes.SELECT,
    }
  )) as ColumnRef[];
  return rows.filter((row) => row.tableName && row.columnName);
}

async function replaceDirectValues(
  columns: ColumnRef[],
  mapping: Array<{ from: string; to: string }>
): Promise<void> {
  for (const { tableName, columnName } of columns) {
    for (const { from, to } of mapping) {
      await sequelize.query(
        `UPDATE \`${tableName}\` SET \`${columnName}\` = :to WHERE \`${columnName}\` = :from`,
        { replacements: { from, to } }
      );
    }
  }
}

async function replaceColumnTextValues(
  columns: ColumnRef[],
  mapping: Array<{ from: string; to: string }>
): Promise<void> {
  for (const { tableName, columnName } of columns) {
    for (const { from, to } of mapping) {
      await sequelize.query(
        `
          UPDATE \`${tableName}\`
          SET \`${columnName}\` = REPLACE(CAST(\`${columnName}\` AS CHAR), :fromToken, :toToken)
          WHERE CAST(\`${columnName}\` AS CHAR) LIKE :search
        `,
        {
          replacements: {
            fromToken: `"${from}"`,
            toToken: `"${to}"`,
            search: `%"${from}"%`,
          },
        }
      );
    }
  }
}

async function migrateIdFamily(options: {
  table: 'departments' | 'positions';
  prefix: string;
  model: typeof Department | typeof Position;
  foreignKeyColumns: string[];
  listColumns?: string[];
}): Promise<void> {
  const ids = await loadSimpleIds(options.model);
  if (!ids.length) return;

  const needsMigration = ids.some((id, index) => padId(options.prefix, index + 1) !== id);
  if (!needsMigration) return;

  const tempMap = ids.map((id, index) => ({
    from: id,
    to: `__TMP_${options.prefix}_${index + 1}__`,
  }));
  const finalMap = ids.map((id, index) => ({
    from: `__TMP_${options.prefix}_${index + 1}__`,
    to: padId(options.prefix, index + 1),
  }));

  const directColumns = await findColumns(options.foreignKeyColumns);
  const listColumns = await findColumns(options.listColumns ?? []);

  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await replaceDirectValues([{ tableName: options.table, columnName: 'id' }, ...directColumns], tempMap);
    await replaceColumnTextValues(listColumns, tempMap);
    await replaceDirectValues([{ tableName: options.table, columnName: 'id' }, ...directColumns], finalMap);
    await replaceColumnTextValues(listColumns, finalMap);
  } finally {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

export async function migrateOrganizationUnitIds(): Promise<void> {
  await migrateIdFamily({
    table: 'departments',
    prefix: DEPARTMENT_PREFIX,
    model: Department,
    foreignKeyColumns: ['department_id', 'from_department_id', 'to_department_id', 'departmentId'],
    listColumns: ['department_ids'],
  });
  await migrateIdFamily({
    table: 'positions',
    prefix: POSITION_PREFIX,
    model: Position,
    foreignKeyColumns: ['position_id', 'from_position_id', 'to_position_id', 'positionId'],
    listColumns: ['position_ids'],
  });
}
