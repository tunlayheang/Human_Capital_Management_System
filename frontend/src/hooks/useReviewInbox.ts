import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { Role } from '../types';
import {
  useRequiredActions,
  type RequiredActionItem,
} from './useRequiredActions';

export type ReviewQueueKey = 'kpi' | 'probation' | 'self';

const KPI_KIND = 'appraisal_manager_review' as const;
const PROBATION_KIND = 'probation_manager_review' as const;
const SELF_KINDS = new Set(['appraisal_employee_self_eval', 'probation_employee_self_eval']);

export function useReviewInbox(enabled = true) {
  const { hasRole } = useAuth();
  const { data, loading, refresh, canLoad } = useRequiredActions(enabled);

  const isManagement =
    hasRole(Role.ADMIN) || hasRole(Role.HR) || hasRole(Role.MANAGER);

  const performanceItems = useMemo(() => {
    const group = data?.groups.find((g) => g.key === 'performance');
    return group?.items ?? [];
  }, [data?.groups]);

  const kpiItems = useMemo(
    () => performanceItems.filter((item) => item.kind === KPI_KIND),
    [performanceItems]
  );

  const probationItems = useMemo(
    () => performanceItems.filter((item) => item.kind === PROBATION_KIND),
    [performanceItems]
  );

  const selfItems = useMemo(() => {
    const fromPerformance = performanceItems.filter((item) => SELF_KINDS.has(item.kind));
    if (fromPerformance.length) return fromPerformance;
    return (data?.items ?? []).filter((item) => SELF_KINDS.has(item.kind));
  }, [performanceItems, data?.items]);

  const totalReviews = kpiItems.length + probationItems.length + selfItems.length;

  const itemsByQueue = useMemo(
    (): Record<ReviewQueueKey, RequiredActionItem[]> => ({
      kpi: kpiItems,
      probation: probationItems,
      self: selfItems,
    }),
    [kpiItems, probationItems, selfItems]
  );

  return {
    data,
    loading,
    refresh,
    canLoad,
    isManagement,
    kpiItems,
    probationItems,
    selfItems,
    totalReviews,
    itemsByQueue,
  };
}
