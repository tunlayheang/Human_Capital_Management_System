import { useCallback, useEffect, useState } from 'react';
import { Api } from '../services/api';
import type { PersonalAnalyticsPayload, PersonalAnalyticsPreset } from '../types/personalAnalytics';
import {
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from './useWorkspaceTabCache';

export type PersonalAnalyticsFilter = {
  preset: PersonalAnalyticsPreset;
  startDate?: string;
  endDate?: string;
  userId?: string;
};

export function usePersonalAnalytics(filter: PersonalAnalyticsFilter) {
  const [data, setData] = useState<PersonalAnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cacheKey = [filter.preset, filter.startDate, filter.endDate, filter.userId].join('|');
  const tabCache = useWorkspaceTabCache<{ data: PersonalAnalyticsPayload | null }>({
    slot: 'personal-analytics-v1',
    cacheKey,
    getSnapshot: () => ({ data }),
    applySnapshot: (cached) => {
      setData(cached.data);
      setLoading(false);
      setError(null);
    },
    shouldPersist: (cached) => cached.data != null,
    persistDeps: [data, cacheKey],
  });

  const load = useCallback(async (opts?: WorkspaceLoadOptions) => {
    if (!opts?.background) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = (await Api.analytics.getPersonal({
        preset: filter.preset,
        startDate: filter.startDate,
        endDate: filter.endDate,
        userId: filter.userId,
      })) as PersonalAnalyticsPayload;
      setData(res);
    } catch (e) {
      if (!opts?.background) {
        setData(null);
        setError(e instanceof Error ? e.message : 'Failed to load analytics');
      }
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, [filter.preset, filter.startDate, filter.endDate, filter.userId]);

  useWorkspaceTabMountLoad(load, [load, cacheKey], tabCache);

  return { data, loading, error, reload: load };
}
