/** Keep in sync with backend `EMPLOYEE_DOCUMENT_TYPES`. */
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

export type EmployeeDocumentType = (typeof EMPLOYEE_DOCUMENT_TYPES)[number];

export function normalizeEmployeeDocumentType(raw: unknown): string {
  const t = String(raw ?? '').trim();
  if (!t) return 'Other';
  if (t.toLowerCase() === 'resignation' || t.toLowerCase() === 'resign letter') {
    return 'Resignation Letter';
  }
  const lower = t.toLowerCase();
  if (lower === 'resume / cv' || lower === 'resume/cv' || lower === 'cv/resume') return 'Resume';
  const match = EMPLOYEE_DOCUMENT_TYPES.find((x) => x.toLowerCase() === t.toLowerCase());
  return match ?? t;
}
