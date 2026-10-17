/** Process-wide barrier while a SQL restore is wiping/rebuilding tables. */
let activeRestores = 0;

export function beginDatabaseRestoreBarrier(): void {
  activeRestores += 1;
}

export function endDatabaseRestoreBarrier(): void {
  activeRestores = Math.max(0, activeRestores - 1);
}

export function isDatabaseRestoreBarrierActive(): boolean {
  return activeRestores > 0;
}

/** Paths that must stay reachable while tables are being rebuilt. */
export function isRestoreBarrierExemptPath(apiPath: string): boolean {
  const p = String(apiPath || '').split('?')[0];
  return (
    p === '/health' ||
    p === '/api/health' ||
    p.startsWith('/settings/backup/restore-status') ||
    p.startsWith('/api/settings/backup/restore-status') ||
    p.startsWith('/settings/backup/restore-upload') ||
    p.startsWith('/api/settings/backup/restore-upload') ||
    p.startsWith('/auth/login') ||
    p.startsWith('/api/auth/login')
  );
}
