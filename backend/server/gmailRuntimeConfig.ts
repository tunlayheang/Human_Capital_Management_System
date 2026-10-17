import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { SystemSetting } from './db.js';
import {
  clearGmailSmtpCache,
  isSmtpLikelyBlocked,
  resetGmailAppPasswordRejection,
  verifySmtpConnection,
} from './services/OtpDeliveryService.js';

export const GMAIL_OTP_SETTING_KEY = 'otp.gmail';

type GmailOtpSetting = {
  user?: string;
  from?: string;
  appPassword?: string;
  appsScriptUrl?: string;
  appsScriptSecret?: string;
};

const asObject = (value: unknown): GmailOtpSetting => {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as GmailOtpSetting;
    } catch {
      return {};
    }
  }
  if (typeof value === 'object') return value as GmailOtpSetting;
  return {};
};

/** Apply Gmail values into process.env. */
export const applyGmailEnv = (cfg: {
  user?: string;
  from?: string;
  appPassword?: string;
  appsScriptUrl?: string;
  appsScriptSecret?: string;
  force?: boolean;
}): void => {
  const force = Boolean(cfg.force);
  if (cfg.user && (force || !process.env.GMAIL_USER?.trim())) {
    process.env.GMAIL_USER = cfg.user.trim().toLowerCase();
  }
  if (cfg.from && (force || !process.env.GMAIL_FROM?.trim())) {
    process.env.GMAIL_FROM = cfg.from.trim().toLowerCase();
  }
  if (cfg.appPassword && (force || !process.env.GMAIL_APP_PASSWORD?.trim())) {
    process.env.GMAIL_APP_PASSWORD = cfg.appPassword.replace(/\s+/g, '');
  }
  if (cfg.appsScriptUrl && (force || !process.env.GMAIL_APPS_SCRIPT_URL?.trim())) {
    process.env.GMAIL_APPS_SCRIPT_URL = cfg.appsScriptUrl.trim();
  }
  if (cfg.appsScriptSecret && (force || !process.env.GMAIL_APPS_SCRIPT_SECRET?.trim())) {
    process.env.GMAIL_APPS_SCRIPT_SECRET = cfg.appsScriptSecret.trim();
  }
  if (!process.env.OTP_DELIVERY?.trim()) {
    process.env.OTP_DELIVERY = 'email';
  }
  if (!process.env.OTP_PROVIDER?.trim()) {
    process.env.OTP_PROVIDER = 'gmail';
  }
  clearGmailSmtpCache();
  resetGmailAppPasswordRejection();
};

/** Load Gmail OTP credentials from SystemSetting into process.env (DB fills gaps). */
export const loadGmailConfigFromDb = async (): Promise<boolean> => {
  const row: any = await SystemSetting.findOne({ where: { key: GMAIL_OTP_SETTING_KEY } });
  if (!row) return false;

  const cfg = asObject(row.value);
  const appPassword = String(cfg.appPassword || '').replace(/\s+/g, '');
  const appsScriptUrl = String(cfg.appsScriptUrl || '').trim();
  const appsScriptSecret = String(cfg.appsScriptSecret || '').trim();
  if (!appPassword && !(appsScriptUrl && appsScriptSecret)) return false;

  applyGmailEnv({
    user: cfg.user || 'iroc.hcms@gmail.com',
    from: cfg.from || cfg.user || 'iroc.hcms@gmail.com',
    appPassword: appPassword || undefined,
    appsScriptUrl: appsScriptUrl || undefined,
    appsScriptSecret: appsScriptSecret || undefined,
    force: false,
  });
  console.info(`[auth] Loaded Gmail OTP credentials from SystemSetting (${GMAIL_OTP_SETTING_KEY})`);
  return true;
};

const upsertGmailSetting = async (value: GmailOtpSetting): Promise<void> => {
  const existing: any = await SystemSetting.findOne({ where: { key: GMAIL_OTP_SETTING_KEY } });
  if (existing) {
    const prev = asObject(existing.value);
    existing.value = { ...prev, ...value };
    existing.category = 'auth';
    existing.description = 'Gmail OTP delivery credentials (SMTP and/or Apps Script HTTPS relay)';
    existing.isPublic = false;
    await existing.save();
  } else {
    await SystemSetting.create({
      id: `ss-gmail-${crypto.randomBytes(4).toString('hex')}`,
      key: GMAIL_OTP_SETTING_KEY,
      value,
      category: 'auth',
      description: 'Gmail OTP delivery credentials (SMTP and/or Apps Script HTTPS relay)',
      isPublic: false,
    });
  }
};

/** Persist Gmail app password (useful for local / paid Render SMTP). */
export const saveGmailConfigToDb = async (input: {
  user: string;
  from?: string;
  appPassword?: string;
  appsScriptUrl?: string;
  appsScriptSecret?: string;
}): Promise<void> => {
  const user = String(input.user || '').trim().toLowerCase();
  const from = String(input.from || user).trim().toLowerCase();
  const appPassword = String(input.appPassword || '').replace(/\s+/g, '');
  const appsScriptUrl = String(input.appsScriptUrl || '').trim();
  const appsScriptSecret = String(input.appsScriptSecret || '').trim();

  if (!user) {
    throw new Error('Gmail user is required');
  }
  if (!appPassword && !(appsScriptUrl && appsScriptSecret)) {
    throw new Error('Provide appPassword and/or appsScriptUrl + appsScriptSecret');
  }

  const value: GmailOtpSetting = {
    user,
    from,
    ...(appPassword ? { appPassword } : {}),
    ...(appsScriptUrl ? { appsScriptUrl } : {}),
    ...(appsScriptSecret ? { appsScriptSecret } : {}),
  };

  await upsertGmailSetting(value);
  applyGmailEnv({
    user,
    from,
    appPassword: appPassword || undefined,
    appsScriptUrl: appsScriptUrl || undefined,
    appsScriptSecret: appsScriptSecret || undefined,
    force: true,
  });
};

export const configureGmailAppPassword = async (input: {
  user: string;
  from?: string;
  appPassword?: string;
  appsScriptUrl?: string;
  appsScriptSecret?: string;
}): Promise<{ ok: boolean; message: string }> => {
  await saveGmailConfigToDb(input);

  const ok = await verifySmtpConnection();
  if (ok) {
    return { ok: true, message: 'Gmail OTP email is configured and verified.' };
  }

  if (input.appsScriptUrl) {
    return {
      ok: false,
      message:
        'Saved Apps Script URL but relay check failed. Confirm the Web App is deployed (Anyone) and the secret matches.',
    };
  }

  if (isSmtpLikelyBlocked()) {
    return {
      ok: false,
      message:
        'Saved app password, but Render free tier blocks SMTP. Deploy backend/scripts/gmail-otp-apps-script.gs and POST appsScriptUrl + appsScriptSecret.',
    };
  }

  return {
    ok: false,
    message: 'Saved credentials but SMTP verify failed. Check the Gmail app password.',
  };
};

export const getGmailAppsScriptSource = (): string => {
  const p = path.join(process.cwd(), 'scripts', 'gmail-otp-apps-script.gs');
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  return '';
};
