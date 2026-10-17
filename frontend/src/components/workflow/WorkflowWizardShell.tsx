import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { EmployeeWizardStepper, EmployeeWizardStepRail, type WizardStep } from '../EmployeeWizardStepper';
import { WorkflowWizardStepHeader } from './WorkflowWizardStepHeader';
import { ensureWizardFooterRoot } from '../../utils/overlayPortal';
import { useStickyActionBarActive } from '../../hooks/useStickyActionBarActive';

export type { WizardStep };

type StepHeader = {
  title: string;
  description?: string;
};

type Props = {
  header: React.ReactNode;
  steps: WizardStep[];
  currentStep: number;
  maxReachableStep: number;
  onStepChange: (index: number) => void;
  stepHeader: StepHeader;
  children: React.ReactNode;
  footer: React.ReactNode;
  /**
   * Pin the back-button header card while page content below scrolls.
   * Defaults on — all wizard shells use the same sticky back-header pattern.
   */
  stickyHeader?: boolean;
};

export const WorkflowWizardShell: React.FC<Props> = ({
  header,
  steps,
  currentStep,
  maxReachableStep,
  onStepChange,
  stepHeader,
  children,
  footer,
  stickyHeader = true,
}) => {
  const footerRef = useStickyActionBarActive(true);
  const [footerRoot, setFooterRoot] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined' ? ensureWizardFooterRoot() : null
  );

  useLayoutEffect(() => {
    setFooterRoot(ensureWizardFooterRoot());
  }, []);

  const footerBar = (
    <div
      ref={footerRef}
      role="toolbar"
      aria-label="Wizard actions"
      className="hcms-wizard-sticky-footer hcms-sticky-footer max-lg:py-2.5 max-lg:px-3 p-4 sm:p-5 flex flex-row items-center justify-between gap-3 max-lg:rounded-none max-lg:rounded-t-2xl max-lg:border-x-0 lg:rounded-t-2xl lg:rounded-b-none"
    >
      {footer}
    </div>
  );

  return (
    <div className="hcms-wizard-page relative flex flex-col flex-1 min-h-0 w-full">
      <div className="flex-1 min-h-0 space-y-3 sm:space-y-4 hcms-wizard-mobile-scroll-pad">
        <div
          className={[
            'surface-card surface-card-pad',
            stickyHeader ? 'hcms-wizard-sticky-header' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {header}
        </div>

        <div className="surface-card overflow-hidden px-3 sm:px-5 py-3 sm:py-4 hidden lg:block">
          <EmployeeWizardStepper
            steps={steps}
            currentStep={currentStep}
            maxReachableStep={maxReachableStep}
            showActiveDescription
            onStepChange={onStepChange}
          />
        </div>

        <div className="surface-card surface-card-pad max-lg:pr-11 sm:max-lg:pr-12">
          <WorkflowWizardStepHeader
            stepIndex={currentStep}
            totalSteps={steps.length}
            title={stepHeader.title}
            description={stepHeader.description}
          />
          {children}
        </div>

        <EmployeeWizardStepRail
          steps={steps}
          currentStep={currentStep}
          maxReachableStep={maxReachableStep}
          showActiveDescription
          onStepChange={onStepChange}
        />
      </div>

      {footerRoot ? createPortal(footerBar, footerRoot) : footerBar}
    </div>
  );
};
