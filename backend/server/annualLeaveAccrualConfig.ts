import { SystemSetting } from './db.js';

export const ANNUAL_LEAVE_ACCRUAL_SETTING_KEY = 'AnnualLeaveAccrual';

export type JoinDateTier = {
  from: number;
  to: number;
  accrual: number;
};

export type AnnualLeaveAccrualConfig = {
  monthlyRate: number;
  joinDateTiers: JoinDateTier[];
  /** When true, block monthly AL accrual while employee is in probation. Default off. */
  blockAccrualDuringProbation: boolean;
};

export const DEFAULT_ANNUAL_LEAVE_ACCRUAL_CONFIG: AnnualLeaveAccrualConfig = {
  monthlyRate: 1.5,
  blockAccrualDuringProbation: false,
  joinDateTiers: [
    /** Join day 1–9 (and 0 if present) → 1.5 days */
    { from: 0, to: 9, accrual: 1.5 },
    { from: 10, to: 19, accrual: 1.0 },
    { from: 20, to: 31, accrual: 0.5 },
  ],
};

function parseTier(raw: Record<string, unknown>): JoinDateTier | null {
  const from = Number(raw.From ?? raw.from);
  const to = Number(raw.To ?? raw.to);
  const accrual = Number(raw.Accrual ?? raw.accrual);
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(accrual)) return null;
  return { from, to, accrual };
}

export function normalizeAnnualLeaveAccrualConfig(raw: unknown): AnnualLeaveAccrualConfig {
  const base = { ...DEFAULT_ANNUAL_LEAVE_ACCRUAL_CONFIG, joinDateTiers: [...DEFAULT_ANNUAL_LEAVE_ACCRUAL_CONFIG.joinDateTiers] };
  if (!raw || typeof raw !== 'object') return base;

  const obj = raw as Record<string, unknown>;
  const nested =
    obj.AnnualLeaveAccrual && typeof obj.AnnualLeaveAccrual === 'object'
      ? (obj.AnnualLeaveAccrual as Record<string, unknown>)
      : obj;

  const monthlyRate = Number(
    nested.MonthlyRate ?? nested.monthlyRate ?? base.monthlyRate
  );
  if (Number.isFinite(monthlyRate) && monthlyRate > 0) {
    base.monthlyRate = monthlyRate;
  }

  const blockProbation = nested.BlockAccrualDuringProbation ?? nested.blockAccrualDuringProbation;
  if (blockProbation === true || blockProbation === 'true' || blockProbation === 1) {
    base.blockAccrualDuringProbation = true;
  } else if (blockProbation === false || blockProbation === 'false' || blockProbation === 0) {
    base.blockAccrualDuringProbation = false;
  }

  const tiersRaw = nested.JoinDateTiers ?? nested.joinDateTiers;
  if (Array.isArray(tiersRaw) && tiersRaw.length > 0) {
    const tiers = tiersRaw
      .map((t) => (t && typeof t === 'object' ? parseTier(t as Record<string, unknown>) : null))
      .filter((t): t is JoinDateTier => t != null);
    if (tiers.length > 0) base.joinDateTiers = tiers;
  }

  return base;
}

export async function loadAnnualLeaveAccrualConfig(): Promise<AnnualLeaveAccrualConfig> {
  const row = await SystemSetting.findOne({ where: { key: ANNUAL_LEAVE_ACCRUAL_SETTING_KEY } });
  if (!row) return DEFAULT_ANNUAL_LEAVE_ACCRUAL_CONFIG;
  const value = row.get ? row.get('value') : (row as { value?: unknown }).value;
  return normalizeAnnualLeaveAccrualConfig(value);
}

export async function ensureAnnualLeaveAccrualConfigSetting(): Promise<void> {
  const existing = await SystemSetting.findOne({ where: { key: ANNUAL_LEAVE_ACCRUAL_SETTING_KEY } });
  if (existing) return;

  await SystemSetting.create({
    id: 'ss-annual-leave-accrual',
    key: ANNUAL_LEAVE_ACCRUAL_SETTING_KEY,
    value: {
      MonthlyRate: DEFAULT_ANNUAL_LEAVE_ACCRUAL_CONFIG.monthlyRate,
      JoinDateTiers: DEFAULT_ANNUAL_LEAVE_ACCRUAL_CONFIG.joinDateTiers.map((t) => ({
        From: t.from,
        To: t.to,
        Accrual: t.accrual,
      })),
    },
    category: 'leave',
    description: 'Cambodian annual leave accrual — monthly rate and first-month join-day tiers',
    isPublic: false,
  });
  console.log('[leave-accrual] Seeded AnnualLeaveAccrual system setting');
}

export function resolveTierLabel(joinDay: number, tiers: JoinDateTier[]): string {
  for (const tier of tiers) {
    if (joinDay >= tier.from && joinDay <= tier.to) {
      return `${tier.from}-${tier.to}`;
    }
  }
  return 'none';
}

export function firstMonthAccrualFromTiers(
  joinDay: number,
  tiers: JoinDateTier[]
): number {
  for (const tier of tiers) {
    if (joinDay >= tier.from && joinDay <= tier.to) {
      return tier.accrual;
    }
  }
  return 0;
}
