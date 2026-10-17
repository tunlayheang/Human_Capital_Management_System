import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText,
  Upload,
  Trash2,
  ExternalLink,
  Loader2,
  AlertCircle,
  Save,
} from 'lucide-react';
import { Api } from '../../services/api';
import { openEmployeeDocument } from '../../utils/openEmployeeDocument';
import type { EmployeeDocumentRow } from '../../types/employeeDocument';
import {
  EMPLOYEE_DOCUMENT_TYPES,
  normalizeEmployeeDocumentType,
} from '../../constants/employeeDocumentTypes';
import { Button } from '../ui/Button';
import { SelectWithOther } from '../ui/SelectWithOther';
import { useToast } from '../../context/ToastContext';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { SELECT_OTHER_VALUE } from '../../constants/selectOther';
import { validateOtherSpecification } from '../../utils/selectWithOther';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';
import { ContentSkeleton } from '../common/ContentSkeleton';
import {
  WizardField,
  WizardFieldGrid,
  WizardSectionCard,
  WizardStepStack,
  WIZARD_INPUT_CLASS,
  WIZARD_SELECT_CLASS,
} from './wizardLayout';

function formatBytes(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  employeeDisplayId?: string;
  canSaveDraft: boolean;
  onSaveDraftForUploads: () => Promise<string | null>;
};

export const StepDocuments: React.FC<Props> = ({
  employeeDisplayId,
  canSaveDraft,
  onSaveDraftForUploads,
}) => {
  const { showToast } = useToast();
  const { confirm, ConfirmDialogHost } = useConfirmDialog();
  const fileRef = useRef<HTMLInputElement>(null);
  const resolvedIdRef = useRef<string | undefined>(employeeDisplayId?.trim());
  const [documents, setDocuments] = useState<EmployeeDocumentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [openingDocId, setOpeningDocId] = useState<number | null>(null);
  const [documentType, setDocumentType] = useState<string>('');
  const [savingDraft, setSavingDraft] = useState(false);

  const activeDisplayId = employeeDisplayId?.trim() || resolvedIdRef.current;

  useEffect(() => {
    if (employeeDisplayId?.trim()) {
      resolvedIdRef.current = employeeDisplayId.trim();
    }
  }, [employeeDisplayId]);

  const loadDocuments = useCallback(async () => {
    const key = employeeDisplayId?.trim() || resolvedIdRef.current;
    if (!key) {
      setDocuments([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await Api.employees.listDocuments(key);
      setDocuments(Array.isArray(rows) ? rows : []);
    } catch (e) {
      const status = (e as Error & { status?: number })?.status;
      // 404 = EmpID not persisted yet (or legacy IROC before migrate) — stay quiet.
      if (status !== 404) {
        console.error(e);
        showToast('Failed to load documents', 'error');
      }
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [employeeDisplayId, showToast]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const usedDocumentTypes = useMemo(
    () => new Set(documents.map((d) => normalizeEmployeeDocumentType(d.documentType))),
    [documents]
  );

  useEffect(() => {
    if (!String(documentType).trim()) return;
    const current = normalizeEmployeeDocumentType(documentType);
    if (!usedDocumentTypes.has(current)) return;
    const next = EMPLOYEE_DOCUMENT_TYPES.find((t) => !usedDocumentTypes.has(t));
    if (next) setDocumentType(next);
  }, [documentType, usedDocumentTypes]);

  const ensureEmployeeId = async (): Promise<string | null> => {
    const existing = employeeDisplayId?.trim() || resolvedIdRef.current;
    if (existing) return existing;
    if (!canSaveDraft) {
      showToast('Enter at least a name or employee ID before saving.', 'warning');
      return null;
    }
    setSavingDraft(true);
    try {
      const id = await onSaveDraftForUploads();
      if (!id) {
        showToast('Save draft first to attach documents.', 'warning');
        return null;
      }
      resolvedIdRef.current = id;
      void loadDocuments();
      return id;
    } finally {
      setSavingDraft(false);
    }
  };

  const documentTypeOptions = useMemo(
    () =>
      EMPLOYEE_DOCUMENT_TYPES.map((t) => ({
        value: t,
        label: t,
        disabled: usedDocumentTypes.has(t) && t !== SELECT_OTHER_VALUE,
      })),
    [usedDocumentTypes]
  );

  const handleUpload = async (file: File) => {
    const displayId = await ensureEmployeeId();
    if (!displayId) return;

    const typeErr = validateOtherSpecification(
      documentType,
      EMPLOYEE_DOCUMENT_TYPES,
      'Please specify document type'
    );
    if (typeErr) {
      showToast(typeErr, 'warning');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    const type = normalizeEmployeeDocumentType(documentType);
    if (documents.some((d) => normalizeEmployeeDocumentType(d.documentType) === type)) {
      showToast(
        `A ${type} document is already uploaded. Delete it first, then upload the new file.`,
        'warning'
      );
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    setUploading(true);
    try {
      const row = await Api.employees.uploadDocument(displayId, file, documentType);
      setDocuments((prev) => [row, ...prev]);
      showToast('Document uploaded', 'success');
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (docId: number) => {
    const key = activeDisplayId;
    if (!key) return;
    const ok = await confirm({
      title: 'Remove document?',
      description: 'Remove this document from the employee record?',
      variant: 'danger',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await Api.employees.deleteDocument(key, docId);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      showToast('Document removed', 'info');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Delete failed', 'error');
    }
  };

  const handleOpen = async (docId: number) => {
    const key = activeDisplayId;
    if (!key) {
      showToast('Save draft first to view documents.', 'warning');
      return;
    }
    setOpeningDocId(docId);
    try {
      await openEmployeeDocument(key, docId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not open document', 'error');
    } finally {
      setOpeningDocId(null);
    }
  };

  const ready = !!activeDisplayId;

  const selectedType = normalizeEmployeeDocumentType(documentType);
  const typeAlreadyUploaded = usedDocumentTypes.has(selectedType);
  const documentTypeReady =
    validateOtherSpecification(
      documentType,
      EMPLOYEE_DOCUMENT_TYPES,
      'Choose a document type (or Other, then Enter)'
    ) === null;
  const uploadBlocked = !documentTypeReady || typeAlreadyUploaded || uploading;
  const uploadButtonActive = documentTypeReady && ready && !typeAlreadyUploaded && !uploading;

  return (
    <WizardStepStack>
      <ConfirmDialogHost />

      {!ready && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-start gap-2 text-amber-900 dark:text-amber-100 flex-1">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <p className="text-sm">
              Save a draft employee record first so uploads can be linked to an employee ID.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            isLoading={savingDraft}
            disabled={!canSaveDraft}
            onClick={() => void ensureEmployeeId()}
            className="shrink-0 border-amber-300 dark:border-amber-700"
          >
            <Save className="w-4 h-4 mr-2" />
            Save draft & enable uploads
          </Button>
        </div>
      )}

      <WizardSectionCard icon={Upload} title="Upload file">
        <WizardFieldGrid>
          <WizardField label="Document type">
            <SelectWithOther
              value={documentType}
              onChange={setDocumentType}
              options={documentTypeOptions}
              selectClassName={WIZARD_SELECT_CLASS}
              inputClassName={WIZARD_INPUT_CLASS}
              disabled={uploading}
              emptyOption={{ value: '', label: 'Select document type' }}
              otherPlaceholder="e.g. Visa letter, Training certificate…"
              otherLabel="Specify document type"
            />
            {documentTypeReady && typeAlreadyUploaded && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  <strong>{selectedType}</strong> is already on file. Delete it from the list below
                  before uploading a replacement.
                </span>
              </p>
            )}
          </WizardField>
          <div className="flex flex-col justify-end">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,application/pdf,image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
              }}
            />
            <Button
              type="button"
              variant={uploadButtonActive ? 'primary' : 'secondary'}
              onClick={() => {
                if (!documentTypeReady) {
                  showToast('Select or enter a document type before uploading.', 'warning');
                  return;
                }
                fileRef.current?.click();
              }}
              isLoading={uploading}
              disabled={uploadBlocked || (!ready && !canSaveDraft)}
              title={
                !ready
                  ? 'Save a draft employee record first'
                  : !documentTypeReady
                    ? 'Choose or enter a document type first'
                    : typeAlreadyUploaded
                      ? `Delete the existing ${selectedType} document before uploading a new one`
                      : undefined
              }
              className="w-full sm:w-auto"
            >
              <Upload className="w-4 h-4 mr-2" />
              Choose file & upload
            </Button>
          </div>
        </WizardFieldGrid>
      </WizardSectionCard>

      <WizardSectionCard
        icon={FileText}
        title={`Uploaded files (${documents.length})`}
        headerAside={loading ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : null}
        bodyClassName="p-0"
      >

        {loading && documents.length === 0 ? (
          <ContentSkeleton layout="list" rows={3} className="p-3" label="Loading documents…" />
        ) : documents.length === 0 ? (
          <p className="p-8 text-sm text-slate-500 text-center">
            No documents yet. Upload ID, contract, or certificates above.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">
            {documents.map((doc) => {
              const docTypeNorm = normalizeEmployeeDocumentType(doc.documentType);
              return (
              <li
                key={doc.id}
                className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/50"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-100 dark:bg-primary-900/40 text-primary-600">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 dark:text-white truncate">
                    {doc.documentName}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    <span className="font-medium text-slate-600 dark:text-slate-300">{docTypeNorm}</span>
                    {' · '}
                    {formatBytes(doc.fileSize)}
                    {doc.uploadedAt
                      ? ` · ${formatDateOnlyDisplay(doc.uploadedAt)}`
                      : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => void handleOpen(doc.id)}
                    disabled={openingDocId === doc.id}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-400 disabled:opacity-50"
                  >
                    {openingDocId === doc.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ExternalLink className="w-3.5 h-3.5" />
                    )}
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(doc.id)}
                    className="p-2 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                    aria-label="Delete document"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            );
            })}
          </ul>
        )}
      </WizardSectionCard>
    </WizardStepStack>
  );
};
