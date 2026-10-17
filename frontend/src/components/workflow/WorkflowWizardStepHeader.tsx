import React from 'react';

type Props = {
  stepIndex: number;
  totalSteps: number;
  title: string;
  description?: string;
};

/** Shared "Step X of Y" heading used by offboarding and performance workflows. */
export const WorkflowWizardStepHeader: React.FC<Props> = ({
  stepIndex,
  totalSteps,
  title,
  description,
}) => (
  <div className="mb-4 sm:mb-5 pb-3 sm:pb-4 border-b border-slate-100 dark:border-slate-800">
    <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-primary-600 dark:text-primary-400 mb-0.5 sm:mb-1">
      Step {stepIndex + 1} of {totalSteps}
    </p>
    <h3 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white tracking-tight">{title}</h3>
    {description ? (
      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1.5 max-w-2xl">{description}</p>
    ) : null}
  </div>
);
