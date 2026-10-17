// @refresh reset
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { User, Role } from '../types';
import { Api, waitForBackendReady } from '../services/api';
import { useToast } from './ToastContext';
import { useLanguage } from './LanguageContext';
import { resolvePermissionKeys } from '../constants/permissionKeys';
import { roleGrantsInherentPermission } from '../utils/roleInherentPermissions';
import { permissionService } from '../services/permissionService';
import { resolveMediaUrl } from '../utils/mediaUrl';
import { getDeviceAuthPayload, rememberDeviceLabel, requestPersistentStorage, syncDeviceIdWithSession, isStandaloneDisplay } from '../utils/device';
import { clearPinSession } from '../utils/pinSession';
import {
  clearPortalSessionStorage,
  hydratePortalSessionFromDurableStore,
  isStoredSessionLocallyExpired,
  readStoredPortalSession,
  writePortalSessionRaw,
} from '../utils/portalSession';
import { clearCachedMenu } from '../utils/menuCache';
import { invalidateApiCache } from '../services/apiCache';
import { isAdminRole } from '../utils/adminNavScope';
import { normalizeAccessRole } from '../utils/accessRole';
import { LogoutConfirmDialog, type LogoutConfirmContext } from '../components/auth/LogoutConfirmDialog';
import { normalizeEmployeeDisplayId } from '../utils';

export type LogoutOptions = {
  /** Skip confirmation (e.g. expired session). */
  skipConfirm?: boolean;
  /** Opened from PIN lock — cancel returns to PIN entry. */
  fromPin?: boolean;
};

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (employeeId: string, password?: string) => Promise<void>;
  redeemHandoff: (handoffToken: string) => Promise<boolean>;
  requestOtp: (employeeId: string) => Promise<{ message?: string; devOtp?: string; maskedEmail?: string; expiresInSeconds?: number; expiresInMinutes?: number }>;
  verifyOtp: (employeeId: string, otp: string) => Promise<void>;
  forgotPassword: (employeeId: string) => Promise<{ message?: string; devOtp?: string; maskedEmail?: string; expiresInSeconds?: number; expiresInMinutes?: number }>;
  verifyResetPasswordOtp: (employeeId: string, otp: string) => Promise<void>;
  resetPassword: (employeeId: string, newPassword: string) => Promise<void>;
  logout: (options?: LogoutOptions) => Promise<void>;
  hasRole: (roles: Role | Role[]) => boolean;
  refreshUser: () => Promise<void>;
  /** Spec or DB permission key — matrix, overrides, API effective perms, then role fallback. */
  hasPermission: (permissionKey: string) => boolean;
  /** True after permission catalog + client store are initialized for the session user. */
  permissionsReady: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type ApiUserPayload = Record<string, unknown> & {
  id?: string;
  avatarUrl?: string;
  employee?: { avatar_url?: string | null } | null;
};

type LoginSessionPayload = {
  token: string;
  deviceId?: string;
  sessionExpiresAt?: string;
  sessionTimeoutMinutes?: number;
  devicesEvicted?: number;
  maxDevices?: number;
};

/** Merge API user payload with session token; avatar comes from Employee when linked. */
function mergeSessionUser(base: ApiUserPayload, token: string): User {
  const rawAvatar =
    (typeof base.avatarUrl === 'string' && base.avatarUrl) ||
    base.employee?.avatar_url ||
    '';
  const avatarUrl = resolveMediaUrl(rawAvatar) || '';
  const role = normalizeAccessRole(base.role);
  return { ...base, role, avatarUrl, token } as User;
}

function persistUserSession(user: User, session?: Partial<LoginSessionPayload>): User {
  const boundDeviceId = syncDeviceIdWithSession({
    deviceId: session?.deviceId || (user as User & { deviceId?: string }).deviceId,
    token: session?.token || user.token,
  });
  if (session?.deviceId || boundDeviceId) {
    localStorage.setItem('hcms_device_id', session?.deviceId || boundDeviceId);
  }
  const resolvedAvatar = user.avatarUrl ? resolveMediaUrl(user.avatarUrl) || user.avatarUrl : '';
  const merged = {
    ...user,
    ...(resolvedAvatar ? { avatarUrl: resolvedAvatar } : {}),
    ...(session?.deviceId || boundDeviceId
      ? { deviceId: session?.deviceId || boundDeviceId }
      : {}),
    ...(session?.sessionExpiresAt ? { sessionExpiresAt: session.sessionExpiresAt } : {}),
    ...(session?.sessionTimeoutMinutes != null
      ? { sessionTimeoutMinutes: session.sessionTimeoutMinutes }
      : {}),
  } as User;
  writePortalSessionRaw(merged);
  return merged;
}

async function finalizeLoginSession(
  base: ApiUserPayload,
  auth: LoginSessionPayload
): Promise<User> {
  requestPersistentStorage();
  syncDeviceIdWithSession({ deviceId: auth.deviceId, token: auth.token });
  let merged = mergeSessionUser(base, auth.token);
  merged = persistUserSession(merged, auth);
  const [meSettled, sessSettled] = await Promise.allSettled([
    Api.auth.me({ skipSessionRedirect: true }),
    Api.auth.getSession({ skipSessionRedirect: true }),
  ]);
  if (meSettled.status === 'fulfilled' && meSettled.value) {
    merged = persistUserSession(
      mergeSessionUser({ ...merged, ...(meSettled.value as ApiUserPayload) }, auth.token),
      auth
    );
  }
  if (sessSettled.status === 'fulfilled' && sessSettled.value) {
    const sess = sessSettled.value as {
      sessionExpiresAt?: string;
      deviceId?: string;
      sessionTimeoutMinutes?: number;
    };
    if (sess.sessionExpiresAt || sess.deviceId || sess.sessionTimeoutMinutes != null) {
      merged = persistUserSession(merged, {
        token: auth.token,
        sessionExpiresAt: sess.sessionExpiresAt ?? auth.sessionExpiresAt,
        deviceId: sess.deviceId ?? auth.deviceId,
        sessionTimeoutMinutes: sess.sessionTimeoutMinutes ?? auth.sessionTimeoutMinutes,
      });
    }
  }
  return merged;
}

type EffectivePermissionEntry = { actions?: string[]; source?: string };

/** API/DB may return actions as array, JSON string, or single action string. */
function normalizePermissionActions(actions: unknown): string[] {
  if (Array.isArray(actions)) return actions.map(String);
  if (typeof actions === 'string') {
    const trimmed = actions.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        /* single action string */
      }
    }
    return [trimmed];
  }
  return [];
}

function normalizeEffectivePermissions(data: unknown): Record<string, EffectivePermissionEntry> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out: Record<string, EffectivePermissionEntry> = {};
  for (const [key, raw] of Object.entries(data as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    out[key] = {
      ...(entry.source != null ? { source: String(entry.source) } : {}),
      actions: normalizePermissionActions(entry.actions),
    };
  }
  return out;
}

function effectivePermissionsEqual(
  prev: Record<string, EffectivePermissionEntry>,
  next: Record<string, EffectivePermissionEntry>
): boolean {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return false;
  return nextKeys.every((k) => {
    const a = normalizePermissionActions(prev[k]?.actions);
    const b = normalizePermissionActions(next[k]?.actions);
    return a.length === b.length && a.every((act, i) => act === b[i]);
  });
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [logoutConfirmContext, setLogoutConfirmContext] = useState<LogoutConfirmContext>('app');
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [effectivePermissions, setEffectivePermissions] = useState<
    Record<string, EffectivePermissionEntry>
  >({});
  const [permissionsReady, setPermissionsReady] = useState(false);
  const [permissionRevision, setPermissionRevision] = useState(0);
  const userRef = useRef(user);
  userRef.current = user;

  const isAuthenticated = !!user;

  useEffect(() => {
    return permissionService.subscribe(() => setPermissionRevision((r) => r + 1));
  }, []);

  const loadEffectivePermissions = useCallback(async (userId: string) => {
    try {
      const data = await Api.users.getEffectivePermissions(userId);
      const next = normalizeEffectivePermissions(data);
      setEffectivePermissions((prev) =>
        effectivePermissionsEqual(prev, next) ? prev : next
      );
    } catch {
      setEffectivePermissions((prev) => (Object.keys(prev).length === 0 ? prev : {}));
    }
  }, []);

  const hasPermission = useCallback(
    (permissionKey: string) => {
      if (!user) return false;
      if (roleGrantsInherentPermission(user.role, permissionKey)) return true;

      // Catalog matrix is only authoritative when keys are actually loaded.
      // Empty catalog + isReady() used to fall through to a stale /users/:id/permissions map.
      const catalogReady =
        permissionService.isReady() && permissionService.getAll().length > 0;

      if (catalogReady) {
        const matrixState = permissionService.effectivePermissionAny(
          user.id,
          user.role,
          permissionKey
        );
        // Explicit Deny always wins (e.g. Security Deny while settings.edit stays Grant).
        if (matrixState === false) return false;
        if (matrixState === true) return true;
      }

      for (const key of resolvePermissionKeys(permissionKey)) {
        const actions = normalizePermissionActions(effectivePermissions[key]?.actions);
        if (actions.length > 0) return true;
      }

      if (permissionsReady) {
        return false;
      }

      const profileKeys = Object.keys(effectivePermissions);
      const strictProfile = profileKeys.some((k) => k.startsWith('profile.'));
      if (permissionKey.startsWith('profile.') && !strictProfile) return true;

      return false;
    },
    [user, effectivePermissions, permissionRevision, permissionsReady]
  );

  const refreshUser = useCallback(async () => {
    const current = userRef.current;
    if (!current?.token) return;
    const { isBackupRestoreSessionGuarded } = await import('../services/api');
    if (isBackupRestoreSessionGuarded()) return;
    try {
      const updatedUser = (await Api.auth.me({ skipSessionRedirect: true })) as ApiUserPayload | null;
      if (!updatedUser?.id) return;

      const merged = mergeSessionUser({ ...current, ...updatedUser }, current.token);
      const prev = userRef.current;
      const pinUnchanged =
        prev &&
        prev.id === merged.id &&
        prev.role === merged.role &&
        prev.pinSet === (merged as User).pinSet &&
        prev.pinLockEnabled === (merged as User).pinLockEnabled &&
        prev.pinMandatory === (merged as User).pinMandatory &&
        prev.pinRequired === (merged as User).pinRequired &&
        prev.pinAutoLockMinutes === (merged as User).pinAutoLockMinutes;

      if (
        prev &&
        prev.id === merged.id &&
        prev.name === merged.name &&
        prev.email === merged.email &&
        prev.avatarUrl === merged.avatarUrl &&
        prev.mustChangePassword === (merged as User).mustChangePassword &&
        prev.passwordLength === (merged as User).passwordLength &&
        prev.hasPassword === (merged as User).hasPassword &&
        pinUnchanged
      ) {
        await loadEffectivePermissions(merged.id);
        return;
      }

      setUser(merged);
      persistUserSession(merged, {
        token: current.token,
        deviceId: merged.deviceId,
        sessionExpiresAt: merged.sessionExpiresAt,
      });
      await loadEffectivePermissions(merged.id);
    } catch (error) {
      console.error('Failed to refresh user', error);
    }
  }, [loadEffectivePermissions]);

  useEffect(() => {
    const initAuth = async () => {
      requestPersistentStorage();

      // Sync localStorage first so home-screen reopen enters the app immediately.
      // IndexedDB is only a fallback when LS is empty (or to keep the durable copy warm).
      let stored = readStoredPortalSession();
      if (!stored?.token) {
        try {
          stored = await Promise.race([
            hydratePortalSessionFromDurableStore(),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000)),
          ]);
        } catch {
          stored = null;
        }
      } else {
        void hydratePortalSessionFromDurableStore();
      }

      if (!stored?.token) {
        setIsLoading(false);
        return;
      }
      if (isStoredSessionLocallyExpired(stored.sessionExpiresAt)) {
        clearPortalSessionStorage();
        setIsLoading(false);
        return;
      }
      try {
        const storedUser = localStorage.getItem('hcms_user');
        const parsed = storedUser
          ? (JSON.parse(storedUser) as ApiUserPayload & LoginSessionPayload)
          : (stored as ApiUserPayload & LoginSessionPayload);
        if (!parsed?.token) {
          clearPortalSessionStorage();
          setIsLoading(false);
          return;
        }

        syncDeviceIdWithSession({
          deviceId: parsed.deviceId || stored.deviceId,
          token: parsed.token,
        });

        const optimistic = mergeSessionUser(parsed, parsed.token);
        setUser(optimistic);
        writePortalSessionRaw({ ...parsed, ...optimistic });
        // Unblock shell immediately — do not wait for Render wake / health poll.
        setIsLoading(false);

        // Soft-refresh session in the background — do not block on health polling.
        // Render cold starts may fail once; optimistic session stays until SessionKeeper clears it.
        void (async () => {
          try {
            const [meSettled, sessSettled] = await Promise.allSettled([
              Api.auth.me({ skipSessionRedirect: true }),
              Api.auth.getSession({ skipSessionRedirect: true }),
            ]);
            const meOk = meSettled.status === 'fulfilled' && meSettled.value;
            const sessOk = sessSettled.status === 'fulfilled' && sessSettled.value;
            if (!meOk && !sessOk) {
              // One wake attempt for free-tier sleep, then retry once.
              await waitForBackendReady({ maxWaitMs: 8_000 });
              const retry = await Promise.allSettled([
                Api.auth.me({ skipSessionRedirect: true }),
                Api.auth.getSession({ skipSessionRedirect: true }),
              ]);
              const me2 = retry[0].status === 'fulfilled' && retry[0].value;
              const sess2 = retry[1].status === 'fulfilled' && retry[1].value;
              if (!me2 && !sess2) return;
              if (!userRef.current?.token) return;
              const me = me2 ? (retry[0] as PromiseFulfilledResult<ApiUserPayload>).value : null;
              const sess = sess2
                ? ((retry[1] as PromiseFulfilledResult<{
                    sessionExpiresAt?: string;
                    deviceId?: string;
                    sessionTimeoutMinutes?: number;
                  }>).value)
                : null;
              let merged = mergeSessionUser({ ...parsed, ...(me || {}) }, parsed.token);
              merged = persistUserSession(merged, {
                token: parsed.token,
                sessionExpiresAt: sess?.sessionExpiresAt ?? parsed.sessionExpiresAt,
                deviceId: sess?.deviceId ?? parsed.deviceId ?? stored.deviceId,
                sessionTimeoutMinutes:
                  sess?.sessionTimeoutMinutes ?? parsed.sessionTimeoutMinutes,
              });
              setUser(merged);
              return;
            }
            if (!userRef.current?.token) return;
            const me = meOk ? (meSettled.value as ApiUserPayload) : null;
            let merged = mergeSessionUser({ ...parsed, ...(me || {}) }, parsed.token);
            const sess = sessOk
              ? (sessSettled.value as {
                  sessionExpiresAt?: string;
                  deviceId?: string;
                  sessionTimeoutMinutes?: number;
                } | null)
              : null;
            merged = persistUserSession(merged, {
              token: parsed.token,
              sessionExpiresAt: sess?.sessionExpiresAt ?? parsed.sessionExpiresAt,
              deviceId: sess?.deviceId ?? parsed.deviceId ?? stored.deviceId,
              sessionTimeoutMinutes: sess?.sessionTimeoutMinutes ?? parsed.sessionTimeoutMinutes,
            });
            setUser(merged);
          } catch (error) {
            console.warn('Session refresh deferred; keeping local login', error);
          }
        })();
        return;
      } catch (error) {
        console.error('Failed to parse stored user', error);
        clearPortalSessionStorage();
        setUser(null);
      }
      setIsLoading(false);
    };
    void initAuth();
  }, []);

  useEffect(() => {
    if (!user?.id) {
      permissionService.reset();
      setEffectivePermissions({});
      setPermissionsReady(false);
      return;
    }
    let cancelled = false;
    // Do not flip ready → false on every refresh (that flashed PageLoader on each route).
    // Initial state is already false; logout / missing user clears ready above.
    (async () => {
      try {
        await permissionService.initialize({ role: user.role });
        await loadEffectivePermissions(user.id);
      } finally {
        if (!cancelled) setPermissionsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.role, loadEffectivePermissions]);

  /** Keep local sessionExpiresAt in sync with server idle policy while the tab is open. */
  useEffect(() => {
    if (!user?.token) return;

    let cancelled = false;
    const syncSession = async () => {
      try {
        const sess = (await Api.auth.getSession({ skipSessionRedirect: true })) as {
          sessionExpiresAt?: string;
          deviceId?: string;
          sessionTimeoutMinutes?: number;
        } | null;
        if (cancelled || !sess || !userRef.current?.token) return;
        const next = persistUserSession(userRef.current, {
          token: userRef.current.token,
          sessionExpiresAt: sess.sessionExpiresAt,
          deviceId: sess.deviceId ?? userRef.current.deviceId,
          sessionTimeoutMinutes: sess.sessionTimeoutMinutes,
        });
        setUser((prev) => (prev?.token ? { ...prev, ...next } : prev));
      } catch (error: unknown) {
        const err = error as { status?: number; code?: string };
        if (err?.status === 401 && !cancelled) {
          clearPortalSessionStorage();
          setUser(null);
        }
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncSession();
    };
    document.addEventListener('visibilitychange', onVisible);

    const timeoutMinutes = Number(user.sessionTimeoutMinutes);
    const minutes =
      Number.isFinite(timeoutMinutes) && timeoutMinutes > 0 ? timeoutMinutes : 30;
    const intervalMs = Math.min(5 * 60_000, Math.max(60_000, Math.floor((minutes * 60_000) / 3)));
    const timer = window.setInterval(() => void syncSession(), intervalMs);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [user?.token, user?.sessionTimeoutMinutes]);

  const notifyDevicesEvicted = useCallback(
    (count?: number) => {
      if (!count || count < 1) return;
      showToast(
        t('messages.devicesEvicted', { count: String(count) }) ||
          `Signed out ${count} older device(s). Your account can stay signed in on 2 devices.`,
        'info'
      );
    },
    [showToast, t]
  );

  const login = async (employeeId: string, password?: string) => {
    setIsLoading(true);
    try {
      const device = getDeviceAuthPayload();
      const loginRes = (await Api.auth.login(
        normalizeEmployeeDisplayId(employeeId),
        password,
        device.deviceId,
        device.deviceLabel
      )) as LoginSessionPayload & { user: ApiUserPayload; deviceLabel?: string };
      if (loginRes.deviceLabel) rememberDeviceLabel(loginRes.deviceLabel);
      const merged = await finalizeLoginSession(loginRes.user, {
        token: loginRes.token,
        deviceId: loginRes.deviceId,
        sessionExpiresAt: loginRes.sessionExpiresAt,
        sessionTimeoutMinutes: loginRes.sessionTimeoutMinutes,
      });
      notifyDevicesEvicted(loginRes.devicesEvicted);
      clearPinSession(merged.id);
      setUser(merged);
      if (!isStandaloneDisplay()) {
        try {
          const handoff = (await Api.auth.createHandoff()) as {
            openPath?: string;
            handoffToken?: string;
          };
          if (handoff?.handoffToken) {
            const path =
              handoff.openPath || `/login?handoff=${encodeURIComponent(handoff.handoffToken)}`;
            const url = `${window.location.origin}${window.location.pathname}#${path.startsWith('/') ? path : `/${path}`}`;
            try {
              localStorage.setItem(
                'hcms_handoff_payload',
                JSON.stringify({ url, createdAt: Date.now(), expiresInMinutes: 15 })
              );
            } catch {
              /* ignore */
            }
            showToast(
              t('login.handoffReady') ||
                'Home-screen tip: open your app icon and sign in once there to stay signed in. Or use Profile → Copy home-screen link.',
              'info'
            );
          }
        } catch {
          /* handoff is optional */
        }
      } else {
        showToast(
          t('login.standaloneStaySignedIn') ||
            'Signed in on this home-screen app. You will stay signed in here until you sign out.',
          'success'
        );
      }
    } catch (error) {
      console.error('Login failed', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const redeemHandoff = async (handoffToken: string) => {
    setIsLoading(true);
    try {
      const res = (await Api.auth.redeemHandoff(handoffToken)) as LoginSessionPayload & {
        user: ApiUserPayload;
        deviceLabel?: string;
      };
      if (!res?.token || !res?.user) return false;
      if (res.deviceLabel) rememberDeviceLabel(res.deviceLabel);
      const merged = await finalizeLoginSession(res.user, {
        token: res.token,
        deviceId: res.deviceId,
        sessionExpiresAt: res.sessionExpiresAt,
        sessionTimeoutMinutes: res.sessionTimeoutMinutes,
      });
      clearPinSession(merged.id);
      setUser(merged);
      showToast(
        t('login.handoffSuccess') || 'Signed in on this home-screen app. You will stay signed in here.',
        'success'
      );
      return true;
    } catch (error) {
      console.error('Handoff redeem failed', error);
      showToast(
        t('login.handoffFailed') ||
          'Transfer link expired. Please sign in on this home-screen app.',
        'error'
      );
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const requestOtp = async (employeeId: string) => {
    setIsLoading(true);
    try {
      return await Api.auth.requestOtp(normalizeEmployeeDisplayId(employeeId));
    } catch (error) {
      console.error('Failed to request OTP', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const verifyOtp = async (employeeId: string, otp: string) => {
    setIsLoading(true);
    try {
      const device = getDeviceAuthPayload();
      const otpRes = (await Api.auth.verifyOtp(
        normalizeEmployeeDisplayId(employeeId),
        otp,
        device.deviceId,
        device.deviceLabel
      )) as LoginSessionPayload & { user: ApiUserPayload; deviceLabel?: string };
      if (otpRes.deviceLabel) rememberDeviceLabel(otpRes.deviceLabel);
      const merged = await finalizeLoginSession(otpRes.user, {
        token: otpRes.token,
        deviceId: otpRes.deviceId,
        sessionExpiresAt: otpRes.sessionExpiresAt,
        sessionTimeoutMinutes: otpRes.sessionTimeoutMinutes,
      });
      notifyDevicesEvicted(otpRes.devicesEvicted);
      clearPinSession(merged.id);
      setUser(merged);
    } catch (error) {
      console.error('OTP verification failed', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const forgotPassword = async (employeeId: string) => {
    setIsLoading(true);
    try {
      return await Api.auth.forgotPassword(normalizeEmployeeDisplayId(employeeId));
    } catch (error) {
      console.error('Failed to request forgot password OTP', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const verifyResetPasswordOtp = async (employeeId: string, otp: string) => {
    setIsLoading(true);
    try {
      await Api.auth.verifyResetPasswordOtp(normalizeEmployeeDisplayId(employeeId), otp);
    } catch (error) {
      console.error('Reset OTP verification failed', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const resetPassword = async (employeeId: string, newPassword: string) => {
    setIsLoading(true);
    try {
      await Api.auth.resetPassword(normalizeEmployeeDisplayId(employeeId), newPassword);
    } catch (error) {
      console.error('Password reset failed', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const performLogout = useCallback(async () => {
    try {
      await Api.auth.logout();
    } catch {
      /* clear local session even if server logout fails */
    }
    const uid = userRef.current?.id;
    if (uid) {
      clearPinSession(uid);
      clearCachedMenu(uid);
    }
    permissionService.reset();
    setUser(null);
    setEffectivePermissions({});
    invalidateApiCache();
    clearPortalSessionStorage();
    window.location.href = '/#/login';
  }, []);

  const logout = useCallback(
    async (options?: LogoutOptions) => {
      if (options?.skipConfirm) {
        await performLogout();
        return;
      }
      setLogoutConfirmContext(options?.fromPin ? 'pin' : 'app');
      setLogoutConfirmOpen(true);
    },
    [performLogout]
  );

  const cancelLogoutConfirm = useCallback(() => {
    if (!logoutLoading) setLogoutConfirmOpen(false);
  }, [logoutLoading]);

  const confirmLogout = useCallback(async () => {
    setLogoutLoading(true);
    try {
      await performLogout();
    } finally {
      setLogoutLoading(false);
      setLogoutConfirmOpen(false);
    }
  }, [performLogout]);

  const hasRole = (roles: Role | Role[]) => {
    if (!user) return false;
    if (isAdminRole(user.role)) return true;
    const requiredRoles = Array.isArray(roles) ? roles : [roles];
    const userRole = String(user.role || '').toUpperCase() as Role;
    return requiredRoles.some((r) => String(r).toUpperCase() === userRole);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoading,
        login,
        redeemHandoff,
        requestOtp,
        verifyOtp,
        forgotPassword,
        verifyResetPasswordOtp,
        resetPassword,
        logout,
        hasRole,
        refreshUser,
        hasPermission,
        permissionsReady,
      }}
    >
      {children}
      <LogoutConfirmDialog
        open={logoutConfirmOpen}
        context={logoutConfirmContext}
        loading={logoutLoading}
        onClose={cancelLogoutConfirm}
        onConfirm={confirmLogout}
      />
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
