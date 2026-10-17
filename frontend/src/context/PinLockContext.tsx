import React, { createContext, useCallback, useContext, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from './AuthContext';
import { Api } from '../services/api';
import { isPinMandatoryRole } from '../utils/pinSecurity';
import type { PinSecurityState } from '../utils/pinApi';
import {
  clearPinSession,
  isPinSessionVerified,
  markPinSessionVerified,
  readPinVerifiedAt,
  touchPinSessionActivity,
} from '../utils/pinSession';
import { usePersonDisplayName } from '../hooks/usePersonDisplayName';
import { PinLockFallback } from '../components/security/PinLockFallback';

/** Debounce sessionStorage idle-touch writes while the user is interacting. */
const PIN_ACTIVITY_TOUCH_MS = 10_000;
/** How often to check whether idle auto-lock should fire. */
const PIN_IDLE_POLL_MS = 10_000;

const PinLockScreen = lazy(() =>
  import('../components/security/PinLockScreen').then((m) => ({ default: m.PinLockScreen }))
);

interface PinLockContextType {
  lock: () => void;
  unlock: () => void;
  isLocked: boolean;
  needsPinSetup: boolean;
  showPinOverlay: boolean;
  /** Until first PIN is created (all roles) — sidebar/mobile nav shows Dashboard only. */
  restrictNavToDashboard: boolean;
  refreshSecurity: () => Promise<void>;
}

const PinLockContext = createContext<PinLockContextType | undefined>(undefined);

const securityFromUser = (user: {
  role?: string;
  pinSet?: boolean;
  pinLockEnabled?: boolean;
  pinMandatory?: boolean;
  pinRequired?: boolean;
  pinAutoLockMinutes?: number;
}): PinSecurityState => {
  const mandatory = user.pinMandatory ?? isPinMandatoryRole(user.role);
  const pinLockEnabled = mandatory ? true : user.pinLockEnabled !== false;
  const pinRequired = user.pinRequired ?? (mandatory || pinLockEnabled);
  const pinSetKnown = typeof user.pinSet === 'boolean';
  const pinSet = user.pinSet;
  return {
    pinLockEnabled,
    pinRequired,
    pinMandatory: mandatory,
    pinSet,
    pinAutoLockMinutes: user.pinAutoLockMinutes ?? 15,
    needsPinSetup: pinSetKnown ? !pinSet : undefined,
    pinRequiresOtpRecovery: false,
    pinRequiresAdminReset: false,
    pinRecoveryReady: false,
    pinMustReset: pinSetKnown ? !pinSet : undefined,
  };
};

export const PinLockProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated, logout } = useAuth();
  const displayName = usePersonDisplayName();
  const [locked, setLocked] = useState(false);
  const [needsFirstTimeSetup, setNeedsFirstTimeSetup] = useState(false);
  const [requiresOtpRecovery, setRequiresOtpRecovery] = useState(false);
  const [requiresAdminReset, setRequiresAdminReset] = useState(false);
  const [pinRecoveryReady, setPinRecoveryReady] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState<string | undefined>();
  const [pinActive, setPinActive] = useState(false);
  const [securityLoaded, setSecurityLoaded] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState(15);
  const activityRef = useRef(Date.now());
  const lastTouchWriteRef = useRef(0);

  const pinExempt = !user || !isPinMandatoryRole(user.role);

  const checkVerifiedFresh = useCallback(() => {
    if (!user || pinExempt || !pinActive) return true;
    return isPinSessionVerified(user.id, user.pinAutoLockMinutes ?? autoLockMinutes);
  }, [user?.id, user?.pinAutoLockMinutes, pinExempt, pinActive, autoLockMinutes]);

  const lock = useCallback(() => {
    if (!user || pinExempt || !pinActive) return;
    clearPinSession(user.id);
    setLocked(true);
  }, [user, pinExempt, pinActive]);

  const unlock = useCallback(() => {
    if (!user) return;
    const now = Date.now();
    markPinSessionVerified(user.id);
    setLocked(false);
    setNeedsFirstTimeSetup(false);
    setRequiresOtpRecovery(false);
    setRequiresAdminReset(false);
    setPinRecoveryReady(false);
    activityRef.current = now;
    lastTouchWriteRef.current = now;
  }, [user]);

  const noteActivity = useCallback(() => {
    const now = Date.now();
    activityRef.current = now;
    if (!user || pinExempt || !pinActive || locked) return;
    // Keep PIN session alive only while the user is interacting (idle-based lock).
    if (now - lastTouchWriteRef.current >= PIN_ACTIVITY_TOUCH_MS) {
      lastTouchWriteRef.current = now;
      touchPinSessionActivity(user.id);
    }
  }, [user, pinExempt, pinActive, locked]);

  const applySecurityState = useCallback(
    (s: PinSecurityState, opts?: { authoritative?: boolean }) => {
      if (!user || pinExempt) {
        setLocked(false);
        setNeedsFirstTimeSetup(false);
        setRequiresOtpRecovery(false);
        setRequiresAdminReset(false);
        setPinRecoveryReady(false);
        setPinActive(false);
        return;
      }

      setAutoLockMinutes(s.pinAutoLockMinutes ?? 15);
      setRequiresOtpRecovery(Boolean(s.pinRequiresOtpRecovery));
      setRequiresAdminReset(Boolean(s.pinRequiresAdminReset));
      setPinRecoveryReady(Boolean(s.pinRecoveryReady));
      if (s.maskedEmail) setMaskedEmail(s.maskedEmail);

      const mandatory = s.pinMandatory ?? isPinMandatoryRole(user.role);
      const active = !!(s.pinRequired && s.pinLockEnabled) || (mandatory && s.pinLockEnabled !== false);
      setPinActive(active);

      if (!active) {
        setNeedsFirstTimeSetup(false);
        setLocked(false);
        return;
      }

      if (s.pinRequiresAdminReset) {
        clearPinSession(user.id);
        setNeedsFirstTimeSetup(false);
        setLocked(true);
        return;
      }

      if (s.pinRequiresOtpRecovery) {
        clearPinSession(user.id);
        setNeedsFirstTimeSetup(false);
        setLocked(true);
        return;
      }

      const mustSetup =
        opts?.authoritative &&
        (Boolean(s.needsPinSetup) || s.pinSet === false);

      if (mustSetup) {
        clearPinSession(user.id);
        setNeedsFirstTimeSetup(true);
        setLocked(true);
        return;
      }

      setNeedsFirstTimeSetup(false);
      setLocked(!checkVerifiedFresh());
    },
    [user, pinExempt, checkVerifiedFresh]
  );

  const refreshSecurity = useCallback(async () => {
    if (!isAuthenticated || !user) {
      setSecurityLoaded(true);
      setLocked(false);
      setNeedsFirstTimeSetup(false);
      setRequiresOtpRecovery(false);
      setRequiresAdminReset(false);
      setPinActive(false);
      return;
    }

    if (pinExempt) {
      setSecurityLoaded(true);
      setLocked(false);
      setNeedsFirstTimeSetup(false);
      setRequiresOtpRecovery(false);
      setRequiresAdminReset(false);
      setPinActive(false);
      return;
    }

    // Seed idle clock from last activity (not a fixed unlock expiry).
    const lastActivity = readPinVerifiedAt(user.id);
    if (lastActivity) {
      activityRef.current = lastActivity;
      lastTouchWriteRef.current = lastActivity;
    }

    try {
      const s = await Promise.race([
        Api.auth.getSecurity(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('PIN security timeout')), 10_000)
        ),
      ]);
      applySecurityState(s, { authoritative: true });
    } catch {
      applySecurityState(securityFromUser(user), { authoritative: typeof user.pinSet === 'boolean' });
    } finally {
      setSecurityLoaded(true);
    }
  }, [isAuthenticated, user, pinExempt, applySecurityState]);

  useEffect(() => {
    setSecurityLoaded(false);
    void refreshSecurity();
  }, [refreshSecurity]);

  useEffect(() => {
    if (!isAuthenticated || pinExempt || !pinActive || locked) return;

    const events = ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, noteActivity, { passive: true }));

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const mins = user?.pinAutoLockMinutes ?? autoLockMinutes;
      const idleMs = Math.max(1, mins) * 60 * 1000;
      // Tab regained focus after idle → require PIN; otherwise treat as activity.
      if (Date.now() - activityRef.current > idleMs) {
        lock();
      } else {
        noteActivity();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const interval = setInterval(() => {
      const mins = user?.pinAutoLockMinutes ?? autoLockMinutes;
      const idleMs = Math.max(1, mins) * 60 * 1000;
      if (Date.now() - activityRef.current > idleMs) {
        lock();
      }
    }, PIN_IDLE_POLL_MS);

    return () => {
      events.forEach((e) => window.removeEventListener(e, noteActivity));
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(interval);
    };
  }, [
    isAuthenticated,
    pinExempt,
    pinActive,
    locked,
    lock,
    noteActivity,
    user?.pinAutoLockMinutes,
    autoLockMinutes,
  ]);

  const showPinOverlay =
    isAuthenticated &&
    !user?.mustChangePassword &&
    pinActive &&
    securityLoaded &&
    (locked || needsFirstTimeSetup || requiresOtpRecovery || requiresAdminReset);

  const restrictNavToDashboard =
    isAuthenticated &&
    (Boolean(user?.mustChangePassword) ||
      (pinActive &&
        !pinExempt &&
        (needsFirstTimeSetup ||
          requiresOtpRecovery ||
          requiresAdminReset ||
          pinRecoveryReady)));

  return (
    <PinLockContext.Provider
      value={{
        lock,
        unlock,
        isLocked: locked,
        needsPinSetup: needsFirstTimeSetup || requiresOtpRecovery || requiresAdminReset,
        showPinOverlay,
        restrictNavToDashboard,
        refreshSecurity,
      }}
    >
      {children}
      {showPinOverlay && user
        ? createPortal(
            <Suspense fallback={<PinLockFallback />}>
              <PinLockScreen
                userName={displayName}
                needsFirstTimeSetup={needsFirstTimeSetup}
                requiresOtpRecovery={requiresOtpRecovery}
                requiresAdminReset={requiresAdminReset}
                pinRecoveryReady={pinRecoveryReady}
                maskedEmail={maskedEmail}
                autoLockMinutes={user.pinAutoLockMinutes ?? autoLockMinutes}
                onVerified={unlock}
                onLogout={() => void logout({ fromPin: true })}
              />
            </Suspense>,
            document.body
          )
        : null}
    </PinLockContext.Provider>
  );
};

export const usePinLock = () => {
  const ctx = useContext(PinLockContext);
  if (!ctx) throw new Error('usePinLock must be used within PinLockProvider');
  return ctx;
};
