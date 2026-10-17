import { SystemSetting } from '../db.js';
import type { SeparationType } from './separationTypes.js';

export type AbandonmentPolicyConfig = {
  consecutiveAbsenceThresholds: number[];
  defaultThreshold: number;
  payrollGroupOverrides: Record<string, { thresholds: number[] }>;
  noNoticePenaltyUsd: number;
  abscondedAssetPenaltyDefaultUsd: number;
  notifyRoles: string[];
  autoFlagEnabled: boolean;
};

const DEFAULT_POLICY: AbandonmentPolicyConfig = {
  consecutiveAbsenceThresholds: [3, 5, 7],
  defaultThreshold: 3,
  payrollGroupOverrides: {},
  noNoticePenaltyUsd: 0,
  abscondedAssetPenaltyDefaultUsd: 0,
  notifyRoles: ['HR', 'ADMIN'],
  autoFlagEnabled: true,
};

export async function getAbandonmentPolicy(): Promise<AbandonmentPolicyConfig> {
  const row = await SystemSetting.findOne({ where: { key: 'hr.abandonment.policy' } });
  if (!row) return DEFAULT_POLICY;
  let raw = row.get('value');
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return DEFAULT_POLICY;
    }
  }
  if (!raw || typeof raw !== 'object') return DEFAULT_POLICY;
  const o = raw as Record<string, unknown>;
  const thresholds = Array.isArray(o.consecutiveAbsenceThresholds)
    ? o.consecutiveAbsenceThresholds.map((n) => Number(n)).filter((n) => n > 0)
    : DEFAULT_POLICY.consecutiveAbsenceThresholds;
  return {
    consecutiveAbsenceThresholds: thresholds.length ? thresholds : DEFAULT_POLICY.consecutiveAbsenceThresholds,
    defaultThreshold: Number(o.defaultThreshold) > 0 ? Number(o.defaultThreshold) : DEFAULT_POLICY.defaultThreshold,
    payrollGroupOverrides:
      o.payrollGroupOverrides && typeof o.payrollGroupOverrides === 'object'
        ? (o.payrollGroupOverrides as Record<string, { thresholds: number[] }>)
        : {},
    noNoticePenaltyUsd: Number(o.noNoticePenaltyUsd) || 0,
    abscondedAssetPenaltyDefaultUsd: Number(o.abscondedAssetPenaltyDefaultUsd) || 0,
    notifyRoles: Array.isArray(o.notifyRoles)
      ? o.notifyRoles.map(String)
      : DEFAULT_POLICY.notifyRoles,
    autoFlagEnabled: o.autoFlagEnabled !== false,
  };
}

export function thresholdForGroup(
  policy: AbandonmentPolicyConfig,
  payrollGroupId = 'default'
): number {
  const override = policy.payrollGroupOverrides[payrollGroupId];
  if (override?.thresholds?.length) return Math.min(...override.thresholds);
  return policy.defaultThreshold;
}

export function defaultPenaltyForSeparation(
  policy: AbandonmentPolicyConfig,
  separationType: SeparationType
): number {
  if (separationType === 'resignation_without_notice') return policy.noNoticePenaltyUsd;
  if (separationType === 'absconded') return policy.abscondedAssetPenaltyDefaultUsd;
  return 0;
}

const POLICY_SETTING_KEY = 'hr.abandonment.policy';

export async function updateAbandonmentPolicy(
  patch: Partial<Pick<AbandonmentPolicyConfig, 'defaultThreshold' | 'autoFlagEnabled'>>
): Promise<AbandonmentPolicyConfig> {
  const current = await getAbandonmentPolicy();
  const next: AbandonmentPolicyConfig = { ...current };

  if (patch.defaultThreshold !== undefined) {
    const n = Math.floor(Number(patch.defaultThreshold));
    if (!Number.isFinite(n) || n < 1 || n > 90) {
      const err = new Error('Absence rule must be between 1 and 90 days.') as Error & {
        statusCode?: number;
      };
      err.statusCode = 400;
      throw err;
    }
    next.defaultThreshold = n;
    const tiers = [...next.consecutiveAbsenceThresholds].filter((t) => t > 0);
    if (!tiers.includes(n)) tiers.unshift(n);
    next.consecutiveAbsenceThresholds = [...new Set(tiers)].sort((a, b) => a - b);
  }

  if (patch.autoFlagEnabled !== undefined) {
    next.autoFlagEnabled = Boolean(patch.autoFlagEnabled);
  }

  await SystemSetting.upsert({
    key: POLICY_SETTING_KEY,
    value: next,
    category: 'hr',
    description: 'Abandonment and absconded HR policy',
    isPublic: false,
  });

  return next;
}
