import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardList, ShieldCheck } from 'lucide-react';
import { PillSegmentTabs } from '../ui/page/PillSegmentTabs';
import { useLanguage } from '../../context/LanguageContext';

export type PerformanceMode = 'evaluation' | 'approval';

export function parsePerformanceMode(view: string | null): PerformanceMode {
  return view === 'approval' ? 'approval' : 'evaluation';
}

export function performanceModeSearch(
  tab: string,
  mode: PerformanceMode,
  preserve?: URLSearchParams | null
): string {
  const params = new URLSearchParams();
  params.set('tab', tab);
  if (mode === 'approval') params.set('view', 'approval');
  if (preserve) {
    for (const key of ['appraisalId', 'userId', 'reviewId']) {
      const value = preserve.get(key)?.trim();
      if (value) params.set(key, value);
    }
  }
  return `?${params.toString()}`;
}

type Props = {
  /** Base performance tab (`kpi-appraisals` or `probation`). */
  baseTab: 'kpi-appraisals' | 'probation';
  mode: PerformanceMode;
};

/** Shared Evaluation / Approval switcher for Appraisals and Probation pages. */
export const PerformanceModeTabs: React.FC<Props> = ({ baseTab, mode }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useLanguage();

  return (
    <PillSegmentTabs
      ariaLabel={t('approvals.inboxTabsAria') || 'Evaluation and approval'}
      value={mode}
      onChange={(next) => {
        const nextMode = next as PerformanceMode;
        if (nextMode === mode && searchParams.get('tab') === baseTab) return;
        navigate(`/performance${performanceModeSearch(baseTab, nextMode, searchParams)}`, {
          replace: true,
        });
      }}
      tabs={[
        {
          id: 'evaluation',
          label: t('performance.mode.evaluation') || 'Evaluation',
          icon: ClipboardList,
        },
        {
          id: 'approval',
          label: t('performance.mode.approval') || 'Approval',
          icon: ShieldCheck,
        },
      ]}
      size="md"
    />
  );
};

export default PerformanceModeTabs;
