/**
 * Manager Probation access is assignment-only (same product rule as Appraisals):
 * evaluate staff HR routed to you — not department-wide / full module admin.
 */

export function managerCanSeeAssignedProbation(opts: {
  actorUserId: string;
  assignedManagerUserId?: string | null;
  assignedEvaluatorUserIds?: string[] | null;
  managerSubmittedBy?: string | null;
  canManagerEdit?: boolean;
  canApproverReview?: boolean;
}): boolean {
  const id = String(opts.actorUserId ?? '').trim();
  if (!id) return false;
  if (opts.canManagerEdit || opts.canApproverReview) return true;
  if (opts.assignedManagerUserId && String(opts.assignedManagerUserId) === id) return true;
  if (opts.managerSubmittedBy && String(opts.managerSubmittedBy) === id) return true;
  const chain = Array.isArray(opts.assignedEvaluatorUserIds)
    ? opts.assignedEvaluatorUserIds
    : [];
  return chain.some((uid) => String(uid) === id);
}

/** Lifetime outcome cards: Manager only counts reviews they participated in. */
export function managerParticipatedInProbationOutcome(opts: {
  actorUserId: string;
  assignedManagerUserId?: string | null;
  managerSubmittedBy?: string | null;
  outcomePayloadJson?: string | null;
}): boolean {
  const id = String(opts.actorUserId ?? '').trim();
  if (!id) return false;
  if (opts.assignedManagerUserId && String(opts.assignedManagerUserId) === id) return true;
  if (opts.managerSubmittedBy && String(opts.managerSubmittedBy) === id) return true;
  const raw = opts.outcomePayloadJson;
  if (!raw) return false;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const ratings = parsed?.evaluatorRatings;
    if (ratings && typeof ratings === 'object' && Object.prototype.hasOwnProperty.call(ratings, id)) {
      return true;
    }
    const mgmt = parsed?.managementEvaluations;
    if (mgmt && typeof mgmt === 'object' && Object.prototype.hasOwnProperty.call(mgmt, id)) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}
