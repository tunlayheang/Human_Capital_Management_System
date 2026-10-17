import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export type UseUrlSyncedTabOptions<T extends string> = {
  /** Allowed tab ids. */
  values: readonly T[];
  /** Used when the URL has no valid tab. */
  defaultValue: T;
  /** Query param name. Defaults to `tab`. */
  param?: string;
  /**
   * When true (default), write the default tab into the URL if missing/invalid
   * so refresh keeps a stable address.
   */
  writeDefault?: boolean;
};

/**
 * Keeps an in-page tab selection in the URL so browser refresh (and workspace
 * tab restore) lands on the same section instead of the default.
 */
export function useUrlSyncedTab<T extends string>(
  options: UseUrlSyncedTabOptions<T>
): [T, (next: T) => void] {
  const { values, defaultValue, param = 'tab', writeDefault = true } = options;
  const [searchParams, setSearchParams] = useSearchParams();

  const allowed = useMemo(() => new Set<string>(values), [values]);

  const value = useMemo(() => {
    const raw = searchParams.get(param);
    if (raw && allowed.has(raw)) return raw as T;
    return defaultValue;
  }, [allowed, defaultValue, param, searchParams]);

  useEffect(() => {
    if (!writeDefault) return;
    const raw = searchParams.get(param);
    if (raw && allowed.has(raw)) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(param, defaultValue);
        return next;
      },
      { replace: true }
    );
  }, [allowed, defaultValue, param, searchParams, setSearchParams, writeDefault]);

  const setValue = useCallback(
    (next: T) => {
      if (!allowed.has(next)) return;
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set(param, next);
          return p;
        },
        { replace: true }
      );
    },
    [allowed, param, setSearchParams]
  );

  return [value, setValue];
}
