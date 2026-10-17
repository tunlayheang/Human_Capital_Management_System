import type { Transaction } from 'sequelize';
import { Employee } from './db.js';
import { findPortalUserForEmployee } from './userAuth.js';

export const PORTAL_USER_STATUS_ACTIVE = 'ACTIVE';
export const PORTAL_USER_STATUS_INACTIVE = 'INACTIVE';
export const PORTAL_USER_STATUS_FROZEN = 'FROZEN';

export function isPortalUserFrozen(user: {
  status?: string | null;
  isActive?: boolean | null;
} | null): boolean {
  if (!user) return false;
  return String(user.status ?? '')
    .trim()
    .toUpperCase() === PORTAL_USER_STATUS_FROZEN;
}

/** True when the portal account may hold an authenticated session. */
export function isPortalUserAllowedSession(user: {
  status?: string | null;
  isActive?: boolean | null;
} | null): boolean {
  if (!user || user.isActive === false) return false;
  const status = String(user.status ?? 'ACTIVE')
    .trim()
    .toUpperCase();
  return status !== 'INACTIVE' && status !== 'FROZEN' && status !== 'DISABLED';
}

/**
 * Block sign-in and end every active device session immediately
 * (freeze / deactivate while the user may still be online).
 */
export async function revokePortalSessionsForUser(
  userId: string,
  transaction?: Transaction
): Promise<void> {
  const id = String(userId || '').trim();
  if (!id) return;
  const { revokeAllDeviceSessions } = await import('./sessionIssue.js');
  const { User } = await import('./db.js');
  const user: any = await User.findByPk(id, {
    transaction,
    attributes: ['id', 'sessionToken'],
  });
  await revokeAllDeviceSessions(id, user ?? { sessionToken: null }, transaction);
  if (user && user.sessionToken != null) {
    await user.update({ sessionToken: null }, { transaction });
  }
}

/** Deactivate portal login; terminated employees get a frozen (archived) account. */
export async function syncPortalUserActiveForEmployee(
  employee: InstanceType<typeof Employee>,
  active: boolean,
  transaction: Transaction,
  options?: { forceFrozen?: boolean }
) {
  const plain = employee.get({ plain: true }) as {
    id?: string;
    email?: string;
    status?: string;
  };
  const user = await findPortalUserForEmployee(
    { id: plain.id, email: plain.email },
    { transaction }
  );
  if (!user) return;

  if (active) {
    await user.update(
      {
        status: PORTAL_USER_STATUS_ACTIVE,
        isActive: true,
      },
      { transaction }
    );
    return;
  }

  const empStatus = String(plain.status ?? '')
    .trim()
    .toLowerCase();
  const frozen =
    options?.forceFrozen === true || empStatus === 'terminated';

  await user.update(
    {
      status: frozen ? PORTAL_USER_STATUS_FROZEN : PORTAL_USER_STATUS_INACTIVE,
      isActive: false,
      sessionToken: null,
    },
    { transaction }
  );
  await revokePortalSessionsForUser(String(user.id), transaction);
}

/** Manual deactivate — portal status Inactive, cannot sign in. */
export async function freezePortalUserById(
  userId: string,
  transaction?: Transaction
): Promise<boolean> {
  const { User } = await import('./db.js');
  const user: any = await User.findByPk(userId, {
    transaction,
    attributes: ['id', 'status', 'isActive', 'sessionToken'],
  });
  if (!user) return false;
  await user.update(
    {
      status: PORTAL_USER_STATUS_INACTIVE,
      isActive: false,
      sessionToken: null,
    },
    { transaction }
  );
  await revokePortalSessionsForUser(userId, transaction);
  return true;
}

/** Restore sign-in after Inactive (or legacy Frozen) portal status. */
export async function unfreezePortalUserById(
  userId: string,
  transaction?: Transaction
): Promise<boolean> {
  const { User } = await import('./db.js');
  const user: any = await User.findByPk(userId, {
    transaction,
    attributes: ['id', 'status', 'isActive'],
  });
  if (!user) return false;
  const plain = user.get({ plain: true }) as { status?: string; isActive?: boolean };
  const status = String(plain.status ?? '')
    .trim()
    .toUpperCase();
  const alreadyActive =
    plain.isActive !== false &&
    status !== PORTAL_USER_STATUS_FROZEN &&
    status !== PORTAL_USER_STATUS_INACTIVE &&
    status !== 'DISABLED';
  if (alreadyActive) return true;
  await user.update(
    {
      status: PORTAL_USER_STATUS_ACTIVE,
      isActive: true,
    },
    { transaction }
  );
  return true;
}
