import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useWorkspaceTabId } from './useWorkspaceTabId';
import {
  readWorkspaceTabState,
  writeWorkspaceTabState,
} from '../utils/workspaceTabStateStore';

type CachedEnvelope<T> = {
  data: T;
  savedAt?: number;
};

/** Skip background re-fetch when revisiting a tab within this window (reduces API burst / 429 risk). */
export const WORKSPACE_TAB_REVALIDATE_MS = 30_000;

export type WorkspaceTabCacheControls = {
  /** Returns true once per tab revisit when snapshot was restored; clears the flag. */
  consumeRestored: () => boolean;
  persistNow: () => void;
  /** Whether cached data was applied on this mount (before consumeRestored). */
  isRestored: () => boolean;
  /** Milliseconds since cache was last saved; null if unknown. */
  getCacheAgeMs: () => number | null;
};

function unwrapCachedData<T>(raw: CachedEnvelope<T> | T | undefined): {
  data: T | undefined;
  savedAt: number | undefined;
} {
  if (raw == null) return { data: undefined, savedAt: undefined };
  if (typeof raw === 'object' && 'data' in (raw as object)) {
    const envelope = raw as CachedEnvelope<T>;
    return { data: envelope.data, savedAt: envelope.savedAt };
  }
  return { data: raw as T, savedAt: undefined };
}

export function useWorkspaceTabCache<T>(options: {
  slot: string;
  /** @deprecated Ignored for restore; only used as a persist dependency label. */
  cacheKey?: string;
  getSnapshot: () => T;
  applySnapshot: (data: T) => void;
  shouldPersist?: (data: T) => boolean;
  persistDeps?: readonly unknown[];
}): WorkspaceTabCacheControls {
  const {
    slot,
    cacheKey = 'default',
    getSnapshot,
    applySnapshot,
    shouldPersist = () => true,
    persistDeps = [],
  } = options;

  const tabId = useWorkspaceTabId();
  const restoredRef = useRef(false);
  const restoredForMountRef = useRef(false);
  const savedAtRef = useRef<number | null>(null);

  const applySnapshotRef = useRef(applySnapshot);
  applySnapshotRef.current = applySnapshot;

  const getSnapshotRef = useRef(getSnapshot);
  getSnapshotRef.current = getSnapshot;

  const shouldPersistRef = useRef(shouldPersist);
  shouldPersistRef.current = shouldPersist;

  useLayoutEffect(() => {
    restoredForMountRef.current = false;
  }, [tabId, slot]);

  useLayoutEffect(() => {
    if (restoredForMountRef.current) return;
    restoredForMountRef.current = true;

    const raw = readWorkspaceTabState<CachedEnvelope<T> | T>(tabId, slot);
    const { data, savedAt } = unwrapCachedData(raw);
    if (data != null) {
      applySnapshotRef.current(data);
      restoredRef.current = true;
      savedAtRef.current = savedAt ?? Date.now();
    } else {
      restoredRef.current = false;
      savedAtRef.current = null;
    }
  }, [tabId, slot]);

  const persistNow = useCallback(() => {
    const data = getSnapshotRef.current();
    if (!shouldPersistRef.current(data)) return;
    const savedAt = Date.now();
    savedAtRef.current = savedAt;
    writeWorkspaceTabState<CachedEnvelope<T>>(tabId, slot, { data, savedAt });
  }, [tabId, slot]);

  useEffect(() => {
    persistNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistNow, tabId, cacheKey, ...persistDeps]);

  useEffect(() => {
    return () => {
      persistNow();
    };
  }, [persistNow]);

  const consumeRestored = useCallback(() => {
    const was = restoredRef.current;
    restoredRef.current = false;
    return was;
  }, []);

  const isRestored = useCallback(() => restoredRef.current, []);

  const getCacheAgeMs = useCallback(() => {
    if (savedAtRef.current != null) return Date.now() - savedAtRef.current;
    const raw = readWorkspaceTabState<CachedEnvelope<T> | T>(tabId, slot);
    const { savedAt } = unwrapCachedData(raw);
    if (savedAt == null) return null;
    return Date.now() - savedAt;
  }, [tabId, slot]);

  return useMemo(
    () => ({ consumeRestored, persistNow, isRestored, getCacheAgeMs }),
    [consumeRestored, persistNow, isRestored, getCacheAgeMs]
  );
}

/** Peek cached data for a tab slot (e.g. to skip initial loading state). */
export function peekWorkspaceTabCache<T>(tabId: string, slot: string): T | undefined {
  const raw = readWorkspaceTabState<CachedEnvelope<T> | T>(tabId, slot);
  return unwrapCachedData(raw).data;
}

/** Module-level cache surviving route remounts within the same browser session. */
export function createWorkspaceShellCache<T>() {
  let value: T | null = null;
  return {
    get: (): T | null => value,
    set: (next: T) => {
      value = next;
    },
    has: () => value != null,
    clear: () => {
      value = null;
    },
  };
}

export type WorkspaceLoadOptions = { background?: boolean };

/**
 * Run a data load on mount / dep change.
 * First run after a cache restore uses background mode (no loading flash).
 * Fresh restores (< revalidateMs) skip the network call entirely.
 * Later dep changes (e.g. filter change) always do a full reload.
 */
export function useWorkspaceTabMountLoad(
  load: (opts: WorkspaceLoadOptions) => void | Promise<void>,
  deps: readonly unknown[],
  cache: WorkspaceTabCacheControls,
  gate = true,
  revalidateMs = WORKSPACE_TAB_REVALIDATE_MS
): void {
  const initialLoadDoneRef = useRef(false);

  useEffect(() => {
    if (!gate) return;

    if (!initialLoadDoneRef.current) {
      initialLoadDoneRef.current = true;

      const restored = cache.isRestored();
      const ageMs = cache.getCacheAgeMs();
      if (restored && ageMs != null && ageMs < revalidateMs) {
        cache.consumeRestored();
        return;
      }

      const background = cache.consumeRestored();
      void load({ background });
      return;
    }

    void load({ background: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
