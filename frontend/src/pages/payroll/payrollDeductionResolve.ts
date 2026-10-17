import type { SalaryBreakdown } from '../../types';
import { roundUsd } from './payrollBreakdownReconcile';

export type ResolvedDeductionsFromBreakdown = {
  nssf: number;
  taxOnSalary: number;
  absences: number;
  advances: number;
  total: number;
  unpaidLeave: number;
  unexcusedAbsence: number;
  latePenalty: number;
};

/** NSSF, tax, and attendance deductions — prefer stored breakdown, fall back to hybrid split. */
export function resolveDeductionsFromBreakdown(
  breakdown: SalaryBreakdown
): ResolvedDeductionsFromBreakdown {
  const d = breakdown.deductions ?? {
    nssf: 0,
    taxOnSalary: 0,
    absences: 0,
    advances: 0,
    total: 0,
  };
  const varDed = breakdown.hybrid?.variableDeductions;
  const unpaidLeave = Math.max(0, Number(varDed?.unpaidLeave ?? 0));
  const unexcusedAbsence = Math.max(0, Number(varDed?.unexcusedAbsence ?? 0));
  const latePenalty = Math.max(0, Number(varDed?.latePenalty ?? 0));
  const absenceFromParts = roundUsd(unpaidLeave + unexcusedAbsence + latePenalty);
  const absences =
    Number(d.absences) > 0 ? roundUsd(Number(d.absences)) : absenceFromParts;
  const nssf = roundUsd(Number(d.nssf ?? 0));
  const taxOnSalary = roundUsd(Number(d.taxOnSalary ?? 0));
  const advances = roundUsd(Number(d.advances ?? varDed?.advances ?? 0));
  const total = roundUsd(
    Number(d.total) > 0
      ? Number(d.total)
      : nssf + taxOnSalary + absences + advances
  );
  return {
    nssf,
    taxOnSalary,
    absences,
    advances,
    total,
    unpaidLeave,
    unexcusedAbsence,
    latePenalty,
  };
}
