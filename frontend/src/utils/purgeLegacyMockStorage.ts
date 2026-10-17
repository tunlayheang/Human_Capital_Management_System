const MOCK_STORAGE_PREFIX = 'hcms_db_';

/** Remove legacy browser mock DB keys so self-service never reads stale demo data. */
export function purgeLegacyMockStorage(): void {
  if (typeof localStorage === 'undefined') return;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(MOCK_STORAGE_PREFIX)) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);
}
