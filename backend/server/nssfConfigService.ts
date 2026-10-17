import { SystemSetting } from './db.js';

export const NSSF_CONFIG_SETTING_KEY = 'payroll.nssf_config';

export type NssfConfigPayload = {
  id: string;
  employeeRate: number;
  employerRate: number;
  capAmount: number;
  currency: string;
  isActive: boolean;
  effectiveFrom?: string | null;
};

const DEFAULT_NSSF: NssfConfigPayload = {
  id: 'nssf-1',
  employeeRate: 4,
  employerRate: 4,
  capAmount: 1300000,
  currency: 'KHR',
  isActive: true,
};

function normalize(raw: unknown): NssfConfigPayload {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    id: String(row.id ?? DEFAULT_NSSF.id),
    employeeRate: Number(row.employeeRate ?? DEFAULT_NSSF.employeeRate),
    employerRate: Number(row.employerRate ?? DEFAULT_NSSF.employerRate),
    capAmount: Number(row.capAmount ?? DEFAULT_NSSF.capAmount),
    currency: String(row.currency ?? DEFAULT_NSSF.currency),
    isActive: row.isActive !== false,
    effectiveFrom: row.effectiveFrom != null ? String(row.effectiveFrom) : null,
  };
}

export async function getActiveNssfConfig(): Promise<NssfConfigPayload> {
  const row: any = await SystemSetting.findOne({ where: { key: NSSF_CONFIG_SETTING_KEY } });
  if (!row?.value) return { ...DEFAULT_NSSF };
  const value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
  return normalize(value);
}

export async function ensureDefaultNssfConfigSetting(): Promise<void> {
  const existing = await SystemSetting.findOne({ where: { key: NSSF_CONFIG_SETTING_KEY } });
  if (existing) return;
  await SystemSetting.create({
    id: 'ss-nssf-config',
    key: NSSF_CONFIG_SETTING_KEY,
    value: DEFAULT_NSSF,
    category: 'payroll',
    description: 'NSSF contribution rates and cap (merged from nssfconfigs table)',
  } as never);
}
