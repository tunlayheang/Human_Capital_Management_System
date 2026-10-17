import { useCallback, useEffect, useRef, useState } from 'react';
import { Api } from '../services/api';
import { createWorkspaceShellCache } from './useWorkspaceTabCache';
import {
  formatRangeLabel,
  loadStoredDashboardRange,
  type DashboardDateRangeValue,
} from '../utils/dashboardDateRange';

export type OrganizationAnalyticsCharts = {
  monthlyAttendanceRate?: Array<{
    month: string;
    attendanceRatePct: number;
    present: number;
    absent: number;
    late: number;
  }>;
  monthlyLateTrend?: Array<{ month: string; late: number }>;
  monthlyLeaveUsage?: Array<{ month: string; days: number }>;
  monthlyOvertimeHours?: Array<{ month: string; hours: number }>;
  monthlySeparations?: Array<{ month: string; count: number }>;
  departmentAttendanceRates?: Array<{
    name: string;
    ratePct: number;
    present: number;
    absent: number;
  }>;
};

export type OrganizationAnalyticsPayload = {
  period?: { startDate: string; endDate: string; label?: string };
  charts?: OrganizationAnalyticsCharts;
};

type OrgAnalyticsShell = {
  range: DashboardDateRangeValue;
  data: OrganizationAnalyticsPayload | null;
};

const orgAnalyticsShellCache = createWorkspaceShellCache<OrgAnalyticsShell>();

function rangeKey(range: DashboardDateRangeValue) {
  return `${range.startDate}|${range.endDate}`;
}

export function useOrganizationAnalytics(enabled: boolean) {
  const cached = orgAnalyticsShellCache.get();
  const [range, setRange] = useState<DashboardDateRangeValue>(
    () => cached?.range ?? loadStoredDashboardRange()
  );
  const [data, setData] = useState<OrganizationAnalyticsPayload | null>(
    () => cached?.data ?? null
  );
  const [loading, setLoading] = useState(() => enabled && !cached?.data);
  const dataRef = useRef(data);
  dataRef.current = data;

  const reload = useCallback(async (opts?: { background?: boolean }) => {
    if (!enabled) return;
    const background = opts?.background ?? dataRef.current != null;
    if (!background) setLoading(true);
    try {
      const res = (await Api.reports.getAnalytics({
        startDate: range.startDate,
        endDate: range.endDate,
      })) as OrganizationAnalyticsPayload;
      const next = res ?? null;
      setData(next);
      orgAnalyticsShellCache.set({ range, data: next });
    } catch {
      if (!background) setData(null);
    } finally {
      if (!background) setLoading(false);
    }
  }, [enabled, range.startDate, range.endDate, range]);

  useEffect(() => {
    if (!enabled) return;
    const shell = orgAnalyticsShellCache.get();
    const hasFresh =
      shell?.data != null && rangeKey(shell.range) === rangeKey(range);
    if (hasFresh) {
      setData(shell.data);
      setLoading(false);
    }
    void reload({ background: hasFresh || dataRef.current != null });
  }, [enabled, range.startDate, range.endDate, reload]);

  return {
    range,
    setRange,
    charts: data?.charts ?? null,
    periodLabel: data?.period?.label ?? formatRangeLabel(range.startDate, range.endDate),
    loading,
    reload: () => reload({ background: false }),
  };
}
