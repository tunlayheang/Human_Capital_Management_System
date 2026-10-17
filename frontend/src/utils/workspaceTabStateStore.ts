/**
 * In-memory state per workspace tab — survives route unmount when switching tabs.
 * Cleared when a tab is closed or the session ends (page reload).
 */
const tabBuckets = new Map<string, Map<string, unknown>>();
const MAX_TAB_BUCKETS = 24;

function bucketFor(tabId: string): Map<string, unknown> {
  let bucket = tabBuckets.get(tabId);
  if (!bucket) {
    if (tabBuckets.size >= MAX_TAB_BUCKETS) {
      const oldest = tabBuckets.keys().next().value;
      if (oldest) tabBuckets.delete(oldest);
    }
    bucket = new Map();
    tabBuckets.set(tabId, bucket);
  }
  return bucket;
}

export function readWorkspaceTabState<T>(tabId: string, slot: string): T | undefined {
  return tabBuckets.get(tabId)?.get(slot) as T | undefined;
}

export function writeWorkspaceTabState<T>(tabId: string, slot: string, value: T): void {
  bucketFor(tabId).set(slot, value);
}

export function clearWorkspaceTabState(tabId: string): void {
  tabBuckets.delete(tabId);
}

/** Drop one slot from every open workspace tab (e.g. after attendance rules save). */
export function clearWorkspaceTabSlotAcrossTabs(slot: string): void {
  for (const bucket of tabBuckets.values()) {
    bucket.delete(slot);
  }
}

const ATTENDANCE_RULES_REV_KEY = 'hcms.attendanceRulesRev';

/** Bump when Clock rules / office settings change so self-service can refetch immediately. */
export function bumpAttendanceRulesRevision(): void {
  try {
    sessionStorage.setItem(ATTENDANCE_RULES_REV_KEY, String(Date.now()));
    window.dispatchEvent(new Event('hcms-attendance-rules-changed'));
  } catch {
    /* ignore */
  }
}

export function getAttendanceRulesRevision(): string {
  try {
    return sessionStorage.getItem(ATTENDANCE_RULES_REV_KEY) || '0';
  } catch {
    return '0';
  }
}
