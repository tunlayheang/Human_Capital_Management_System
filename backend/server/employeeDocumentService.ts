import fs from 'node:fs';
import path from 'node:path';
import type { Transaction } from 'sequelize';
import type { Express } from 'express';
import { Employee } from './db.js';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

function extensionFromUpload(file: Express.Multer.File): string {
  const fromName = path.extname(String(file.originalname || '')).toLowerCase();
  if (fromName) return fromName;
  const byMime: Record<string, string> = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  };
  return byMime[file.mimetype] || '';
}

/** Move multer temp file to uploads/ with a stable extension for browser preview. */
export function finalizeStoredUploadFile(file: Express.Multer.File): {
  relativePath: string;
  storedFileName: string;
} {
  const ext = extensionFromUpload(file);
  const base = path.basename(file.filename);
  const storedFileName = ext && !base.toLowerCase().endsWith(ext) ? `${base}${ext}` : base;
  const dest = path.join(UPLOADS_DIR, storedFileName);
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (file.path !== dest) {
    try {
      fs.renameSync(file.path, dest);
    } catch {
      fs.copyFileSync(file.path, dest);
      fs.unlinkSync(file.path);
    }
  }
  return { relativePath: `/uploads/${storedFileName}`, storedFileName };
}

export function resolveUploadDiskPath(filePath: string): string {
  const raw = String(filePath || '').trim();
  const match = raw.match(/\/uploads\/([^?#]+)/i) || raw.match(/^uploads\/([^?#]+)/i);
  const name = match ? match[1] : path.basename(raw);
  return path.join(UPLOADS_DIR, name);
}

export function mimeTypeForDocumentName(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return map[ext] || 'application/octet-stream';
}

export const REQUIRED_EMPLOYEE_DOCUMENT_TYPES = [
  'National ID',
  'Passport',
  'Contract',
] as const;

export const EMPLOYEE_DOCUMENT_TYPES = [
  'National ID',
  'Passport',
  'Contract',
  'Resignation Letter',
  'Certificate',
  'Resume',
  'CV',
  'Work Permit',
  'Other',
] as const;

const DOCUMENT_TYPE_ALIASES: Record<string, string> = {
  'national id': 'National ID',
  national_id: 'National ID',
  passport: 'Passport',
  contract: 'Contract',
  'resignation letter': 'Resignation Letter',
  resignation: 'Resignation Letter',
  'resignation-letter': 'Resignation Letter',
  'resign letter': 'Resignation Letter',
  certificate: 'Certificate',
  resume: 'Resume',
  cv: 'CV',
  'resume / cv': 'Resume',
  'resume/cv': 'Resume',
  'cv/resume': 'Resume',
  'work permit': 'Work Permit',
  other: 'Other',
};

export function normalizeDocumentType(raw: unknown): string {
  const t = String(raw ?? '').trim();
  if (!t) return 'Other';
  const alias = DOCUMENT_TYPE_ALIASES[t.toLowerCase()];
  if (alias) return alias;
  const split = t
    .split(/[,&;|/]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  for (const token of split) {
    const mapped = DOCUMENT_TYPE_ALIASES[token];
    if (mapped) return mapped;
  }
  const match = EMPLOYEE_DOCUMENT_TYPES.find((x) => x.toLowerCase() === t.toLowerCase());
  return match ?? t;
}

export type StoredEmployeeDocument = {
  id: number;
  document_type: string;
  document_name: string;
  file_path: string;
  file_size: number | null;
  uploaded_by: string | null;
  uploaded_at: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type EmployeeDocumentDto = {
  id: number;
  employeeId: string;
  documentType: string;
  documentName: string;
  filePath: string;
  fileSize: number | null;
  uploadedBy: string | null;
  uploadedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

function parseDocumentsJson(raw: unknown): StoredEmployeeDocument[] {
  if (raw == null) return [];
  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const docs: StoredEmployeeDocument[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    docs.push({
      id,
      document_type: normalizeDocumentType(row.document_type ?? row.documentType),
      document_name: String(row.document_name ?? row.documentName ?? 'document'),
      file_path: String(row.file_path ?? row.filePath ?? ''),
      file_size: row.file_size != null || row.fileSize != null
        ? Number(row.file_size ?? row.fileSize)
        : null,
      uploaded_by:
        row.uploaded_by != null || row.uploadedBy != null
          ? String(row.uploaded_by ?? row.uploadedBy)
          : null,
      uploaded_at:
        row.uploaded_at != null || row.uploadedAt != null
          ? String(row.uploaded_at ?? row.uploadedAt)
          : null,
      createdAt:
        row.createdAt != null ? String(row.createdAt) : row.created_at != null ? String(row.created_at) : null,
      updatedAt:
        row.updatedAt != null ? String(row.updatedAt) : row.updated_at != null ? String(row.updated_at) : null,
    });
  }
  return docs.sort((a, b) => b.id - a.id);
}

function nextDocumentId(docs: StoredEmployeeDocument[]): number {
  let max = 0;
  for (const doc of docs) max = Math.max(max, doc.id);
  return max + 1;
}

async function loadEmployeeDocuments(
  employeePk: string,
  transaction?: Transaction
): Promise<StoredEmployeeDocument[]> {
  const employee = await Employee.findByPk(employeePk, {
    attributes: ['id', 'documents_json'],
    transaction,
  });
  if (!employee) return [];
  return parseDocumentsJson(employee.get('documents_json'));
}

async function saveEmployeeDocuments(
  employeePk: string,
  docs: StoredEmployeeDocument[],
  transaction?: Transaction
): Promise<void> {
  await Employee.update(
    { documents_json: docs },
    { where: { id: employeePk }, transaction }
  );
}

/** Normalize legacy/multi-value document types stored in employees.documents_json. */
export async function normalizeEmployeeDocumentTypesInDatabase(): Promise<void> {
  const employees = await Employee.findAll({ attributes: ['id', 'documents_json'] });
  let updatedEmployees = 0;
  for (const employee of employees) {
    const docs = parseDocumentsJson(employee.get('documents_json'));
    if (!docs.length) continue;
    let changed = false;
    const normalized = docs.map((doc) => {
      let document_type = normalizeDocumentType(doc.document_type);
      if (
        /resume\s*\/\s*cv|cv\s*\/\s*resume/i.test(doc.document_type) &&
        doc.document_name &&
        /(?:^|[\s._-])cv(?:[\s._-]|$)/i.test(doc.document_name)
      ) {
        document_type = 'CV';
      }
      if (document_type !== doc.document_type) changed = true;
      return { ...doc, document_type };
    });
    if (changed) {
      await saveEmployeeDocuments(String(employee.get('id')), normalized);
      updatedEmployees += 1;
    }
  }
  if (updatedEmployees > 0) {
    console.log(`[db] Normalized document types for ${updatedEmployees} employee(s).`);
  }
}

export async function employeeHasDocumentType(
  employeeInternalId: string,
  documentType: string,
  transaction?: Transaction
): Promise<boolean> {
  const want = normalizeDocumentType(documentType);
  const docs = await loadEmployeeDocuments(employeeInternalId, transaction);
  return docs.some((doc) => normalizeDocumentType(doc.document_type) === want);
}

export async function employeeHasResignationLetter(
  employeePk: string,
  transaction?: Transaction
): Promise<boolean> {
  return employeeHasDocumentType(employeePk, 'Resignation Letter', transaction);
}

export async function countEmployeeDocuments(employeePk: string): Promise<number> {
  const docs = await loadEmployeeDocuments(employeePk);
  return docs.length;
}

export async function findEmployeeByDisplayId(displayId: string) {
  const key = String(displayId || '').trim();
  if (!key) return null;
  const { employeeLookupWhere } = await import('./employeeIdFormat.js');
  return Employee.findOne({ where: employeeLookupWhere(key) as any });
}

export function documentToDto(
  doc: StoredEmployeeDocument,
  employeeInternalId: string
): EmployeeDocumentDto {
  return {
    id: doc.id,
    employeeId: employeeInternalId,
    documentType: doc.document_type,
    documentName: doc.document_name,
    filePath: doc.file_path,
    fileSize: doc.file_size,
    uploadedBy: doc.uploaded_by,
    uploadedAt: doc.uploaded_at,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function listEmployeeDocuments(displayId: string): Promise<EmployeeDocumentDto[]> {
  const employee = await findEmployeeByDisplayId(displayId);
  if (!employee) return [];
  const plain = employee.get({ plain: true }) as { id: string };
  const docs = await loadEmployeeDocuments(plain.id);
  return docs.map((doc) => documentToDto(doc, plain.id));
}

export async function createEmployeeDocument(params: {
  displayId: string;
  file: Express.Multer.File;
  documentType: string;
  documentName?: string;
  uploadedBy?: string;
}): Promise<EmployeeDocumentDto> {
  const employee = await findEmployeeByDisplayId(params.displayId);
  if (!employee) {
    throw Object.assign(new Error('Employee not found'), { statusCode: 404 });
  }
  const plain = employee.get({ plain: true }) as { id: string };
  const docType = normalizeDocumentType(params.documentType);
  const already = await employeeHasDocumentType(plain.id, docType);
  if (already) {
    throw Object.assign(
      new Error(
        `A ${docType} document is already on file. Delete it before uploading a new one.`
      ),
      { statusCode: 409 }
    );
  }
  const docName =
    String(params.documentName || '').trim() ||
    params.file.originalname ||
    params.file.filename ||
    'document';

  const { relativePath } = finalizeStoredUploadFile(params.file);
  const now = new Date().toISOString();
  const docs = await loadEmployeeDocuments(plain.id);
  const stored: StoredEmployeeDocument = {
    id: nextDocumentId(docs),
    document_type: docType,
    document_name: docName,
    file_path: relativePath,
    file_size: params.file.size,
    uploaded_by: params.uploadedBy || null,
    uploaded_at: now,
    createdAt: now,
    updatedAt: now,
  };
  await saveEmployeeDocuments(plain.id, [stored, ...docs]);
  return documentToDto(stored, plain.id);
}

export async function missingRequiredDocumentTypesForDisplayId(
  displayId: string
): Promise<string[]> {
  const docs = await listEmployeeDocuments(displayId);
  const have = new Set(docs.map((d) => String(d.documentType || '').trim()));
  return REQUIRED_EMPLOYEE_DOCUMENT_TYPES.filter((t) => !have.has(t));
}

export async function employeeHasRequiredDocuments(displayId: string): Promise<boolean> {
  const missing = await missingRequiredDocumentTypesForDisplayId(displayId);
  return missing.length === 0;
}

export async function getEmployeeDocumentForDownload(
  displayId: string,
  documentId: number
): Promise<{ diskPath: string; documentName: string; mime: string } | null> {
  const employee = await findEmployeeByDisplayId(displayId);
  if (!employee) return null;
  const plain = employee.get({ plain: true }) as { id: string };
  const docs = await loadEmployeeDocuments(plain.id);
  const stored = docs.find((doc) => doc.id === documentId);
  if (!stored) return null;
  const dto = documentToDto(stored, plain.id);
  const diskPath = resolveUploadDiskPath(dto.filePath);
  if (!fs.existsSync(diskPath)) return null;
  return {
    diskPath,
    documentName: dto.documentName || path.basename(diskPath),
    mime: mimeTypeForDocumentName(dto.documentName || diskPath),
  };
}

export async function deleteEmployeeDocument(
  displayId: string,
  documentId: number
): Promise<boolean> {
  const employee = await findEmployeeByDisplayId(displayId);
  if (!employee) return false;
  const plain = employee.get({ plain: true }) as { id: string };
  const docs = await loadEmployeeDocuments(plain.id);
  const target = docs.find((doc) => doc.id === documentId);
  if (!target) return false;
  const remaining = docs.filter((doc) => doc.id !== documentId);
  await saveEmployeeDocuments(plain.id, remaining);
  const diskPath = resolveUploadDiskPath(target.file_path);
  if (fs.existsSync(diskPath)) {
    try {
      fs.unlinkSync(diskPath);
    } catch {
      /* non-fatal */
    }
  }
  return true;
}
