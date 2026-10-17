import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Api } from '../services/api';
import {
  DEFAULT_PORTAL_PASSWORD_POLICY,
  getPortalPasswordPolicy,
  normalizePortalPasswordPolicy,
  setPortalPasswordPolicy,
  subscribePortalPasswordPolicy,
  type PortalPasswordPolicy,
} from '../utils/passwordPolicy';

let loadPromise: Promise<PortalPasswordPolicy> | null = null;

export async function refreshPortalPasswordPolicy(): Promise<PortalPasswordPolicy> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const res = await Api.auth.getPasswordPolicy();
        return setPortalPasswordPolicy(normalizePortalPasswordPolicy(res?.policy));
      } catch {
        return getPortalPasswordPolicy();
      } finally {
        loadPromise = null;
      }
    })();
  }
  return loadPromise;
}

/**
 * Loads org password policy from the API and keeps the shared validator cache in sync.
 * Safe on login / reset screens (public endpoint).
 */
export function usePortalPasswordPolicy() {
  const policy = useSyncExternalStore(
    subscribePortalPasswordPolicy,
    getPortalPasswordPolicy,
    () => DEFAULT_PORTAL_PASSWORD_POLICY
  );
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await refreshPortalPasswordPolicy();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        await refreshPortalPasswordPolicy();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { policy, loading, refresh };
}
