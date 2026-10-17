import type { RequiredActionItem } from '../hooks/useRequiredActions';

/** Deep-link path to complete a routed performance review action. */
export function reviewItemNavigatePath(item: RequiredActionItem): string {
  const entityId = encodeURIComponent(String(item.entityId ?? ''));
  switch (item.kind) {
    case 'appraisal_manager_review':
      return `/performance?tab=kpi-appraisals&appraisalId=${entityId}`;
    case 'probation_manager_review': {
      const userId = encodeURIComponent(String(item.targetUserId ?? item.entityId ?? ''));
      return `/performance?tab=probation&userId=${userId}`;
    }
    case 'appraisal_employee_self_eval':
      return `/my-performance?tab=action&appraisalId=${entityId}`;
    case 'probation_employee_self_eval':
      return '/my-performance?tab=action';
    default:
      return item.href || '/dashboard';
  }
}

/** Dashboard / review-queue entry for employee self-evaluations (Self Service). */
export function selfEvaluationQueueNavigatePath(items: RequiredActionItem[]): string {
  if (items.length === 1) {
    return reviewItemNavigatePath(items[0]);
  }
  const kpi = items.find(
    (item) => item.kind === 'appraisal_employee_self_eval' && item.entityId
  );
  if (kpi?.entityId) {
    const appraisalId = encodeURIComponent(String(kpi.entityId));
    return `/my-performance?tab=action&appraisalId=${appraisalId}`;
  }
  if (items.some((item) => item.kind === 'probation_employee_self_eval')) {
    return '/my-performance?tab=action';
  }
  return '/my-performance?tab=action';
}

export function splitNavigateTarget(target: string): { pathname: string; search: string } {
  const qIndex = target.indexOf('?');
  if (qIndex < 0) return { pathname: target, search: '' };
  return {
    pathname: target.slice(0, qIndex),
    search: target.slice(qIndex),
  };
}
