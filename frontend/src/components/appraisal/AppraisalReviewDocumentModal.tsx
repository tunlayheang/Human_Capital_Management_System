import React, { useCallback, useEffect, useState } from 'react';
import { ContentSkeleton } from '../common/ContentSkeleton';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import type { EmployeeAppraisal } from '../../types/appraisal';
import type { AppraisalDetailPayload } from './appraisalDetailUtils';
import { AppraisalReviewDocument } from './AppraisalReviewDocument';
import { exportAppraisalReviewDocument } from '../../utils/exportAppraisalReviewPdf';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';
import { ExportFormatMenu } from '../ui/ExportFormatMenu';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  appraisalId: string | null;
  /** Optional list-row summary shown while loading. */
  summary?: EmployeeAppraisal | null;
};

export const AppraisalReviewDocumentModal: React.FC<Props> = ({
  isOpen,
  onClose,
  appraisalId,
  summary,
}) => {
  const { showToast } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<AppraisalDetailPayload | null>(null);

  const load = useCallback(async () => {
    if (!appraisalId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    try {
      const data = (await Api.appraisal.getAppraisal(appraisalId)) as AppraisalDetailPayload;
      setDetail(data);
    } catch (e) {
      setDetail(null);
      showToast((e as Error)?.message || 'Could not load appraisal detail', 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  }, [appraisalId, onClose, showToast]);

  useEffect(() => {
    if (!isOpen || !appraisalId) {
      setDetail(null);
      return;
    }
    void load();
  }, [isOpen, appraisalId, load]);

  const handleExport = async (format: ExportFileExt) => {
    if (!detail) return;
    try {
      await exportAppraisalReviewDocument(format, {
        appraisal: detail.appraisal,
        componentScores: detail.componentScores ?? [],
        linkedMovements: detail.linkedMovements ?? [],
      });
      showToast(`Appraisal exported as ${format === 'xlsx' ? 'Excel' : format.toUpperCase()}.`, 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Export failed.', 'error');
    }
  };

  const title =
    detail?.appraisal.employeeName ??
    summary?.employeeName ??
    'Appraisal review';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Appraisal detail"
      description={`Document review — ${title}`}
      size="2xl"
      contentClassName="!p-0 bg-slate-100/90 dark:bg-slate-950/60"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ExportFormatMenu
            variant="button"
            disabled={!detail || loading}
            onExport={handleExport}
          />
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="p-4 sm:p-6 max-h-[min(72vh,42rem)] overflow-y-auto overscroll-contain">
        {loading ? (
          <ContentSkeleton layout="form" rows={1} label="Loading appraisal document…" />
        ) : detail ? (
          <AppraisalReviewDocument
            appraisal={detail.appraisal}
            componentScores={detail.componentScores ?? []}
            linkedMovements={detail.linkedMovements ?? []}
            viewerUserId={user?.id}
          />
        ) : (
          <p className="text-sm text-center text-slate-500 py-12">No appraisal data to display.</p>
        )}
      </div>
    </Modal>
  );
};

export default AppraisalReviewDocumentModal;
