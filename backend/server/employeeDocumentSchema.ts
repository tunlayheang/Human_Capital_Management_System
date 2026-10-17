import { sequelize } from './db.js';
import { normalizeDocumentType } from './employeeDocumentService.js';

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function tableExists(table: string): Promise<boolean> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    { replacements: [table] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

type LegacyDocumentRow = {
  id: number;
  employee_id: string;
  document_type?: string | null;
  document_name?: string | null;
  file_path?: string | null;
  file_size?: number | null;
  uploaded_by?: string | null;
  uploaded_at?: string | Date | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

function iso(value: unknown): string | null {
  if (value == null) return null;
  const s = value instanceof Date ? value.toISOString() : String(value);
  return s.trim() ? s : null;
}

/** Add `employees.documents_json`, migrate rows from `employeedocuments`, then drop the legacy table. */
export async function ensureEmployeeDocumentsConsolidated(): Promise<void> {
  if (!(await columnExists('employees', 'documents_json'))) {
    await sequelize.query('ALTER TABLE `employees` ADD COLUMN `documents_json` JSON NULL');
    console.log('[db] Added employees.documents_json column.');
  }

  if (!(await tableExists('employeedocuments'))) {
    return;
  }

  const [legacyRows] = await sequelize.query(
    `SELECT id, employee_id, document_type, document_name, file_path, file_size,
            uploaded_by, uploaded_at, createdAt, updatedAt
     FROM employeedocuments
     ORDER BY id ASC`,
    { raw: true }
  );
  const grouped = new Map<string, LegacyDocumentRow[]>();
  for (const raw of legacyRows as LegacyDocumentRow[]) {
    const pk = String(raw.employee_id || '').trim();
    if (!pk) continue;
    const list = grouped.get(pk) ?? [];
    list.push(raw);
    grouped.set(pk, list);
  }

  let migratedEmployees = 0;
  for (const [employeePk, docs] of grouped.entries()) {
    const payload = docs.map((row) => ({
      id: Number(row.id),
      document_type: normalizeDocumentType(row.document_type),
      document_name: String(row.document_name ?? 'document'),
      file_path: String(row.file_path ?? ''),
      file_size: row.file_size != null ? Number(row.file_size) : null,
      uploaded_by: row.uploaded_by != null ? String(row.uploaded_by) : null,
      uploaded_at: iso(row.uploaded_at),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    }));

    await sequelize.query(
      `UPDATE employees
       SET documents_json = :payload
       WHERE id = :employeePk
         AND (documents_json IS NULL OR JSON_LENGTH(documents_json) = 0)`,
      { replacements: { payload: JSON.stringify(payload), employeePk } }
    );
    migratedEmployees += 1;
  }

  await sequelize.query('DROP TABLE IF EXISTS `employeedocuments`', { raw: true });
  console.log(
    `[db] Consolidated employeedocuments into employees.documents_json` +
      (migratedEmployees ? ` (${migratedEmployees} employee(s)).` : '.') +
      ' Legacy table dropped.'
  );
}
