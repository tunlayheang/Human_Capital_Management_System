import React from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Project, User } from '../../types';
import { ProjectSettingsTab } from './ProjectSettingsTab';

type Props = {
  isOpen: boolean;
  project: Project | null;
  employees: User[];
  canEditInfo: boolean;
  canEditLead: boolean;
  canEditStatus: boolean;
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string, type: 'success' | 'error') => void;
};

export const ProjectSettingsModal: React.FC<Props> = ({
  isOpen,
  project,
  employees,
  canEditInfo,
  canEditLead,
  canEditStatus,
  onClose,
  onSaved,
  showToast,
}) => {
  if (!project) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title="Project settings"
      description={`Update settings for ${project.title}.`}
      footer={
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="project-settings-form">
            Save configuration
          </Button>
        </div>
      }
    >
      <ProjectSettingsTab
        project={project}
        employees={employees}
        canEditInfo={canEditInfo}
        canEditLead={canEditLead}
        canEditStatus={canEditStatus}
        onUpdated={onSaved}
        showToast={showToast}
        variant="modal"
        formId="project-settings-form"
      />
    </Modal>
  );
};
