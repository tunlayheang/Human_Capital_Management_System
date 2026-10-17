import type { Notification } from '../types';
import { resolveNotificationLink } from './notificationNavigation';

const PERMISSION_KEY = 'hcms.browserNotifications.asked';

export type BrowserNotificationOpenDetail = {
  link: string;
  notificationId: string;
};

export const NOTIFICATION_OPEN_EVENT = 'hcms:notification-open';

export function browserNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function browserNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!browserNotificationsSupported()) return 'unsupported';
  return Notification.permission;
}

/** Ask once per browser profile when user has not denied. */
export async function ensureBrowserNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!browserNotificationsSupported()) return 'unsupported';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  try {
    const asked = localStorage.getItem(PERMISSION_KEY) === '1';
    if (asked) return Notification.permission;
    localStorage.setItem(PERMISSION_KEY, '1');
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function shouldSurfaceBrowserAlert(): boolean {
  if (typeof document === 'undefined') return false;
  return document.hidden || !document.hasFocus();
}

export function showBrowserNotification(
  n: Notification,
  options?: { roles?: string[] }
): void {
  if (!browserNotificationsSupported()) return;
  if (Notification.permission !== 'granted') return;
  if (!shouldSurfaceBrowserAlert()) return;

  const link = resolveNotificationLink(n, { roles: options?.roles }) ?? n.link;

  try {
    const body = n.message?.trim() || 'Open HCMS to view details.';
    const notification = new Notification(n.title || 'HCMS', {
      body,
      tag: n.id,
      silent: false,
    });
    notification.onclick = () => {
      window.focus();
      if (link) {
        window.dispatchEvent(
          new CustomEvent<BrowserNotificationOpenDetail>(NOTIFICATION_OPEN_EVENT, {
            detail: { link, notificationId: n.id },
          })
        );
      }
      notification.close();
    };
  } catch {
    /* ignore — autoplay / permission edge cases */
  }
}
