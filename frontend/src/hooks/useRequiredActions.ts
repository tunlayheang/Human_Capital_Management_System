import { useCallback, useEffect, useRef, useState } from 'react';
import { Api } from '../services/api';
import { useAuth } from '../context/AuthContext';

export type RequiredActionKind =
  | 'appraisal_manager_review'
  | 'appraisal_employee_self_eval'
  | 'appraisal_hr_finalize'
  | 'appraisal_hr_route'
  | 'appraisal_final_approval'
  | 'probation_manager_review'
  | 'probation_employee_self_eval'
  | 'probation_hr_decide'
  | 'probation_hr_route'
  | 'probation_final_approval'
  | 'movement_approval'
  | 'payroll_run_approval'
  | 'leave_approval'
  | 'overtime_approval';

export type RequiredActionItem = {
  id: string;
  kind: RequiredActionKind;
  module: 'appraisal' | 'probation' | 'movement' | 'payroll' | 'leave' | 'overtime';
  title: string;
  subtitle: string;
  href: string;
  urgency: 'high' | 'normal';
  entityId?: string;
  targetUserId?: string;
  employeeName?: string;
};

export type RequiredActionGroupKey = 'performance' | 'approvals' | 'leave' | 'overtime';

export type RequiredActionGroup = {
  key: RequiredActionGroupKey;
  label: string;
  count: number;
  href: string;
  items: RequiredActionItem[];
};

export type RequiredActionsResponse = {
  totalCount: number;
  groups: RequiredActionGroup[];
  items: RequiredActionItem[];
};

export function useRequiredActions(enabled = true) {
  const { user } = useAuth();
  const userId = String(user?.id ?? '');
  const canLoad = enabled && Boolean(userId);

  const [data, setData] = useState<RequiredActionsResponse | null>(null);
  const [loading, setLoading] = useState(canLoad);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const refresh = useCallback(async (showLoading = false) => {
    if (!canLoad) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const requestId = ++requestSequence.current;
    if (showLoading) setLoading(true);
    try {
      const result = await Api.actions.getRequired();
      if (requestId !== requestSequence.current) return;
      setData(result as RequiredActionsResponse);
      setError(null);
    } catch (cause) {
      if (requestId !== requestSequence.current) return;
      // A temporary network failure must not turn every badge into a misleading zero.
      setError(cause instanceof Error ? cause.message : 'Unable to refresh required actions');
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [canLoad, userId]);

  useEffect(() => {
    if (!canLoad) {
      setData(null);
      setLoading(false);
      return;
    }

    setData(null);
    void refresh(true);

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const intervalId = window.setInterval(refreshWhenVisible, 60_000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      requestSequence.current += 1;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refresh]);

  return { data, loading, error, refresh, canLoad };
}
