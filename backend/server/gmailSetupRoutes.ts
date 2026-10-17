import crypto from 'crypto';
import { Router, type RequestHandler } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { upsertEnvLocal } from './emailEnvConfig.js';
import {
  configureGmailAppPassword,
  getGmailAppsScriptSource,
} from './gmailRuntimeConfig.js';
import {
  getOtpEmailStatus,
  isEmailConfigured,
  isSmtpLikelyBlocked,
  verifySmtpConnection,
} from './services/OtpDeliveryService.js';

const getGmailOAuthRedirectUri = () => {
  if (process.env.GMAIL_OAUTH_REDIRECT_URI?.trim()) {
    return process.env.GMAIL_OAUTH_REDIRECT_URI.trim();
  }
  const port = Number(process.env.PORT || 4000);
  return `http://127.0.0.1:${port}/api/setup/gmail/callback`;
};

export const gmailSetupRouter = Router();

const tokensMatch = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

/**
 * This endpoint rewrites OTP delivery credentials, so an open version lets anyone redirect every
 * login/reset code to a relay they control. In production it requires SETUP_ADMIN_TOKEN and stays
 * disabled until that secret is set; locally it is open so first-time setup still works.
 */
const requireSetupToken: RequestHandler = (req, res, next) => {
  if (process.env.NODE_ENV !== 'production') return next();

  const expected = process.env.SETUP_ADMIN_TOKEN?.trim();
  if (!expected) {
    console.error(
      '[auth] /api/setup/gmail-smtp is disabled: set SETUP_ADMIN_TOKEN to enable remote Gmail OTP setup.'
    );
    return res.status(404).json({ message: 'Not found' });
  }

  const provided = String(
    req.get('x-setup-token') || (req.body as any)?.setupToken || ''
  ).trim();
  if (!provided || !tokensMatch(provided, expected)) {
    return res.status(401).json({ message: 'Invalid setup token.' });
  }

  return next();
};

/** Return the Apps Script source to paste into script.google.com */
gmailSetupRouter.get('/setup/gmail-apps-script', (_req, res) => {
  const source = getGmailAppsScriptSource();
  if (!source) {
    return res.status(404).json({ message: 'Apps Script template not found on server.' });
  }
  res.type('text/plain').send(source);
});

/**
 * Configure Gmail OTP delivery.
 * Body: {
 *   confirm: "ENABLE_GMAIL_OTP",
 *   appPassword?: string,          // works locally / paid Render
 *   appsScriptUrl?: string,        // required on Render free (HTTPS)
 *   appsScriptSecret?: string,
 *   user?: string,
 *   from?: string,
 *   rotate?: boolean
 * }
 */
gmailSetupRouter.post('/setup/gmail-smtp', requireSetupToken, async (req, res) => {
  const confirm = String(req.body?.confirm || '').trim();
  if (confirm !== 'ENABLE_GMAIL_OTP') {
    return res.status(400).json({
      message: 'Set confirm to ENABLE_GMAIL_OTP to configure Gmail SMTP.',
      smtpLikelyBlocked: isSmtpLikelyBlocked(),
      hint: isSmtpLikelyBlocked()
        ? 'Render free blocks SMTP. GET /api/setup/gmail-apps-script, deploy it, then POST appsScriptUrl + appsScriptSecret.'
        : undefined,
    });
  }

  const appPassword = String(req.body?.appPassword || '').replace(/\s+/g, '');
  const appsScriptUrl = String(req.body?.appsScriptUrl || '').trim();
  const appsScriptSecret = String(req.body?.appsScriptSecret || '').trim();
  const user = String(req.body?.user || process.env.GMAIL_USER || 'iroc.hcms@gmail.com')
    .trim()
    .toLowerCase();
  const from = String(req.body?.from || process.env.GMAIL_FROM || user)
    .trim()
    .toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user)) {
    return res.status(400).json({ message: 'Provide a valid Gmail user.' });
  }

  if (!appsScriptUrl && appPassword.length < 16) {
    return res.status(400).json({
      message: 'Provide a 16-character app password and/or appsScriptUrl + appsScriptSecret.',
      smtpLikelyBlocked: isSmtpLikelyBlocked(),
    });
  }

  if (appsScriptUrl && !appsScriptSecret) {
    return res.status(400).json({
      message: 'appsScriptSecret is required with appsScriptUrl (must match OTP_RELAY_SECRET in the script).',
    });
  }

  if (isEmailConfigured() && req.body?.rotate !== true) {
    return res.status(409).json({
      message: 'Gmail OTP is already configured. Send rotate:true to replace credentials.',
      providers: getOtpEmailStatus(),
    });
  }

  try {
    const result = await configureGmailAppPassword({
      user,
      from,
      appPassword: appPassword || undefined,
      appsScriptUrl: appsScriptUrl || undefined,
      appsScriptSecret: appsScriptSecret || undefined,
    });
    return res.status(result.ok ? 200 : 502).json({
      ...result,
      providers: getOtpEmailStatus(),
    });
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || 'Failed to save Gmail SMTP config' });
  }
});

/** One-time Gmail OAuth (admin only). Not shown on the employee login screen. */
gmailSetupRouter.get('/setup/gmail/start', (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).send('Not found');
  }

  const clientId = process.env.GMAIL_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return res.status(400).send(
      'Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in backend/.env first (Google Cloud → OAuth Desktop app).'
    );
  }

  const redirectUri = getGmailOAuthRedirectUri();
  const oauth2 = new OAuth2Client(clientId, clientSecret, redirectUri);
  const url = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.send'],
    prompt: 'consent',
  });

  res.redirect(url);
});

gmailSetupRouter.get('/setup/gmail/callback', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).send('Not found');
  }

  const code = String(req.query.code || '');
  if (!code) {
    return res.status(400).send('Missing authorization code.');
  }

  const clientId = process.env.GMAIL_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();
  const redirectUri = getGmailOAuthRedirectUri();
  const oauth2 = new OAuth2Client(clientId, clientSecret, redirectUri);

  try {
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      return res.status(400).send(
        'No refresh token returned. Revoke HCMS at https://myaccount.google.com/permissions and try again.'
      );
    }

    upsertEnvLocal({ GMAIL_REFRESH_TOKEN: tokens.refresh_token });
    const ok = await verifySmtpConnection();

    res.send(
      ok
        ? '<h2>Gmail OTP email is configured.</h2><p>Restart the backend, then use phone OTP login.</p>'
        : '<h2>Token saved but verification failed.</h2><p>Check SMTP_USER matches the Google account you signed in with.</p>'
    );
  } catch (err: any) {
    res.status(500).send(`OAuth failed: ${err?.message || err}`);
  }
});
