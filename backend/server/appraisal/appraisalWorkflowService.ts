import crypto from 'crypto';
import { QueryTypes } from 'sequelize';
import { Employee, sequelize } from '../db.js';
import { Op } from 'sequelize';
import type {
  AppraisalWorkflowStatus,
  ComponentScoreInput,
  EmployeeAppraisalRow,
} from './appraisalTypes.js';
import { clampScore } from './appraisalTypes.js';
import { validateManualScoreWithPolicy } from './appraisalPolicySettings.js';
import { appraisalId } from './appraisalSchema.js';
import {
  buildComponentScoresForAppraisal,
  logAppraisalReopenSnapshot,
  logScoreChange,
  listAppraisalAuditLog,
  parseEvaluatorScores,
  recalculateCombinedAppraisalScores,
  recordEvaluatorSnapshotsForActor,
  recalculatePeriodRankings,
} from './appraisalCalculationService.js';
import {
  assertAppraisalPeriodActive,
  getAppraisalPeriod,
} from './appraisalPeriodService.js';
import { listKpiComponents } from './kpiComponentService.js';
import {
  APPRAISAL_EMPLOYEE_JOINS,
  APPRAISAL_EMPLOYEE_NAME_EXPR,
  APPRAISAL_EMPLOYEE_CODE_EXPR,
  APPRAISAL_EMPLOYEE_EMAIL_EXPR,
  APPRAISAL_EMPLOYEE_PHONE_EXPR,
  APPRAISAL_DEPARTMENT_ID_EXPR,
  APPRAISAL_ASSIGNED_MANAGER_JOINS,
  APPRAISAL_ASSIGNED_MANAGER_NAME_EXPR,
} from './appraisalQuerySql.js';
import {
  type AppraisalActor,
  actorCanSeeAppraisalRow,
  actorIsAssignedManager,
  canActorEditAppraisalContent,
  effectiveAssignedManagerUserId,
  enrichAppraisalRow,
  parseAppraisalOutcomePayload,
  resolveAppraisalCapabilities,
} from './appraisalRoutingService.js';
import {
  LINKED_MOVEMENT_COUNT_JOIN,
  LINKED_MOVEMENT_COUNT_SQL,
} from './appraisalMovementLinkService.js';

function scoreId(): string {
  return `score-${crypto.randomBytes(8).toString('hex')}`;
}

/* ------------------------------------------------------------------ */
/* Management-evaluator chain (HR routes to one or more managers in   */
/* sequence). Built on the generic chain-approver service, but with   */
/* evaluation-specific DTO field names + notification wording.        */
/* ------------------------------------------------------------------ */

type AppraisalEvaluatorDtoFields = {
  assignedEvaluatorUserIds: string[];
  assignedEvaluators: Array<{
    userId: string;
    name: string | null;
    status: 'pending' | 'submitted';
    submittedAt: string | null;
    sortOrder: number;
    phase: 'submitted' | 'current' | 'queued';
  }>;
  currentEvaluatorUserId: string | null;
  currentEvaluatorName: string | null;
  evaluationProgress: { submitted: number; total: number } | null;
};

function serializeEvaluatorRecordsForDto(
  records: import('../workflowChainApproverService.js').ChainApproverRecord[]
): AppraisalEvaluatorDtoFields {
  const sorted = [...records].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.userId.localeCompare(b.userId)
  );
  const current = sorted.find((row) => row.status === 'pending') ?? null;
  const submitted = sorted.filter((row) => row.status === 'approved').length;
  return {
    assignedEvaluatorUserIds: sorted.map((row) => row.userId),
    assignedEvaluators: sorted.map((row) => ({
      userId: row.userId,
      name: row.userName,
      status: row.status === 'approved' ? 'submitted' : 'pending',
      submittedAt: row.approvedAt,
      sortOrder: row.sortOrder,
      phase:
        row.status === 'approved'
          ? 'submitted'
          : current?.userId === row.userId
            ? 'current'
            : 'queued',
    })),
    currentEvaluatorUserId: current?.userId ?? null,
    currentEvaluatorName: current?.userName ?? null,
    evaluationProgress: sorted.length ? { submitted, total: sorted.length } : null,
  };
}

async function loadEvaluatorDtoFields(appraisalId: string): Promise<AppraisalEvaluatorDtoFields> {
  const { APPRAISAL_EVALUATOR_CONFIG, loadChainApprovers } = await import(
    '../workflowChainApproverService.js'
  );
  return serializeEvaluatorRecordsForDto(
    await loadChainApprovers(APPRAISAL_EVALUATOR_CONFIG, appraisalId)
  );
}

async function loadEvaluatorDtoFieldsBatch(
  appraisalIds: string[]
): Promise<Map<string, AppraisalEvaluatorDtoFields>> {
  const { APPRAISAL_EVALUATOR_CONFIG, loadChainApproversBatch } = await import(
    '../workflowChainApproverService.js'
  );
  const map = await loadChainApproversBatch(APPRAISAL_EVALUATOR_CONFIG, appraisalIds);
  const out = new Map<string, AppraisalEvaluatorDtoFields>();
  for (const id of appraisalIds) {
    out.set(String(id), serializeEvaluatorRecordsForDto(map.get(String(id)) ?? []));
  }
  return out;
}

/**
 * Whether `userId` is the evaluator whose turn it currently is for this
 * appraisal (chain-aware, with a fallback to the legacy single assignee).
 * Used to authorize score/evaluation/submit actions for non-manager evaluators.
 */
export async function isCurrentAppraisalEvaluator(
  appraisalId: string,
  userId: string
): Promise<boolean> {
  const id = String(userId ?? '').trim();
  if (!id) return false;
  const { APPRAISAL_EVALUATOR_CONFIG, loadChainApprovers, getCurrentPendingChainApprover } =
    await import('../workflowChainApproverService.js');
  const chain = await loadChainApprovers(APPRAISAL_EVALUATOR_CONFIG, appraisalId);
  if (chain.length) {
    const current = getCurrentPendingChainApprover(chain);
    return Boolean(current && current.userId === id);
  }
  const appraisal = await getEmployeeAppraisal(appraisalId);
  if (!appraisal) return false;
  return String(effectiveAssignedManagerUserId(appraisal) ?? '') === id;
}

async function notifyAppraisalEvaluatorTurn(
  appraisalId: string,
  evaluatorUserId: string,
  stepLabel?: string
): Promise<void> {
  const userId = String(evaluatorUserId ?? '').trim();
  if (!userId) return;
  try {
    const { createNotification } = await import('../notificationService.js');
    await createNotification({
      userId,
      id: `aev-turn-${appraisalId}-${userId}`,
      title: 'Appraisal awaiting your evaluation',
      message: `An employee appraisal has been routed to you for evaluation.${stepLabel ? ` ${stepLabel}` : ''}`,
      type: 'WARNING',
      link: '/performance?tab=kpi-appraisals',
    });
  } catch (err) {
    console.error('[aev] notifyAppraisalEvaluatorTurn failed:', err);
  }
}

async function notifyAppraisalEvaluatorQueued(
  appraisalId: string,
  evaluatorUserId: string,
  stepNumber: number,
  totalSteps: number
): Promise<void> {
  const userId = String(evaluatorUserId ?? '').trim();
  if (!userId) return;
  try {
    const { createNotification } = await import('../notificationService.js');
    await createNotification({
      userId,
      id: `aev-assigned-${appraisalId}-${userId}`,
      title: 'Assigned as appraisal evaluator',
      message: `You are evaluator ${stepNumber} of ${totalSteps} for an employee appraisal. You will be notified when it is your turn.`,
      type: 'INFO',
      link: '/performance?tab=kpi-appraisals',
    });
  } catch (err) {
    console.error('[aev] notifyAppraisalEvaluatorQueued failed:', err);
  }
}

async function notifyAppraisalEvaluatorChainOnRoute(
  appraisalId: string,
  evaluators: import('../workflowChainApproverService.js').ChainApproverRecord[]
): Promise<void> {
  if (!evaluators.length) return;
  const total = evaluators.length;
  for (let index = 0; index < evaluators.length; index += 1) {
    const entry = evaluators[index];
    if (index === 0) {
      await notifyAppraisalEvaluatorTurn(
        appraisalId,
        entry.userId,
        total > 1 ? `(Evaluator 1 of ${total})` : undefined
      );
    } else {
      await notifyAppraisalEvaluatorQueued(appraisalId, entry.userId, index + 1, total);
    }
  }
}


export async function getEmployeeAppraisal(id: string): Promise<EmployeeAppraisalRow | null> {
  const rows = (await sequelize.query(
    `SELECT * FROM employee_appraisals WHERE id = :id LIMIT 1`,
    { replacements: { id }, type: QueryTypes.SELECT }
  )) as EmployeeAppraisalRow[];
  return rows[0] ?? null;
}

export async function listAppraisals(filters?: {
  periodId?: string;
  userId?: string;
  workflowStatus?: string;
  actor?: AppraisalActor;
}): Promise<
  Array<
    EmployeeAppraisalRow & {
      employeeName?: string;
      periodName?: string;
      departmentId?: string | null;
      assignedManagerName?: string | null;
      canRouteToManager?: boolean;
      canManagerEdit?: boolean;
      canEmployeeSelfEvaluate?: boolean;
      canHrFinalize?: boolean;
      canFinalApproverReview?: boolean;
      canLegacyAdvance?: boolean;
    }
  >
> {
  const { ensureAppraisalColumnMigrations } = await import('./appraisalSchemaMigration.js');
  await ensureAppraisalColumnMigrations();

  const clauses: string[] = [];
  const replacements: Record<string, unknown> = {};
  if (filters?.periodId) {
    clauses.push('ea.period_id = :periodId');
    replacements.periodId = filters.periodId;
  }
  if (filters?.userId) {
    clauses.push('ea.user_id = :userId');
    replacements.userId = filters.userId;
  }
  if (filters?.workflowStatus) {
    clauses.push('ea.workflow_status = :status');
    replacements.status = filters.workflowStatus;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = (await sequelize.query(
    `SELECT ea.*, ap.name AS periodName, ${APPRAISAL_EMPLOYEE_NAME_EXPR},
            ${APPRAISAL_EMPLOYEE_CODE_EXPR}, ${APPRAISAL_EMPLOYEE_EMAIL_EXPR}, ${APPRAISAL_EMPLOYEE_PHONE_EXPR},
            ${APPRAISAL_DEPARTMENT_ID_EXPR},
            ${APPRAISAL_ASSIGNED_MANAGER_NAME_EXPR},
            ${LINKED_MOVEMENT_COUNT_SQL} AS linkedMovementCount
     FROM employee_appraisals ea
     LEFT JOIN appraisal_periods ap ON ap.id = ea.period_id
     ${APPRAISAL_EMPLOYEE_JOINS}
     ${APPRAISAL_ASSIGNED_MANAGER_JOINS}
     ${LINKED_MOVEMENT_COUNT_JOIN}
     ${where}
     ORDER BY ea.updated_at DESC`,
    { replacements, type: QueryTypes.SELECT }
  )) as Array<
    EmployeeAppraisalRow & {
      employeeName?: string;
      periodName?: string;
      departmentId?: string | null;
      assignedManagerName?: string | null;
      linkedMovementCount?: number;
    }
  >;

  const actor = filters?.actor;
  const { loadAppraisalApproversBatch, serializeAppraisalApproversForDto } = await import(
    '../workflowAppraisalApproverService.js'
  );
  const appraisalIds = rows.map((row) => String(row.id));
  const [approverMap, evaluatorMap] = await Promise.all([
    loadAppraisalApproversBatch(appraisalIds),
    loadEvaluatorDtoFieldsBatch(appraisalIds),
  ]);
  const rowsWithApprovers = rows.map((row) => {
    const approverFields = serializeAppraisalApproversForDto(
      approverMap.get(String(row.id)) ?? []
    );
    const evaluatorFields =
      evaluatorMap.get(String(row.id)) ?? serializeEvaluatorRecordsForDto([]);
    return { ...row, ...approverFields, ...evaluatorFields };
  });
  return rowsWithApprovers
    .filter((row) => actorCanSeeAppraisalRow(row, actor))
    .map((row) => enrichAppraisalRow(row, actor));
}

/** Manager review inbox: HR-routed appraisals assigned to the current evaluator. */
export async function listRoutedManagerAppraisalReviews(actor: AppraisalActor): Promise<
  Array<
    EmployeeAppraisalRow & {
      employeeName?: string;
      periodName?: string;
      departmentId?: string | null;
      assignedManagerName?: string | null;
      canManagerEdit?: boolean;
    }
  >
> {
  const { ensureAppraisalColumnMigrations } = await import('./appraisalSchemaMigration.js');
  await ensureAppraisalColumnMigrations();

  const actorId = String(actor.userId ?? '').trim();
  if (!actorId) return [];

  const rows = (await sequelize.query(
    `SELECT ea.*, ap.name AS periodName, ${APPRAISAL_EMPLOYEE_NAME_EXPR},
            ${APPRAISAL_EMPLOYEE_CODE_EXPR}, ${APPRAISAL_EMPLOYEE_EMAIL_EXPR}, ${APPRAISAL_EMPLOYEE_PHONE_EXPR},
            ${APPRAISAL_DEPARTMENT_ID_EXPR},
            ${APPRAISAL_ASSIGNED_MANAGER_NAME_EXPR}
     FROM employee_appraisals ea
     LEFT JOIN appraisal_periods ap ON ap.id = ea.period_id
     ${APPRAISAL_EMPLOYEE_JOINS}
     ${APPRAISAL_ASSIGNED_MANAGER_JOINS}
     WHERE ea.workflow_status IN ('PENDING_MANAGER', 'MANAGER_REVIEW')
       AND ea.assigned_manager_user_id = :actorId
       AND ea.routed_by_hr_user_id IS NOT NULL AND TRIM(ea.routed_by_hr_user_id) != ''
       AND ea.user_id != :actorId
       AND COALESCE(ea.locked, 0) = 0
       AND e.id IS NOT NULL
       AND LOWER(COALESCE(e.status, '')) IN ('active', 'pending_approval')
       AND NOT (
         UPPER(COALESCE(u.role, '')) IN ('ADMIN', 'SUPER_ADMIN')
         AND (u.employeeId IS NULL OR TRIM(COALESCE(u.employeeId, '')) = '')
       )
     ORDER BY ea.updated_at DESC`,
    {
      replacements: { actorId },
      type: QueryTypes.SELECT,
    }
  )) as Array<
    EmployeeAppraisalRow & {
      employeeName?: string;
      periodName?: string;
      departmentId?: string | null;
      assignedManagerName?: string | null;
    }
  >;

  return rows
    .map((row) => enrichAppraisalRow(row, actor))
    .filter((row) => row.canManagerEdit);
}

export async function listAppraisalHistory(userId: string) {
  return listAppraisals({ userId });
}

async function persistComponentScores(
  appraisalId: string,
  components: Awaited<ReturnType<typeof buildComponentScoresForAppraisal>>['components'],
  manualMeta?: Record<string, { comment?: string; evaluationNotes?: string }>
): Promise<void> {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const existingSnapshots = (await sequelize.query(
    `SELECT component_id, hr_raw_score, manager_raw_score, employee_raw_score, evaluator_scores_json
     FROM appraisal_component_scores WHERE appraisal_id = :id`,
    { replacements: { id: appraisalId }, type: QueryTypes.SELECT }
  )) as Array<{
    component_id: string;
    hr_raw_score: number | null;
    manager_raw_score: number | null;
    employee_raw_score: number | null;
    evaluator_scores_json: string | null;
  }>;
  const snapshotByComponent = new Map(
    existingSnapshots.map((row) => [
      row.component_id,
      {
        hr: row.hr_raw_score != null ? Number(row.hr_raw_score) : null,
        mgr: row.manager_raw_score != null ? Number(row.manager_raw_score) : null,
        emp: row.employee_raw_score != null ? Number(row.employee_raw_score) : null,
        evaluatorJson: row.evaluator_scores_json ?? null,
      },
    ])
  );

  await sequelize.query(`DELETE FROM appraisal_component_scores WHERE appraisal_id = :id`, {
    replacements: { id: appraisalId },
  });
  for (const c of components) {
    const meta = manualMeta?.[c.componentId];
    const snap = snapshotByComponent.get(c.componentId);
    await sequelize.query(
      `INSERT INTO appraisal_component_scores
       (id, appraisal_id, component_id, raw_score, weighted_score, hr_raw_score, manager_raw_score,
        employee_raw_score, evaluator_scores_json, auto_calculated, comment, evaluation_notes, calculated_at)
       VALUES (:id, :appraisalId, :compId, :raw, :weighted, :hrRaw, :mgrRaw, :empRaw, :evaluatorJson, :auto, :comment, :notes, :now)`,
      {
        replacements: {
          id: scoreId(),
          appraisalId,
          compId: c.componentId,
          raw: c.rawScore,
          weighted: c.weightedScore,
          hrRaw: snap?.hr ?? null,
          mgrRaw: snap?.mgr ?? null,
          empRaw: snap?.emp ?? null,
          evaluatorJson: snap?.evaluatorJson ?? null,
          auto: c.autoCalculated ? 1 : 0,
          comment: meta?.comment ?? null,
          notes: meta?.evaluationNotes ?? null,
          now,
        },
      }
    );
  }
}

async function snapshotComponentScoresForStage(
  appraisalId: string,
  stage: 'hr' | 'manager'
): Promise<void> {
  const { ensureAppraisalColumnMigrations } = await import('./appraisalSchemaMigration.js');
  await ensureAppraisalColumnMigrations();
  const column = stage === 'hr' ? 'hr_raw_score' : 'manager_raw_score';
  await sequelize.query(
    `UPDATE appraisal_component_scores SET ${column} = raw_score WHERE appraisal_id = :id`,
    { replacements: { id: appraisalId } }
  );
}

async function clearDualScoreSnapshots(appraisalId: string): Promise<void> {
  const { ensureAppraisalColumnMigrations } = await import('./appraisalSchemaMigration.js');
  await ensureAppraisalColumnMigrations();
  await sequelize.query(
    `UPDATE appraisal_component_scores
     SET hr_raw_score = NULL, manager_raw_score = NULL, employee_raw_score = NULL,
         evaluator_scores_json = NULL
     WHERE appraisal_id = :id`,
    { replacements: { id: appraisalId } }
  );
}

/** Restore working raw_score from manager snapshot when combined recalc overwrote it. */
async function repairComponentWorkingScores(appraisalId: string): Promise<void> {
  await sequelize.query(
    `UPDATE appraisal_component_scores
     SET raw_score = manager_raw_score
     WHERE appraisal_id = :id
       AND manager_raw_score IS NOT NULL
       AND auto_calculated = 0`,
    { replacements: { id: appraisalId } }
  );
}

export async function getAppraisalDetail(appraisalId: string, actor?: AppraisalActor) {
  const { ensureAppraisalColumnMigrations } = await import('./appraisalSchemaMigration.js');
  await ensureAppraisalColumnMigrations();

  const rows = (await sequelize.query(
    `SELECT ea.*, ap.name AS periodName, ap.end_date AS periodEndDate,
            ${APPRAISAL_EMPLOYEE_CODE_EXPR}, ${APPRAISAL_EMPLOYEE_NAME_EXPR},
            ${APPRAISAL_EMPLOYEE_EMAIL_EXPR}, ${APPRAISAL_EMPLOYEE_PHONE_EXPR},
            ${APPRAISAL_DEPARTMENT_ID_EXPR},
            ${APPRAISAL_ASSIGNED_MANAGER_NAME_EXPR}
     FROM employee_appraisals ea
     LEFT JOIN appraisal_periods ap ON ap.id = ea.period_id
     ${APPRAISAL_EMPLOYEE_JOINS}
     ${APPRAISAL_ASSIGNED_MANAGER_JOINS}
     WHERE ea.id = :id LIMIT 1`,
    { replacements: { id: appraisalId }, type: QueryTypes.SELECT }
  )) as Array<Record<string, unknown>>;

  const enriched = rows[0];
  if (!enriched) return null;

  const { loadAppraisalApprovers, serializeAppraisalApproversForDto } = await import(
    '../workflowAppraisalApproverService.js'
  );
  const approverFields = serializeAppraisalApproversForDto(
    await loadAppraisalApprovers(appraisalId)
  );
  const evaluatorFields = await loadEvaluatorDtoFields(appraisalId);
  Object.assign(enriched, approverFields, evaluatorFields);

  if (actor && !actorCanSeeAppraisalRow(enriched as EmployeeAppraisalRow, actor)) {
    return null;
  }

  const caps = enrichAppraisalRow(
    { ...(enriched as EmployeeAppraisalRow), ...approverFields },
    actor
  );
  Object.assign(caps, approverFields, evaluatorFields);
  const period = await getAppraisalPeriod(String(caps.period_id));

  if (caps.manager_submitted_at) {
    await repairComponentWorkingScores(appraisalId);
    await recalculateCombinedAppraisalScores(appraisalId);
    const refreshed = (await sequelize.query(
      `SELECT ea.*, ap.name AS periodName, ap.end_date AS periodEndDate,
              ${APPRAISAL_EMPLOYEE_CODE_EXPR}, ${APPRAISAL_EMPLOYEE_NAME_EXPR},
              ${APPRAISAL_EMPLOYEE_EMAIL_EXPR}, ${APPRAISAL_EMPLOYEE_PHONE_EXPR},
              ${APPRAISAL_DEPARTMENT_ID_EXPR},
              ${APPRAISAL_ASSIGNED_MANAGER_NAME_EXPR}
       FROM employee_appraisals ea
       LEFT JOIN appraisal_periods ap ON ap.id = ea.period_id
       ${APPRAISAL_EMPLOYEE_JOINS}
       ${APPRAISAL_ASSIGNED_MANAGER_JOINS}
       WHERE ea.id = :id LIMIT 1`,
      { replacements: { id: appraisalId }, type: QueryTypes.SELECT }
    )) as Array<Record<string, unknown>>;
    if (refreshed[0]) {
      Object.assign(enriched, refreshed[0]);
      const refreshedApprovers = serializeAppraisalApproversForDto(
        await loadAppraisalApprovers(appraisalId)
      );
      Object.assign(
        caps,
        enrichAppraisalRow(
          { ...(refreshed[0] as EmployeeAppraisalRow), ...refreshedApprovers },
          actor
        ),
        refreshedApprovers,
        evaluatorFields
      );
    }
  }

  const componentScores = (await sequelize.query(
    `SELECT acs.*, kc.name AS componentName, kc.weight_percent AS weightPercent,
            kc.scoring_method AS scoringMethod, kc.auto_metric AS autoMetric
     FROM appraisal_component_scores acs
     JOIN kpi_config_items kc ON kc.id = acs.component_id AND kc.kind = 'component'
     WHERE acs.appraisal_id = :id
     ORDER BY kc.sort_order ASC`,
    { replacements: { id: appraisalId }, type: QueryTypes.SELECT }
  )) as Array<Record<string, unknown>>;
  const auditLog = await listAppraisalAuditLog(appraisalId);
  const { listMovementsForAppraisal } = await import('../employeeMovementService.js');
  const linkedMovements = await listMovementsForAppraisal(appraisalId);
  return {
    appraisal: {
      ...caps,
      employeeName: caps.employeeName ?? enriched.employeeName,
      employeeCode: caps.employeeCode ?? enriched.employeeCode,
      employeeEmail: caps.employeeEmail ?? enriched.employeeEmail,
      employeePhone: caps.employeePhone ?? enriched.employeePhone,
      departmentId: caps.departmentId ?? enriched.departmentId,
      assignedManagerName: caps.assignedManagerName ?? enriched.assignedManagerName,
      periodName: enriched.periodName ?? period?.name,
      periodEndDate: enriched.periodEndDate ?? period?.end_date,
    },
    period,
    componentScores,
    auditLog,
    linkedMovements,
  };
}

async function loadExistingManualScores(appraisalId: string) {
  const rows = (await sequelize.query(
    `SELECT component_id, raw_score, hr_raw_score, manager_raw_score, comment, evaluation_notes, auto_calculated
     FROM appraisal_component_scores WHERE appraisal_id = :id`,
    { replacements: { id: appraisalId }, type: QueryTypes.SELECT }
  )) as Array<{
    component_id: string;
    raw_score: number;
    hr_raw_score: number | null;
    manager_raw_score: number | null;
    comment: string | null;
    evaluation_notes: string | null;
    auto_calculated: number;
  }>;

  const manualMap: Record<
    string,
    { rawScore: number; comment?: string; evaluationNotes?: string }
  > = {};
  for (const row of rows) {
    if (Number(row.auto_calculated) === 1) continue;
    const rawScore =
      row.hr_raw_score != null ? Number(row.hr_raw_score) : Number(row.raw_score);
    manualMap[row.component_id] = {
      rawScore,
      comment: row.comment ?? undefined,
      evaluationNotes: row.evaluation_notes ?? undefined,
    };
  }
  return manualMap;
}

export async function createOrRefreshAppraisal(params: {
  userId: string;
  periodId: string;
  actorId?: string;
  manualScores?: Record<string, { rawScore: number; comment?: string; evaluationNotes?: string }>;
}): Promise<EmployeeAppraisalRow> {
  const existing = (await sequelize.query(
    `SELECT * FROM employee_appraisals WHERE user_id = :userId AND period_id = :periodId LIMIT 1`,
    {
      replacements: { userId: params.userId, periodId: params.periodId },
      type: QueryTypes.SELECT,
    }
  )) as EmployeeAppraisalRow[];

  if (existing[0]?.locked) {
    throw new Error('Appraisal is locked after final approval. Reopen via HR to edit.');
  }

  const period = await getAppraisalPeriod(params.periodId);
  if (!existing[0]) {
    assertAppraisalPeriodActive(period);
  }
  const asOfDate = period ? String(period.end_date) : null;
  const kpiComponents = await listKpiComponents(true, asOfDate);
  const manualScores =
    params.manualScores ??
    (existing[0] ? await loadExistingManualScores(existing[0].id) : undefined);
  for (const comp of kpiComponents) {
    if (comp.scoring_method !== 'MANUAL') continue;
    const manual = manualScores?.[comp.id];
    if (manual) {
      const err = await validateManualScoreWithPolicy(manual.rawScore, manual.comment);
      if (err) throw new Error(`${comp.name}: ${err}`);
    }
  }

  const calc = await buildComponentScoresForAppraisal({
    userId: params.userId,
    periodId: params.periodId,
    manualScores,
  });

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  let appraisalIdVal = existing[0]?.id ?? appraisalId();

  if (existing[0]) {
    const prev = existing[0];
    if (prev.weighted_score != null && prev.weighted_score !== calc.weightedScore) {
      await logScoreChange({
        appraisalId: appraisalIdVal,
        fieldName: 'weighted_score',
        oldValue: prev.weighted_score,
        newValue: calc.weightedScore,
        changedBy: params.actorId,
        reason: 'Recalculated KPI scores',
      });
    }
    await sequelize.query(
      `UPDATE employee_appraisals SET
        raw_score = :raw, weighted_score = :weighted, final_grade = :grade,
        recommendation = :rec, updated_at = :now
       WHERE id = :id`,
      {
        replacements: {
          id: appraisalIdVal,
          raw: calc.rawScore,
          weighted: calc.weightedScore,
          grade: calc.grade,
          rec: calc.recommendation,
          now,
        },
      }
    );
  } else {
    await sequelize.query(
      `INSERT INTO employee_appraisals
       (id, user_id, period_id, workflow_status, raw_score, weighted_score, final_grade, recommendation, locked, created_at, updated_at)
       VALUES (:id, :userId, :periodId, 'DRAFT', :raw, :weighted, :grade, :rec, 0, :now, :now)`,
      {
        replacements: {
          id: appraisalIdVal,
          userId: params.userId,
          periodId: params.periodId,
          raw: calc.rawScore,
          weighted: calc.weightedScore,
          grade: calc.grade,
          rec: calc.recommendation,
          now,
        },
      }
    );
  }

  await persistComponentScores(appraisalIdVal, calc.components, manualScores);
  const row = await getEmployeeAppraisal(appraisalIdVal);
  if (!row) throw new Error('Failed to save appraisal');
  return row;
}

export async function advanceAppraisalWorkflow(params: {
  appraisalId: string;
  action:
    | 'self_review'
    | 'supervisor_submit'
    | 'manager_review'
    | 'hr_approve'
    | 'final_approve'
    | 'submit_for_final_approval'
    | 'approve_final'
    | 'reject_final'
    | 'return_final'
    | 'route_to_manager'
    | 'submit_to_hr'
    | 'submit_self_evaluation'
    | 'reject'
    | 'close'
    | 'reopen';
  actorId: string;
  actorRole?: string;
  notes?: string;
  assignedManagerUserId?: string;
  assignedEvaluatorUserIds?: string[];
  assignedFinalApproverUserId?: string;
  assignedFinalApproverUserIds?: string[];
  evaluation?: {
    strengths?: string | null;
    weaknesses?: string | null;
    managerRecommendations?: string | null;
    notes?: string | null;
    scores?: Array<{ componentId: string; rawScore: number }>;
  };
}): Promise<EmployeeAppraisalRow> {
  const { ensureAppraisalColumnMigrations } = await import('./appraisalSchemaMigration.js');
  await ensureAppraisalColumnMigrations();

  const appraisal = await getEmployeeAppraisal(params.appraisalId);
  if (!appraisal) throw new Error('Appraisal not found');
  if (appraisal.locked && params.action !== 'reopen') {
    throw new Error('Appraisal is locked. HR must reopen before changes.');
  }

  const role = String(params.actorRole ?? '').toUpperCase();
  const isHr = role === 'HR' || role === 'ADMIN';
  const actor: AppraisalActor = { userId: params.actorId, role };

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const patch: Record<string, unknown> = { updated_at: now };
  let terminalApproversForNotify:
    | import('../workflowAppraisalApproverService.js').AppraisalApproverRecord[]
    | undefined;
  // Management-evaluator chain bookkeeping (resolved inside the relevant cases,
  // applied/notified in the post-update side-effect block below).
  let routedEvaluatorIds: string[] | undefined;
  let evaluatorHandoffNext: { userId: string; step: number; total: number } | undefined;

  switch (params.action) {
    case 'route_to_manager': {
      if (!isHr) throw new Error('Only HR can route appraisals to managers.');
      const rawEvaluatorIds =
        Array.isArray(params.assignedEvaluatorUserIds) && params.assignedEvaluatorUserIds.length
          ? params.assignedEvaluatorUserIds
          : params.assignedManagerUserId
            ? [params.assignedManagerUserId]
            : [];
      const evaluatorIds = [
        ...new Set(rawEvaluatorIds.map((id) => String(id ?? '').trim()).filter(Boolean)),
      ];
      if (!evaluatorIds.length) {
        throw new Error('Select at least one evaluator for this appraisal.');
      }
      if (evaluatorIds.includes(String(appraisal.user_id))) {
        throw new Error('An employee cannot be assigned to evaluate their own appraisal.');
      }
      const managerId = evaluatorIds[0];
      const currentStatus = String(appraisal.workflow_status);
      if (appraisal.manager_submitted_at && currentStatus !== 'DRAFT' && currentStatus !== 'REOPENED') {
        throw new Error('Manager evaluation already submitted.');
      }
      patch.workflow_status = 'PENDING_MANAGER';
      patch.assigned_manager_user_id = managerId;
      patch.routed_by_hr_user_id = params.actorId;
      patch.routed_at = now;
      patch.manager_id = managerId;
      routedEvaluatorIds = evaluatorIds;
      if (currentStatus === 'DRAFT' || currentStatus === 'REOPENED') {
        patch.manager_submitted_at = null;
        patch.manager_submitted_by = null;
        patch.manager_reviewed_at = null;
        patch.self_review_at = null;
        patch.self_review_notes = null;
        patch.outcome_payload_json = null;
      }
      break;
    }
    case 'submit_to_hr': {
      if (!actorIsAssignedManager(actor, effectiveAssignedManagerUserId(appraisal)) && role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
        throw new Error('Only the assigned manager can submit this appraisal to HR.');
      }
      const status = String(appraisal.workflow_status);
      if (status !== 'PENDING_MANAGER' && status !== 'MANAGER_REVIEW') {
        throw new Error('Appraisal is not awaiting manager evaluation.');
      }
      const evalPayload = {
        strengths: params.evaluation?.strengths?.trim() || null,
        weaknesses: params.evaluation?.weaknesses?.trim() || null,
        managerRecommendations:
          params.evaluation?.managerRecommendations?.trim() || null,
        submittedBy: params.actorId,
        submittedAt: now,
      };

      let priorPayload: Record<string, unknown> = {};
      try {
        if (appraisal.outcome_payload_json) {
          priorPayload = JSON.parse(String(appraisal.outcome_payload_json));
        }
      } catch {
        priorPayload = {};
      }
      const managementEvaluations: Record<string, unknown> = {
        ...(priorPayload.managementEvaluations &&
        typeof priorPayload.managementEvaluations === 'object' &&
        !Array.isArray(priorPayload.managementEvaluations)
          ? (priorPayload.managementEvaluations as Record<string, unknown>)
          : {}),
      };
      managementEvaluations[String(params.actorId)] = evalPayload;
      patch.outcome_payload_json = JSON.stringify({
        ...priorPayload,
        managementEvaluations,
      });

      // Sequential evaluator chain: mark the current evaluator done and, if more
      // evaluators remain, hand off to the next one (staying in PENDING_MANAGER)
      // instead of advancing to the employee self-evaluation step.
      const {
        APPRAISAL_EVALUATOR_CONFIG,
        loadChainApprovers,
        markChainApproverApproved,
        getCurrentPendingChainApprover,
      } = await import('../workflowChainApproverService.js');
      const evaluatorChain = await loadChainApprovers(
        APPRAISAL_EVALUATOR_CONFIG,
        params.appraisalId
      );
      if (evaluatorChain.length) {
        const currentEvaluator = getCurrentPendingChainApprover(evaluatorChain);
        if (currentEvaluator) {
          await markChainApproverApproved(
            APPRAISAL_EVALUATOR_CONFIG,
            params.appraisalId,
            currentEvaluator.userId
          );
        }
        const refreshedChain = await loadChainApprovers(
          APPRAISAL_EVALUATOR_CONFIG,
          params.appraisalId
        );
        const nextEvaluator = getCurrentPendingChainApprover(refreshedChain);
        if (nextEvaluator) {
          patch.workflow_status = 'PENDING_MANAGER';
          patch.assigned_manager_user_id = nextEvaluator.userId;
          patch.manager_id = nextEvaluator.userId;
          evaluatorHandoffNext = {
            userId: nextEvaluator.userId,
            step: refreshedChain.filter((row) => row.status === 'approved').length + 1,
            total: refreshedChain.length,
          };
          break;
        }
      }

      // No chain (legacy single manager) or every evaluator has now submitted.
      patch.workflow_status = 'PENDING_EMPLOYEE';
      const legacyManagerId = effectiveAssignedManagerUserId(appraisal);
      if (!appraisal.assigned_manager_user_id && legacyManagerId) {
        patch.assigned_manager_user_id = legacyManagerId;
      }
      patch.manager_submitted_at = now;
      patch.manager_submitted_by = params.actorId;
      patch.manager_reviewed_at = now;
      patch.self_review_at = null;
      patch.self_review_notes = null;
      const lastEval = managementEvaluations[String(params.actorId)] as
        | { strengths?: string | null; weaknesses?: string | null; managerRecommendations?: string | null }
        | undefined;
      if (lastEval?.strengths) patch.strengths = lastEval.strengths;
      if (lastEval?.weaknesses) patch.weaknesses = lastEval.weaknesses;
      if (lastEval?.managerRecommendations) {
        patch.manager_recommendations = lastEval.managerRecommendations;
      }
      break;
    }
    case 'submit_self_evaluation': {
      if (String(appraisal.user_id) !== String(params.actorId)) {
        throw new Error('Only the employee can submit their self-evaluation.');
      }
      const status = String(appraisal.workflow_status);
      if (status !== 'PENDING_EMPLOYEE') {
        throw new Error('This appraisal is not awaiting employee self-evaluation.');
      }
      if (!appraisal.manager_submitted_at) {
        throw new Error('Manager evaluation must be completed before employee self-evaluation.');
      }
      if (appraisal.self_review_at) {
        throw new Error('Employee self-evaluation was already submitted.');
      }

      const componentRows = (await sequelize.query(
        `SELECT acs.component_id, kc.name AS componentName, kc.weight_percent AS weightPercent
         FROM appraisal_component_scores acs
         JOIN kpi_config_items kc ON kc.id = acs.component_id
         WHERE acs.appraisal_id = :id
         ORDER BY kc.sort_order ASC`,
        { replacements: { id: params.appraisalId }, type: QueryTypes.SELECT }
      )) as Array<{ component_id: string; componentName: string; weightPercent: number }>;

      if (!componentRows.length) {
        throw new Error('No KPI components found for this appraisal.');
      }

      const scoreInputs = params.evaluation?.scores ?? [];
      const scoreMap = new Map(
        scoreInputs.map((s) => [String(s.componentId), clampScore(Number(s.rawScore))])
      );
      for (const row of componentRows) {
        const raw = scoreMap.get(String(row.component_id));
        if (raw == null || !Number.isFinite(raw)) {
          throw new Error('Rate every KPI component before submitting your self-evaluation.');
        }
      }

      let employeeWeighted = 0;
      const persistedScores: Array<{
        componentId: string;
        componentName: string;
        rawScore: number;
        weightPercent: number;
        weightedScore: number;
      }> = [];

      for (const row of componentRows) {
        const rawScore = scoreMap.get(String(row.component_id))!;
        const weight = Number(row.weightPercent ?? 0);
        const weightedScore = Math.round(((rawScore * weight) / 100) * 100) / 100;
        employeeWeighted += weightedScore;
        persistedScores.push({
          componentId: String(row.component_id),
          componentName: String(row.componentName),
          rawScore,
          weightPercent: weight,
          weightedScore,
        });
        await sequelize.query(
          `UPDATE appraisal_component_scores
           SET employee_raw_score = :raw
           WHERE appraisal_id = :id AND component_id = :compId`,
          {
            replacements: { raw: rawScore, id: params.appraisalId, compId: row.component_id },
          }
        );
      }
      employeeWeighted = Math.round(employeeWeighted * 100) / 100;

      const notes = params.evaluation?.notes?.trim() || params.notes?.trim() || null;
      const strengths = params.evaluation?.strengths?.trim() || null;
      const weaknesses = params.evaluation?.weaknesses?.trim() || null;

      let priorPayload: Record<string, unknown> = {};
      try {
        if (appraisal.outcome_payload_json) {
          priorPayload = JSON.parse(String(appraisal.outcome_payload_json));
        }
      } catch {
        priorPayload = {};
      }
      const employeeEvaluation = {
        strengths,
        weaknesses,
        notes,
        scores: persistedScores,
        weightedScore: employeeWeighted,
        submittedBy: params.actorId,
        submittedAt: now,
      };
      patch.workflow_status = 'PENDING_HR';
      patch.self_review_at = now;
      patch.self_review_notes =
        notes ?? ([strengths, weaknesses].filter(Boolean).join('\n\n') || null);
      patch.outcome_payload_json = JSON.stringify({
        ...priorPayload,
        employeeEvaluation,
      });
      break;
    }
    case 'self_review':
      patch.workflow_status = 'SELF_REVIEW';
      patch.self_review_notes = params.notes ?? null;
      patch.self_review_at = now;
      break;
    case 'supervisor_submit':
      patch.workflow_status = 'PENDING_REVIEW';
      patch.supervisor_id = params.actorId;
      patch.supervisor_submitted_at = now;
      break;
    case 'manager_review':
      patch.workflow_status = 'MANAGER_REVIEW';
      patch.manager_id = params.actorId;
      patch.manager_reviewed_at = now;
      break;
    case 'hr_approve':
      patch.workflow_status = 'SUBMITTED';
      patch.hr_approved_by = params.actorId;
      patch.hr_approved_at = now;
      break;
    case 'final_approve': {
      if (!isHr) throw new Error('Only HR can finalize appraisals.');
      if (
        effectiveAssignedManagerUserId(appraisal) &&
        !appraisal.manager_submitted_at &&
        String(appraisal.workflow_status) !== 'SUBMITTED' &&
        String(appraisal.workflow_status) !== 'HR_REVIEW'
      ) {
        throw new Error('Waiting for assigned manager evaluation before HR can finalize.');
      }
      if (
        effectiveAssignedManagerUserId(appraisal) &&
        appraisal.manager_submitted_at &&
        !appraisal.self_review_at &&
        String(appraisal.workflow_status) !== 'SUBMITTED' &&
        String(appraisal.workflow_status) !== 'HR_REVIEW'
      ) {
        throw new Error('Waiting for employee self-evaluation before HR can finalize.');
      }
      patch.workflow_status = 'APPROVED';
      patch.final_approved_by = params.actorId;
      patch.final_approved_at = now;
      patch.hr_approved_by = params.actorId;
      patch.hr_approved_at = now;
      patch.locked = 1;
      break;
    }
    case 'submit_for_final_approval': {
      if (!isHr) throw new Error('Only HR can submit appraisals for final approval.');
      const status = String(appraisal.workflow_status);
      if (status !== 'PENDING_HR' && status !== 'HR_REVIEW' && status !== 'SUBMITTED') {
        throw new Error('Appraisal is not ready for final approval submission.');
      }
      if (
        effectiveAssignedManagerUserId(appraisal) &&
        appraisal.manager_submitted_at &&
        !appraisal.self_review_at
      ) {
        throw new Error('Waiting for employee self-evaluation before submitting for approval.');
      }
      const { resolveAssignedFinalApproversForSubmit, replaceAppraisalApprovers } = await import(
        '../workflowAppraisalApproverService.js'
      );
      const approverIds = await resolveAssignedFinalApproversForSubmit({
        assignedFinalApproverUserIds: params.assignedFinalApproverUserIds,
        assignedFinalApproverUserId: params.assignedFinalApproverUserId,
        actorId: params.actorId,
      });
      patch.workflow_status = 'PENDING_FINAL_APPROVAL';
      patch.assigned_final_approver_user_id = approverIds[0];
      patch.hr_approved_by = params.actorId;
      patch.hr_approved_at = now;
      await replaceAppraisalApprovers(params.appraisalId, approverIds);
      break;
    }
    case 'approve_final': {
      const approveComment = String(params.notes ?? '').trim();
      if (approveComment.length < 3) {
        throw new Error('Approval comment is required (min 3 characters).');
      }
      const {
        loadAppraisalApprovers,
        markAppraisalApproverApproved,
        allAppraisalApproversApproved,
        getCurrentPendingAppraisalApprover,
        appraisalRequiresActorApproval,
      } = await import('../workflowAppraisalApproverService.js');
      const { canActAsFinalAppraisalApprover } = await import('../workflowApproverService.js');

      const approvers = await loadAppraisalApprovers(params.appraisalId);
      const actorId = params.actorId;
      const role = String(params.actorRole ?? '').toUpperCase();
      const isHrAdmin = ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(role);

      if (String(appraisal.workflow_status) !== 'PENDING_FINAL_APPROVAL') {
        throw new Error('Appraisal is not awaiting final approval.');
      }

      if (approvers.length) {
        if (!appraisalRequiresActorApproval(approvers, actorId)) {
          throw new Error(
            isHrAdmin
              ? 'This appraisal is waiting on another approver in the chain. Only the current approver can sign off.'
              : 'It is not your turn to approve this appraisal yet.'
          );
        }
        const mine = approvers.find((entry) => entry.userId === actorId);
        if (mine?.status === 'approved') {
          throw new Error('You have already approved this appraisal.');
        }
        await markAppraisalApproverApproved(params.appraisalId, actorId);
        const refreshed = await loadAppraisalApprovers(params.appraisalId);
        if (!allAppraisalApproversApproved(refreshed)) {
          const next = getCurrentPendingAppraisalApprover(refreshed);
          const touchNow = new Date().toISOString().slice(0, 19).replace('T', ' ');
          await sequelize.query(
            `UPDATE employee_appraisals SET assigned_final_approver_user_id = :approverId, updated_at = :now WHERE id = :id`,
            {
              replacements: {
                approverId: next?.userId ?? null,
                now: touchNow,
                id: params.appraisalId,
              },
            }
          );
          if (next) {
            const { notifyNextAppraisalApproverTurn } = await import(
              '../workflowAppraisalApproverService.js'
            );
            await notifyNextAppraisalApproverTurn(params.appraisalId, refreshed);
          }
          await logScoreChange({
            appraisalId: params.appraisalId,
            fieldName: 'workflow_status',
            oldValue: appraisal.workflow_status,
            newValue: 'PENDING_FINAL_APPROVAL',
            changedBy: params.actorId,
            reason: approveComment,
          });
          const partial = await getEmployeeAppraisal(params.appraisalId);
          if (!partial) throw new Error('Failed to update appraisal');
          return partial;
        }
      } else if (
        !canActAsFinalAppraisalApprover(
          { id: params.actorId, role },
          { assigned_final_approver_user_id: appraisal.assigned_final_approver_user_id },
          { sequential: false }
        )
      ) {
        throw new Error('You are not authorized to approve this appraisal.');
      }

      patch.workflow_status = 'APPROVED';
      patch.final_approved_by = params.actorId;
      patch.final_approved_at = now;
      patch.locked = 1;
      break;
    }
    case 'reject_final': {
      const rejectComment = String(params.notes ?? '').trim();
      if (rejectComment.length < 3) {
        throw new Error('Rejection comment is required (min 3 characters).');
      }
      const { loadAppraisalApprovers, appraisalRequiresActorApproval } = await import(
        '../workflowAppraisalApproverService.js'
      );
      const { canActAsFinalAppraisalApprover } = await import('../workflowApproverService.js');
      const approvers = await loadAppraisalApprovers(params.appraisalId);
      const actorId = params.actorId;
      const role = String(params.actorRole ?? '').toUpperCase();
      const isHrAdmin = ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(role);

      if (String(appraisal.workflow_status) !== 'PENDING_FINAL_APPROVAL') {
        throw new Error('Appraisal is not awaiting final approval.');
      }

      if (approvers.length) {
        if (!appraisalRequiresActorApproval(approvers, actorId)) {
          throw new Error(
            isHrAdmin
              ? 'This appraisal is waiting on another approver in the chain. Only the current approver can reject.'
              : 'It is not your turn to reject this appraisal yet.'
          );
        }
      } else if (
        !canActAsFinalAppraisalApprover(
          { id: params.actorId, role },
          { assigned_final_approver_user_id: appraisal.assigned_final_approver_user_id },
          { sequential: false }
        )
      ) {
        throw new Error('You are not authorized to reject this appraisal.');
      }

      patch.workflow_status = 'REJECTED';
      patch.rejected_by = params.actorId;
      patch.rejected_at = now;
      patch.rejection_reason = rejectComment;
      patch.locked = 0;
      break;
    }
    case 'return_final': {
      const { loadAppraisalApprovers, appraisalRequiresActorApproval } =
        await import('../workflowAppraisalApproverService.js');
      const { canActAsFinalAppraisalApprover } = await import('../workflowApproverService.js');
      const approvers = await loadAppraisalApprovers(params.appraisalId);
      const actorId = params.actorId;
      const role = String(params.actorRole ?? '').toUpperCase();
      const isHrAdmin = ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(role);

      if (String(appraisal.workflow_status) !== 'PENDING_FINAL_APPROVAL') {
        throw new Error('Appraisal is not awaiting final approval.');
      }

      if (approvers.length) {
        if (!appraisalRequiresActorApproval(approvers, actorId)) {
          throw new Error(
            isHrAdmin
              ? 'This appraisal is waiting on another approver in the chain. Only the current approver can return it.'
              : 'It is not your turn to return this appraisal yet.'
          );
        }
      } else if (
        !canActAsFinalAppraisalApprover(
          { id: params.actorId, role },
          { assigned_final_approver_user_id: appraisal.assigned_final_approver_user_id },
          { sequential: false }
        )
      ) {
        throw new Error('You are not authorized to return this appraisal.');
      }

      const trimmed = String(params.notes ?? '').trim();
      if (trimmed.length < 3) {
        throw new Error('Return notes are required (min 3 characters).');
      }
      patch.workflow_status = 'PENDING_HR';
      patch.returned_by = params.actorId;
      patch.returned_at = now;
      patch.return_notes = trimmed;
      patch.assigned_final_approver_user_id = null;
      terminalApproversForNotify = approvers;
      // Keep the approver chain so returned items remain visible in the approval queue (Leave-style history).
      break;
    }
    case 'reject':
      if (!isHr && role !== 'ADMIN') throw new Error('Only HR can reject appraisals.');
      patch.workflow_status = 'REJECTED';
      patch.rejected_by = params.actorId;
      patch.rejected_at = now;
      patch.rejection_reason = params.notes ?? null;
      patch.locked = 0;
      break;
    case 'close':
      patch.workflow_status = 'CLOSED';
      patch.locked = 1;
      break;
    case 'reopen': {
      if (!isHr && role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
        throw new Error('Only HR can reopen appraisals.');
      }

      await logAppraisalReopenSnapshot(appraisal, params.actorId, params.notes);

      {
        const { APPRAISAL_EVALUATOR_CONFIG, replaceChainApprovers } = await import(
          '../workflowChainApproverService.js'
        );
        await replaceChainApprovers(APPRAISAL_EVALUATOR_CONFIG, params.appraisalId, []);
      }

      patch.locked = 0;
      patch.final_approved_by = null;
      patch.final_approved_at = null;
      patch.hr_approved_by = null;
      patch.hr_approved_at = null;
      patch.rejected_by = null;
      patch.rejected_at = null;
      patch.rejection_reason = null;
      patch.manager_submitted_at = null;
      patch.manager_submitted_by = null;
      patch.manager_reviewed_at = null;
      patch.self_review_at = null;
      patch.self_review_notes = null;
      patch.outcome_payload_json = null;
      patch.assigned_manager_user_id = null;
      patch.manager_id = null;
      patch.routed_at = null;
      patch.routed_by_hr_user_id = null;
      patch.workflow_status = 'REOPENED';

      await clearDualScoreSnapshots(params.appraisalId);

      await logScoreChange({
        appraisalId: params.appraisalId,
        fieldName: 'locked',
        oldValue: appraisal.locked ?? 1,
        newValue: 0,
        changedBy: params.actorId,
        reason: params.notes ?? 'HR reopened appraisal',
      });
      break;
    }
  }

  const sets = Object.keys(patch)
    .map((k) => `${k} = :${k}`)
    .join(', ');
  await sequelize.query(`UPDATE employee_appraisals SET ${sets} WHERE id = :id`, {
    replacements: { ...patch, id: params.appraisalId },
  });

  if (params.action === 'route_to_manager') {
    await snapshotComponentScoresForStage(params.appraisalId, 'hr');
    if (routedEvaluatorIds && routedEvaluatorIds.length) {
      const { APPRAISAL_EVALUATOR_CONFIG, replaceChainApprovers, loadChainApprovers } =
        await import('../workflowChainApproverService.js');
      await replaceChainApprovers(
        APPRAISAL_EVALUATOR_CONFIG,
        params.appraisalId,
        routedEvaluatorIds
      );
      await notifyAppraisalEvaluatorChainOnRoute(
        params.appraisalId,
        await loadChainApprovers(APPRAISAL_EVALUATOR_CONFIG, params.appraisalId)
      );
    }
  } else if (params.action === 'submit_to_hr') {
    if (evaluatorHandoffNext) {
      await recalculateCombinedAppraisalScores(params.appraisalId);
      await notifyAppraisalEvaluatorTurn(
        params.appraisalId,
        evaluatorHandoffNext.userId,
        evaluatorHandoffNext.total > 1
          ? `(Evaluator ${evaluatorHandoffNext.step} of ${evaluatorHandoffNext.total})`
          : undefined
      );
    } else {
      const { APPRAISAL_EVALUATOR_CONFIG, loadChainApprovers } = await import(
        '../workflowChainApproverService.js'
      );
      const evaluatorChain = await loadChainApprovers(
        APPRAISAL_EVALUATOR_CONFIG,
        params.appraisalId
      );
      if (evaluatorChain.length) {
        await recalculateCombinedAppraisalScores(params.appraisalId);
      } else {
        await snapshotComponentScoresForStage(params.appraisalId, 'manager');
        await recalculateCombinedAppraisalScores(params.appraisalId);
      }
    }
    if (String(patch.workflow_status ?? '') === 'PENDING_EMPLOYEE') {
      const employeeUserId = String(appraisal.user_id ?? '').trim();
      if (employeeUserId) {
        const { notifyAppraisalEmployeeSelfEval } = await import('../notificationService.js');
        await notifyAppraisalEmployeeSelfEval({
          appraisalId: params.appraisalId,
          employeeUserId,
          periodName: String(appraisal.periodName ?? appraisal.period_name ?? ''),
        });
      }
    }
  } else if (params.action === 'submit_self_evaluation') {
    await recalculateCombinedAppraisalScores(params.appraisalId);
  } else if (params.action === 'submit_for_final_approval') {
    const { loadAppraisalApprovers, notifyAppraisalApproversOnSubmit } = await import(
      '../workflowAppraisalApproverService.js'
    );
    const approvers = await loadAppraisalApprovers(params.appraisalId);
    await notifyAppraisalApproversOnSubmit(params.appraisalId, approvers);
  }

  await logScoreChange({
    appraisalId: params.appraisalId,
    fieldName: 'workflow_status',
    oldValue: appraisal.workflow_status,
    newValue: String(patch.workflow_status ?? appraisal.workflow_status),
    changedBy: params.actorId,
    reason: params.notes ?? params.action,
  });

  const updated = await getEmployeeAppraisal(params.appraisalId);
  if (!updated) throw new Error('Failed to update appraisal');

  if (params.action === 'final_approve' || params.action === 'approve_final') {
    if (String(patch.workflow_status ?? '') === 'APPROVED') {
      await recalculatePeriodRankings(updated.period_id);
      const { loadAppraisalApprovers, notifyAppraisalWorkflowFinished } = await import(
        '../workflowAppraisalApproverService.js'
      );
      await notifyAppraisalWorkflowFinished({
        appraisalId: params.appraisalId,
        outcome: 'approved',
        approvers: await loadAppraisalApprovers(params.appraisalId),
      });
      const refreshed = await getEmployeeAppraisal(params.appraisalId);
      if (refreshed) return refreshed;
    }
  }

  if (params.action === 'reject_final' && String(patch.workflow_status ?? '') === 'REJECTED') {
    const { loadAppraisalApprovers, notifyAppraisalWorkflowFinished } = await import(
      '../workflowAppraisalApproverService.js'
    );
    await notifyAppraisalWorkflowFinished({
      appraisalId: params.appraisalId,
      outcome: 'rejected',
      approvers: await loadAppraisalApprovers(params.appraisalId),
    });
  }

  if (params.action === 'return_final') {
    const { notifyAppraisalWorkflowFinished } = await import(
      '../workflowAppraisalApproverService.js'
    );
    await notifyAppraisalWorkflowFinished({
      appraisalId: params.appraisalId,
      outcome: 'returned',
      approvers: terminalApproversForNotify ?? [],
    });
  }

  return updated;
}

export async function saveAppraisalEvaluation(params: {
  appraisalId: string;
  actorId: string;
  actorRole?: string;
  strengths?: string | null;
  weaknesses?: string | null;
  managerRecommendations?: string | null;
}): Promise<EmployeeAppraisalRow> {
  const appraisal = await getEmployeeAppraisal(params.appraisalId);
  if (!appraisal) throw new Error('Appraisal not found');
  if (appraisal.locked) throw new Error('Appraisal is locked');
  const actor: AppraisalActor = {
    userId: params.actorId,
    role: String(params.actorRole ?? ''),
  };
  if (!canActorEditAppraisalContent(appraisal, actor)) {
    throw new Error('You do not have permission to edit this appraisal.');
  }

  const caps = resolveAppraisalCapabilities(appraisal, actor);
  const { APPRAISAL_EVALUATOR_CONFIG, loadChainApprovers } = await import(
    '../workflowChainApproverService.js'
  );
  const evaluatorChain = await loadChainApprovers(APPRAISAL_EVALUATOR_CONFIG, params.appraisalId);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  if (caps.canManagerEdit && evaluatorChain.length) {
    let priorPayload: Record<string, unknown> = {};
    try {
      if (appraisal.outcome_payload_json) {
        priorPayload = JSON.parse(String(appraisal.outcome_payload_json));
      }
    } catch {
      priorPayload = {};
    }
    const managementEvaluations: Record<string, unknown> = {
      ...(priorPayload.managementEvaluations &&
      typeof priorPayload.managementEvaluations === 'object' &&
      !Array.isArray(priorPayload.managementEvaluations)
        ? (priorPayload.managementEvaluations as Record<string, unknown>)
        : {}),
    };
    const existing = (managementEvaluations[String(params.actorId)] ?? {}) as Record<
      string,
      unknown
    >;
    managementEvaluations[String(params.actorId)] = {
      ...existing,
      strengths: params.strengths?.trim() || null,
      weaknesses: params.weaknesses?.trim() || null,
      managerRecommendations: params.managerRecommendations?.trim() || null,
      submittedBy: params.actorId,
      savedAt: now,
    };
    await sequelize.query(
      `UPDATE employee_appraisals SET outcome_payload_json = :payload, updated_at = :now WHERE id = :id`,
      {
        replacements: {
          id: params.appraisalId,
          payload: JSON.stringify({ ...priorPayload, managementEvaluations }),
          now,
        },
      }
    );
  } else {
    await sequelize.query(
      `UPDATE employee_appraisals SET
        strengths = :strengths,
        weaknesses = :weaknesses,
        manager_recommendations = :recs,
        updated_at = :now
       WHERE id = :id`,
      {
        replacements: {
          id: params.appraisalId,
          strengths: params.strengths?.trim() || null,
          weaknesses: params.weaknesses?.trim() || null,
          recs: params.managerRecommendations?.trim() || null,
          now,
        },
      }
    );
  }

  await logScoreChange({
    appraisalId: params.appraisalId,
    fieldName: 'evaluation_narrative',
    oldValue: null,
    newValue: 'updated',
    changedBy: params.actorId,
    reason: 'Manager evaluation narrative saved',
  });

  const row = await getEmployeeAppraisal(params.appraisalId);
  if (!row) throw new Error('Failed to save evaluation');
  return row;
}

export async function bulkCreateAppraisalsForPeriod(periodId: string, actorId?: string) {
  assertAppraisalPeriodActive(await getAppraisalPeriod(periodId));

  const employees = await Employee.findAll({
    // Draft / incomplete employees must never enter performance cycles.
    where: { status: 'active' },
    attributes: ['id'],
  });

  const created: EmployeeAppraisalRow[] = [];
  let skipped = 0;
  for (const emp of employees) {
    const empId = String(emp.get('id'));
    const users = (await sequelize.query(
      `SELECT id FROM users WHERE employeeId = :empId OR id = :empId LIMIT 1`,
      { replacements: { empId }, type: QueryTypes.SELECT }
    )) as Array<{ id: string }>;
    const userId = users[0]?.id;
    if (!userId) continue;

    const existing = (await sequelize.query(
      `SELECT id FROM employee_appraisals WHERE user_id = :userId AND period_id = :periodId LIMIT 1`,
      { replacements: { userId, periodId }, type: QueryTypes.SELECT }
    )) as Array<{ id: string }>;
    if (existing[0]) {
      skipped += 1;
      continue;
    }

    const row = await createOrRefreshAppraisal({
      userId,
      periodId,
      actorId,
    });
    created.push(row);
  }
  return { created, skipped };
}

export async function saveManualComponentScores(params: {
  appraisalId: string;
  scores: ComponentScoreInput[];
  actorId: string;
  actorRole?: string;
}) {
  const appraisal = await getEmployeeAppraisal(params.appraisalId);
  if (!appraisal) throw new Error('Appraisal not found');
  if (appraisal.locked) throw new Error('Appraisal is locked');
  const actor: AppraisalActor = {
    userId: params.actorId,
    role: String(params.actorRole ?? ''),
  };
  if (!canActorEditAppraisalContent(appraisal, actor)) {
    throw new Error('You do not have permission to edit scores on this appraisal.');
  }

  const caps = resolveAppraisalCapabilities(appraisal, actor);
  const snapshotColumn = caps.canManagerEdit ? 'manager_raw_score' : 'hr_raw_score';

  const manualMap: Record<string, { rawScore: number; comment?: string; evaluationNotes?: string }> =
    {};
  for (const s of params.scores) {
    manualMap[s.componentId] = {
      rawScore: clampScore(s.rawScore),
      comment: s.comment,
      evaluationNotes: s.evaluationNotes,
    };
  }

  const existingScores = (await sequelize.query(
    `SELECT * FROM appraisal_component_scores WHERE appraisal_id = :id`,
    { replacements: { id: params.appraisalId }, type: QueryTypes.SELECT }
  )) as Array<{ component_id: string; raw_score: number; auto_calculated: number }>;

  for (const ex of existingScores) {
    if (Number(ex.auto_calculated) === 1) {
      manualMap[ex.component_id] = {
        rawScore: Number(ex.raw_score),
      };
    }
  }

  await createOrRefreshAppraisal({
    userId: appraisal.user_id,
    periodId: appraisal.period_id,
    actorId: params.actorId,
    manualScores: manualMap,
  });

  for (const s of params.scores) {
    await sequelize.query(
      `UPDATE appraisal_component_scores
       SET ${snapshotColumn} = :raw
       WHERE appraisal_id = :id AND component_id = :compId`,
      {
        replacements: {
          raw: clampScore(s.rawScore),
          id: params.appraisalId,
          compId: s.componentId,
        },
      }
    );
  }

  // Record per-evaluator snapshots for manual KPIs and auto KPI engine scores.
  if (caps.canManagerEdit) {
    const manualScoresByComponentId = new Map(
      params.scores.map((s) => [s.componentId, clampScore(s.rawScore)])
    );
    await recordEvaluatorSnapshotsForActor(
      params.appraisalId,
      String(params.actorId),
      manualScoresByComponentId
    );
  }

  await recalculateCombinedAppraisalScores(params.appraisalId);

  return getEmployeeAppraisal(params.appraisalId).then((row) => {
    if (!row) throw new Error('Appraisal not found after save');
    return row;
  });
}

export async function listMyPendingAppraisalSelfEvaluations(userId: string) {
  return listAppraisals({
    userId,
    actor: { userId, role: 'EMPLOYEE' },
  }).then((rows) =>
    rows.filter(
      (row) =>
        String(row.workflow_status) === 'PENDING_EMPLOYEE' &&
        Boolean(row.manager_submitted_at) &&
        !row.self_review_at
    )
  );
}

function viewerIsAssignedFinalApprover(
  row: {
    assignedFinalApproverUserIds?: string[];
    assigned_final_approver_user_id?: string | null;
  },
  actorId: string
): boolean {
  const ids = row.assignedFinalApproverUserIds ?? [];
  if (ids.includes(actorId)) return true;
  const legacy = String(row.assigned_final_approver_user_id ?? '').trim();
  return legacy === actorId;
}

/** Appraisals in final approval where the viewer is assigned anywhere in the approver chain. */
export async function listFinalAppraisalsForAssignedApprover(
  viewer: {
    id?: string;
    role?: string;
  },
  options?: { includeHistory?: boolean }
): Promise<
  Array<
    EmployeeAppraisalRow & {
      employeeName?: string;
      periodName?: string;
      departmentId?: string | null;
      canFinalApproverReview?: boolean;
    }
  >
> {
  const actorId = String(viewer?.id ?? '').trim();
  if (!actorId) return [];
  const includeHistory = Boolean(options?.includeHistory);

  const { ensureAppraisalColumnMigrations } = await import('./appraisalSchemaMigration.js');
  await ensureAppraisalColumnMigrations();

  // Leave-style history: keep assigned rows after approve/reject/return. Inbox badges pass
  // includeHistory=false so they only count open final-approval items.
  const statusClause = includeHistory
    ? `ea.workflow_status IN ('PENDING_FINAL_APPROVAL', 'APPROVED', 'REJECTED', 'PENDING_HR', 'CLOSED')`
    : `ea.workflow_status = 'PENDING_FINAL_APPROVAL'`;

  const rows = (await sequelize.query(
    `SELECT ea.*, ap.name AS periodName, ${APPRAISAL_EMPLOYEE_NAME_EXPR},
            ${APPRAISAL_DEPARTMENT_ID_EXPR}
     FROM employee_appraisals ea
     LEFT JOIN appraisal_periods ap ON ap.id = ea.period_id
     ${APPRAISAL_EMPLOYEE_JOINS}
     WHERE ${statusClause}
     ORDER BY ea.updated_at DESC
     LIMIT 200`,
    { type: QueryTypes.SELECT }
  )) as Array<
    EmployeeAppraisalRow & {
      employeeName?: string;
      periodName?: string;
      departmentId?: string | null;
    }
  >;

  const { loadAppraisalApproversBatch, serializeAppraisalApproversForDto } = await import(
    '../workflowAppraisalApproverService.js'
  );
  const approverMap = await loadAppraisalApproversBatch(rows.map((row) => String(row.id)));
  const actor: AppraisalActor = { userId: actorId, role: String(viewer?.role ?? '') };

  return rows
    .map((row) => {
      const approverFields = serializeAppraisalApproversForDto(
        approverMap.get(String(row.id)) ?? []
      );
      return enrichAppraisalRow({ ...row, ...approverFields }, actor);
    })
    .filter((row) => viewerIsAssignedFinalApprover(row, actorId))
    .sort((a, b) => {
      const aAction = a.canFinalApproverReview ? 0 : 1;
      const bAction = b.canFinalApproverReview ? 0 : 1;
      if (aAction !== bAction) return aAction - bAction;
      return String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''));
    });
}

/** @deprecated Use listFinalAppraisalsForAssignedApprover */
export const listPendingFinalAppraisalsForCurrentApprover = listFinalAppraisalsForAssignedApprover;
