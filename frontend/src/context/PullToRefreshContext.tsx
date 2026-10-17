import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type PullRefreshHandler = () => void | Promise<void>;

type PullToRefreshContextValue = {
  /** Register a page refresh handler; returns unregister. */
  register: (handler: PullRefreshHandler) => () => void;
  /** Run all registered handlers (used by Layout gesture). */
  runRefresh: () => Promise<void>;
  refreshing: boolean;
  /** True when at least one page registered a handler. */
  hasHandler: boolean;
};

const PullToRefreshContext = createContext<PullToRefreshContextValue | null>(null);

export const PullToRefreshProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const handlersRef = useRef(new Set<PullRefreshHandler>());
  const [handlerCount, setHandlerCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const register = useCallback((handler: PullRefreshHandler) => {
    handlersRef.current.add(handler);
    setHandlerCount(handlersRef.current.size);
    return () => {
      handlersRef.current.delete(handler);
      setHandlerCount(handlersRef.current.size);
    };
  }, []);

  const runRefresh = useCallback(async () => {
    if (refreshing) return;
    const handlers = [...handlersRef.current];
    setRefreshing(true);
    try {
      if (handlers.length === 0) {
        // Soft fallback: bust GET cache so the next mounts/fetches see fresh data.
        try {
          const { invalidateApiCache } = await import('../services/apiCache');
          invalidateApiCache();
        } catch {
          /* ignore */
        }
        await new Promise((r) => setTimeout(r, 450));
        return;
      }
      await Promise.all(
        handlers.map(async (h) => {
          try {
            await h();
          } catch {
            /* page handles its own errors */
          }
        })
      );
    } finally {
      setRefreshing(false);
    }
  }, [refreshing]);

  const value = useMemo(
    () => ({
      register,
      runRefresh,
      refreshing,
      hasHandler: handlerCount > 0,
    }),
    [register, runRefresh, refreshing, handlerCount]
  );

  return (
    <PullToRefreshContext.Provider value={value}>{children}</PullToRefreshContext.Provider>
  );
};

export function usePullToRefreshRegistry(): PullToRefreshContextValue {
  const ctx = useContext(PullToRefreshContext);
  if (!ctx) {
    throw new Error('usePullToRefreshRegistry must be used within PullToRefreshProvider');
  }
  return ctx;
}

/** Opt-in: list/dashboard pages register so pull-to-refresh reloads their data. */
export function useRegisterPullToRefresh(handler: PullRefreshHandler | null | undefined): void {
  const ctx = useContext(PullToRefreshContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const enabled = Boolean(handler);

  useEffect(() => {
    if (!ctx || !enabled) return;
    const wrapped: PullRefreshHandler = () => handlerRef.current?.();
    return ctx.register(wrapped);
  }, [ctx, enabled]);
}
