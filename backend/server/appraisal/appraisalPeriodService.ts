import { QueryTypes } from 'sequelize';
import { sequelize } from '../db.js';
import type { AppraisalPeriodRow, AppraisalPeriodStatus, AppraisalPeriodType } from './appraisalTypes.js';
import { appraisalId } from './appraisalSchema.js';
import {
  snapshotAppraisalPeriod,
  writeAppraisalPeriodAudit,
} from './appraisalPeriodAuditService.js';

/** Treat missing column / null as active for backward compatibility. */
export function isAppraisalPeriodActive(
  row: { is_active?: number | boolean | null } | null | undefined
): boolean {
  if (!row || row.is_active == null) return true;
  return Number(row.is_active) === 1;
}

export function assertAppraisalPeriodActive(period: AppraisalPeriodRow | null): AppraisalPeriodRow {
  if (!period) {
    throw Object.assign(new Error('Appraisal period not found'), { status: 404 });
  }
  if (!isAppraisalPeriodActive(period)) {
    throw Object.assign(new Error('This appraisal period is disabled. Enable it in KPI settings to use it.'), {
      status: 409,
      code: 'APPRAISAL_PERIOD_DISABLED',
    });
  }
  return period;
}

export async function createAppraisalPeriod(input: {
  name: string;
  periodType: AppraisalPeriodType;
  startDate: string;
  endDate: string;
  status?: AppraisalPeriodStatus;
  isActive?: boolean | number;
  alertNotificationDate?: string | null;
  createdBy?: string | null;
}): Promise<AppraisalPeriodRow> {
  if (input.startDate > input.endDate) {
    throw new Error('Period start date must be on or before end date');
  }
  const alertDate = input.alertNotificationDate?.trim() || null;
  if (alertDate && alertDate < input.startDate) {
    throw new Error('Alert date should be on or after the period start date');
  }
  const id = appraisalId().replace('appr-', 'period-');
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const isActive =
    input.isActive === undefined || input.isActive === null
      ? 1
      : Number(input.isActive) === 1 || input.isActive === true
        ? 1
        : 0;
  await sequelize.query(
    `INSERT INTO appraisal_periods
     (id, name, period_type, start_date, end_date, status, is_active, alert_notification_date, created_by, created_at, updated_at)
     VALUES (:id, :name, :type, :start, :end, :status, :isActive, :alertDate, :by, :now, :now)`,
    {
      replacements: {
        id,
        name: input.name.trim(),
        type: input.periodType,
        start: input.startDate,
        end: input.endDate,
        status: input.status ?? 'DRAFT',
        isActive,
        alertDate,
        by: input.createdBy ?? null,
        now,
      },
    }
  );
  const rows = (await sequelize.query(
    `SELECT * FROM appraisal_periods WHERE id = :id`,
    { replacements: { id }, type: QueryTypes.SELECT }
  )) as AppraisalPeriodRow[];
  const created = rows[0];
  if (created) {
    await writeAppraisalPeriodAudit({
      action: 'CREATE',
      periodId: id,
      newValue: snapshotAppraisalPeriod(created),
      performedBy: input.createdBy ?? null,
    });
  }
  return created;
}

export async function updateAppraisalPeriod(
  id: string,
  patch: Partial<{
    name: string;
    periodType: AppraisalPeriodType;
    startDate: string;
    endDate: string;
    status: AppraisalPeriodStatus;
    isActive: boolean | number;
    alertNotificationDate: string | null;
    performedBy?: string | null;
    /** When true (default if review window changes), refresh unlocked appraisals. */
    recalculateAppraisals?: boolean;
  }>
): Promise<
  | (AppraisalPeriodRow & {
      recalc?: { refreshed: number; skippedLocked: number };
    })
  | null
> {
  const existing = (await sequelize.query(
    `SELECT * FROM appraisal_periods WHERE id = :id LIMIT 1`,
    { replacements: { id }, type: QueryTypes.SELECT }
  )) as AppraisalPeriodRow[];
  if (!existing[0]) return null;

  const beforeSnapshot = snapshotAppraisalPeriod(existing[0]);
  const prevStart = String(existing[0].start_date).slice(0, 10);
  const prevEnd = String(existing[0].end_date).slice(0, 10);
  const nextStart = patch.startDate ?? prevStart;
  const nextEnd = patch.endDate ?? prevEnd;
  if (nextStart > nextEnd) {
    throw new Error('Period start date must be on or before end date');
  }

  let alertDate: string | null | undefined = patch.alertNotificationDate;
  if (alertDate !== undefined) {
    alertDate = alertDate?.trim() || null;
    if (alertDate && alertDate < nextStart) {
      throw new Error('Alert date should be on or after the period start date');
    }
  }

  const existingAlert = existing[0].alert_notification_date
    ? String(existing[0].alert_notification_date).slice(0, 10)
    : null;
  const alertChanged =
    alertDate !== undefined && (alertDate ?? null) !== (existingAlert ?? null);

  const isActiveSet = patch.isActive !== undefined;
  const nextIsActive = isActiveSet
    ? Number(patch.isActive) === 1 || patch.isActive === true
      ? 1
      : 0
    : null;

  const windowChanged = nextStart !== prevStart || nextEnd !== prevEnd;

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await sequelize.query(
    `UPDATE appraisal_periods SET
      name = COALESCE(:name, name),
      period_type = COALESCE(:type, period_type),
      start_date = COALESCE(:start, start_date),
      end_date = COALESCE(:end, end_date),
      status = COALESCE(:status, status),
      is_active = CASE WHEN :isActiveSet = 1 THEN :isActive ELSE is_active END,
      alert_notification_date = CASE
        WHEN :alertDateSet = 1 THEN :alertDate
        ELSE alert_notification_date
      END,
      alert_notification_sent_at = CASE
        WHEN :resetSent = 1 THEN NULL
        ELSE alert_notification_sent_at
      END,
      updated_at = :now
     WHERE id = :id`,
    {
      replacements: {
        id,
        name: patch.name?.trim() ?? null,
        type: patch.periodType ?? null,
        start: patch.startDate ?? null,
        end: patch.endDate ?? null,
        status: patch.status ?? null,
        isActiveSet: isActiveSet ? 1 : 0,
        isActive: nextIsActive,
        alertDate: alertDate === undefined ? null : alertDate,
        alertDateSet: alertDate !== undefined ? 1 : 0,
        resetSent: alertChanged ? 1 : 0,
        now,
      },
    }
  );
  const rows = (await sequelize.query(
    `SELECT * FROM appraisal_periods WHERE id = :id`,
    { replacements: { id }, type: QueryTypes.SELECT }
  )) as AppraisalPeriodRow[];
  const updated = rows[0] ?? null;
  if (!updated) return null;

  const afterSnapshot = snapshotAppraisalPeriod(updated);
  await writeAppraisalPeriodAudit({
    action: 'UPDATE',
    periodId: id,
    oldValue: beforeSnapshot,
    newValue: afterSnapshot,
    performedBy: patch.performedBy ?? null,
  });

  let recalc: { refreshed: number; skippedLocked: number } | undefined;
  const shouldRecalc =
    patch.recalculateAppraisals === true ||
    (patch.recalculateAppraisals !== false && windowChanged);
  if (shouldRecalc && windowChanged) {
    recalc = await recalculateUnlockedAppraisalsForPeriod(id, patch.performedBy ?? null);
  }

  return recalc ? { ...updated, recalc } : updated;
}

export async function listAppraisalPeriods(): Promise<AppraisalPeriodRow[]> {
  return (await sequelize.query(
    `SELECT * FROM appraisal_periods ORDER BY start_date DESC`,
    { type: QueryTypes.SELECT }
  )) as AppraisalPeriodRow[];
}

export type AppraisalPeriodListRow = AppraisalPeriodRow & {
  appraisal_count: number;
  /** Always true — delete cascades and reverts linked employee appraisals. */
  can_delete: boolean;
};

export async function listAppraisalPeriodsWithUsage(): Promise<AppraisalPeriodListRow[]> {
  const rows = (await sequelize.query(
    `SELECT ap.*, COALESCE(u.appraisal_count, 0) AS appraisal_count
     FROM appraisal_periods ap
     LEFT JOIN (
       SELECT period_id, COUNT(*) AS appraisal_count
       FROM employee_appraisals
       GROUP BY period_id
     ) u ON u.period_id = ap.id
     ORDER BY ap.start_date DESC`,
    { type: QueryTypes.SELECT }
  )) as Array<AppraisalPeriodRow & { appraisal_count?: number | string }>;

  return rows.map((row) => {
    const count = Number(row.appraisal_count ?? 0);
    const { appraisal_count: _c, ...period } = row;
    return {
      ...period,
      appraisal_count: count,
      can_delete: true,
    };
  });
}

async function listAppraisalIdsForPeriod(periodId: string): Promise<string[]> {
  const rows = (await sequelize.query(
    `SELECT id FROM employee_appraisals WHERE period_id = :id`,
    { replacements: { id: periodId }, type: QueryTypes.SELECT }
  )) as Array<{ id?: string }>;
  return rows.map((r) => String(r.id ?? '').trim()).filter(Boolean);
}

/**
 * Hard-delete every employee appraisal for a period and wipe related scores /
 * approval chains / movement source links so staff are treated as never appraised.
 */
export async function revertAppraisalsForPeriod(
  periodId: string
): Promise<{ deletedAppraisals: number }> {
  const appraisalIds = await listAppraisalIdsForPeriod(periodId);
  if (!appraisalIds.length) return { deletedAppraisals: 0 };

  const {
    APPRAISAL_EVALUATOR_CONFIG,
    APPRAISAL_FINAL_APPROVER_CONFIG,
    replaceChainApprovers,
  } = await import('../workflowChainApproverService.js');

  for (const appraisalIdVal of appraisalIds) {
    await replaceChainApprovers(APPRAISAL_EVALUATOR_CONFIG, appraisalIdVal, []);
    await replaceChainApprovers(APPRAISAL_FINAL_APPROVER_CONFIG, appraisalIdVal, []);
  }

  // Movements keep their rows but drop the appraisal source so history isn't orphaned.
  await sequelize.query(
    `UPDATE employee_movements
     SET source_appraisal_id = NULL
     WHERE source_appraisal_id IN (:ids)`,
    { replacements: { ids: appraisalIds } }
  );

  await sequelize.query(
    `DELETE FROM appraisal_component_scores WHERE appraisal_id IN (:ids)`,
    { replacements: { ids: appraisalIds } }
  );

  await sequelize.query(`DELETE FROM employee_appraisals WHERE period_id = :periodId`, {
    replacements: { periodId },
  });

  return { deletedAppraisals: appraisalIds.length };
}

/**
 * Recalculate KPI scores for unlocked appraisals after the review window changes.
 * Locked / finalized rows are left untouched (HR must reopen those first).
 */
export async function recalculateUnlockedAppraisalsForPeriod(
  periodId: string,
  actorId?: string | null
): Promise<{ refreshed: number; skippedLocked: number }> {
  const rows = (await sequelize.query(
    `SELECT id, user_id, locked FROM employee_appraisals WHERE period_id = :id`,
    { replacements: { id: periodId }, type: QueryTypes.SELECT }
  )) as Array<{ id?: string; user_id?: string; locked?: number | boolean }>;

  let refreshed = 0;
  let skippedLocked = 0;
  if (!rows.length) return { refreshed, skippedLocked };

  const { createOrRefreshAppraisal } = await import('./appraisalWorkflowService.js');
  for (const row of rows) {
    if (Number(row.locked) === 1 || row.locked === true) {
      skippedLocked += 1;
      continue;
    }
    const userId = String(row.user_id ?? '').trim();
    if (!userId) continue;
    try {
      await createOrRefreshAppraisal({
        userId,
        periodId,
        actorId: actorId ?? undefined,
      });
      refreshed += 1;
    } catch (err) {
      console.warn(
        `[appraisal] skip recalc for user ${userId} period ${periodId}:`,
        (err as Error)?.message || err
      );
    }
  }
  return { refreshed, skippedLocked };
}

export async function deleteAppraisalPeriod(
  id: string,
  performedBy?: string | null
): Promise<{ deletedAppraisals: number }> {
  const period = await getAppraisalPeriod(id);
  if (!period) {
    throw Object.assign(new Error('Appraisal period not found'), { status: 404 });
  }
  const snapshot = snapshotAppraisalPeriod(period);
  const { deletedAppraisals } = await revertAppraisalsForPeriod(id);

  await sequelize.query(`DELETE FROM appraisal_periods WHERE id = :id`, {
    replacements: { id },
  });
  await writeAppraisalPeriodAudit({
    action: 'DELETE',
    periodId: id,
    oldValue: {
      ...snapshot,
      reverted_appraisal_count: deletedAppraisals,
    },
    performedBy: performedBy ?? null,
  });
  return { deletedAppraisals };
}

export async function getAppraisalPeriod(id: string): Promise<AppraisalPeriodRow | null> {
  const rows = (await sequelize.query(
    `SELECT * FROM appraisal_periods WHERE id = :id LIMIT 1`,
    { replacements: { id }, type: QueryTypes.SELECT }
  )) as AppraisalPeriodRow[];
  return rows[0] ?? null;
}
