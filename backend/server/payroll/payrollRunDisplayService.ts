import { QueryTypes } from 'sequelize';
import { sequelize } from '../db.js';
import { isPayrollRunViewFrozen } from './payslipFreezePolicy.js';

/** When the run was last calculated (falls back to latest payslip or createdAt). */
export async function resolvePayrollRunCalculatedAt(
  run: Record<string, unknown>
): Promise<string | null> {
  const stored = run.calculatedAt ?? run.calculated_at;
  if (stored) return String(stored);

  const runId = String(run.id ?? '');
  if (!runId) return run.createdAt ? String(run.createdAt) : null;

  try {
    const rows = (await sequelize.query(
      `SELECT MAX(\`generatedAt\`) AS lastGenerated
       FROM payslips
       WHERE payrollRunId = :runId`,
      { replacements: { runId }, type: QueryTypes.SELECT }
    )) as Array<{ lastGenerated?: string | null }>;
    const fromPayslips = rows[0]?.lastGenerated ? String(rows[0].lastGenerated) : null;
    if (fromPayslips) return fromPayslips;
  } catch (err) {
    console.warn(
      '[payroll] Could not resolve calculatedAt from payslips:',
      (err as Error)?.message || err
    );
  }
  return run.createdAt ? String(run.createdAt) : null;
}

function runnerUserId(run: Record<string, unknown>): string | null {
  const id = String(run.calculatedBy ?? run.processedBy ?? '').trim();
  return id || null;
}

async function resolveRunnerNamesByUserId(
  userIds: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.map((id) => String(id).trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (!unique.length) return map;

  const { getUserDisplayName } = await import('../notificationService.js');
  await Promise.all(
    unique.map(async (id) => {
      try {
        const name = await getUserDisplayName(id);
        if (name) map.set(id, name);
      } catch {
        /* ignore */
      }
    })
  );
  return map;
}

export async function enrichPayrollRunPlain(
  run: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const calculatedAt = await resolvePayrollRunCalculatedAt(run);
  const readOnly = isPayrollRunViewFrozen(run.status);
  const calculatedBy = runnerUserId(run);
  let calculatedByName: string | null = null;
  if (calculatedBy) {
    const names = await resolveRunnerNamesByUserId([calculatedBy]);
    calculatedByName = names.get(calculatedBy) ?? null;
  }
  const base = {
    ...run,
    ...(calculatedAt ? { calculatedAt } : {}),
    calculatedBy: calculatedBy ?? run.calculatedBy ?? null,
    calculatedByName,
  };
  return readOnly ? { ...base, readOnly: true } : base;
}

export async function enrichPayrollRunsList(
  runs: Array<{ get?: (opts: { plain: true }) => Record<string, unknown> } & Record<string, unknown>>
): Promise<Record<string, unknown>[]> {
  if (!runs.length) return [];

  const plains = runs.map((r) => (r.get ? r.get({ plain: true }) : r));
  const needsPayslipLookup = plains.filter((p) => !p.calculatedAt && !p.calculated_at);
  const ids = needsPayslipLookup.map((p) => String(p.id)).filter(Boolean);

  const byRunId = new Map<string, string>();
  if (ids.length > 0) {
    try {
      // Raw SQL avoids Sequelize GROUP BY / ONLY_FULL_GROUP_BY quirks on MySQL 8.
      const rows = (await sequelize.query(
        `SELECT payrollRunId, MAX(\`generatedAt\`) AS lastGenerated
         FROM payslips
         WHERE payrollRunId IN (:ids)
         GROUP BY payrollRunId`,
        { replacements: { ids }, type: QueryTypes.SELECT }
      )) as Array<{ payrollRunId: string; lastGenerated: string | null }>;
      for (const row of rows) {
        if (row.lastGenerated) byRunId.set(String(row.payrollRunId), String(row.lastGenerated));
      }
    } catch (err) {
      console.warn(
        '[payroll] Payslip calculatedAt aggregate skipped:',
        (err as Error)?.message || err
      );
    }
  }

  const runnerIds = plains
    .map((plain) => runnerUserId(plain))
    .filter((id): id is string => Boolean(id));
  const namesById = await resolveRunnerNamesByUserId(runnerIds);

  return plains.map((plain) => {
    const calculatedAt =
      plain.calculatedAt ??
      plain.calculated_at ??
      byRunId.get(String(plain.id)) ??
      plain.createdAt;
    const calculatedBy = runnerUserId(plain);
    return {
      ...plain,
      ...(calculatedAt ? { calculatedAt: String(calculatedAt) } : {}),
      calculatedBy,
      calculatedByName: calculatedBy ? namesById.get(calculatedBy) ?? null : null,
    };
  });
}
