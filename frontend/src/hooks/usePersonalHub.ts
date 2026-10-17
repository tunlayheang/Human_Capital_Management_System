import { useCallback, useEffect, useState } from 'react';
import { Api } from '../services/api';
import type {
  PersonalHubAlert,
  PersonalHubNote,
  PersonalHubOverview,
  PersonalRequestItem,
  WorkRosterDay,
} from '../types/personalHub';

export function usePersonalHubOverview(targetUserId?: string) {
  const [data, setData] = useState<PersonalHubOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await Api.personalHub.getOverview(targetUserId);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [targetUserId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}

export function usePersonalNotes() {
  const [notes, setNotes] = useState<PersonalHubNote[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await Api.personalHub.listNotes();
      setNotes(res.notes ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { notes, loading, reload };
}

export function usePersonalAlerts() {
  const [alerts, setAlerts] = useState<PersonalHubAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const res = await Api.personalHub.listAlerts();
      setAlerts(res.alerts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reminders');
      setAlerts([]);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => {
      void reload({ silent: true });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  return { alerts, loading, error, reload };
}

export function useWorkRoster(month: string, targetUserId?: string) {
  const [days, setDays] = useState<WorkRosterDay[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await Api.personalHub.getWorkRoster(month, targetUserId);
      setDays(res.days ?? []);
    } finally {
      setLoading(false);
    }
  }, [month, targetUserId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { days, loading, reload };
}

export function usePersonalRequests(targetUserId?: string) {
  const [items, setItems] = useState<PersonalRequestItem[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await Api.personalHub.getRequests(targetUserId);
      setItems(res.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [targetUserId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, loading, reload };
}
