import { useEffect, useState } from 'react';
import { Api } from '../services/api';
import type {
  WorkflowApproverCandidate,
  WorkflowApproverDepartmentGroup,
} from '../components/workflow/ApproverSelectPanel';

/** Flat userId → candidate map from `/workflow/approvers` (shared by appraisal/probation/leave). */
export function useWorkflowApproverDirectory(enabled = true): {
  byUserId: Map<string, WorkflowApproverCandidate>;
  loading: boolean;
} {
  const [byUserId, setByUserId] = useState<Map<string, WorkflowApproverCandidate>>(() => new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = (await Api.workflow.getApprovers()) as {
          departments?: WorkflowApproverDepartmentGroup[];
        };
        const map = new Map<string, WorkflowApproverCandidate>();
        for (const group of Array.isArray(res?.departments) ? res.departments : []) {
          for (const candidate of group.candidates ?? []) {
            const id = String(candidate.userId ?? '').trim();
            if (id) map.set(id, candidate);
          }
        }
        if (!cancelled) setByUserId(map);
      } catch {
        if (!cancelled) setByUserId(new Map());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { byUserId, loading };
}
