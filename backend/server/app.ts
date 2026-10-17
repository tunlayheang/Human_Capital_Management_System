import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import { initDb, isDatabaseReady, sequelize } from './db';
import { isDatabaseConnectionError } from './mysqlConfig';
import { router } from './routes';
import { performanceMiddleware, monitorPool } from './middleware/performance';
import {
  getOtpDeliveryMode,
  verifySmtpConnection,
  isEmailConfigured,
  getGmailSetupMessage,
  hasGmailOAuthCredentials,
} from './services/OtpDeliveryService.js';
import { gmailSetupRouter } from './gmailSetupRoutes.js';
import { loadGmailConfigFromDb } from './gmailRuntimeConfig.js';
import { contentTypeForUploadFile } from './uploadMime.js';
import {
  isUploadImagePath,
  UPLOAD_MISSING_IMAGE_PLACEHOLDER,
} from './uploadPlaceholder.js';

/** Known production SPA origin — keep in sync with render.yaml / frontend deployOrigins. */
const PRODUCTION_FRONTEND_ORIGINS = [
  'https://iroc-hcms-frontend1.onrender.com',
] as const;

function splitOriginList(raw: string | undefined): string[] {
  return String(raw || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * Allowed browser Origins for credentialed CORS.
 * Production always includes the known Render frontend + CORS_ORIGIN / FRONTEND_URL,
 * so a missing dashboard env var does not lock the SPA out.
 */
export function getAllowedOrigins(): string[] {
  const fromEnv = [
    ...splitOriginList(process.env.CORS_ORIGIN),
    ...splitOriginList(process.env.FRONTEND_URL),
    ...splitOriginList(process.env.VITE_PUBLIC_URL),
    ...splitOriginList(process.env.PUBLIC_APP_URL),
  ];

  if (process.env.NODE_ENV === 'production') {
    return [...new Set([...PRODUCTION_FRONTEND_ORIGINS, ...fromEnv])];
  }

  const devExtras = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:3002',
    'http://127.0.0.1:3002',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
  ];
  return [...new Set([...fromEnv, ...devExtras])];
}

export async function createApp() {
  const app = express();
  const allowedOrigins = getAllowedOrigins();

  // Render sits behind a reverse proxy; required for rate-limit + secure cookies.
  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  // Compression
  app.use(compression());

  // Security headers — allow uploaded images to be embedded from the Vite dev origin
  // (and production UI origin) when clients request /uploads/* directly.
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  console.log(`[cors] Allowed origins (${allowedOrigins.length}): ${allowedOrigins.join(', ')}`);

  app.use(
    cors({
      origin(origin, callback) {
        // Non-browser clients (health checks, server-to-server) send no Origin.
        if (!origin) {
          callback(null, true);
          return;
        }
        const normalized = origin.replace(/\/+$/, '');
        if (allowedOrigins.includes(normalized) || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        console.warn(`[cors] Blocked origin: ${origin}`);
        callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      // Do not set allowedHeaders — cors reflects Access-Control-Request-Headers
      // (Authorization, X-Device-Id, Content-Type, etc.) so SPA preflight succeeds.
      optionsSuccessStatus: 204,
    })
  );

  // Employee creates often include base64 avatars; default ~100kb limit causes 413 Payload Too Large.
  const jsonBodyLimit = process.env.JSON_BODY_LIMIT || '12mb';
  app.use(express.json({ limit: jsonBodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: jsonBodyLimit }));

  // SPA clients issue many parallel API calls (dashboards, tab restores, filters).
  // 100/15min was too low for production and caused widespread 429s on Render.
  const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
  const rateLimitMax =
    Number(process.env.RATE_LIMIT_MAX) ||
    (process.env.NODE_ENV === 'production' ? 3000 : 1000);

  app.use(
    rateLimit({
      windowMs: rateLimitWindowMs,
      max: rateLimitMax,
      message: { error: 'Too many requests, please try again later' },
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => {
        if (process.env.NODE_ENV !== 'production') return true;
        if (process.env.RATE_LIMIT_DISABLED === '1') return true;
        const path = req.path || req.url || '';
        if (path === '/api/health' || path.startsWith('/api/health')) return true;
        if (path.startsWith('/uploads/')) return true;
        return false;
      },
    })
  );

  // Performance monitoring
  app.use(performanceMiddleware);

  // While a restore is wiping/rebuilding tables, reject normal API traffic so Sequelize
  // does not thrash on missing tables. Poll status + health stay available.
  app.use('/api', (req, res, next) => {
    void (async () => {
      try {
        const {
          isDatabaseRestoreBarrierActive,
          isRestoreBarrierExemptPath,
        } = await import('./databaseRestoreBarrier.js');
        if (!isDatabaseRestoreBarrierActive()) {
          next();
          return;
        }
        if (isRestoreBarrierExemptPath(req.path) || isRestoreBarrierExemptPath(req.originalUrl)) {
          next();
          return;
        }
        res.status(503).json({
          message: 'Database restore is in progress. Please wait…',
          code: 'DB_RESTORE_IN_PROGRESS',
        });
      } catch {
        next();
      }
    })();
  });

  // Initialize database in the background so the HTTP server can accept /api/health immediately.
  void initDb()
    .then(async () => {
      try {
        await loadGmailConfigFromDb();
      } catch (err: any) {
        console.warn('[auth] Could not load Gmail OTP config from DB:', err?.message || err);
      }

      const wantsEmail =
        process.env.OTP_DELIVERY?.toLowerCase() === 'email' || isEmailConfigured();

      if (wantsEmail) {
        if (!isEmailConfigured()) {
          const hint = getGmailSetupMessage();
          console.error(
            '\n[auth] Gmail OTP is NOT ready.' +
              (hint ? `\n       ${hint.replace(/\n/g, '\n       ')}\n` : '\n') +
              '       Or POST /api/setup/gmail-smtp with confirm=ENABLE_GMAIL_OTP and appPassword.\n'
          );
        } else if (
          hasGmailOAuthCredentials() &&
          !process.env.GMAIL_REFRESH_TOKEN?.trim() &&
          !process.env.GMAIL_APP_PASSWORD?.trim() &&
          !process.env.SMTP_PASS?.trim()
        ) {
          console.error(
            '\n[auth] Gmail Client ID/Secret found but OAuth not authorized.\n' +
              '       Open http://localhost:4000/api/setup/gmail/start (sign in as iroc.hcms@gmail.com), then restart.\n'
          );
        } else {
          void verifySmtpConnection().then((ok) => {
            if (ok) {
              console.info(
                "[auth] Gmail OTP ready — codes will be sent to each user's registered email."
              );
            }
          });
        }
      }

      if (process.env.NODE_ENV === 'production' && isDatabaseReady) {
        monitorPool(sequelize);
      }

      try {
        const { startBackupScheduler } = await import('./backupScheduler.js');
        startBackupScheduler();
      } catch (err: unknown) {
        console.warn('[backup] Could not start scheduler:', err instanceof Error ? err.message : err);
      }
    })
    .catch((err) => {
      console.error('[db] initDb failed:', err instanceof Error ? err.message : err);
    });

  app.use('/api', gmailSetupRouter);
  // API routes (authenticated by default inside router after /auth handlers)
  app.use('/api', router);

  // Serve uploads (explicit CORP so <img src="http://api/uploads/..."> works cross-origin if needed)
  app.use(
    '/uploads',
    (_req, res, next) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      next();
    },
    express.static('uploads', {
      maxAge: '1d',
      etag: true,
      fallthrough: true,
      setHeaders(res, filePath) {
        const ct = contentTypeForUploadFile(filePath);
        if (ct) res.setHeader('Content-Type', ct);
      },
    }),
    (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.status(404).end();
        return;
      }
      if (!isUploadImagePath(req.path)) {
        res.status(404).end();
        return;
      }
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=120');
      res.status(200).send(UPLOAD_MISSING_IMAGE_PLACEHOLDER);
    }
  );

  return app;
}