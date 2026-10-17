import type { PayrollOverlapView } from '../components/payroll/PayrollOverlapBanner';
import {
  buildSettlementCalculationContext,
  type SettlementCalculationContext,
} from '../payroll/settlementCalculationDetail';
import { parseSettlementLines } from '../payroll/settlementPayStatement';

/** Stored in `clearanceJson` — offboard wizard metadata and optional settlement notes. */
export type SettlementClearanceJson = {
  _offboardMeta?: {
    offboardType?: 'terminate' | 'resign';
    offboardReason?: string;
    resignationSubmittedAt?: string;
    resignationApprovedAt?: string;
    offboardedBy?: string;
    source?: 'wizard';
  };
  notes?: string;
  deductionUsd?: number;
};

export function parseClearanceJson(raw: unknown): SettlementClearanceJson {
  if (!raw) return {};
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!o || typeof o !== 'object') return {};
    const parsed = o as Record<string, unknown>;
    const meta = parsed._offboardMeta;
    return {
      ...(parsed.notes != null ? { notes: String(parsed.notes) } : {}),
      ...(parsed.deductionUsd != null ? { deductionUsd: Number(parsed.deductionUsd) } : {}),
      ...(meta && typeof meta === 'object'
        ? { _offboardMeta: meta as SettlementClearanceJson['_offboardMeta'] }
        : {}),
    };
  } catch {
    return {};
  }
}

/** True for wizard Pay/No-pay settlements (not the legacy multi-stage approval path). */
export function isSimplifiedOffboardingSettlement(row?: {
  clearanceJson?: unknown;
  breakdown?: unknown;
  breakdownSnapshotJson?: unknown;
} | null): boolean {
  if (!row) return false;
  const rawClearance = row.clearanceJson;
  if (rawClearance) {
    try {
      const parsed =
        typeof rawClearance === 'string'
          ? (JSON.parse(rawClearance) as Record<string, unknown>)
          : (rawClearance as Record<string, unknown>);
      const meta = parsed?._offboardMeta as { source?: string; offboardReason?: string } | undefined;
      if (meta?.source === 'wizard' || Boolean(meta?.offboardReason?.trim())) return true;
    } catch {
      /* ignore */
    }
  }
  const rawBreakdown = row.breakdown ?? row.breakdownSnapshotJson;
  if (!rawBreakdown) return false;
  try {
    const parsed =
      typeof rawBreakdown === 'string'
        ? (JSON.parse(rawBreakdown) as Record<string, unknown>)
        : (rawBreakdown as Record<string, unknown>);
    return Boolean(parsed && parsed.simplified === true);
  } catch {
    return false;
  }
}

/** Statuses where wizard Pay / No-pay can still be chosen. */
export const SIMPLIFIED_PRE_PAYMENT_STATUSES = new Set([
  'DRAFT',
  'HR_REVIEW',
  'FINANCE_REVIEW',
  'MANAGEMENT_APPROVAL',
  'APPROVED',
  'PENDING_REMOVAL_APPROVAL',
]);

export function formatUsd(n: unknown): string {
  return `$${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export { formatDisplayDate, formatDateOnlyDisplay } from '../utils/formatDisplayDate';

/** Restore leave / loan fields from saved settlement line items. */
export function settlementLinesToFormAmounts(raw: unknown): {
  leaveEncashment: string;
  loanDeduction: string;
} {
  const lines = parseSettlementLines(raw);
  let leaveUsd = 0;
  let loanUsd = 0;
  let hasLeave = false;
  let hasLoan = false;
  for (const line of lines) {
    const code = String(line.code ?? '').toUpperCase();
    const amt = Number(line.amountUsd ?? 0);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    if (code === 'LEAVE_ENCASH') {
      leaveUsd += amt;
      hasLeave = true;
    } else if (code === 'CLEARANCE_DED') {
      loanUsd += amt;
      hasLoan = true;
    }
  }
  return {
    leaveEncashment: hasLeave ? String(leaveUsd) : '0',
    loanDeduction: hasLoan ? String(loanUsd) : '0',
  };
}

export function buildFormPayload(
  employeeId: string,
  lastWorkingDate: string,
  finalSettlementDate: string,
  leaveEncashment: string,
  loanDeduction: string,
  notes: string,
  clearance: SettlementClearanceJson = {}
): Record<string, unknown> {
  return {
    employeeId: employeeId.trim(),
    lastWorkingDate,
    finalSettlementDate: finalSettlementDate || lastWorkingDate,
    clearance,
    leaveEncashmentUsd: parseFloat(leaveEncashment) || 0,
    loanSettlementUsd: parseFloat(loanDeduction) || 0,
    notes: notes.trim() || undefined,
  };
}

export type SettlementRow = Record<string, unknown> & {
  id: string;
  employeeId: string;
  employeeName?: string;
  month?: string;
  lastWorkingDate?: string;
  finalSettlementDate?: string;
  netUsd?: number;
  recommendedPayUsd?: number;
  status?: string;
  clearanceJson?: unknown;
  notes?: string;
  payrollOverlap?: PayrollOverlapView;
  breakdown?: unknown;
  breakdownSnapshotJson?: unknown;
  settlementLines?: unknown;
  settlementLinesJson?: unknown;
  managementApprovedBy?: string | null;
  payslipId?: string | null;
};

export function settlementCalculationFromRow(
  row: SettlementRow | null | undefined
): SettlementCalculationContext | null {
  if (!row) return null;
  return buildSettlementCalculationContext({
    lastWorkingDate: row.lastWorkingDate,
    month: row.month,
    netUsd: row.netUsd,
    breakdown: row.breakdown ?? row.breakdownSnapshotJson,
    settlementLines: row.settlementLines ?? row.settlementLinesJson,
  });
}

export function settlementCalculationFromPreview(
  preview: Record<string, unknown> | null | undefined
): SettlementCalculationContext | null {
  if (!preview) return null;
  const emp = preview.employee as Record<string, unknown> | undefined;
  return buildSettlementCalculationContext({
    lastWorkingDate: preview.lastWorkingDate as string,
    month: preview.month as string,
    netUsd: preview.netUsd as number,
    breakdown: preview.breakdown,
    settlementLines: preview.settlementLines,
    prorationFactor: (preview.breakdown as { hybrid?: { fixed?: { prorationFactor?: number } } })
      ?.hybrid?.fixed?.prorationFactor,
    joinDate: (emp?.join_date ?? emp?.joinDate) as string | undefined,
  });
}

export type EligibilityPrefill = {
  eligible: boolean;
  employeeId: string;
  employeeName: string;
  employeeStatus: string;
  offboardLabel: string;
  suggestedLastWorkingDate: string | null;
  offboardingAbsenceDays: number;
  existingDraft: { id?: string } | null;
  hasBlockingSettlement: boolean;
};
