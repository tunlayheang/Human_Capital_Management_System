export type PersonalAnalyticsPreset =
  | 'current_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'current_year'
  | 'custom';

export type TrendDirection =
  | 'improved'
  | 'stable'
  | 'declined'
  | 'increasing'
  | 'decreasing';

export type PersonalAnalyticsPayload = {
  userId: string;
  readOnly: boolean;
  range: {
    preset: PersonalAnalyticsPreset;
    startDate: string;
    endDate: string;
    label: string;
  };
  summary: {
    attendanceRatePct: number;
    leaveBalanceDays: number | null;
    otHours: number;
    kpiGrade: string | null;
    trends: {
      attendance: TrendDirection;
      overtime: TrendDirection;
    };
  };
  attendance: {
    summary: {
      workingDays: number;
      presentDays: number;
      absentDays: number;
      lateDays: number;
      earlyDepartures: number;
      attendanceRatePct: number;
      punctualityRatePct: number;
    };
    trends: Record<string, TrendDirection>;
    monthlyTrend: Array<{
      month: string;
      present: number;
      absent: number;
      late: number;
      attendanceRatePct: number;
    }>;
    lateTrend: Array<{ month: string; late: number }>;
  };
  leave: {
    balances: {
      annualRemaining: number | null;
      annualUsed: number;
      sickUsed: number;
      unpaidUsed: number;
      otherUsed: number;
    };
    distribution: Array<{ name: string; value: number }>;
    monthlyUsage: Array<{ month: string; days: number }>;
    insights: string[];
  };
  overtime: {
    totalHours: number;
    averageMonthlyHours: number;
    approvedHours: number;
    compensationEstimateUsd: number;
    monthlyTrend: Array<{ month: string; hours: number }>;
    trend: TrendDirection;
  };
  kpi: {
    currentGrade: string | null;
    performanceScorePct: number | null;
    departmentAveragePct: number | null;
    companyAveragePct: number | null;
    history: Array<{ period: string; grade: string; scorePct: number; numeric: number }>;
    gradeDistribution: Array<{ grade: string; count: number }>;
    categoryBreakdown: Array<{ key: string; label: string; scorePct: number | null }>;
    strengthAreas?: string[];
    improvementAreas?: string[];
    rankingPosition?: number | null;
    insights: string[];
  };
};
