import { Request, Response, NextFunction } from 'express';
import {
  getEffectivePermissionsForUser,
  hasEffectivePermission,
} from '../effectivePermissions';
import { roleGrantsInherentPermission } from '../roleInherentPermissions.js';
import { assertUserEligibleForChat } from '../chatEligibility.js';

type AuthUser = { id: string; role?: string };

const PORTAL_CHAT_SEND_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'HR', 'MANAGER', 'EMPLOYEE']);

/** Staff portal users may send chat messages (matches menu + self-service access). */
export const requireChatSend = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const currentUser = (req as Request & { user?: AuthUser }).user;
    if (!currentUser?.id) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    try {
      await assertUserEligibleForChat(currentUser.id);
    } catch (err: any) {
      const status = Number(err?.status) || 403;
      return res.status(status).json({
        message: err?.message || 'Only Active employees can use chat',
      });
    }

    const role = String(currentUser.role || '').toUpperCase();
    if (PORTAL_CHAT_SEND_ROLES.has(role)) {
      return next();
    }

    const map = await getEffectivePermissionsForUser(currentUser.id);
    if (hasEffectivePermission(map, 'chat.send') || hasEffectivePermission(map, 'chat.view')) {
      return next();
    }

    return res.status(403).json({
      message: 'Insufficient permissions',
      requiredPermission: 'chat.send',
    });
  } catch (error) {
    console.error('Chat send permission check failed:', error);
    res.status(500).json({ message: 'Permission check failed' });
  }
};

/**
 * Enforce catalog permission keys (with aliases). Matrix Grant/Deny applies to every role,
 * including ADMIN / SUPER_ADMIN.
 */
export const requireEffectivePermission =
  (...specKeys: string[]) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const currentUser = (req as Request & { user?: AuthUser }).user;
      if (!currentUser?.id) {
        return res.status(401).json({ message: 'Not authenticated' });
      }

      const role = String(currentUser.role || '').toUpperCase();

      if (specKeys.some((key) => roleGrantsInherentPermission(role, key))) {
        return next();
      }

      const map = await getEffectivePermissionsForUser(currentUser.id);
      const allowed = specKeys.some((key) => hasEffectivePermission(map, key, role));
      if (!allowed) {
        return res.status(403).json({
          message: 'Insufficient permissions',
          requiredPermission: specKeys[0],
        });
      }

      next();
    } catch (error) {
      console.error('Permission check failed:', error);
      res.status(500).json({ message: 'Permission check failed' });
    }
  };
