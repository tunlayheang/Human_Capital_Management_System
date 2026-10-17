import { useCallback, useEffect, useRef, useState } from 'react';
import { Api } from '../services/api';
import { createWorkspaceShellCache } from './useWorkspaceTabCache';
import {
  formatRangeLabel,
  loadStoredDashboardRange,
  type DashboardDateRangeValue,
} from '../utils/dashboardDateRange';

export type DashboardAnalyticsPayload = {
  period?: { startDate: string; endDate: string; label?: string };
  stats?: Record<string, unknown>;
  charts?: Record<string, unknown>;
};

function queryParams(range: DashboardDateRangeValue) {
  return { startDate: range.startDate, endDate: range.endDate };
}

type DashboardShell = {
  range: DashboardDateRangeValue;
  data: DashboardAnalyticsPayload | null;
};

type ManagerDashboardShell = {
  range: DashboardDateRangeValue;
  teamStats: Record<string, unknown> | null;
};

const dashboardShellCache = createWorkspaceShellCache<DashboardShell>();
const managerDashboardShellCache = createWorkspaceShellCache<ManagerDashboardShell>();

function rangeKey(range: DashboardDateRangeValue) {
  return `${range.startDate}|${range.endDate}`;
}

export function useDashboardReport(enabled: boolean) {
  const cached = dashboardShellCache.get();
  const [range, setRange] = useState<DashboardDateRangeValue>(
    () => cached?.range ?? loadStoredDashboardRange()
  );
  const [data, setData] = useState<DashboardAnalyticsPayload | null>(
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
      const res = (await Api.dashboard.getAnalytics(queryParams(range))) as DashboardAnalyticsPayload;
      const next = res ?? null;
      setData(next);
      dashboardShellCache.set({ range, data: next });
    } catch {
      if (!background) setData(null);
    } finally {
      if (!background) setLoading(false);
    }
  }, [enabled, range.startDate, range.endDate, range]);

  useEffect(() => {
    if (!enabled) return;
    const shell = dashboardShellCache.get();
    const hasFresh =
      shell?.data != null && rangeKey(shell.range) === rangeKey(range);
    if (hasFresh) {
      setData(shell.data);
      setLoading(false);
    }
    void reload({ background: hasFresh || dataRef.current != null });
  }, [enabled, range.startDate, range.endDate, reload]);

  const stats = data?.stats ?? null;
  const charts = data?.charts ?? null;
  const periodLabel = data?.period?.label;

  return {
    range,
    setRange,
    stats,
    charts,
    periodLabel,
    loading,
    reload: () => reload({ background: false }),
  };
}

export function useManagerDashboardReport(enabled: boolean) {
  const cached = managerDashboardShellCache.get();
  const [range, setRange] = useState<DashboardDateRangeValue>(
    () => cached?.range ?? loadStoredDashboardRange()
  );
  const [teamStats, setTeamStats] = useState<Record<string, unknown> | null>(
    () => cached?.teamStats ?? null
  );
  const [loading, setLoading] = useState(() => enabled && !cached?.teamStats);
  const teamStatsRef = useRef(teamStats);
  teamStatsRef.current = teamStats;

  const reload = useCallback(async (opts?: { background?: boolean }) => {
    if (!enabled) return;
    const background = opts?.background ?? teamStatsRef.current != null;
    if (!background) setLoading(true);
    try {
      const res = (await Api.dashboard.getTeamStats(queryParams(range))) as Record<string, unknown>;
      const next = res ?? null;
      setTeamStats(next);
      managerDashboardShellCache.set({ range, teamStats: next });
    } catch {
      if (!background) setTeamStats(null);
    } finally {
      if (!background) setLoading(false);
    }
  }, [enabled, range.startDate, range.endDate, range]);

  useEffect(() => {
    if (!enabled) return;
    const shell = managerDashboardShellCache.get();
    const hasFresh =
      shell?.teamStats != null && rangeKey(shell.range) === rangeKey(range);
    if (hasFresh) {
      setTeamStats(shell.teamStats);
      setLoading(false);
    }
    void reload({ background: hasFresh || teamStatsRef.current != null });
  }, [enabled, range.startDate, range.endDate, reload]);

  const periodLabel =
    teamStats?.period && typeof teamStats.period === 'object'
      ? formatRangeLabel(
          String((teamStats.period as { startDate?: string }).startDate ?? range.startDate),
          String((teamStats.period as { endDate?: string }).endDate ?? range.endDate)
        )
      : undefined;

  return {
    range,
    setRange,
    teamStats,
    periodLabel,
    loading,
    reload: () => reload({ background: false }),
  };
}
