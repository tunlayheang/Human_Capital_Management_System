import React, { useEffect } from 'react';
import { Clock } from 'lucide-react';
import { computeWorkHoursPerDay } from '../../utils/employeeSchedule';
import { LeaveTypeAssignmentToggles } from './LeaveTypeAssignmentToggles';
import type { LeaveAssignmentOption } from '../../types';
import {
  WizardField,
  WizardFieldGrid,
  WizardSectionCard,
  WizardStepStack,
  WizardInput,
  WIZARD_INPUT_CLASS,
} from './wizardLayout';

interface StepScheduleProps {
  register: any;
  errors: Record<string, any>;
  watchTimeIn?: string;
  watchTimeOut?: string;
  watchBreakMinutes?: number;
  watchWorkHours?: number;
  setValue: (name: string, value: unknown) => void;
  leaveTypeOptions?: LeaveAssignmentOption[];
  leaveAssignments?: Record<string, boolean>;
  leaveTypesLoading?: boolean;
  onLeaveAssignmentToggle?: (leaveTypeId: string, enabled: boolean) => void;
}

export const StepSchedule: React.FC<StepScheduleProps> = ({
  register,
  errors,
  watchTimeIn = '08:00',
  watchTimeOut = '17:00',
  watchBreakMinutes = 60,
  watchWorkHours,
  setValue,
  leaveTypeOptions = [],
  leaveAssignments = {},
  leaveTypesLoading = false,
  onLeaveAssignmentToggle,
}) => {
  useEffect(() => {
    const computed = computeWorkHoursPerDay(watchTimeIn, watchTimeOut, watchBreakMinutes);
    if (computed > 0 && computed !== watchWorkHours) {
      setValue('workHours', computed);
    }
  }, [watchTimeIn, watchTimeOut, watchBreakMinutes, watchWorkHours, setValue]);

  return (
    <WizardStepStack>
      <WizardSectionCard
        icon={Clock}
        title="Work schedule"
      >
        <WizardFieldGrid>
          <WizardField label="Working days per week" required error={errors.workDays?.message}>
            <WizardInput
              register={register}
              name="workDays"
              filter="integer"
              filterOptions={{ maxLength: 1 }}
            />
          </WizardField>

          <WizardField
            label="Working hours per day"
            required
            hint="Auto-calculated from time in/out minus break; you can override."
          >
            <WizardInput
              register={register}
              name="workHours"
              filter="decimal"
              filterOptions={{ maxDecimals: 2, maxLength: 5 }}
            />
          </WizardField>

          <WizardField label="Time in" required error={errors.timeIn?.message}>
            <input type="time" {...register('timeIn')} className={WIZARD_INPUT_CLASS} />
          </WizardField>

          <WizardField label="Time out" required error={errors.timeOut?.message}>
            <input type="time" {...register('timeOut')} className={WIZARD_INPUT_CLASS} />
          </WizardField>

          <WizardField label="Break duration (minutes)" required error={errors.breakDurationMinutes?.message}>
            <WizardInput
              register={register}
              name="breakDurationMinutes"
              filter="integer"
              filterOptions={{ maxLength: 3 }}
            />
          </WizardField>

          <WizardField
            label="Grace period (minutes)"
            required
            error={errors.gracePeriodMinutes?.message}
          >
            <WizardInput
              register={register}
              name="gracePeriodMinutes"
              filter="integer"
              filterOptions={{ maxLength: 3 }}
            />
          </WizardField>
        </WizardFieldGrid>
      </WizardSectionCard>

      {onLeaveAssignmentToggle ? (
        <LeaveTypeAssignmentToggles
          options={leaveTypeOptions}
          assignments={leaveAssignments}
          onToggle={onLeaveAssignmentToggle}
          loading={leaveTypesLoading}
        />
      ) : null}
    </WizardStepStack>
  );
};
