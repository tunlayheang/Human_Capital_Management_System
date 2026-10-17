import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';

type Props = {
  /** Total validity window in seconds (e.g. 180). */
  durationSeconds: number;
  /** Epoch ms when the OTP was issued / resent. Null = show full duration idle. */
  issuedAt: number | null;
  className?: string;
  /** i18n key prefix: `login` or `pin` */
  i18nScope?: 'login' | 'pin';
};

/**
 * Live OTP expiry countdown ("This code is valid for 180s." → … → expired).
 */
export const OtpExpiryCountdown: React.FC<Props> = ({
  durationSeconds,
  issuedAt,
  className,
  i18nScope = 'login',
}) => {
  const { t } = useLanguage();
  const safeDuration = Math.max(1, Math.floor(durationSeconds) || 180);
  const [remaining, setRemaining] = useState(safeDuration);

  useEffect(() => {
    if (issuedAt == null) {
      setRemaining(safeDuration);
      return;
    }
    const tick = () => {
      const left = Math.max(
        0,
        Math.ceil((issuedAt + safeDuration * 1000 - Date.now()) / 1000)
      );
      setRemaining(left);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [issuedAt, safeDuration]);

  if (issuedAt != null && remaining <= 0) {
    return (
      <p className={className} role="status" aria-live="polite">
        {t(`${i18nScope}.otpExpired`) ||
          'This code has expired. Resend a new one.'}
      </p>
    );
  }

  return (
    <p className={className} role="status" aria-live="polite">
      {(
        t(`${i18nScope}.otpValidForSeconds`) ||
        'This code is valid for {seconds}s.'
      ).replace('{seconds}', String(remaining))}
    </p>
  );
};
