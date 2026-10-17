import React from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ExportFormatMenu } from '../ui/ExportFormatMenu';
import { useToast } from '../../context/ToastContext';
import type { EmployeeMovementRow } from '../../types/employeeMovement';
import { MovementListCard } from './employeeMovementDisplay';
import { exportMovementReviewDocument } from '../../utils/exportMovementReviewPdf';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  movement: EmployeeMovementRow | null;
};

export const MovementReviewDocumentModal: React.FC<Props> = ({ isOpen, onClose, movement }) => {
  const { showToast } = useToast();

  const handleExport = async (format: ExportFileExt) => {
    if (!movement) return;
    try {
      await exportMovementReviewDocument(format, movement);
      showToast(`Movement exported as ${format === 'xlsx' ? 'Excel' : format.toUpperCase()}.`, 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Export failed.', 'error');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Movement detail"
      description={
        movement
          ? `${movement.employeeName} — review before approval`
          : 'Employee movement document'
      }
      size="2xl"
      contentClassName="!p-0 bg-slate-100/90 dark:bg-slate-950/60"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ExportFormatMenu
            variant="button"
            disabled={!movement}
            onExport={handleExport}
          />
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="p-4 sm:p-6 max-h-[min(72vh,42rem)] overflow-y-auto overscroll-contain">
        {movement ? (
          <div className="mx-auto max-w-3xl">
            <MovementListCard row={movement} density="default" salaryDeltaFormat="percent" />
            {movement.assignedApprovers?.length ? (
              <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                  Approval chain
                </p>
                <ul className="space-y-2 text-sm">
                  {movement.assignedApprovers.map((approver) => (
                    <li key={approver.userId} className="flex justify-between gap-3">
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {approver.name ?? approver.userId}
                      </span>
                      <span className="text-slate-500 capitalize">{approver.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-center text-slate-500 py-12">No movement data to display.</p>
        )}
      </div>
    </Modal>
  );
};

export default MovementReviewDocumentModal;
