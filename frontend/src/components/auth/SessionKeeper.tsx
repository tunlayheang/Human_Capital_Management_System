import React, { useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Api } from '../../services/api';
import {
  isStoredSessionLocallyExpired,
  persistPortalSession,
  readStoredPortalSession,
} from '../../utils/portalSession';
import { isUnauthorizedError } from '../../utils/httpError';

/** Session check while idle — short enough that freeze/deactivate logs the user out quickly. */
const HEARTBEAT_MS = 60 * 1000;
const ACTIVITY_DEBOUNCE_MS = 2 * 60 * 1000;

/**
 * Keeps the 7-day sliding session alive while the app is in use and
 * signs the user out when the device session has expired or the account
 * was frozen / deactivated.
 */
export const SessionKeeper: React.FC = () => {
  const { isAuthenticated, logout } = useAuth();
  const lastTouchRef = useRef(0);
  const touchingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) return;

    const touch = async (force = false) => {
      const stored = readStoredPortalSession();
      if (!stored?.token) return;

      if (!force && isStoredSessionLocallyExpired(stored.sessionExpiresAt)) {
        void logout({ skipConfirm: true });
        return;
      }

      const now = Date.now();
      if (!force && now - lastTouchRef.current < ACTIVITY_DEBOUNCE_MS) return;
      if (touchingRef.current) return;

      lastTouchRef.current = now;
      touchingRef.current = true;
      try {
        const data = (await Api.auth.getSession({ skipSessionRedirect: true })) as {
          sessionExpiresAt?: string;
          deviceId?: string;
        } | null;
        if (data?.sessionExpiresAt) {
          persistPortalSession({
            sessionExpiresAt: data.sessionExpiresAt,
            ...(data.deviceId ? { deviceId: data.deviceId } : {}),
          });
        }
      } catch (error) {
        if (isUnauthorizedError(error)) {
          void logout({ skipConfirm: true });
        }
      } finally {
        touchingRef.current = false;
      }
    };

    void touch(true);

    const interval = window.setInterval(() => void touch(true), HEARTBEAT_MS);

    const onActivity = () => void touch(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void touch(true);
    };

    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity, { passive: true });
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isAuthenticated, logout]);

  return null;
};
