import React, { useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader, PageShell } from '../components/ui/page';
import { GraduationCap, ClipboardList } from 'lucide-react';
import { KpiPerformanceHub, kpiTabToView } from '../components/appraisal/KpiPerformanceHub';
import { ProbationPerformanceHub } from '../components/probation/ProbationPerformanceHub';
import {
  parsePerformanceMode,
  performanceModeSearch,
  type PerformanceMode,
} from '../components/appraisal/PerformanceModeTabs';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { Role } from '../types';

type PerformanceTab =
  | 'probation'
  | 'kpi-appraisals'
  | 'kpi-settings'
  | 'kpi-analytics';

const VALID_TABS = new Set<PerformanceTab>([
  'probation',
  'kpi-appraisals',
  'kpi-settings',
  'kpi-analytics',
]);

const LEGACY_APPROVAL_TABS = new Set(['kpi-approvals', 'probation-approvals']);

const KPI_HUB_TABS = new Set<PerformanceTab>(['kpi-appraisals', 'kpi-settings', 'kpi-analytics']);

function isKpiHubTab(tab: PerformanceTab): boolean {
  return KPI_HUB_TABS.has(tab);
}

export const EmployeePerformance: React.FC = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isManagerOnly = user?.role === Role.MANAGER;
  const managerAllowedTabs = new Set<PerformanceTab>(['probation', 'kpi-appraisals']);
  const defaultKpiHubTab: PerformanceTab = isManagerOnly ? 'kpi-appraisals' : 'kpi-analytics';
  const rawTab = searchParams.get('tab');
  const mode: PerformanceMode = parsePerformanceMode(searchParams.get('view'));

  const tab: PerformanceTab =
    rawTab && VALID_TABS.has(rawTab as PerformanceTab)
      ? (rawTab as PerformanceTab)
      : defaultKpiHubTab;

  const isProbation = tab === 'probation';

  useEffect(() => {
    const fromUrl = searchParams.get('tab');
    const view = searchParams.get('view');
    const preserveKeys = ['appraisalId', 'userId', 'reviewId'] as const;
    const withPreserved = (base: string) => {
      const params = new URLSearchParams(base.startsWith('?') ? base.slice(1) : base);
      for (const key of preserveKeys) {
        const value = searchParams.get(key)?.trim();
        if (value) params.set(key, value);
      }
      const qs = params.toString();
      return qs ? `?${qs}` : '';
    };

    if (fromUrl === 'kpi-approvals') {
      navigate(`/performance${withPreserved(performanceModeSearch('kpi-appraisals', 'approval'))}`, {
        replace: true,
      });
      return;
    }
    if (fromUrl === 'probation-approvals') {
      navigate(`/performance${withPreserved(performanceModeSearch('probation', 'approval'))}`, {
        replace: true,
      });
      return;
    }

    if (isManagerOnly && fromUrl && !managerAllowedTabs.has(fromUrl as PerformanceTab)) {
      if (!LEGACY_APPROVAL_TABS.has(fromUrl)) {
        navigate(`/performance${withPreserved('?tab=kpi-appraisals')}`, { replace: true });
        return;
      }
    }

    if (!fromUrl || fromUrl === 'performance' || !VALID_TABS.has(fromUrl as PerformanceTab)) {
      navigate(`/performance${withPreserved(`?tab=${defaultKpiHubTab}`)}`, { replace: true });
      return;
    }

    // Drop stale view= on analytics/configuration.
    if (view && fromUrl !== 'kpi-appraisals' && fromUrl !== 'probation') {
      navigate(`/performance${withPreserved(`?tab=${fromUrl}`)}`, { replace: true });
    }
  }, [searchParams, navigate, isManagerOnly, defaultKpiHubTab]);

  const pageCopy = useMemo(() => {
    if (isProbation) {
      if (mode === 'approval') {
        return {
          title: t('nav.modules.perf-probation') || 'Probation',
          subtitle:
            t('performance.probationApprovalsSubtitle') ||
            'Review and approve probation reviews assigned to you in the final approval chain',
        };
      }
      return {
        title: t('nav.modules.perf-probation') || 'Probation',
        subtitle:
          isManagerOnly
            ? 'Evaluate probation reviews assigned to you by HR'
            : 'Run probation evaluations, manager review, employee self-evaluation, and approval workflow',
      };
    }
    if (isKpiHubTab(tab)) {
      const view = kpiTabToView(tab);
      if (view === 'analytics') {
        return {
          title: 'Performance appraisal',
          subtitle: 'Review team KPI trends, rankings, and department averages',
        };
      }
      if (view === 'configuration') {
        return {
          title: 'Performance appraisal',
          subtitle: 'Set up periods, KPI components, scoring rules, and grades',
        };
      }
      if (mode === 'approval') {
        return {
          title: t('nav.modules.perf-kpi') || 'Appraisals',
          subtitle:
            t('performance.approvalsSubtitle') ||
            'Review and approve appraisals assigned to you in the final approval chain',
        };
      }
      return {
        title: t('nav.modules.perf-kpi') || 'Appraisals',
        subtitle: 'Run weighted KPI evaluations, manager scoring, and approval workflow',
      };
    }
    return {
      title: 'Performance',
      subtitle: 'Team performance appraisals and probation reviews',
    };
  }, [tab, t, isProbation, mode]);

  const headerIcon = isProbation ? GraduationCap : ClipboardList;

  return (
    <PageShell className="w-full min-w-0">
      <PageHeader
        title={pageCopy.title}
        subtitle={pageCopy.subtitle}
        iconComponent={headerIcon}
      />

      {isKpiHubTab(tab) && (
        <KpiPerformanceHub
          activeView={kpiTabToView(tab)}
          mode={tab === 'kpi-appraisals' ? mode : 'evaluation'}
        />
      )}

      {isProbation && <ProbationPerformanceHub mode={mode} />}
    </PageShell>
  );
};
