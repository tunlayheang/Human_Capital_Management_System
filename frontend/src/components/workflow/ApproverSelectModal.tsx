import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import {
  ApproverSelectPanel,
  type WorkflowApproverCandidate,
} from './ApproverSelectPanel';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  value: string[];
  onConfirm: (userIds: string[], candidates: WorkflowApproverCandidate[]) => void;
  title?: string;
  description?: string;
  maxApprovers?: number;
  defaultExpandedDepartmentId?: string | null;
};

export const ApproverSelectModal: React.FC<Props> = ({
  isOpen,
  onClose,
  value,
  onConfirm,
  title = 'Select approvers',
  description = 'Choose employees with portal access to review and approve before this is finalized.',
  maxApprovers,
  defaultExpandedDepartmentId,
}) => {
  const [draftIds, setDraftIds] = useState<string[]>(value);
  const [draftCandidates, setDraftCandidates] = useState<WorkflowApproverCandidate[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setDraftIds(value);
    setDraftCandidates([]);
  }, [isOpen, value]);

  const handleConfirm = () => {
    if (!draftIds.length) return;
    onConfirm(draftIds, draftCandidates);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={description}
      size="xl"
      align="center"
      dialogClassName="hcms-modal-dialog--approver"
      contentClassName="!flex !flex-col !min-h-0 !px-0 !py-0"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between w-full">
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            className="w-full sm:w-auto"
            disabled={!draftIds.length}
            onClick={handleConfirm}
          >
            Confirm {maxApprovers === 1 ? 'approver' : 'approvers'}
          </Button>
        </div>
      }
    >
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 sm:py-4 mx-auto w-full max-w-5xl">
        <ApproverSelectPanel
          hideHeader
          active={isOpen}
          value={draftIds}
          onChange={(userIds, candidates) => {
            setDraftIds(userIds);
            setDraftCandidates(candidates);
          }}
          maxApprovers={maxApprovers}
          defaultExpandedDepartmentId={defaultExpandedDepartmentId}
        />
      </div>
    </Modal>
  );
};

export default ApproverSelectModal;
