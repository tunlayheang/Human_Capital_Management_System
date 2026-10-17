import { Api } from '../services/api';

/** Open an uploaded employee document in a new tab (authenticated API + blob URL). */
export async function openEmployeeDocument(
  employeeDisplayId: string,
  documentId: number
): Promise<void> {
  const blob = await Api.employees.fetchDocumentFile(employeeDisplayId, documentId);
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
