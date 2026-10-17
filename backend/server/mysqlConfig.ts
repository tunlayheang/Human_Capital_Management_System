/**
 * Shared MySQL connection settings for Sequelize and mysql2 (import script).
 */

export function normalizeMysqlUrl(rawUrl: string): { connectionUrl: string; useSsl: boolean } {
  let useSsl = /aivencloud\.com/i.test(rawUrl);

  const q = rawUrl.indexOf('?');
  if (q >= 0) {
    const query = rawUrl.slice(q + 1);
    if (/ssl-mode=REQUIRED|ssl-mode=required|ssl=true|sslmode=required/i.test(query)) {
      useSsl = true;
    }
    return { connectionUrl: rawUrl.slice(0, q), useSsl };
  }
  return { connectionUrl: rawUrl, useSsl };
}

/** SSL for cloud MySQL only — never apply DB_SSL to local XAMPP (HANDSHAKE_NO_SSL_SUPPORT). */
export function resolveMysqlSsl(useUrl: boolean): boolean {
  const raw = process.env.MYSQL_URL?.trim() || '';
  if (raw) return normalizeMysqlUrl(raw).useSsl;
  if (useUrl) return false;
  const host = `${process.env.DB_HOST || 'localhost'}`;
  if (/aivencloud\.com/i.test(host)) {
    return process.env.DB_SSL === 'true' || process.env.MYSQL_SSL === 'true';
  }
  return false;
}

/** Aiven often needs rejectUnauthorized: false unless you install their CA bundle. */
export function sslRejectUnauthorized(): boolean {
  if (process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true') return true;
  if (process.env.DB_SSL_REJECT_UNAUTHORIZED === 'false') return false;
  const hint = `${process.env.MYSQL_URL || ''} ${process.env.DB_HOST || ''}`;
  if (/aivencloud\.com/i.test(hint)) return false;
  return true;
}

export function buildMysql2Ssl() {
  const useSsl = resolveMysqlSsl(true);
  if (!useSsl) return undefined;
  return {
    require: true,
    rejectUnauthorized: sslRejectUnauthorized(),
  };
}

export function isDatabaseSchemaError(error: unknown): boolean {
  const err = error as { name?: string; parent?: { code?: string }; original?: { code?: string } };
  const code = err?.parent?.code || err?.original?.code || '';
  return code === 'ER_BAD_FIELD_ERROR' || code === 'ER_NO_SUCH_TABLE';
}

export function isDatabaseConnectionError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|Access denied|ER_ACCESS_DENIED|SSL|HANDSHAKE_NO_SSL|self-signed|certificate|does not support secure connection/i.test(
    msg
  );
}

export function buildSequelizeDialectOptions(useSsl: boolean) {
  const charsetOpts: Record<string, unknown> = {
    charset: 'utf8mb4',
    timezone: '+00:00',
    // Fail slow remote connects sooner so the pool can recycle instead of hanging.
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15_000),
  };
  if (!useSsl) return charsetOpts;
  return {
    ...charsetOpts,
    ssl: {
      require: true,
      rejectUnauthorized: sslRejectUnauthorized(),
    },
  };
}
