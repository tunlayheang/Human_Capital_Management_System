import React, { useCallback, useEffect, useState } from 'react';
import { ContentSkeleton } from '../common/ContentSkeleton';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import type { ProbationPendingApprovalItem, ProbationRow } from '../../types';
import { ProbationReviewDocument } from './ProbationReviewDocument';
import { exportProbationReviewDocument } from '../../utils/exportProbationReviewPdf';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';
import { ExportFormatMenu } from '../ui/ExportFormatMenu';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  reviewId: string | null;
  summary?: ProbationPendingApprovalItem | null;
};

export const ProbationReviewDocumentModal: React.FC<Props> = ({
  isOpen,
  onClose,
  reviewId,
  summary,
}) => {
  const { showToast } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [row, setRow] = useState<ProbationRow | null>(null);

  const load = useCallback(async () => {
    if (!reviewId) {
      setRow(null);
      return;
    }
    setLoading(true);
    try {
      const data = await Api.reviews.getProbation();
      const payload = data as { items?: ProbationRow[] };
      const list = Array.isArray(payload?.items) ? payload.items : Array.isArray(data) ? data : [];
      const match = list.find((entry) => String(entry.reviewId) === String(reviewId));
      if (!match) {
        throw new Error('Probation review not found.');
      }
      setRow(match);
    } catch (e) {
      setRow(null);
      showToast((e as Error)?.message || 'Could not load probation review.', 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  }, [onClose, reviewId, showToast]);

  useEffect(() => {
    if (!isOpen || !reviewId) {
      setRow(null);
      return;
    }
    void load();
  }, [isOpen, reviewId, load]);

  const handleExport = async (format: ExportFileExt) => {
    if (!row) return;
    try {
      await exportProbationReviewDocument(format, row);
      showToast(`Probation review exported as ${format === 'xlsx' ? 'Excel' : format.toUpperCase()}.`, 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Export failed.', 'error');
    }
  };

  const title = row?.name ?? summary?.employeeName ?? 'Probation review';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Probation review detail"
      description={`Document review — ${title}`}
      size="2xl"
      contentClassName="!p-0 bg-slate-100/90 dark:bg-slate-950/60"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ExportFormatMenu variant="button" disabled={!row || loading} onExport={handleExport} />
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="p-4 sm:p-6 max-h-[min(72vh,42rem)] overflow-y-auto overscroll-contain">
        {loading ? (
          <ContentSkeleton layout="form" rows={1} label="Loading probation document…" />
        ) : row ? (
          <ProbationReviewDocument row={row} viewerUserId={user?.id} />
        ) : (
          <p className="text-sm text-center text-slate-500 py-12">No probation data to display.</p>
        )}
      </div>
    </Modal>
  );
};

export default ProbationReviewDocumentModal;
