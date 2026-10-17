import React from 'react';
import { CalendarCheck } from 'lucide-react';
import type { LeaveAssignmentOption } from '../../types';
import { isMaternityLeaveType } from '../../utils/leaveAssignmentDefaults';
import { WizardSectionCard } from './wizardLayout';
import { useLanguage } from '../../context/LanguageContext';
import {
  localizedLabelUsesKhmerFont,
  resolveLocalizedLabel,
} from '../../utils/localizedEntityLabel';
import { cn } from '../../utils';

type Props = {
  options: LeaveAssignmentOption[];
  assignments: Record<string, boolean>;
  onToggle: (leaveTypeId: string, enabled: boolean) => void;
  loading?: boolean;
};

export const LeaveTypeAssignmentToggles: React.FC<Props> = ({
  options,
  assignments,
  onToggle,
  loading = false,
}) => {
  const { language } = useLanguage();
  if (loading) {
    return (
      <WizardSectionCard icon={CalendarCheck} title="Leave balance types" bodyClassName="py-6">
        <p className="text-sm text-slate-500">Loading leave types…</p>
      </WizardSectionCard>
    );
  }

  if (options.length === 0) {
    return (
      <WizardSectionCard icon={CalendarCheck} title="Leave balance types" bodyClassName="py-6">
        <p className="text-sm text-slate-500">
          No leave types configured. Add types under Leave management → Configuration.
        </p>
      </WizardSectionCard>
    );
  }

  return (
    <WizardSectionCard
      icon={CalendarCheck}
      title="Leave balance types"
      description="Turn on each leave type this employee may use. New types from Leave configuration appear here automatically."
      bodyClassName="p-0"
    >
      <ul className="divide-y divide-slate-100 dark:divide-slate-700/80">
        {options.map((opt) => {
          const enabled = !!assignments[opt.leaveTypeId];
          const label = resolveLocalizedLabel(opt.name, opt.nameKh, language);
          return (
            <li
              key={opt.leaveTypeId}
              className="flex items-center justify-between gap-4 px-4 sm:px-5 py-3.5 hover:bg-slate-50/80 dark:hover:bg-slate-800/50"
            >
              <div className="min-w-0">
                <p
                  className={cn(
                    'text-sm font-semibold text-slate-900 dark:text-white',
                    localizedLabelUsesKhmerFont(opt.name, opt.nameKh, language) && 'font-khmer'
                  )}
                >
                  {label}
                </p>
                {isMaternityLeaveType(opt) ? (
                  <p className="text-[10px] font-medium text-violet-600 dark:text-violet-400 mt-1">
                    Maternity — typically assigned to female employees
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={`${label} leave assignment`}
                onClick={() => onToggle(opt.leaveTypeId, !enabled)}
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                  enabled ? 'bg-primary-500' : 'bg-slate-300 dark:bg-slate-600'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition ${
                    enabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </WizardSectionCard>
  );
};
