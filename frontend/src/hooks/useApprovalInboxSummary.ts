import { useCallback, useEffect, useRef, useState } from 'react';
import { Api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Role } from '../types';

export type ApprovalInboxSummary = {
  actionRequired: number;
  totalAssigned: number;
  breakdown: {
    appraisalsAction: number;
    appraisalsTracking: number;
    movements: number;
        probationAction: number;
        probationTracking: number;
        payrollAction: number;
        payrollTracking: number;
        leaveRequests: number;
    overtimeRequests: number;
  };
};

const APPROVAL_ROLES = new Set<Role>([Role.ADMIN, Role.HR, Role.MANAGER]);

export function useApprovalInboxSummary(enabled = true) {
  const { user, hasRole } = useAuth();
  const userId = String(user?.id ?? '');
  const canView =
    enabled &&
    Boolean(userId) &&
    APPROVAL_ROLES.size > 0 &&
    [...APPROVAL_ROLES].some((role) => hasRole(role));

  const [summary, setSummary] = useState<ApprovalInboxSummary | null>(null);
  const [loading, setLoading] = useState(canView);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const refresh = useCallback(async (showLoading = false) => {
    if (!canView) {
      setSummary(null);
      setLoading(false);
      setError(null);
      return;
    }
    const requestId = ++requestSequence.current;
    if (showLoading) setLoading(true);
    try {
      const data = await Api.approvals.getSummary();
      if (requestId !== requestSequence.current) return;
      setSummary(data);
      setError(null);
    } catch (cause) {
      if (requestId !== requestSequence.current) return;
      // Keep the last successful badge values during a transient refresh failure.
      setError(cause instanceof Error ? cause.message : 'Unable to refresh approval counts');
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [canView, userId]);

  useEffect(() => {
    if (!canView) {
      setSummary(null);
      setLoading(false);
      return;
    }

    setSummary(null);
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

  return { summary, loading, error, refresh, canView };
}
