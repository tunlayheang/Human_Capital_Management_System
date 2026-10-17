import { QueryTypes } from 'sequelize';
import { Employee, EmployeeReview, sequelize } from '../db.js';
import {
  applyProbationFailOutcome,
  applyProbationPassOutcome,
  type ProbationMovementOutcome,
  type ProbationOffboardOutcome,
} from './probationReviewOutcomes.js';
import { formatDateOnly } from '../probationService.js';
import { writeWorkflowStatusAudit } from '../domainAuditService.js';
import { addDaysToDate } from './probationReviewStatus.js';
import type {
  ProbationReviewRecommendation,
  ProbationReviewStatus,
  SubmitProbationReviewInput,
} from './probationReviewTypes.js';
import { PROBATION_EXTENSION_DAYS } from './probationReviewTypes.js';
import {
  resolveEmployeeFromReviewUserId,
  type ProbationReviewActor,
} from './probationReviewService.js';

export type ProbationPendingApprovalItem = {
  reviewId: string;
  userId: string;
  employeeId: string | null;
  employeeName: string;
  departmentName: string | null;
  status: ProbationReviewStatus;
  recommendation: ProbationReviewRecommendation | null;
  overallRecommendation: string | null;
  probationEnd: string | null;
  managerSubmittedAt: string | null;
  employeeSubmittedAt: string | null;
  hrNotes: string | null;
  assignedApproverUserIds: string[];
  assignedApprovers: Array<{
    userId: string;
    name: string | null;
    status: string;
    approvedAt: string | null;
    sortOrder: number;
    phase: 'approved' | 'current' | 'queued';
  }>;
  currentApproverUserId: string | null;
  currentApproverName: string | null;
  approvalProgress: { approved: number; total: number } | null;
  canApproverReview: boolean;
  pendingDecision?: Record<string, unknown> | null;
};

type PendingHrDecision = {
  recommendation: ProbationReviewRecommendation;
  hrNotes?: string | null;
  extensionDays?: number;
  extensionReason?: string;
  nextReviewDate?: string;
  movement?: ProbationMovementOutcome;
  offboard?: ProbationOffboardOutcome;
  submittedBy?: string;
  submittedAt?: string;
};

function reviewPlain(row: unknown): Record<string, unknown> {
  const r = row as { get?: (opts: { plain: boolean }) => Record<string, unknown> };
  return r?.get ? r.get({ plain: true }) : (row as Record<string, unknown>);
}

function parsePendingDecision(raw: unknown): PendingHrDecision | null {
  if (!raw || typeof raw !== 'object') return null;
  const pending = (raw as Record<string, unknown>).pendingHrDecision;
  if (!pending || typeof pending !== 'object') return null;
  const rec = String((pending as Record<string, unknown>).recommendation ?? '').toUpperCase();
  if (rec !== 'PASS' && rec !== 'EXTEND' && rec !== 'FAIL') return null;
  return pending as PendingHrDecision;
}

function viewerIsAssignedApprover(
  row: { assignedApproverUserIds?: string[] },
  actorId: string
): boolean {
  const ids = row.assignedApproverUserIds ?? [];
  return ids.includes(actorId);
}

export async function listPendingProbationReviewsForCurrentApprover(
  viewer: {
    id?: string;
    role?: string;
  },
  options?: { includeHistory?: boolean }
): Promise<ProbationPendingApprovalItem[]> {
  const actorId = String(viewer?.id ?? '').trim();
  if (!actorId) return [];
  const includeHistory = Boolean(options?.includeHistory);

  const { ensureProbationApproversTable, loadProbationApproversBatch, serializeProbationApproversForDto, probationRequiresActorApproval } =
    await import('../workflowProbationApproverService.js');

  await ensureProbationApproversTable();

  const statusClause = includeHistory
    ? `er.status IN ('PENDING_FINAL_APPROVAL', 'PASSED', 'EXTENDED', 'FAILED', 'REJECTED', 'PENDING_HR')`
    : `er.status = 'PENDING_FINAL_APPROVAL'`;

  const rows = (await sequelize.query(
    `SELECT er.*,
            CONCAT(COALESCE(e.last_name, ''), ' ', COALESCE(e.first_name, '')) AS employeeName,
            e.employee_id AS employeeCode,
            d.name AS departmentName,
            e.join_date AS joinDate,
            e.probation_period_months AS probationPeriodMonths,
            e.worker_type AS workerType
     FROM employeereviews er
     INNER JOIN users u ON u.id = er.userId
     LEFT JOIN employees e ON e.id = u.employeeId
     LEFT JOIN departments d ON d.id = e.department_id
     WHERE er.reviewType = 'PROBATION' AND ${statusClause}
     ORDER BY er.reviewedAt DESC, er.createdAt DESC
     LIMIT 200`,
    { type: QueryTypes.SELECT }
  )) as Array<Record<string, unknown>>;

  const approverMap = await loadProbationApproversBatch(
    rows.map((row) => String(row.id ?? ''))
  );

  const items: ProbationPendingApprovalItem[] = [];
  for (const row of rows) {
    const reviewId = String(row.id ?? '');
    const status = String(row.status ?? '').toUpperCase();
    const approverFields = serializeProbationApproversForDto(
      approverMap.get(reviewId) ?? []
    );
    if (!viewerIsAssignedApprover(approverFields, actorId)) continue;

    let pendingDecision: Record<string, unknown> | null = null;
    try {
      const payload = row.outcomePayloadJson ? JSON.parse(String(row.outcomePayloadJson)) : null;
      pendingDecision = payload?.pendingHrDecision ?? null;
    } catch {
      pendingDecision = null;
    }

    const canApproverReview =
      status === 'PENDING_FINAL_APPROVAL' &&
      probationRequiresActorApproval(approverMap.get(reviewId) ?? [], actorId);

    items.push({
      reviewId,
      userId: String(row.userId ?? ''),
      employeeId: row.employeeCode ? String(row.employeeCode) : null,
      employeeName: String(row.employeeName ?? '').trim() || 'Employee',
      departmentName: row.departmentName ? String(row.departmentName) : null,
      status: status as ProbationPendingApprovalItem['status'],
      recommendation: row.recommendation
        ? (String(row.recommendation).toUpperCase() as ProbationReviewRecommendation)
        : null,
      overallRecommendation: row.overallRecommendation
        ? String(row.overallRecommendation)
        : null,
      probationEnd: row.periodEnd ? String(row.periodEnd).slice(0, 10) : null,
      managerSubmittedAt: row.managerSubmittedAt ? String(row.managerSubmittedAt) : null,
      employeeSubmittedAt: row.employeeSubmittedAt ? String(row.employeeSubmittedAt) : null,
      hrNotes: row.hrNotes ? String(row.hrNotes) : null,
      assignedApproverUserIds: approverFields.assignedApproverUserIds,
      assignedApprovers: approverFields.assignedApprovers,
      currentApproverUserId: approverFields.currentApproverUserId,
      currentApproverName: approverFields.currentApproverName,
      approvalProgress: approverFields.approvalProgress,
      canApproverReview,
      pendingDecision,
    });
  }

  return items.sort((a, b) => {
    const aAction = a.canApproverReview ? 0 : 1;
    const bAction = b.canApproverReview ? 0 : 1;
    if (aAction !== bAction) return aAction - bAction;
    return String(b.reviewId).localeCompare(String(a.reviewId));
  });
}

export async function finalizeProbationFromPendingDecision(
  reviewId: string,
  actorId: string
): Promise<{ message: string; status: ProbationReviewStatus }> {
  const existing: any = await EmployeeReview.findByPk(reviewId);
  if (!existing) throw new Error('Probation review not found.');
  const plain = reviewPlain(existing);
  if (String(plain.status) !== 'PENDING_FINAL_APPROVAL') {
    throw new Error('Probation review is not awaiting final approval.');
  }

  let priorOutcome: Record<string, unknown> = {};
  try {
    if (plain.outcomePayloadJson) {
      priorOutcome = JSON.parse(String(plain.outcomePayloadJson));
    }
  } catch {
    priorOutcome = {};
  }

  const pending = parsePendingDecision(priorOutcome);
  if (!pending?.recommendation) {
    throw new Error('Pending HR decision not found on this review.');
  }

  const resolved = await resolveEmployeeFromReviewUserId(String(plain.userId));
  if (!resolved) throw new Error('Employee record not found.');

  const { employee } = resolved;
  const empPlain = employee.get({ plain: true }) as {
    id: string;
    employee_id: string;
    department_id: string;
    position_id: string;
    join_date?: string;
  };

  const today = formatDateOnly(new Date())!;
  const recommendation = pending.recommendation;

  if (recommendation === 'PASS') {
    const movement: ProbationMovementOutcome = {
      movementType: pending.movement?.movementType ?? 'promotion',
      effectiveDate:
        String(pending.movement?.effectiveDate ?? '').trim().slice(0, 10) || today,
      toDepartmentId: pending.movement?.toDepartmentId,
      toPositionId: pending.movement?.toPositionId,
      toBaseSalary: pending.movement?.toBaseSalary,
      toCurrency: pending.movement?.toCurrency,
      notes: pending.movement?.notes,
    };
    const passResult = await applyProbationPassOutcome({
      displayEmployeeId: String(empPlain.employee_id),
      probationReviewId: reviewId,
      movement,
      createdBy: actorId,
      submitterRole: 'HR',
      employeeSnapshot: {
        department_id: String(empPlain.department_id),
        position_id: String(empPlain.position_id),
      },
    });
    await employee.update({
      probation_confirmed_at: today,
      probation_next_review_date: null,
      updated_at: new Date(),
    });
    delete priorOutcome.pendingHrDecision;
    await EmployeeReview.update(
      {
        status: 'PASSED',
        recommendation: 'PASS',
        reviewedAt: new Date(),
        reviewedBy: actorId,
        outcomePayloadJson: JSON.stringify({ ...priorOutcome, movement, passResult }),
      },
      { where: { id: reviewId } }
    );
    await writeWorkflowStatusAudit({
      entityType: 'probation_review',
      entityId: reviewId,
      previousStatus: 'PENDING_FINAL_APPROVAL',
      nextStatus: 'PASSED',
      performedBy: actorId,
      reason: 'Probation passed',
    });
    return {
      message: passResult.movementSkipped
        ? 'Probation passed — employee confirmed.'
        : 'Probation passed — movement recorded and employee confirmed.',
      status: 'PASSED',
    };
  }

  if (recommendation === 'EXTEND') {
    const days = Number(pending.extensionDays);
    if (!PROBATION_EXTENSION_DAYS.includes(days as (typeof PROBATION_EXTENSION_DAYS)[number])) {
      throw new Error('Invalid extension duration on pending decision.');
    }
    const nextReviewDate =
      pending.nextReviewDate?.slice(0, 10) ?? addDaysToDate(today, days);
    await employee.update({
      probation_next_review_date: nextReviewDate,
      updated_at: new Date(),
    });
    delete priorOutcome.pendingHrDecision;
    await EmployeeReview.update(
      {
        status: 'EXTENDED',
        recommendation: 'EXTEND',
        extensionDays: days,
        extensionReason: pending.extensionReason ?? null,
        nextReviewDate,
        reviewedAt: new Date(),
        reviewedBy: actorId,
        outcomePayloadJson: JSON.stringify({
          ...priorOutcome,
          extensionDays: days,
          extensionReason: pending.extensionReason,
          nextReviewDate,
        }),
      },
      { where: { id: reviewId } }
    );
    await writeWorkflowStatusAudit({
      entityType: 'probation_review',
      entityId: reviewId,
      previousStatus: 'PENDING_FINAL_APPROVAL',
      nextStatus: 'EXTENDED',
      performedBy: actorId,
      reason: `Probation extended to ${nextReviewDate}`,
    });
    return {
      message: `Probation extended — next review scheduled for ${nextReviewDate}.`,
      status: 'EXTENDED',
    };
  }

  const offboard = pending.offboard ?? { reason: 'Probation review failed.' };
  await applyProbationFailOutcome({
    displayEmployeeId: String(empPlain.employee_id),
    offboard,
    offboardedBy: actorId,
  });
  delete priorOutcome.pendingHrDecision;
  await EmployeeReview.update(
    {
      status: 'FAILED',
      recommendation: 'FAIL',
      reviewedAt: new Date(),
      reviewedBy: actorId,
      outcomePayloadJson: JSON.stringify({ ...priorOutcome, offboard }),
    },
    { where: { id: reviewId } }
  );
  await writeWorkflowStatusAudit({
    entityType: 'probation_review',
    entityId: reviewId,
    previousStatus: 'PENDING_FINAL_APPROVAL',
    nextStatus: 'FAILED',
    performedBy: actorId,
    reason: 'Probation failed',
  });
  return {
    message: 'Probation failed — employee offboarded.',
    status: 'FAILED',
  };
}

export async function executeProbationWorkflowAction(input: {
  reviewId: string;
  action: 'approve_final' | 'reject_final' | 'return_final';
  actor: ProbationReviewActor;
  notes?: string | null;
}): Promise<{ message: string; status: ProbationReviewStatus }> {
  const reviewId = String(input.reviewId).trim();
  const actorId = String(input.actor.userId ?? '').trim();
  const role = String(input.actor.role ?? '').toUpperCase();
  const isHrAdmin = ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(role);

  const {
    loadProbationApprovers,
    markProbationApproverApproved,
    allProbationApproversApproved,
    probationRequiresActorApproval,
    notifyNextProbationApproverTurn,
    notifyProbationWorkflowFinished,
  } = await import('../workflowProbationApproverService.js');

  const existing: any = await EmployeeReview.findByPk(reviewId);
  if (!existing) throw Object.assign(new Error('Probation review not found.'), { status: 404 });
  const plain = reviewPlain(existing);
  if (String(plain.status) !== 'PENDING_FINAL_APPROVAL') {
    throw new Error('Probation review is not awaiting final approval.');
  }

  const approvers = await loadProbationApprovers(reviewId);

  if (input.action === 'approve_final') {
    const approveComment = String(input.notes ?? '').trim();
    if (approveComment.length < 3) {
      throw new Error('Approval comment is required (min 3 characters).');
    }
    if (approvers.length) {
      if (!probationRequiresActorApproval(approvers, actorId)) {
        throw new Error(
          isHrAdmin
            ? 'This probation review is waiting on another approver in the chain. Only the current approver can sign off.'
            : 'It is not your turn to approve this probation review yet.'
        );
      }
      const mine = approvers.find((entry) => entry.userId === actorId);
      if (mine?.status === 'approved') {
        throw new Error('You have already approved this probation review.');
      }
      await markProbationApproverApproved(reviewId, actorId);
      const refreshed = await loadProbationApprovers(reviewId);
      if (!allProbationApproversApproved(refreshed)) {
        await notifyNextProbationApproverTurn(reviewId, refreshed);
        await writeWorkflowStatusAudit({
          entityType: 'probation_review',
          entityId: reviewId,
          previousStatus: 'PENDING_FINAL_APPROVAL',
          nextStatus: 'PENDING_FINAL_APPROVAL',
          performedBy: actorId,
          action: 'CHAIN_STEP_APPROVED',
          reason: approveComment,
        });
        return {
          message: 'Your approval was recorded. The next approver will be notified.',
          status: 'PENDING_FINAL_APPROVAL',
        };
      }
    }

    const result = await finalizeProbationFromPendingDecision(reviewId, actorId);
    // Keep approver chain so the review remains visible in the approval queue after completion.
    await notifyProbationWorkflowFinished({
      reviewId,
      outcome: 'approved',
      approvers,
    });
    return result;
  }

  if (input.action === 'return_final') {
    const trimmed = String(input.notes ?? '').trim();
    if (trimmed.length < 3) {
      throw new Error('Return notes are required (min 3 characters).');
    }

    if (approvers.length && !probationRequiresActorApproval(approvers, actorId)) {
      throw new Error(
        isHrAdmin
          ? 'This probation review is waiting on another approver in the chain. Only the current approver can act.'
          : 'It is not your turn to act on this probation review yet.'
      );
    }

    let priorOutcome: Record<string, unknown> = {};
    try {
      if (plain.outcomePayloadJson) {
        priorOutcome = JSON.parse(String(plain.outcomePayloadJson));
      }
    } catch {
      priorOutcome = {};
    }
    delete priorOutcome.pendingHrDecision;

    await EmployeeReview.update(
      {
        status: 'PENDING_HR',
        recommendation: null,
        hrNotes: trimmed,
        outcomePayloadJson: JSON.stringify({
          ...priorOutcome,
          approvalReturn: {
            action: 'return_final',
            notes: trimmed,
            by: actorId,
            at: new Date().toISOString(),
          },
        }),
      },
      { where: { id: reviewId } }
    );
    // Keep approver chain so returned items remain visible in the approval queue.
    await notifyProbationWorkflowFinished({
      reviewId,
      outcome: 'returned',
      approvers,
    });

    await writeWorkflowStatusAudit({
      entityType: 'probation_review',
      entityId: reviewId,
      previousStatus: 'PENDING_FINAL_APPROVAL',
      nextStatus: 'PENDING_HR',
      performedBy: actorId,
      action: 'RETURNED',
      reason: trimmed,
    });

    return {
      message: 'Probation review returned to HR.',
      status: 'PENDING_HR',
    };
  }

  if (input.action === 'reject_final') {
    const rejectComment = String(input.notes ?? '').trim();
    if (rejectComment.length < 3) {
      throw new Error('Rejection comment is required (min 3 characters).');
    }

    if (approvers.length && !probationRequiresActorApproval(approvers, actorId)) {
      throw new Error(
        isHrAdmin
          ? 'This probation review is waiting on another approver in the chain. Only the current approver can act.'
          : 'It is not your turn to act on this probation review yet.'
      );
    }

    let priorOutcome: Record<string, unknown> = {};
    try {
      if (plain.outcomePayloadJson) {
        priorOutcome = JSON.parse(String(plain.outcomePayloadJson));
      }
    } catch {
      priorOutcome = {};
    }
    delete priorOutcome.pendingHrDecision;

    await EmployeeReview.update(
      {
        status: 'REJECTED',
        recommendation: null,
        hrNotes: rejectComment,
        outcomePayloadJson: JSON.stringify({
          ...priorOutcome,
          approvalRejection: {
            action: 'reject_final',
            notes: rejectComment,
            by: actorId,
            at: new Date().toISOString(),
          },
        }),
      },
      { where: { id: reviewId } }
    );
    // Keep approver chain so rejected items remain visible in the approval queue.
    await notifyProbationWorkflowFinished({
      reviewId,
      outcome: 'rejected',
      approvers,
    });

    await writeWorkflowStatusAudit({
      entityType: 'probation_review',
      entityId: reviewId,
      previousStatus: 'PENDING_FINAL_APPROVAL',
      nextStatus: 'REJECTED',
      performedBy: actorId,
      action: 'REJECTED',
      reason: rejectComment,
    });

    return {
      message: 'Probation approval rejected.',
      status: 'REJECTED',
    };
  }

  throw new Error('Unsupported workflow action.');
}

export function buildPendingHrDecisionPayload(
  input: SubmitProbationReviewInput
): PendingHrDecision {
  const today = formatDateOnly(new Date())!;
  const rawMovement = input.movementOutcome as ProbationMovementOutcome | undefined;
  const movement =
    input.recommendation === 'PASS'
      ? {
          movementType: rawMovement?.movementType ?? ('promotion' as const),
          effectiveDate:
            String(rawMovement?.effectiveDate ?? '').trim().slice(0, 10) || today,
          toDepartmentId: rawMovement?.toDepartmentId,
          toPositionId: rawMovement?.toPositionId,
          toBaseSalary: rawMovement?.toBaseSalary,
          toCurrency: rawMovement?.toCurrency,
          notes: rawMovement?.notes,
        }
      : rawMovement;
  return {
    recommendation: input.recommendation!,
    hrNotes: input.hrNotes?.trim() || null,
    extensionDays: input.extensionDays,
    extensionReason: input.extensionReason,
    nextReviewDate: input.nextReviewDate,
    movement,
    offboard: input.offboardOutcome as ProbationOffboardOutcome | undefined,
    submittedBy: input.actorUserId ?? input.reviewedBy ?? null,
    submittedAt: new Date().toISOString(),
  };
}
