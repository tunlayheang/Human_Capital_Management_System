/**
 * Map OTP/email delivery failures to a user-safe message.
 * Production sometimes still returns operator hints (Render SMTP / Apps Script paths);
 * never show those on the login screen.
 */
export function formatAuthDeliveryError(error: unknown, fallback: string): string {
  const err = error as { message?: string; data?: { message?: string; code?: string }; code?: string };
  const message = String(err?.message || err?.data?.message || '').trim();
  const code = String(err?.code || err?.data?.code || '').trim();

  if (
    code === 'EMAIL_NOT_CONFIGURED' ||
    code === 'EMAIL_DELIVERY_FAILED' ||
    /Render free tier|Gmail SMTP|Apps Script|gmail-otp-apps-script|\/api\/setup\/gmail|GMAIL_|RESEND_|SMTP|not configured|App Password|oauth-setup/i.test(
      message
    )
  ) {
    return fallback;
  }

  return message || fallback;
}
