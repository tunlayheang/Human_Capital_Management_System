export type AbsenceDeductionDayCounts = {
  unpaidLeaveDays: number;
  unexcusedAbsentDays: number;
  lateOccurrences: number;
};

/** Day counts for attendance deductions — sourced from attendance records only. */
export function resolveAbsenceDeductionDayCounts(params: {
  unpaidLeaveDaysParam: number;
  paidDaysDetail?: {
    unpaidLeaveDays?: number;
    absentDays?: number;
  } | null;
  lateOccurrences: number;
  rawAbsentRecordCount?: number;
}): AbsenceDeductionDayCounts {
  const unpaidLeaveDays = Math.max(
    0,
    Math.max(
      params.paidDaysDetail?.unpaidLeaveDays ?? 0,
      params.unpaidLeaveDaysParam ?? 0
    )
  );
  const unexcusedAbsentDays = Math.max(
    0,
    params.paidDaysDetail?.absentDays ?? params.rawAbsentRecordCount ?? 0
  );

  return {
    unpaidLeaveDays,
    unexcusedAbsentDays,
    lateOccurrences: Math.max(0, params.lateOccurrences),
  };
}

export function computeAbsenceDeductionUsd(params: {
  dailyRate: number;
  counts: AbsenceDeductionDayCounts;
  latePenaltyPerOccurrenceUsd: number;
  active: boolean;
}): {
  unpaidLeave: number;
  unexcusedAbsence: number;
  latePenalty: number;
  total: number;
} {
  if (!params.active || params.dailyRate <= 0) {
    return { unpaidLeave: 0, unexcusedAbsence: 0, latePenalty: 0, total: 0 };
  }
  const { dailyRate, counts, latePenaltyPerOccurrenceUsd } = params;
  const unpaidLeave =
    counts.unpaidLeaveDays > 0
      ? Math.round(dailyRate * counts.unpaidLeaveDays * 100) / 100
      : 0;
  const unexcusedAbsence =
    counts.unexcusedAbsentDays > 0
      ? Math.round(dailyRate * counts.unexcusedAbsentDays * 100) / 100
      : 0;
  const latePenalty =
    counts.lateOccurrences > 0 && latePenaltyPerOccurrenceUsd > 0
      ? Math.round(counts.lateOccurrences * latePenaltyPerOccurrenceUsd * 100) / 100
      : 0;
  return {
    unpaidLeave,
    unexcusedAbsence,
    latePenalty,
    total: Math.round((unpaidLeave + unexcusedAbsence + latePenalty) * 100) / 100,
  };
}
