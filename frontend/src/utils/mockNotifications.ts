import { Notification, NotificationType } from '../types';

type MockDb = {
  notifications: Notification[];
};

export function mockPushNotification(
  db: MockDb,
  input: {
    userId: string;
    title: string;
    message: string;
    type?: NotificationType;
    link?: string;
    id?: string;
  }
): Notification {
  const row: Notification = {
    id: input.id || `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    userId: input.userId,
    title: input.title,
    message: input.message,
    type: input.type ?? NotificationType.INFO,
    isRead: false,
    createdAt: new Date().toISOString(),
    link: input.link,
  };
  db.notifications = [row, ...db.notifications];
  return row;
}

export function mockNotifyRoles(
  db: MockDb,
  users: { id: string; role: string }[],
  roles: string[],
  payload: Omit<Parameters<typeof mockPushNotification>[1], 'userId'>
): void {
  const roleSet = new Set(roles.map((r) => r.toUpperCase()));
  for (const u of users) {
    if (roleSet.has(String(u.role).toUpperCase())) {
      mockPushNotification(db, { ...payload, userId: u.id });
    }
  }
}
