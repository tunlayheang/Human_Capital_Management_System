/** User is "online" when lastActivity is within this window */
export const CHAT_ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

export function isUserOnline(lastActivity: unknown): boolean {
  if (!lastActivity) return false;
  const t = new Date(lastActivity as string | Date).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < CHAT_ONLINE_THRESHOLD_MS;
}

export function lastSeenIso(lastActivity: unknown): string | undefined {
  if (!lastActivity) return undefined;
  const d = new Date(lastActivity as string | Date);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
