import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import twilio from 'twilio';
import { OTP_EXPIRY_SECONDS, otpExpiryPurposeFromDelivery } from '../otpExpiryConfig.js';

export type OtpPurpose = 'login' | 'password-reset' | 'pin-recovery';
export type OtpDeliveryMode = 'twilio' | 'email' | 'local';
/** verify = Twilio Verify holds the code; sms = we sent via Messages API and store hash on user */
export type TwilioSendMethod = 'verify' | 'sms';

const otpValidForLabel = (purpose: OtpPurpose): string => {
  const seconds = OTP_EXPIRY_SECONDS[otpExpiryPurposeFromDelivery(purpose)];
  return `Valid for ${seconds} seconds`;
};

const normalizeDigits = (phone: string) => phone.replace(/\D/g, '');

/** Cambodia default: 017787947 → +85517787947 */
export const toE164 = (phoneDigits: string): string => {
  const digits = normalizeDigits(phoneDigits);
  const countryCode = (process.env.TWILIO_DEFAULT_COUNTRY_CODE || '855').replace(/\D/g, '');

  if (digits.startsWith(countryCode)) {
    return `+${digits}`;
  }
  if (digits.startsWith('0')) {
    return `+${countryCode}${digits.slice(1)}`;
  }
  return `+${countryCode}${digits}`;
};

const isTwilioConfigured = () =>
  Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_VERIFY_SERVICE_SID || process.env.TWILIO_PHONE_NUMBER)
  );

/** OTP provider: OTP_PROVIDER or legacy OTP_EMAIL_PROVIDER */
const getOtpProvider = () =>
  (process.env.OTP_PROVIDER || process.env.OTP_EMAIL_PROVIDER || 'gmail').toLowerCase();

/** This project sends OTP only via Gmail (App Password SMTP or OAuth). Resend is not used for OTP. */
export const isGmailOnlyOtp = () => getOtpProvider() === 'gmail';

const getOtpSenderName = () =>
  process.env.OTP_SENDER_NAME?.trim() || 'HRMS_ROC_SERVICE';

const normalizeSmtpUser = () =>
  String(process.env.GMAIL_USER || process.env.SMTP_USER || '')
    .trim()
    .toLowerCase();

const normalizeSmtpFrom = () =>
  String(process.env.GMAIL_FROM || process.env.SMTP_FROM || normalizeSmtpUser() || '')
    .trim()
    .toLowerCase();

/** Gmail app passwords are 16 chars; strip spaces from pasted values. */
const normalizeSmtpPass = () =>
  String(process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS || '').replace(/\s+/g, '');

const normalizeAppsScriptUrl = () =>
  String(process.env.GMAIL_APPS_SCRIPT_URL || '').trim();

const normalizeAppsScriptSecret = () =>
  String(process.env.GMAIL_APPS_SCRIPT_SECRET || '').trim();

const hasGmailAppsScriptConfig = () =>
  Boolean(normalizeAppsScriptUrl() && normalizeAppsScriptSecret());

/** Render free tier blocks outbound SMTP (25/465/587). Prefer HTTPS relays there. */
export const isSmtpLikelyBlocked = () =>
  process.env.GMAIL_ALLOW_SMTP === 'true'
    ? false
    : process.env.RENDER === 'true' || process.env.GMAIL_DISABLE_SMTP === 'true';

const hasGmailAppPasswordConfig = () => Boolean(normalizeSmtpPass());

export const isEmailConfigured = () => {
  if (isGmailOAuthConfigured()) return true;
  if (hasGmailAppsScriptConfig()) return true;
  // App Password uses SMTP — unusable on Render free (ports 465/587 blocked).
  if (shouldUseGmailAppPassword() && !isSmtpLikelyBlocked()) return true;
  if (!isGmailOnlyOtp() && process.env.RESEND_API_KEY?.trim()) return true;
  return false;
};

const prefersGmailSmtp = () => Boolean(normalizeSmtpUser() && normalizeSmtpPass());

/** Set false after startup verify or a failed send so we fall back to OAuth. */
let gmailAppPasswordRejected =
  process.env.SMTP_DISABLE_APP_PASSWORD === 'true' && !process.env.GMAIL_APP_PASSWORD?.trim();

export const markGmailAppPasswordRejected = () => {
  gmailAppPasswordRejected = true;
};

export const getOtpEmailStatus = () => ({
  provider: isGmailOnlyOtp() ? 'gmail' : 'multi',
  configured: isEmailConfigured(),
  gmailOAuth: isGmailOAuthConfigured(),
  gmailAppPassword: shouldUseGmailAppPassword(),
  gmailAppsScript: hasGmailAppsScriptConfig(),
  smtpLikelyBlocked: isSmtpLikelyBlocked(),
  resend: isGmailOnlyOtp() ? false : isResendConfigured(),
});

const isResendConfigured = () => Boolean(process.env.RESEND_API_KEY?.trim());

const purposeLabel = (purpose: OtpPurpose) => {
  if (purpose === 'login') return 'login';
  if (purpose === 'pin-recovery') return 'PIN recovery';
  return 'password reset';
};

const getOtpFromAddress = () => {
  const custom = process.env.RESEND_FROM?.trim();
  if (custom?.includes('<')) return custom;
  const fromEmail = normalizeSmtpFrom() || normalizeSmtpUser();
  const senderName = getOtpSenderName();
  if (fromEmail) return `${senderName} <${fromEmail}>`;
  if (isResendConfigured()) return `${senderName} <onboarding@resend.dev>`;
  return `${senderName} <noreply@hcms.local>`;
};

const buildOtpEmailContent = (purpose: OtpPurpose, otp: string) => {
  const label = purposeLabel(purpose);
  const brand = getOtpSenderName();
  const subject = `${brand} ${label} code`;
  const validFor = otpValidForLabel(purpose);
  const text = `Your ${brand} ${label} code is: ${otp}\n\n${validFor}. Do not share this code.`;
  const html = `<p>Your ${brand} ${label} code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${otp}</p><p>${validFor}. Do not share this code.</p>`;
  return { subject, text, html };
};

export const hasGmailOAuthCredentials = () =>
  Boolean(
    normalizeSmtpUser() &&
      process.env.GMAIL_CLIENT_ID?.trim() &&
      process.env.GMAIL_CLIENT_SECRET?.trim()
  );

const isGmailOAuthConfigured = () =>
  Boolean(hasGmailOAuthCredentials() && process.env.GMAIL_REFRESH_TOKEN?.trim());

/** Shown to anonymous callers. Operator hints name internal files/endpoints, so they stay in logs. */
export const OTP_EMAIL_UNAVAILABLE_MESSAGE =
  'We could not send the verification email right now. Please try again in a few minutes, or contact your HR administrator.';

export const getGmailSetupMessage = (): string | null => {
  if (isGmailOAuthConfigured() || hasGmailAppsScriptConfig()) return null;
  if (shouldUseGmailAppPassword() && !isSmtpLikelyBlocked()) return null;
  // A half-set relay otherwise falls through to the generic SMTP hint, which hides the real cause.
  if (normalizeAppsScriptUrl() && !normalizeAppsScriptSecret()) {
    return 'GMAIL_APPS_SCRIPT_URL is set but GMAIL_APPS_SCRIPT_SECRET is missing. Set it to the OTP_RELAY_SECRET value in the Apps Script.';
  }
  if (normalizeAppsScriptSecret() && !normalizeAppsScriptUrl()) {
    return 'GMAIL_APPS_SCRIPT_SECRET is set but GMAIL_APPS_SCRIPT_URL is missing. Set it to the Apps Script Web App /exec URL.';
  }
  if (isSmtpLikelyBlocked()) {
    return (
      'Render free tier blocks Gmail SMTP. Deploy the Apps Script relay (backend/scripts/gmail-otp-apps-script.gs), then POST the Web App URL to /api/setup/gmail-smtp.'
    );
  }
  if (!normalizeSmtpUser()) {
    return 'Set GMAIL_USER=iroc.hcms@gmail.com in backend/.env';
  }
  if (hasGmailAppPasswordConfig() && gmailAppPasswordRejected) {
    return 'Gmail App Password was rejected. Create a new one at https://myaccount.google.com/apppasswords or complete OAuth at http://localhost:4000/api/setup/gmail/start';
  }
  if (!hasGmailAppPasswordConfig() && hasGmailOAuthCredentials()) {
    return (
      'Gmail OAuth is not authorized yet. Open http://localhost:4000/api/setup/gmail/start (sign in as iroc.hcms@gmail.com), or set GMAIL_APP_PASSWORD in backend/.env'
    );
  }
  return 'Set GMAIL_APP_PASSWORD in backend/.env, or complete Gmail OAuth (see backend/EMAIL_SETUP.md).';
};

const shouldUseGmailAppPassword = () => {
  if (!prefersGmailSmtp() || gmailAppPasswordRejected) return false;
  // On Render free, SMTP ports are blocked — keep password for local/dev only unless forced.
  if (isSmtpLikelyBlocked() && !hasGmailAppsScriptConfig() && !isGmailOAuthConfigured()) {
    // Still "configured" for local testing mirrors, but send path will skip SMTP.
  }
  if (hasGmailAppPasswordConfig()) return true;
  return !isGmailOAuthConfigured();
};

const smtpAuthMessagePattern =
  /BadCredentials|535-5\.7\.8|Username and Password not accepted|App Password|RESEND_API_KEY|not configured/i;

export const isSmtpAuthError = (error: unknown): boolean => {
  const check = (e: unknown): boolean => {
    const message = String((e as any)?.message ?? e ?? '');
    const code = String((e as any)?.code ?? '');
    return code === 'EAUTH' || smtpAuthMessagePattern.test(message);
  };
  if (check(error)) return true;
  const cause = (error as any)?.cause;
  return cause ? check(cause) : false;
};

/** Dev-only: store OTP locally when email providers fail (OTP logged on server, not returned in API). */
export const isEmailDevFallbackEnabled = () =>
  process.env.OTP_EMAIL_DEV_FALLBACK === 'true' && process.env.NODE_ENV !== 'production';

const getTwilioClient = () => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  return twilio(accountSid, authToken);
};

const getTwilioFromNumber = async (): Promise<string> => {
  if (process.env.TWILIO_PHONE_NUMBER) {
    return process.env.TWILIO_PHONE_NUMBER;
  }
  const client = getTwilioClient();
  const numbers = await client.incomingPhoneNumbers.list({ limit: 1 });
  if (!numbers[0]?.phoneNumber) {
    throw new OtpDeliveryError(
      'No Twilio phone number found. Set TWILIO_PHONE_NUMBER in .env or buy a number in Twilio Console.'
    );
  }
  return numbers[0].phoneNumber;
};

export const getOtpDeliveryMode = (): OtpDeliveryMode => {
  const forced = process.env.OTP_DELIVERY?.toLowerCase();
  if (forced === 'local') return 'local';
  if (forced === 'email') {
    if (!isEmailConfigured()) {
      if (isEmailDevFallbackEnabled()) return 'email';
      const gmailHint = getGmailSetupMessage();
      throw new OtpDeliveryError(
        isGmailOnlyOtp()
          ? gmailHint || 'OTP_DELIVERY=email but Gmail is not configured.'
          : 'OTP_DELIVERY=email but no email provider is configured.',
        'EMAIL_NOT_CONFIGURED'
      );
    }
    return 'email';
  }
  if (forced === 'twilio') {
    if (!isTwilioConfigured()) {
      throw new Error(
        'OTP_DELIVERY=twilio but TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID or TWILIO_PHONE_NUMBER are missing'
      );
    }
    return 'twilio';
  }
  if (isEmailConfigured()) return 'email';
  return isTwilioConfigured() ? 'twilio' : 'local';
};

export const generateLocalOtp = () =>
  crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

export const logLocalOtp = (purpose: OtpPurpose, phoneDigits: string, code: string) => {
  const mode = getOtpDeliveryMode();
  if (process.env.NODE_ENV === 'production' && (mode === 'twilio' || mode === 'email')) {
    return;
  }
  console.info(`[auth] ${purpose} OTP for ${phoneDigits}: ${code}`);
};

let cachedSmtpTransport: ReturnType<typeof nodemailer.createTransport> | null = null;
let cachedSmtpTransportKey = '';

export const resetGmailAppPasswordRejection = () => {
  gmailAppPasswordRejected = false;
};

export const clearGmailSmtpCache = () => {
  cachedSmtpTransport = null;
  cachedSmtpTransportKey = '';
};

const getSmtpTransport = () => {
  const user = normalizeSmtpUser();
  const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim().toLowerCase();
  const pass = normalizeSmtpPass();
  const cacheKey = `${user}|${host}|${isGmailOAuthConfigured() ? 'oauth' : pass.slice(0, 4)}`;
  if (cachedSmtpTransport && cachedSmtpTransportKey === cacheKey) {
    return cachedSmtpTransport;
  }

  if (isGmailOAuthConfigured()) {
    cachedSmtpTransport = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user,
        clientId: process.env.GMAIL_CLIENT_ID!.trim(),
        clientSecret: process.env.GMAIL_CLIENT_SECRET!.trim(),
        refreshToken: process.env.GMAIL_REFRESH_TOKEN!.trim(),
      },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
    cachedSmtpTransportKey = cacheKey;
    return cachedSmtpTransport;
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const useSsl = port === 465 || process.env.SMTP_SECURE === 'true';

  if (host === 'smtp.gmail.com' || host.endsWith('.gmail.com')) {
    cachedSmtpTransport = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
      pool: true,
      maxConnections: 1,
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 25_000,
    });
    cachedSmtpTransportKey = cacheKey;
    return cachedSmtpTransport;
  }

  cachedSmtpTransport = nodemailer.createTransport({
    host,
    port,
    secure: useSsl,
    requireTLS: !useSsl && port === 587,
    auth: { user, pass },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 25_000,
  });
  cachedSmtpTransportKey = cacheKey;
  return cachedSmtpTransport;
};

/** Verify email delivery credentials on startup. */
export const verifySmtpConnection = async (): Promise<boolean> => {
  if (!isEmailConfigured()) return false;

  if (hasGmailAppsScriptConfig()) {
    try {
      const url = normalizeAppsScriptUrl();
      const res = await fetch(url, { method: 'GET' });
      const text = await res.text();
      let ok = res.ok;
      try {
        const json = JSON.parse(text);
        ok = Boolean(json?.ok);
      } catch {
        /* Apps Script may return HTML before redeploy; treat HTTP 200 as soft-ok */
      }
      if (ok) {
        console.info('[auth] Gmail Apps Script relay ready (HTTPS)');
        return true;
      }
      console.error(`[auth] Gmail Apps Script relay check failed: HTTP ${res.status}`);
    } catch (err: any) {
      console.error(`[auth] Gmail Apps Script relay unreachable: ${err?.message || err}`);
    }
  }

  if (shouldUseGmailAppPassword() && !isSmtpLikelyBlocked()) {
    try {
      const transport = getSmtpTransport();
      await transport.verify();
      console.info(`[auth] Gmail SMTP ready for ${normalizeSmtpUser()}`);
      return true;
    } catch (err: any) {
      if (isSmtpAuthError(err)) {
        markGmailAppPasswordRejected();
      }
      console.error(
        `[auth] Gmail App Password rejected for ${normalizeSmtpUser()}: ${err?.message?.split('\n')[0] || err}\n` +
          '  Use Gmail OAuth: npm run gmail:oauth-setup (see backend/EMAIL_SETUP.md)'
      );
    }
  } else if (prefersGmailSmtp() && (gmailAppPasswordRejected || isSmtpLikelyBlocked())) {
    if (isSmtpLikelyBlocked()) {
      console.warn(
        '[auth] Gmail SMTP skipped on Render (free tier blocks ports 465/587). Use Apps Script relay or OAuth/Gmail API.'
      );
    } else {
      console.warn('[auth] Gmail App Password disabled (failed verify or SMTP_DISABLE_APP_PASSWORD=true).');
    }
  }

  if (!isGmailOnlyOtp() && isResendConfigured()) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY!.trim());
      await resend.domains.list();
      console.info('[auth] Resend API ready (not used when OTP_EMAIL_PROVIDER=gmail)');
      return true;
    } catch (err: any) {
      console.error(`[auth] Resend API key invalid: ${err?.message || err}`);
    }
  }

  if (isGmailOAuthConfigured()) {
    try {
      const oauth2 = new OAuth2Client(
        process.env.GMAIL_CLIENT_ID!.trim(),
        process.env.GMAIL_CLIENT_SECRET!.trim()
      );
      oauth2.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN!.trim() });
      await oauth2.getAccessToken();
      console.info(`[auth] Gmail API ready for ${normalizeSmtpUser()}`);
      return true;
    } catch (err: any) {
      console.error(`[auth] Gmail OAuth failed: ${err?.message || err}`);
    }
  }

  return false;
};

const sendOtpViaGmailApi = async (toEmail: string, purpose: OtpPurpose, otp: string): Promise<void> => {
  const clientId = process.env.GMAIL_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN?.trim();
  const from = normalizeSmtpUser();

  if (!clientId || !clientSecret || !refreshToken || !from) {
    throw new OtpDeliveryError(
      'Gmail OAuth is not fully configured (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, SMTP_USER).'
    );
  }

  const to = String(toEmail || '').trim();
  if (!to) {
    throw new OtpDeliveryError('No email address on file for this account.');
  }

  const { subject, html } = buildOtpEmailContent(purpose, otp);
  const oauth2 = new OAuth2Client(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });

  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const mime = [
    `From: ROC HCMS <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    html,
  ].join('\r\n');

  const raw = Buffer.from(mime)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  console.info(`[auth] OTP email sent to ${to} via Gmail API (${res.data.id || 'ok'})`);
};

/** Resend free tier only delivers to the account owner unless a domain is verified. */
const canResendDeliverTo = (toEmail: string) => {
  if (!isResendConfigured()) return false;
  if (process.env.RESEND_DOMAIN_VERIFIED === 'true') return true;
  const owner = normalizeSmtpUser();
  return Boolean(owner && toEmail.toLowerCase() === owner);
};

const sendOtpViaResend = async (toEmail: string, purpose: OtpPurpose, otp: string): Promise<void> => {
  if (!canResendDeliverTo(toEmail)) {
    throw new OtpDeliveryError(
      `Resend cannot send to ${toEmail} in test mode`,
      'RESEND_SANDBOX_LIMIT'
    );
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new OtpDeliveryError('RESEND_API_KEY is not set');
  }

  const to = String(toEmail || '').trim();
  if (!to) {
    throw new OtpDeliveryError('No email address on file for this account.');
  }

  const { subject, html, text } = buildOtpEmailContent(purpose, otp);
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: getOtpFromAddress(),
    to,
    subject,
    html,
    text,
  });

  if (error) {
    console.error(`[auth] Resend OTP email failed for ${to}:`, error.message);
    throw new OtpDeliveryError(error.message || 'Resend failed to send OTP email');
  }

  console.info(`[auth] OTP email sent to ${to} via Resend (${data?.id || 'ok'})`);
};

const sendOtpViaAppsScript = async (
  toEmail: string,
  purpose: OtpPurpose,
  otp: string
): Promise<void> => {
  const url = normalizeAppsScriptUrl();
  const secret = normalizeAppsScriptSecret();
  if (!url || !secret) {
    throw new OtpDeliveryError('Gmail Apps Script relay is not configured');
  }

  const to = String(toEmail || '').trim();
  if (!to) {
    throw new OtpDeliveryError('No email address on file for this account.');
  }

  const { subject, text, html } = buildOtpEmailContent(purpose, otp);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret,
      to,
      subject,
      text,
      html,
      fromName: getOtpSenderName(),
    }),
    redirect: 'follow',
  });

  const raw = await res.text();
  let payload: any = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    /* ignore */
  }

  if (!res.ok || payload?.ok === false) {
    const detail = payload?.error || raw.slice(0, 200) || `HTTP ${res.status}`;
    console.error(`[auth] Apps Script OTP failed for ${to}:`, detail);
    throw new OtpDeliveryError(`Gmail Apps Script relay failed: ${detail}`);
  }

  console.info(`[auth] OTP email sent to ${to} via Gmail Apps Script`);
};

const sendOtpViaSmtp = async (toEmail: string, purpose: OtpPurpose, otp: string): Promise<void> => {
  const to = String(toEmail || '').trim();
  if (!to) {
    throw new OtpDeliveryError('No email address on file for this account.');
  }

  const { subject, text, html } = buildOtpEmailContent(purpose, otp);

  try {
    const transport = getSmtpTransport();
    const info = await transport.sendMail({ from: getOtpFromAddress(), to, subject, text, html });
    console.info(`[auth] OTP email sent to ${to} via SMTP (${info.messageId || 'ok'})`);
  } catch (err: any) {
    console.error(`[auth] OTP email failed for ${to}:`, err?.message || err);
    if (isSmtpAuthError(err)) {
      markGmailAppPasswordRejected();
    }
    throw new OtpDeliveryError(
      err?.message || 'Failed to send OTP email. Check SMTP credentials.',
      err?.code ? String(err.code) : undefined,
      undefined,
      err
    );
  }
};

const buildEmailDeliveryFailedMessage = (_toEmail: string, errors: Error[]): string => {
  const hasOAuthCredsOnly = Boolean(
    process.env.GMAIL_CLIENT_ID?.trim() && process.env.GMAIL_CLIENT_SECRET?.trim()
  );
  const smtpRejected = errors.some((e) => isSmtpAuthError(e) || /App Password|BadCredentials/i.test(e.message));
  const smtpBlocked = errors.some((e) =>
    /ETIMEDOUT|ENETUNREACH|ESOCKET|ECONNREFUSED|SMTP|port 5(87|65)/i.test(e.message)
  );

  if (isSmtpLikelyBlocked() || smtpBlocked) {
    return (
      'Render free tier blocks Gmail SMTP. Deploy backend/scripts/gmail-otp-apps-script.gs as a Google Apps Script Web App, then POST the URL to /api/setup/gmail-smtp.'
    );
  }
  if (isGmailOAuthConfigured()) {
    return 'Gmail could not send the OTP. Re-run: cd backend && npm run gmail:oauth-setup';
  }
  if (hasOAuthCredsOnly) {
    return 'Gmail OAuth is not authorized yet. Run: cd backend && npm run gmail:oauth-setup (sign in as iroc.hcms@gmail.com).';
  }
  if (smtpRejected || gmailAppPasswordRejected) {
    return 'Gmail App Password failed. Use OAuth instead: cd backend && npm run gmail:oauth-setup (see EMAIL_SETUP.md).';
  }
  return 'Gmail OTP is not configured. Add GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET to backend/.env, then run npm run gmail:oauth-setup.';
};

/** Send OTP via Gmail (Apps Script HTTPS → App Password SMTP → OAuth API). */
export const sendOtpViaEmail = async (
  toEmail: string,
  purpose: OtpPurpose,
  otp: string
): Promise<void> => {
  if (!isEmailConfigured()) {
    const hint = getGmailSetupMessage();
    throw new OtpDeliveryError(
      hint || 'Gmail OTP is not configured in backend/.env',
      'EMAIL_NOT_CONFIGURED'
    );
  }

  const errors: Error[] = [];

  if (hasGmailAppsScriptConfig()) {
    try {
      await sendOtpViaAppsScript(toEmail, purpose, otp);
      return;
    } catch (err: any) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
      console.warn('[auth] Gmail Apps Script failed:', err?.message?.split('\n')[0] || err);
    }
  }

  if (shouldUseGmailAppPassword() && !isSmtpLikelyBlocked()) {
    try {
      await sendOtpViaSmtp(toEmail, purpose, otp);
      return;
    } catch (err: any) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
      console.warn('[auth] Gmail SMTP failed:', err?.message?.split('\n')[0] || err);
    }
  }

  if (isGmailOAuthConfigured()) {
    try {
      await sendOtpViaGmailApi(toEmail, purpose, otp);
      return;
    } catch (err: any) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
      console.warn('[auth] Gmail API failed:', err?.message);
    }

    if (!isSmtpLikelyBlocked()) {
      try {
        await sendOtpViaSmtp(toEmail, purpose, otp);
        return;
      } catch (err: any) {
        errors.push(err instanceof Error ? err : new Error(String(err)));
        console.warn('[auth] Gmail OAuth SMTP failed:', err?.message?.split('\n')[0] || err);
      }
    }
  }

  if (!isGmailOnlyOtp() && canResendDeliverTo(toEmail)) {
    try {
      await sendOtpViaResend(toEmail, purpose, otp);
      return;
    } catch (err: any) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
      console.warn('[auth] Resend failed:', err?.message);
    }
  }

  throw new OtpDeliveryError(
    buildEmailDeliveryFailedMessage(toEmail, errors),
    'EMAIL_DELIVERY_FAILED'
  );
};

export class OtpDeliveryError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly moreInfo?: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'OtpDeliveryError';
  }
}

const mapTwilioError = (err: any, to: string): never => {
  const code = err?.code;
  const message = err?.message || 'Twilio failed';

  if (code === 60605) {
    throw new OtpDeliveryError(
      'SMS to Cambodia is blocked in Twilio Verify Geo-Permissions. Enable KH under Verify → Geo permissions, or rely on direct SMS (verify the phone in Twilio trial).',
      String(code),
      err?.moreInfo
    );
  }

  if (code === 60203 || code === 21608 || code === 21614) {
    throw new OtpDeliveryError(
      `Phone ${to} is not verified on your Twilio trial. Add it at https://console.twilio.com/us1/develop/phone-numbers/manage/verified`,
      String(code),
      err?.moreInfo
    );
  }

  if (code === 63038) {
    throw new OtpDeliveryError(
      'Twilio trial daily SMS limit reached (5 messages/day). Try again tomorrow or upgrade your Twilio account.',
      String(code),
      err?.moreInfo
    );
  }

  throw new OtpDeliveryError(message, code ? String(code) : undefined, err?.moreInfo);
};

/** Send OTP by SMS using Twilio Messages API (works for KH when Verify geo is blocked). */
export const sendOtpViaSms = async (
  phoneDigits: string,
  purpose: OtpPurpose,
  otp: string
): Promise<void> => {
  const client = getTwilioClient();
  const to = toE164(phoneDigits);
  const from = await getTwilioFromNumber();

  try {
    const msg = await client.messages.create({
      to,
      from,
      body: `HCMS ${purposeLabel(purpose)} code: ${otp}. ${otpValidForLabel(purpose)}. Do not share this code.`,
    });
    console.info(`[auth] Twilio SMS sent to ${to} (sid ${msg.sid})`);
  } catch (err: any) {
    console.error(`[auth] Twilio SMS failed for ${to}:`, err?.code, err?.message);
    mapTwilioError(err, to);
  }
};

export const sendOtpViaTwilioVerify = async (phoneDigits: string): Promise<void> => {
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!serviceSid) {
    throw new OtpDeliveryError('TWILIO_VERIFY_SERVICE_SID is not set');
  }

  const client = getTwilioClient();
  const to = toE164(phoneDigits);

  try {
    await client.verify.v2.services(serviceSid).verifications.create({
      to,
      channel: 'sms',
    });
    console.info(`[auth] Twilio Verify SMS sent to ${to}`);
  } catch (err: any) {
    console.error(`[auth] Twilio Verify failed for ${to}:`, err?.code, err?.message);
    mapTwilioError(err, to);
  }
};

/**
 * Send OTP to the phone. Uses direct SMS when TWILIO_PHONE_NUMBER is set (best for Cambodia).
 * Otherwise uses Twilio Verify, with SMS fallback if Verify geo-blocks KH (60605).
 */
export const sendOtpViaTwilio = async (
  phoneDigits: string,
  purpose: OtpPurpose,
  otpForSmsFallback: string
): Promise<TwilioSendMethod> => {
  const useSmsFirst =
    process.env.TWILIO_SMS_FIRST === 'true' || Boolean(process.env.TWILIO_PHONE_NUMBER);

  if (useSmsFirst) {
    await sendOtpViaSms(phoneDigits, purpose, otpForSmsFallback);
    return 'sms';
  }

  if (process.env.TWILIO_VERIFY_SERVICE_SID) {
    try {
      await sendOtpViaTwilioVerify(phoneDigits);
      return 'verify';
    } catch (err: any) {
      if (err?.code !== '60605' && err?.code !== 60605) {
        throw err;
      }
      console.warn('[auth] Verify geo-blocked for KH; falling back to direct SMS');
    }
  }

  await sendOtpViaSms(phoneDigits, purpose, otpForSmsFallback);
  return 'sms';
};

export const verifyOtpViaTwilio = async (
  phoneDigits: string,
  code: string
): Promise<boolean> => {
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!serviceSid) {
    return false;
  }

  const client = getTwilioClient();
  const to = toE164(phoneDigits);

  const check = await client.verify.v2
    .services(serviceSid)
    .verificationChecks.create({ to, code });

  return check.status === 'approved';
};
