import React from 'react';
import { CheckCircle2, ClipboardList, LayoutList } from 'lucide-react';
import { PillSegmentTabs } from '../ui/page/PillSegmentTabs';
import type { ProbationListPhase } from './probationWizardUi';

type PhaseCounts = { all: number; active: number; completed: number };

const PHASE_OPTIONS: Array<{
  id: ProbationListPhase;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'all', label: 'All', icon: LayoutList },
  { id: 'active', label: 'Active reviews', icon: ClipboardList },
  { id: 'completed', label: 'Completed', icon: CheckCircle2 },
];

type Props = {
  listPhase: ProbationListPhase;
  onListPhaseChange: (phase: ProbationListPhase) => void;
  phaseCounts: PhaseCounts;
};

export const ProbationWorkflowOverview: React.FC<Props> = ({
  listPhase,
  onListPhaseChange,
  phaseCounts,
}) => {
  return (
    <PillSegmentTabs
      value={listPhase}
      onChange={onListPhaseChange}
      ariaLabel="Probation review phase"
      tabs={PHASE_OPTIONS.map((phase) => ({
        id: phase.id,
        label: phase.label,
        icon: phase.icon,
        badge:
          phase.id === 'all'
            ? phaseCounts.all
            : phase.id === 'active'
              ? phaseCounts.active
              : phaseCounts.completed,
      }))}
    />
  );
};

export { probationRowStepLabel } from './probationWizardUi';
