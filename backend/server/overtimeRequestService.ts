import { Op } from 'sequelize';
import { OvertimeRequest, OvertimeType } from './db.js';
import { pickAuditFields, writeDomainAudit, writeWorkflowStatusAudit } from './domainAuditService.js';
import type { OvertimeRateTier } from './overtimeTypes.js';
import {
  bucketOvertimeHoursByRateTier,
  roundOvertimeHours,
  type ApprovedOvertimeHours,
} from './payroll/payrollOvertimePay.js';

export type { ApprovedOvertimeHours } from './payroll/payrollOvertimePay.js';

export type { OvertimeRateTier } from './overtimeTypes.js';
export type OvertimeRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED' | 'CANCELLED';

function requireWorkflowComment(raw: string | null | undefined): string | null {
  const trimmed = String(raw ?? '').trim();
  if (trimmed.length < 3) return null;
  return trimmed;
}

export type OvertimeRequestDto = {
  id: string;
  userId: string;
  otTypeId: string | null;
  otTypeName: string | null;
  otTypeNameKh: string | null;
  workDate: string;
  hours: number;
  rateTier: OvertimeRateTier;
  reason: string;
  status: OvertimeRequestStatus;
  appliedOn: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  startTime: string | null;
  endTime: string | null;
  clockIn: string | null;
  clockOut: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  // Ordered approver chain (present when the requester selected approvers).
  assignedApproverUserIds?: string[];
  assignedApprovers?: {
    userId: string;
    name: string | null;
    status: 'pending' | 'approved';
    approvedAt: string | null;
    sortOrder: number;
    phase: 'approved' | 'current' | 'queued';
  }[];
  assignedApproverUserId?: string | null;
  assignedApproverName?: string | null;
  currentApproverUserId?: string | null;
  currentApproverName?: string | null;
  approvalProgress?: { approved: number; total: number } | null;
};

function buildOvertimeSummary(dto: { hours: number; workDate: string }): string {
  return `${dto.hours}h overtime on ${String(dto.workDate).slice(0, 10)}`;
}

/** Merge ordered-approver-chain DTO fields onto a serialized OT row. */
async function attachOvertimeApprovers(dto: OvertimeRequestDto): Promise<OvertimeRequestDto> {
  const { OVERTIME_APPROVER_CONFIG, loadChainApprovers, serializeChainApproversForDto } =
    await import('./workflowChainApproverService.js');
  const approvers = await loadChainApprovers(OVERTIME_APPROVER_CONFIG, dto.id);
  if (!approvers.length) return dto;
  return { ...dto, ...serializeChainApproversForDto(approvers) };
}

async function attachOvertimeApproversBatch(
  dtos: OvertimeRequestDto[]
): Promise<OvertimeRequestDto[]> {
  const { OVERTIME_APPROVER_CONFIG, loadChainApproversBatch, serializeChainApproversForDto } =
    await import('./workflowChainApproverService.js');
  const map = await loadChainApproversBatch(
    OVERTIME_APPROVER_CONFIG,
    dtos.map((d) => d.id)
  );
  return dtos.map((dto) => {
    const approvers = map.get(dto.id) ?? [];
    if (!approvers.length) return dto;
    return { ...dto, ...serializeChainApproversForDto(approvers) };
  });
}

const VALID_TIERS = new Set<OvertimeRateTier>(['daytime_150', 'rest_holiday_200', 'night_200']);

function formatClock(iso: unknown): string | null {
  if (iso == null) return null;
  const d = new Date(String(iso));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toDto(row: { get: (opts?: { plain: true }) => unknown }): OvertimeRequestDto {
  const p = row.get({ plain: true }) as Record<string, unknown>;
  const linked = p.overtimeType as Record<string, unknown> | undefined;
  const otTypeId = p.otTypeId != null ? String(p.otTypeId) : null;

  return {
    id: String(p.id),
    userId: String(p.userId),
    otTypeId,
    otTypeName: linked?.name != null ? String(linked.name) : null,
    otTypeNameKh: linked?.nameKh != null ? String(linked.nameKh) : null,
    workDate: String(p.workDate).slice(0, 10),
    hours: Number(p.hours) || 0,
    rateTier: (p.rateTier as OvertimeRateTier) || 'daytime_150',
    reason: String(p.reason ?? ''),
    status: (p.status as OvertimeRequestStatus) || 'PENDING',
    appliedOn: p.appliedOn != null ? String(p.appliedOn).slice(0, 10) : null,
    approvedBy: p.approvedBy != null ? String(p.approvedBy) : null,
    approvedAt: p.approvedAt != null ? String(p.approvedAt) : null,
    rejectionReason: p.rejectionReason != null ? String(p.rejectionReason) : null,
    startTime: p.startTime != null ? String(p.startTime) : null,
    endTime: p.endTime != null ? String(p.endTime) : null,
    clockIn: formatClock(p.clockIn),
    clockOut: formatClock(p.clockOut),
    createdAt: p.createdAt != null ? String(p.createdAt) : null,
    updatedAt: p.updatedAt != null ? String(p.updatedAt) : null,
  };
}

export async function ensureOvertimeRequestSchema(): Promise<void> {
  const { ensureOvertimeSchema } = await import('./overtimeSchema.js');
  await ensureOvertimeSchema();
}

const listInclude = [{ model: OvertimeType, as: 'overtimeType', required: false }];

export async function listOvertimeRequests(): Promise<OvertimeRequestDto[]> {
  await ensureOvertimeRequestSchema();
  let rows;
  try {
    rows = await OvertimeRequest.findAll({
      include: listInclude,
      order: [['createdAt', 'DESC']],
    });
  } catch (orderErr) {
    console.warn(
      '[overtime] Order by createdAt failed; falling back to id:',
      (orderErr as Error)?.message || orderErr
    );
    rows = await OvertimeRequest.findAll({
      include: listInclude,
      order: [['id', 'DESC']],
    });
  }
  const dtos = rows.map((r) => toDto(r));
  try {
    return await attachOvertimeApproversBatch(dtos);
  } catch (err) {
    console.warn(
      '[overtime] Could not load approver chains; returning requests without chain metadata:',
      (err as Error)?.message || err
    );
    return dtos;
  }
}

export async function createOvertimeRequest(body: {
  userId: string;
  workDate: string;
  hours: number;
  rateTier?: OvertimeRateTier;
  reason: string;
  otTypeId?: string;
  startTime?: string;
  endTime?: string;
  clockIn?: string;
  clockOut?: string;
  /** Ordered approver chain selected by the requester. */
  assignedApproverUserIds?: unknown;
}): Promise<OvertimeRequestDto> {
  await ensureOvertimeRequestSchema();
  const {
    findActiveOvertimeType,
    validateOvertimeCreateBody,
    normalizeOvertimeTimeFields,
  } = await import('./overtimeConfigService.js');
  const { getGlobalMaxHoursPerMonth } = await import('./overtimeSchema.js');

  const otTypeId = String(body.otTypeId ?? '').trim();
  const err = await validateOvertimeCreateBody({
    userId: body.userId,
    workDate: body.workDate,
    hours: body.hours,
    rateTier: body.rateTier,
    reason: body.reason,
    otTypeId,
    startTime: body.startTime,
    endTime: body.endTime,
    clockIn: body.clockIn,
    clockOut: body.clockOut,
  });
  if (err) throw new Error(err);

  const { assertPayrollDateInputsEditable, PayrollPeriodFrozenError } = await import(
    './payroll/payrollPeriodFreezeService.js'
  );
  try {
    await assertPayrollDateInputsEditable(String(body.workDate));
  } catch (e) {
    if (e instanceof PayrollPeriodFrozenError) throw e;
    throw e;
  }

  const otType = (await findActiveOvertimeType(otTypeId))!;
  const tier =
    body.rateTier && VALID_TIERS.has(body.rateTier) ? body.rateTier : otType.rateTier;
  const hours = Math.round(Number(body.hours) * 100) / 100;
  const times = normalizeOvertimeTimeFields({
    userId: body.userId,
    workDate: body.workDate,
    hours,
    rateTier: tier,
    reason: body.reason,
    otTypeId,
    startTime: body.startTime,
    endTime: body.endTime,
    clockIn: body.clockIn,
    clockOut: body.clockOut,
  });

  const workDate = String(body.workDate).slice(0, 10);
  const { monthPrefix, periodBounds } = await resolveOtCapWindow(workDate);
  const globalMax = await getGlobalMaxHoursPerMonth();
  const monthTotal = await sumPendingAndApprovedHoursForMonth(
    body.userId,
    monthPrefix,
    undefined,
    periodBounds
  );
  if (monthTotal + hours > globalMax) {
    throw new Error(
      `Monthly overtime limit is ${globalMax} hours (already ${monthTotal}h this payroll period)`
    );
  }

  const row = await OvertimeRequest.create({
    id: `ot-${Date.now()}`,
    userId: body.userId,
    otTypeId: otType.id,
    workDate,
    hours,
    rateTier: tier,
    reason: String(body.reason || '').trim(),
    status: 'PENDING',
    appliedOn: new Date().toISOString().slice(0, 10),
    startTime: times.startTime,
    endTime: times.endTime,
    clockIn: times.clockIn,
    clockOut: times.clockOut,
  });

  const loaded = await OvertimeRequest.findByPk(String(row.get('id')), { include: listInclude });
  const dto = toDto(loaded ?? row);

  // Persist the requester-selected approver chain, if any.
  const { resolveAssignedChainApprovers } = await import('./workflowChainApproverService.js');
  const approverChain = await resolveAssignedChainApprovers({
    assignedApproverUserIds: body.assignedApproverUserIds,
    requesterUserId: body.userId,
  });
  if (approverChain.length) {
    const {
      OVERTIME_APPROVER_CONFIG,
      replaceChainApprovers,
      loadChainApprovers,
      notifyChainApproversOnSubmit,
    } = await import('./workflowChainApproverService.js');
    await replaceChainApprovers(OVERTIME_APPROVER_CONFIG, dto.id, approverChain);
    const approvers = await loadChainApprovers(OVERTIME_APPROVER_CONFIG, dto.id);
    await notifyChainApproversOnSubmit(
      OVERTIME_APPROVER_CONFIG,
      dto.id,
      approvers,
      buildOvertimeSummary(dto)
    );
  }
  const attached = attachOvertimeApprovers(dto);
  await writeDomainAudit({
    entityType: 'overtime_request',
    entityId: attached.id,
    action: 'CREATE',
    performedBy: body.userId,
    newValue: pickAuditFields(attached as unknown as Record<string, unknown>),
    reason: 'Overtime request submitted',
  });
  return attached;
}

async function sumPendingAndApprovedHoursForMonth(
  userId: string,
  monthPrefix: string,
  excludeRequestId?: string,
  periodBounds?: { periodStart: string; periodEnd: string }
): Promise<number> {
  const { start, end } = resolveOvertimeWorkDateRange({
    monthPrefix,
    periodStart: periodBounds?.periodStart,
    periodEnd: periodBounds?.periodEnd,
  });
  const rows = await OvertimeRequest.findAll({
    where: {
      userId,
      status: { [Op.in]: ['PENDING', 'APPROVED'] },
      workDate: { [Op.between]: [start, end] },
    },
  });
  return rows.reduce((sum, r) => {
    if (excludeRequestId && String(r.get('id')) === excludeRequestId) return sum;
    return sum + (Number(r.get('hours')) || 0);
  }, 0);
}

async function resolveOtCapWindow(workDate: string): Promise<{
  monthPrefix: string;
  periodBounds: { periodStart: string; periodEnd: string };
}> {
  const { resolveSalaryMonthForDate } = await import('./payroll/payrollCalendarCycleService.js');
  const { resolvePayrollPeriod } = await import('./payroll/payrollPeriodService.js');
  const monthPrefix = await resolveSalaryMonthForDate(workDate);
  const period = await resolvePayrollPeriod(monthPrefix);
  return {
    monthPrefix,
    periodBounds: {
      periodStart: period.payPeriodStart.slice(0, 10),
      periodEnd: period.payPeriodEnd.slice(0, 10),
    },
  };
}

export type UpdateOvertimeRequestBody = {
  workDate: string;
  hours: number;
  rateTier?: OvertimeRateTier;
  reason: string;
  otTypeId?: string;
  startTime?: string;
  endTime?: string;
  clockIn?: string;
  clockOut?: string;
  /** Required when resubmitting a RETURNED request — rebuilds the approver chain. */
  assignedApproverUserIds?: unknown;
};

export async function updatePendingOvertimeRequest(
  id: string,
  body: UpdateOvertimeRequestBody,
  options: { actorUserId: string; actorRole?: string }
): Promise<OvertimeRequestDto> {
  await ensureOvertimeRequestSchema();
  const row = await OvertimeRequest.findByPk(id);
  if (!row) throw new Error('Overtime request not found');

  const ownerId = String(row.get('userId'));
  const previousStatus = String(row.get('status') ?? '').toUpperCase();
  const wasReturned = previousStatus === 'RETURNED';
  if (previousStatus !== 'PENDING' && previousStatus !== 'RETURNED') {
    throw new Error('Only pending or returned overtime requests can be edited');
  }

  const role = String(options.actorRole || '').toUpperCase();
  const isAdminHr = role === 'ADMIN' || role === 'HR' || role === 'SUPER_ADMIN';
  if (!isAdminHr && ownerId !== options.actorUserId) {
    throw new Error('You can only edit your own overtime requests');
  }

  const workDate = String(body.workDate ?? row.get('workDate') ?? '').slice(0, 10);
  const { assertPayrollReviewInputsUpdatableForRange, PayrollReviewFrozenError } = await import(
    './payroll/payrollReviewInputGuard.js'
  );
  const { PayrollPeriodFrozenError } = await import('./payroll/payrollPeriodFreezeService.js');
  try {
    await assertPayrollReviewInputsUpdatableForRange(workDate, workDate);
  } catch (e) {
    if (e instanceof PayrollPeriodFrozenError || e instanceof PayrollReviewFrozenError) throw e;
    throw e;
  }

  const {
    findActiveOvertimeType,
    validateOvertimeCreateBody,
    normalizeOvertimeTimeFields,
  } = await import('./overtimeConfigService.js');
  const { getGlobalMaxHoursPerMonth } = await import('./overtimeSchema.js');

  const otTypeId = String(body.otTypeId ?? row.get('otTypeId') ?? '').trim();
  const err = await validateOvertimeCreateBody({
    userId: ownerId,
    workDate,
    hours: body.hours,
    rateTier: body.rateTier,
    reason: body.reason,
    otTypeId,
    startTime: body.startTime,
    endTime: body.endTime,
    clockIn: body.clockIn,
    clockOut: body.clockOut,
  });
  if (err) throw new Error(err);

  const otType = (await findActiveOvertimeType(otTypeId))!;
  const tier =
    body.rateTier && VALID_TIERS.has(body.rateTier) ? body.rateTier : otType.rateTier;
  const hours = Math.round(Number(body.hours) * 100) / 100;
  const times = normalizeOvertimeTimeFields({
    userId: ownerId,
    workDate,
    hours,
    rateTier: tier,
    reason: body.reason,
    otTypeId,
    startTime: body.startTime,
    endTime: body.endTime,
    clockIn: body.clockIn,
    clockOut: body.clockOut,
  });

  const { monthPrefix, periodBounds } = await resolveOtCapWindow(workDate);
  const globalMax = await getGlobalMaxHoursPerMonth();
  const monthTotal = await sumPendingAndApprovedHoursForMonth(
    ownerId,
    monthPrefix,
    id,
    periodBounds
  );
  if (monthTotal + hours > globalMax) {
    throw new Error(
      `Monthly overtime limit is ${globalMax} hours (already ${monthTotal}h this payroll period)`
    );
  }

  const patch: Record<string, unknown> = {
    otTypeId: otType.id,
    workDate,
    hours,
    rateTier: tier,
    reason: String(body.reason || '').trim(),
    startTime: times.startTime,
    endTime: times.endTime,
    clockIn: times.clockIn,
    clockOut: times.clockOut,
  };
  if (wasReturned) {
    patch.status = 'PENDING';
    patch.rejectionReason = null;
    patch.approvedBy = null;
    patch.approvedAt = null;
    patch.appliedOn = new Date().toISOString().slice(0, 10);
  }

  await row.update(patch);

  const loaded = await OvertimeRequest.findByPk(id, { include: listInclude });
  let dto = toDto(loaded ?? row);

  if (wasReturned) {
    const { resolveAssignedChainApprovers } = await import('./workflowChainApproverService.js');
    let approverChain: string[] = [];
    try {
      approverChain = await resolveAssignedChainApprovers({
        assignedApproverUserIds: body.assignedApproverUserIds,
        requesterUserId: ownerId,
      });
    } catch (chainErr) {
      throw new Error((chainErr as Error).message);
    }
    if (!approverChain.length) {
      throw new Error('Select at least one approver to resubmit this overtime request');
    }
    const {
      OVERTIME_APPROVER_CONFIG,
      replaceChainApprovers,
      loadChainApprovers,
      notifyChainApproversOnSubmit,
    } = await import('./workflowChainApproverService.js');
    await replaceChainApprovers(OVERTIME_APPROVER_CONFIG, id, approverChain);
    const approvers = await loadChainApprovers(OVERTIME_APPROVER_CONFIG, id);
    await notifyChainApproversOnSubmit(
      OVERTIME_APPROVER_CONFIG,
      id,
      approvers,
      buildOvertimeSummary(dto)
    );
    dto = await attachOvertimeApprovers(dto);
    await writeWorkflowStatusAudit({
      entityType: 'overtime_request',
      entityId: id,
      previousStatus,
      nextStatus: 'PENDING',
      performedBy: options.actorUserId,
      reason: 'Resubmitted after return',
    });
  }

  return dto;
}

export class OvertimeApprovalError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = 'OvertimeApprovalError';
    this.status = status;
  }
}

/**
 * Return a pending overtime request to the submitter for revision.
 * Clears the approver chain so a clean resubmit can start a new chain.
 */
export async function returnOvertimeRequest(
  id: string,
  actor: { id: string; role: string },
  notes?: string | null
): Promise<OvertimeRequestDto> {
  await ensureOvertimeRequestSchema();
  const row = await OvertimeRequest.findByPk(id);
  if (!row) throw new OvertimeApprovalError('Overtime request not found', 404);

  const current = String(row.get('status') ?? '').toUpperCase();
  if (current !== 'PENDING') {
    throw new OvertimeApprovalError(
      'Only pending overtime requests can be returned for revision.',
      400
    );
  }

  const comment = requireWorkflowComment(notes);
  if (!comment) {
    throw new OvertimeApprovalError('A return comment is required (min 3 characters).', 400);
  }

  const actorId = String(actor.id ?? '').trim();
  const actorRole = String(actor.role ?? '').toUpperCase();
  const isHrAdmin = actorRole === 'ADMIN' || actorRole === 'HR' || actorRole === 'SUPER_ADMIN';
  const isManager = actorRole === 'MANAGER';

  const {
    OVERTIME_APPROVER_CONFIG,
    loadChainApprovers,
    chainRequiresActorApproval,
  } = await import('./workflowChainApproverService.js');

  const approvers = await loadChainApprovers(OVERTIME_APPROVER_CONFIG, id);
  if (approvers.length) {
    if (!chainRequiresActorApproval(approvers, actorId)) {
      throw new OvertimeApprovalError('It is not your turn to return this overtime request.');
    }
  } else if (!isHrAdmin && !isManager) {
    throw new OvertimeApprovalError('You are not allowed to return this overtime request.');
  }

  const { assertPayrollReviewInputsUpdatableForRange, PayrollReviewFrozenError } = await import(
    './payroll/payrollReviewInputGuard.js'
  );
  const { PayrollPeriodFrozenError } = await import('./payroll/payrollPeriodFreezeService.js');
  const workDate = String(row.get('workDate') ?? '');
  try {
    await assertPayrollReviewInputsUpdatableForRange(workDate, workDate);
  } catch (e) {
    if (e instanceof PayrollPeriodFrozenError || e instanceof PayrollReviewFrozenError) throw e;
    throw e;
  }

  await row.update({
    status: 'RETURNED',
    rejectionReason: comment,
    approvedBy: null,
    approvedAt: null,
  });

  // Keep previous approver chain for resubmit prefill (OT status RETURNED is not actionable).

  try {
    const { createNotification } = await import('./notificationService.js');
    const ownerId = String(row.get('userId') ?? '').trim();
    if (ownerId) {
      const summary = buildOvertimeSummary({
        hours: Number(row.get('hours')) || 0,
        workDate: String(row.get('workDate') ?? '').slice(0, 10),
      });
      await createNotification({
        userId: ownerId,
        id: `ot-returned-${id}-${ownerId}-${Date.now()}`,
        title: 'Overtime request returned',
        message: `${summary} was returned for revision: ${comment}`,
        type: 'WARNING',
        link: `/overtime?scope=self&requestId=${encodeURIComponent(id)}`,
      });
    }
  } catch {
    /* non-fatal */
  }

  await writeWorkflowStatusAudit({
    entityType: 'overtime_request',
    entityId: id,
    previousStatus: current,
    nextStatus: 'RETURNED',
    performedBy: actorId,
    reason: comment,
  });

  const loaded = await OvertimeRequest.findByPk(id, { include: listInclude });
  return loaded ? toDto(loaded) : toDto(row);
}

export type CancelOvertimeResult =
  | { ok: true; request: OvertimeRequestDto; previousStatus: string; nextStatus: 'CANCELLED' }
  | { ok: false; status: number; message: string };

/** Employee withdraws an OT request before it is finalized. Row stays as CANCELLED. */
export async function cancelOvertimeByRequester(
  id: string,
  requesterUserId: string
): Promise<CancelOvertimeResult> {
  await ensureOvertimeRequestSchema();
  const row = await OvertimeRequest.findByPk(id);
  if (!row) return { ok: false, status: 404, message: 'Overtime request not found' };

  const ownerId = String(row.get('userId') ?? '').trim();
  const actorId = String(requesterUserId ?? '').trim();
  if (!actorId || ownerId !== actorId) {
    return { ok: false, status: 403, message: 'You can only cancel your own overtime requests.' };
  }

  const current = String(row.get('status') ?? '').toUpperCase();
  if (current === 'CANCELLED') {
    return { ok: false, status: 400, message: 'This request is already cancelled.' };
  }
  if (current !== 'PENDING' && current !== 'RETURNED') {
    return {
      ok: false,
      status: 400,
      message: 'Only pending or returned requests can be cancelled.',
    };
  }

  const { assertPayrollReviewInputsUpdatableForRange, PayrollReviewFrozenError } = await import(
    './payroll/payrollReviewInputGuard.js'
  );
  const { PayrollPeriodFrozenError } = await import('./payroll/payrollPeriodFreezeService.js');
  const workDate = String(row.get('workDate') ?? '').slice(0, 10);
  try {
    await assertPayrollReviewInputsUpdatableForRange(workDate, workDate);
  } catch (e) {
    if (e instanceof PayrollPeriodFrozenError || e instanceof PayrollReviewFrozenError) {
      return { ok: false, status: 409, message: (e as Error).message };
    }
    throw e;
  }

  await row.update({ status: 'CANCELLED' });

  const summaryDto = toDto(row);
  const summary = buildOvertimeSummary(summaryDto);

  try {
    const {
      OVERTIME_APPROVER_CONFIG,
      loadChainApprovers,
      notifyChainWorkflowFinished,
    } = await import('./workflowChainApproverService.js');
    const approvers = await loadChainApprovers(OVERTIME_APPROVER_CONFIG, id);
    if (approvers.length) {
      await notifyChainWorkflowFinished({
        cfg: OVERTIME_APPROVER_CONFIG,
        entityId: id,
        outcome: 'cancelled',
        approvers,
        submitterUserId: ownerId,
        summary,
      });
    }
  } catch {
    /* non-fatal */
  }

  await writeWorkflowStatusAudit({
    entityType: 'overtime_request',
    entityId: id,
    previousStatus: current,
    nextStatus: 'CANCELLED',
    performedBy: actorId,
    reason: 'Cancelled by requester',
  });

  const loaded = await OvertimeRequest.findByPk(id, { include: listInclude });
  const dto = loaded
    ? await attachOvertimeApprovers(toDto(loaded))
    : await attachOvertimeApprovers(toDto(row));

  return {
    ok: true,
    request: dto,
    previousStatus: current,
    nextStatus: 'CANCELLED',
  };
}

export async function updateOvertimeRequestStatus(
  id: string,
  status: OvertimeRequestStatus,
  options?: { approvedBy?: string; rejectionReason?: string; actorRole?: string }
): Promise<OvertimeRequestDto | null> {
  if (status === 'RETURNED') {
    return returnOvertimeRequest(
      id,
      { id: String(options?.approvedBy ?? ''), role: String(options?.actorRole ?? '') },
      options?.rejectionReason
    );
  }

  const row = await OvertimeRequest.findByPk(id);
  if (!row) return null;

  const previousStatus = String(row.get('status') ?? '').toUpperCase();
  if (previousStatus === 'CANCELLED') {
    throw new OvertimeApprovalError('This overtime request was cancelled by the requester.', 400);
  }

  const { assertPayrollReviewInputsUpdatableForRange, PayrollReviewFrozenError } = await import(
    './payroll/payrollReviewInputGuard.js'
  );
  const { PayrollPeriodFrozenError } = await import('./payroll/payrollPeriodFreezeService.js');
  const workDate = String(row.get('workDate') ?? '');
  try {
    await assertPayrollReviewInputsUpdatableForRange(workDate, workDate);
  } catch (e) {
    if (e instanceof PayrollPeriodFrozenError || e instanceof PayrollReviewFrozenError) throw e;
    throw e;
  }

  const actorId = String(options?.approvedBy ?? '').trim();
  const actorRole = String(options?.actorRole ?? '').toUpperCase();
  const isHrAdmin = actorRole === 'ADMIN' || actorRole === 'HR' || actorRole === 'SUPER_ADMIN';
  const isManager = actorRole === 'MANAGER';

  const actionComment =
    status === 'APPROVED' || status === 'REJECTED'
      ? requireWorkflowComment(options?.rejectionReason)
      : null;
  if (status === 'APPROVED' && !actionComment) {
    throw new OvertimeApprovalError('An approval comment is required (min 3 characters).', 400);
  }
  if (status === 'REJECTED' && !actionComment) {
    throw new OvertimeApprovalError('A rejection comment is required (min 3 characters).', 400);
  }

  const {
    OVERTIME_APPROVER_CONFIG,
    loadChainApprovers,
    chainRequiresActorApproval,
    getCurrentPendingChainApprover,
    markChainApproverApproved,
    allChainApproversApproved,
    notifyNextChainApproverTurn,
    notifyChainWorkflowFinished,
  } = await import('./workflowChainApproverService.js');
  const chain = await loadChainApprovers(OVERTIME_APPROVER_CONFIG, id);

  // -------- Ordered approver chain path --------
  if (chain.length) {
    const currentStatus = String(row.get('status') ?? '').toUpperCase();
    if (currentStatus !== 'PENDING') {
      throw new OvertimeApprovalError(
        'This overtime request is no longer awaiting approval.',
        400
      );
    }
    const isCurrent = chainRequiresActorApproval(chain, actorId);
    if (!isCurrent) {
      throw new OvertimeApprovalError('It is not your turn to act on this overtime request yet.');
    }

    const reloadDto = async () => {
      const loaded = await OvertimeRequest.findByPk(id, { include: listInclude });
      return loaded ? attachOvertimeApprovers(toDto(loaded)) : null;
    };
    const summaryDto = toDto(row);
    const summary = buildOvertimeSummary(summaryDto);

    if (status === 'REJECTED') {
      await row.update({ status: 'REJECTED', rejectionReason: actionComment });
      await writeWorkflowStatusAudit({
        entityType: 'overtime_request',
        entityId: id,
        previousStatus,
        nextStatus: 'REJECTED',
        performedBy: actorId,
        reason: actionComment ?? undefined,
      });
      await notifyChainWorkflowFinished({
        cfg: OVERTIME_APPROVER_CONFIG,
        entityId: id,
        outcome: 'rejected',
        approvers: chain,
        submitterUserId: String(row.get('userId') ?? ''),
        summary,
      });
      return reloadDto();
    }

    if (status === 'APPROVED') {
      const current = getCurrentPendingChainApprover(chain);
      if (current) await markChainApproverApproved(OVERTIME_APPROVER_CONFIG, id, current.userId);
      const refreshed = await loadChainApprovers(OVERTIME_APPROVER_CONFIG, id);
      if (!allChainApproversApproved(refreshed)) {
        await writeWorkflowStatusAudit({
          entityType: 'overtime_request',
          entityId: id,
          previousStatus,
          nextStatus: 'PENDING',
          performedBy: actorId,
          reason: actionComment ?? undefined,
        });
        await notifyNextChainApproverTurn(OVERTIME_APPROVER_CONFIG, id, refreshed, summary);
        return reloadDto();
      }
      await row.update({
        status: 'APPROVED',
        approvedBy: actorId || null,
        approvedAt: new Date(),
        rejectionReason: null,
      });
      await writeWorkflowStatusAudit({
        entityType: 'overtime_request',
        entityId: id,
        previousStatus,
        nextStatus: 'APPROVED',
        performedBy: actorId,
        reason: actionComment ?? undefined,
      });
      await notifyChainWorkflowFinished({
        cfg: OVERTIME_APPROVER_CONFIG,
        entityId: id,
        outcome: 'approved',
        approvers: refreshed,
        submitterUserId: String(row.get('userId') ?? ''),
        summary,
      });
      return reloadDto();
    }

    // PENDING reset is treated as a legacy operation below.
  }

  // -------- Legacy single-step path (no chain) --------
  // Authorization formerly enforced by route middleware; enforce here now that
  // the route is open to chain approvers who may not be HR/Manager.
  if (!isHrAdmin && !isManager) {
    throw new OvertimeApprovalError('You are not allowed to action this overtime request.');
  }

  const patch: Record<string, unknown> = { status };
  if (status === 'APPROVED') {
    patch.approvedBy = options?.approvedBy ?? null;
    patch.approvedAt = new Date();
    patch.rejectionReason = null;
  }
  if (status === 'REJECTED') {
    patch.rejectionReason = actionComment;
    patch.approvedBy = null;
    patch.approvedAt = null;
  }
  if (status === 'PENDING') {
    patch.approvedBy = null;
    patch.approvedAt = null;
    patch.rejectionReason = null;
  }
  await row.update(patch);
  const nextStatus = String(status).toUpperCase();
  if (nextStatus !== previousStatus) {
    await writeWorkflowStatusAudit({
      entityType: 'overtime_request',
      entityId: id,
      previousStatus,
      nextStatus,
      performedBy: actorId || options?.approvedBy || null,
      reason: actionComment ?? options?.rejectionReason ?? undefined,
    });
  }
  const loaded = await OvertimeRequest.findByPk(id, { include: listInclude });
  return loaded ? toDto(loaded) : null;
}

function resolveOvertimeWorkDateRange(params: {
  monthPrefix: string;
  throughDate?: string | null;
  periodStart?: string;
  periodEnd?: string;
}): { start: string; end: string } {
  const prefix = params.monthPrefix.slice(0, 7);
  const [y, m] = prefix.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const calendarStart = `${prefix}-01`;
  const calendarEnd = `${prefix}-${String(lastDay).padStart(2, '0')}`;

  // When payroll period bounds are provided (cutoff-to-cutoff), honor them fully —
  // do not clamp to the named calendar month (spillover days must be included).
  const hasPeriodBounds = Boolean(params.periodStart && params.periodEnd);
  let start = params.periodStart?.slice(0, 10) ?? calendarStart;
  let end = params.periodEnd?.slice(0, 10) ?? calendarEnd;
  if (!hasPeriodBounds) {
    if (start < calendarStart) start = calendarStart;
    if (end > calendarEnd) end = calendarEnd;
  }
  if (params.throughDate) {
    const cap = params.throughDate.slice(0, 10);
    if (cap < end) end = cap;
  }
  return { start, end };
}

/** Approved OT hours for payroll (by rate bucket) — APPROVED requests only. */
export async function getApprovedOvertimeHoursForMonth(
  userId: string,
  monthPrefix: string,
  /** Cap OT inclusion (e.g. employee last working date). */
  throughDate?: string | null,
  periodBounds?: { periodStart: string; periodEnd: string }
): Promise<ApprovedOvertimeHours> {
  await ensureOvertimeRequestSchema();
  const { start, end } = resolveOvertimeWorkDateRange({
    monthPrefix,
    throughDate,
    periodStart: periodBounds?.periodStart,
    periodEnd: periodBounds?.periodEnd,
  });

  const rows = await OvertimeRequest.findAll({
    where: {
      userId,
      status: 'APPROVED',
      workDate: { [Op.between]: [start, end] },
    },
  });

  const bucket: ApprovedOvertimeHours = { hours100: 0, hours150: 0, hours200: 0 };
  for (const row of rows) {
    const p = row.get({ plain: true }) as { hours: number; rateTier: string };
    bucketOvertimeHoursByRateTier(p.rateTier, p.hours, bucket);
  }

  return roundOvertimeHours(bucket);
}

/** Batch-load approved OT for payroll preview/run (one query). */
export async function bulkGetApprovedOvertimeHoursForUsers(params: {
  userIds: string[];
  periodStart: string;
  periodEnd: string;
  throughDateByUserId?: Map<string, string | null | undefined>;
}): Promise<Map<string, ApprovedOvertimeHours>> {
  await ensureOvertimeRequestSchema();
  const result = new Map<string, ApprovedOvertimeHours>();
  const ids = [...new Set(params.userIds.map((id) => String(id).trim()).filter(Boolean))];
  for (const id of ids) result.set(id, { hours100: 0, hours150: 0, hours200: 0 });
  if (!ids.length) return result;

  const start = params.periodStart.slice(0, 10);
  const end = params.periodEnd.slice(0, 10);

  const rows = await OvertimeRequest.findAll({
    where: {
      userId: { [Op.in]: ids },
      status: 'APPROVED',
      workDate: { [Op.between]: [start, end] },
    },
  });

  for (const row of rows) {
    const p = row.get({ plain: true }) as {
      userId: string;
      hours: number;
      rateTier: string;
      workDate: string;
    };
    const uid = String(p.userId);
    let effectiveEnd = end;
    const cap = params.throughDateByUserId?.get(uid);
    if (cap) {
      const capKey = String(cap).slice(0, 10);
      if (capKey < effectiveEnd) effectiveEnd = capKey;
    }
    const workDate = String(p.workDate).slice(0, 10);
    if (workDate < start || workDate > effectiveEnd) continue;

    const bucket = result.get(uid) ?? { hours100: 0, hours150: 0, hours200: 0 };
    bucketOvertimeHoursByRateTier(p.rateTier, p.hours, bucket);
    result.set(uid, bucket);
  }

  for (const [uid, bucket] of result) {
    result.set(uid, roundOvertimeHours(bucket));
  }
  return result;
}
