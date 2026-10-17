import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../services/api';

export type BackendHealth = {
  ok: boolean;
  database: 'connected' | 'disconnected' | 'unknown';
  loading: boolean;
};

export const useBackendHealth = (pollMs?: number): BackendHealth => {
  const intervalMs = pollMs ?? (import.meta.env.DEV ? 15_000 : 60_000);
  const [state, setState] = useState<BackendHealth>({
    ok: true,
    database: 'unknown',
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | undefined;

    const scheduleNext = (delayMs: number) => {
      if (cancelled) return;
      timerId = setTimeout(() => void check(), delayMs);
    };

    const check = async () => {
      let nextDelay = intervalMs;
      try {
        const controller = new AbortController();
        const abortTimer = setTimeout(() => controller.abort(), 8_000);
        const res = await fetch(`${API_BASE_URL}/health`, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });
        clearTimeout(abortTimer);
        const data = (await res.json().catch(() => ({}))) as {
          database?: string;
          status?: string;
        };
        const database =
          data.database === 'connected' || data.database === 'disconnected'
            ? data.database
            : res.ok
              ? 'connected'
              : 'disconnected';
        const ok = res.ok && database === 'connected';
        if (!cancelled) setState({ ok, database, loading: false });
        if (!ok && import.meta.env.DEV) {
          nextDelay = Math.min(intervalMs * 2, 30_000);
        }
      } catch {
        if (!cancelled) setState({ ok: false, database: 'disconnected', loading: false });
        if (import.meta.env.DEV) nextDelay = Math.min(intervalMs * 2, 30_000);
      }
      scheduleNext(nextDelay);
    };

    void check();
    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [intervalMs]);

  return state;
};
