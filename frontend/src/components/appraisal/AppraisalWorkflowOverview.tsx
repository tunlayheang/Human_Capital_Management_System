import React from 'react';
import { ArrowRightLeft, CircleCheck, ClipboardList } from 'lucide-react';
import { PillSegmentTabs } from '../ui/page/PillSegmentTabs';
import { type AppraisalListPhase } from './appraisalWorkflowUi';

type PhaseCounts = {
  review: number;
  appraised: number;
  movement: number;
};

type Props = {
  listPhase: AppraisalListPhase;
  onListPhaseChange: (phase: AppraisalListPhase) => void;
  phaseCounts: PhaseCounts;
};

const PHASE_OPTIONS: Array<{
  id: AppraisalListPhase;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'review', label: 'In review', icon: ClipboardList },
  { id: 'appraised', label: 'Awaiting movement', icon: CircleCheck },
  { id: 'movement', label: 'Complete', icon: ArrowRightLeft },
];

export const AppraisalWorkflowOverview: React.FC<Props> = ({
  listPhase,
  onListPhaseChange,
  phaseCounts,
}) => {
  return (
    <PillSegmentTabs
      value={listPhase}
      onChange={onListPhaseChange}
      ariaLabel="Appraisal review phase"
      tabs={PHASE_OPTIONS.map((phase) => ({
        id: phase.id,
        label: phase.label,
        icon: phase.icon,
        badge:
          phase.id === 'review'
            ? phaseCounts.review
            : phase.id === 'appraised'
              ? phaseCounts.appraised
              : phaseCounts.movement,
      }))}
    />
  );
};
