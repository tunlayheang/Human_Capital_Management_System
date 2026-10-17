import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { useLanguage } from '../../context/LanguageContext';
import { useCompanyStructure } from '../../context/CompanyStructureContext';
import { CompanyStructurePanel } from './CompanyStructurePanel';

export const CompanyStructureModal: React.FC = () => {
  const { t } = useLanguage();
  const { isOpen, closeCompanyStructure } = useCompanyStructure();
  const [employeeDetailOpen, setEmployeeDetailOpen] = useState(false);

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeCompanyStructure}
      disableClose={employeeDetailOpen}
      size="2xl"
      align="top"
      title={t('companyStructure.title') || 'Company structure'}
      description={
        t('companyStructure.subtitle') ||
        'Employees organized by office location, department, and role level.'
      }
      dialogClassName="max-h-[min(92dvh,calc(100%-1rem))]"
      contentClassName="overflow-y-auto overscroll-contain min-h-0 max-h-[min(72dvh,calc(92dvh-8rem))]"
    >
      <CompanyStructurePanel
        active={isOpen}
        onEmployeeModalOpenChange={setEmployeeDetailOpen}
      />
    </Modal>
  );
};
