import { SystemSetting } from '../db.js';

export const KPI_POLICY_SETTING_KEY = 'performance.kpiPolicy';

export type KpiPolicySettings = {
  manualCommentThreshold: number;
};

export const DEFAULT_KPI_POLICY: KpiPolicySettings = {
  manualCommentThreshold: 60,
};

export async function loadKpiPolicySettings(): Promise<KpiPolicySettings> {
  const row: any = await SystemSetting.findOne({ where: { key: KPI_POLICY_SETTING_KEY } });
  if (!row?.value && row?.value !== 0) return { ...DEFAULT_KPI_POLICY };
  try {
    const raw = row.value;
    const parsed =
      typeof raw === 'string'
        ? JSON.parse(raw)
        : raw && typeof raw === 'object'
          ? raw
          : null;
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_KPI_POLICY };
    const threshold = Number((parsed as { manualCommentThreshold?: unknown }).manualCommentThreshold);
    return {
      manualCommentThreshold:
        Number.isFinite(threshold) && threshold >= 0 && threshold <= 100
          ? threshold
          : DEFAULT_KPI_POLICY.manualCommentThreshold,
    };
  } catch {
    return { ...DEFAULT_KPI_POLICY };
  }
}

export async function saveKpiPolicySettings(
  policy: KpiPolicySettings,
  performedBy?: string | null
): Promise<KpiPolicySettings> {
  const before = await loadKpiPolicySettings();
  const payload = {
    manualCommentThreshold: Math.max(0, Math.min(100, Number(policy.manualCommentThreshold) || 60)),
  };
  const existing = await SystemSetting.findOne({ where: { key: KPI_POLICY_SETTING_KEY } });
  if (existing) {
    await existing.update({ value: payload });
  } else {
    await SystemSetting.create({
      id: 'ss-performance-kpi-policy',
      key: KPI_POLICY_SETTING_KEY,
      value: payload,
      category: 'performance',
      description: 'KPI appraisal policy (comment threshold, etc.)',
      isPublic: false,
    });
  }
  const saved = await loadKpiPolicySettings();
  const { writeAppraisalConfigAudit } = await import('./appraisalConfigAuditService.js');
  await writeAppraisalConfigAudit({
    configKey: 'kpi_policy',
    oldValue: before,
    newValue: saved,
    performedBy,
  });
  return saved;
}

export async function validateManualScoreWithPolicy(
  score: number,
  comment?: string | null
): Promise<string | null> {
  const policy = await loadKpiPolicySettings();
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  if (s < policy.manualCommentThreshold && !(comment ?? '').trim()) {
    return `Comment is required when score is below ${policy.manualCommentThreshold}`;
  }
  return null;
}
