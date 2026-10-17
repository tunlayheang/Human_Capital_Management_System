import React, { useEffect, useState, lazy, Suspense, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Shield } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePinLock } from '../../context/PinLockContext';
import { useLanguage } from '../../context/LanguageContext';
import { Api } from '../../services/api';
import { isPinMandatoryRole } from '../../utils/pinSecurity';
import type { PinSecurityState } from '../../utils/pinApi';
import { isPinSessionVerified } from '../../utils/pinSession';
import { usePersonDisplayName } from '../../hooks/usePersonDisplayName';
import { PageLoading } from '../ui/page';
import { Z_PIN_LOCK } from '../../utils/overlayPortal';

const PinLockScreen = lazy(() =>
  import('./PinLockScreen').then((m) => ({ default: m.PinLockScreen }))
);
const PinLockFallback = lazy(() =>
  import('./PinLockFallback').then((m) => ({ default: m.PinLockFallback }))
);

type Props = {
  children: React.ReactNode;
  /** Shown on section gate (e.g. "Projects") */
  sectionLabel?: string;
};

function needsPinGate(security: PinSecurityState, userId: string, autoLockMinutes: number): boolean {
  if (!security.pinSet) return true;
  if (security.pinRequiresOtpRecovery) return true;
  if (security.pinRequiresAdminReset) return true;
  if (security.needsPinSetup) return true;
  if (security.pinRecoveryReady) return true;
  return !isPinSessionVerified(userId, autoLockMinutes);
}

function PinGateWaitingOverlay({ message }: { message: string }) {
  return createPortal(
    <div
      className="pin-lock-screen fixed inset-0 flex flex-col items-center justify-center px-4 py-12 text-center"
      style={{ zIndex: Z_PIN_LOCK }}
      role="status"
    >
      <Shield className="w-10 h-10 text-primary-600 dark:text-primary-400 mb-3 opacity-80" />
      <p className="text-sm pin-lock-hint max-w-sm leading-relaxed">{message}</p>
    </div>,
    document.body
  );
}

/** Requires PIN setup / verify / OTP before showing protected routes (e.g. Settings). */
export const PinSettingsGate: React.FC<Props> = ({ children, sectionLabel }) => {
  const { user, logout } = useAuth();
  const displayName = usePersonDisplayName();
  const { unlock, refreshSecurity, isLocked, showPinOverlay } = usePinLock();
  const { t } = useLanguage();
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [security, setSecurity] = useState<PinSecurityState | null>(null);
  const [autoLockMinutes, setAutoLockMinutes] = useState(15);

  const pinExempt = !user || !isPinMandatoryRole(user.role);

  const applyUnlockedFromSession = useCallback(
    (s: PinSecurityState) => {
      if (!user) return;
      if (needsPinGate(s, user.id, s.pinAutoLockMinutes ?? autoLockMinutes)) {
        setUnlocked(false);
      } else {
        setUnlocked(true);
      }
    },
    [user, autoLockMinutes]
  );

  useEffect(() => {
    if (!user) return;
    if (pinExempt) {
      setUnlocked(true);
      setReady(true);
      return;
    }

    let cancelled = false;
    setUnlocked(false);
    setReady(false);

    void (async () => {
      try {
        const s = await Api.auth.getSecurity();
        if (cancelled) return;
        setSecurity(s);
        const mins = s.pinAutoLockMinutes ?? 15;
        setAutoLockMinutes(mins);
        applyUnlockedFromSession(s);
      } catch {
        if (!cancelled) {
          setSecurity({ pinSet: false, needsPinSetup: true });
          setUnlocked(false);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, pinExempt, user?.role, applyUnlockedFromSession]);

  useEffect(() => {
    if (isLocked) setUnlocked(false);
  }, [isLocked]);

  const handleVerified = () => {
    unlock();
    setUnlocked(true);
    void refreshSecurity();
  };

  if (!ready) {
    return <PageLoading layout="form" />;
  }

  if (pinExempt) {
    return <>{children}</>;
  }

  if (showPinOverlay) {
    return (
      <>
        <PinGateWaitingOverlay
          message={
            t('pin.unlockAppFirst') || 'Complete the security PIN prompt to continue.'
          }
        />
        {children}
      </>
    );
  }

  const gateRequired =
    !unlocked && user && security && needsPinGate(security, user.id, autoLockMinutes);

  if (gateRequired) {
    const needsFirstTimeSetup = Boolean(security.needsPinSetup || security.pinRecoveryReady);

    return (
      <>
        {createPortal(
          <Suspense fallback={<PinLockFallback />}>
            <PinLockScreen
              sectionLabel={sectionLabel}
              userName={displayName}
              needsFirstTimeSetup={needsFirstTimeSetup}
              requiresOtpRecovery={Boolean(security.pinRequiresOtpRecovery)}
              requiresAdminReset={Boolean(security.pinRequiresAdminReset)}
              pinRecoveryReady={Boolean(security.pinRecoveryReady)}
              maskedEmail={security.maskedEmail}
              autoLockMinutes={autoLockMinutes}
              onVerified={handleVerified}
              onLogout={() => void logout({ fromPin: true })}
            />
          </Suspense>,
          document.body
        )}
        {children}
      </>
    );
  }

  return <>{children}</>;
};
