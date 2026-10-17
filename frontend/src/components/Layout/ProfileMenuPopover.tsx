import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  LogOut,
  Monitor,
  Moon,
  Shield,
  Smartphone,
  Sun,
  User,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { useWorkspaceNavigate } from '../../hooks/useWorkspaceNavigate';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { useCompactLayout } from '../../hooks/useCompactLayout';
import { Api } from '../../services/api';
import { isStandaloneDisplay } from '../../utils/device';
import { resolveMediaUrl, onAvatarImageError } from '../../utils/mediaUrl';
import { anchorRectToViewportStyle, Z_CHROME_MENU } from '../../utils/overlayPortal';
import { userDisplayEmployeeCode, userDisplayPosition } from '../../utils/userProfile';
import { formatAccessRoleLabel } from '../../utils/accessRole';
import { usePersonDisplayName } from '../../hooks/usePersonDisplayName';
import type { User as AppUser } from '../../types';
import { formatDateTimeDisplay } from '../../utils/formatDisplayDate';

const Z_BACKDROP = Z_CHROME_MENU;
const Z_PANEL = Z_CHROME_MENU + 1;

type DeviceAuditLog = {
  id: string;
  action: string;
  reason?: string | null;
  createdAt?: string;
  ipAddress?: string | null;
  deviceLabel?: string | null;
  browser?: string | null;
  os?: string | null;
  deviceType?: string | null;
};

type DeviceSession = {
  deviceId: string;
  deviceLabel: string;
  lastActivity?: string;
  signedInAt?: string;
  sessionExpiresAt?: string;
  isCurrent?: boolean;
  recentLogs: DeviceAuditLog[];
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
};

function formatWhen(value?: string) {
  return formatDateTimeDisplay(value, value || '—');
}

function actionLabel(action: string) {
  const a = action.toLowerCase();
  if (a.includes('success') || a === 'login') return 'Signed in';
  if (a.includes('fail')) return 'Failed sign-in';
  if (a.includes('otp')) return 'OTP verification';
  if (a.includes('logout')) return 'Signed out';
  return action.replace(/_/g, ' ');
}

function ProfileInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-xs">
      <span className="shrink-0 text-slate-500 dark:text-slate-400">{label}</span>
      <span className="min-w-0 text-right font-medium text-slate-800 dark:text-slate-100 truncate" title={value}>
        {value || '—'}
      </span>
    </div>
  );
}

export const ProfileMenuPopover: React.FC<Props> = ({ isOpen, onClose, anchorRef }) => {
  const { user, logout } = useAuth();
  const displayName = usePersonDisplayName();
  const { theme, toggleTheme } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const { showToast } = useToast();
  const { goTo } = useWorkspaceNavigate();
  const { confirm, ConfirmDialogHost } = useConfirmDialog();
  const compact = useCompactLayout();
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const standalone = isStandaloneDisplay();
  const [style, setStyle] = useState({ top: 0, right: 16, width: 360 });

  const avatarSrc = resolveMediaUrl(user?.avatarUrl);

  const departmentName = useMemo(() => {
    if (!user?.departmentId) return '';
    return departments.find((d) => d.id === user.departmentId)?.name || '';
  }, [user?.departmentId, departments]);

  const updatePosition = useCallback(() => {
    if (compact) return;
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const base = anchorRectToViewportStyle(rect);
    setStyle({ top: base.top, right: base.right, width: Math.max(340, base.width) });
  }, [anchorRef, compact]);

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const data = (await Api.auth.getDevices()) as {
        devices?: DeviceSession[];
      };
      const list = Array.isArray(data?.devices) ? data.devices : [];
      setDevices(list);
      if (list.length === 1) setExpandedDevice(list[0].deviceId);
    } catch {
      setDevices([]);
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;
    setAvatarBroken(false);
    void loadDevices();
    let cancelled = false;
    void Api.departments.getAll().then((rows) => {
      if (!cancelled && Array.isArray(rows)) {
        setDepartments(rows.map((d: { id: string; name: string }) => ({ id: d.id, name: d.name })));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, loadDevices, user?.departmentId]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !compact) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen, compact]);

  const handleTerminate = async (device: DeviceSession) => {
    if (revokingId) return;
    const label = device.deviceLabel || 'this device';
    const msg = device.isCurrent
      ? `End your session on ${label}? You will need to sign in again.`
      : `End the session on ${label}?`;
    const ok = await confirm({
      title: device.isCurrent ? 'End your session?' : 'End device session?',
      description: msg,
      variant: 'danger',
      confirmLabel: 'End session',
    });
    if (!ok) return;
    setRevokingId(device.deviceId);
    try {
      const res = (await Api.auth.revokeDeviceSession(device.deviceId)) as { isCurrent?: boolean };
      if (res?.isCurrent) {
        onClose();
        await logout({ skipConfirm: true });
        return;
      }
      await loadDevices();
    } catch {
      /* toast handled by api client if needed */
    } finally {
      setRevokingId(null);
    }
  };

  const copyHomeScreenHandoff = async () => {
    setHandoffBusy(true);
    try {
      const handoff = (await Api.auth.createHandoff()) as {
        openPath?: string;
        handoffToken?: string;
      };
      if (!handoff?.handoffToken) {
        showToast(t('login.handoffFailed') || 'Could not create transfer link.', 'error');
        return;
      }
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
      let shared = false;
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
          await navigator.share({
            title: 'HCMS home-screen sign-in',
            text: 'Open this link in your HCMS home-screen app to stay signed in.',
            url,
          });
          shared = true;
        }
      } catch {
        /* user cancelled share — fall through to clipboard */
      }
      if (!shared) {
        await navigator.clipboard.writeText(url);
        showToast(
          t('login.handoffCopied') ||
            'Transfer link copied. Open your HCMS home-screen icon, then paste the link in Safari address bar once — or sign in on the icon.',
          'success'
        );
      } else {
        showToast(
          t('login.handoffShared') ||
            'Open the shared link from your home-screen HCMS app (or sign in once on the icon).',
          'success'
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not create transfer link.';
      showToast(msg, 'error');
    } finally {
      setHandoffBusy(false);
    }
  };

  if (!isOpen || !user) return <ConfirmDialogHost />;

  const employeeId = userDisplayEmployeeCode(user as AppUser);
  const position = userDisplayPosition(user as AppUser, language);

  const panelBody = (
    <div className="flex flex-col min-h-0 max-h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200/80 dark:border-slate-700/80 shrink-0">
        <span className="text-sm font-semibold text-slate-900 dark:text-white">Account</span>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="overflow-y-auto overscroll-contain flex-1 min-h-0">
        {compact && (
          <div className="px-3 pt-3 pb-1">
            <p className="px-1 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Quick actions
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 py-3 px-1 text-[10px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={() => setLanguage(language === 'en' ? 'km' : 'en')}
                aria-label={
                  language === 'en' ? t('language.switchToKhmer') : t('language.switchToEnglish')
                }
              >
                <Globe className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                <span className="text-center leading-tight">{language === 'en' ? 'EN' : 'KM'}</span>
              </button>
              <button
                type="button"
                className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 py-3 px-1 text-[10px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={toggleTheme}
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? (
                  <Sun className="w-5 h-5 text-amber-400" />
                ) : (
                  <Moon className="w-5 h-5" />
                )}
                <span className="text-center leading-tight">Theme</span>
              </button>
            </div>
          </div>
        )}

        <div className="p-3">
          <div className="rounded-2xl bg-gradient-to-b from-slate-100 to-slate-50 dark:from-slate-800/80 dark:to-slate-900/40 border border-slate-200/60 dark:border-slate-700/60 px-4 pt-5 pb-4">
            <div className="flex flex-col items-center text-center mb-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-500 to-purple-600 p-[2px] shadow-md mb-3">
                <div className="w-full h-full rounded-full bg-white dark:bg-slate-900 flex items-center justify-center overflow-hidden">
                  {avatarSrc && !avatarBroken ? (
                    <img
                      src={avatarSrc}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={onAvatarImageError}
                    />
                  ) : (
                    <User className="w-7 h-7 text-primary-500" />
                  )}
                </div>
              </div>
              <p className="text-base font-bold text-slate-900 dark:text-white truncate max-w-full font-khmer">
                {displayName}
              </p>
            </div>
            <div className="divide-y divide-slate-200/70 dark:divide-slate-700/70">
              <ProfileInfoRow label="ID" value={employeeId} />
              <ProfileInfoRow label="Role" value={formatAccessRoleLabel(user.role)} />
              <ProfileInfoRow label="Position" value={position} />
              <ProfileInfoRow label="Phone" value={user.phone || ''} />
              <ProfileInfoRow label="Email" value={user.email || ''} />
              <ProfileInfoRow
                label="Department"
                value={departmentName || user.departmentId || ''}
              />
            </div>
          </div>
        </div>

        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 px-1 py-2">
            <Shield className="w-4 h-4 text-primary-600 dark:text-primary-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Audit · Devices
            </span>
            {devicesLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 ml-auto" />}
          </div>

          {!standalone ? (
            <button
              type="button"
              disabled={handoffBusy}
              onClick={() => void copyHomeScreenHandoff()}
              className="mb-2 w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left text-sm font-medium text-primary-700 dark:text-primary-300 bg-primary-50/80 dark:bg-primary-950/40 border border-primary-200/70 dark:border-primary-800 hover:bg-primary-100/80 dark:hover:bg-primary-950/60 disabled:opacity-50"
            >
              {handoffBusy ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <Smartphone className="w-4 h-4 shrink-0" />
              )}
              <span className="min-w-0 flex-1">
                {t('login.handoffProfileAction') || 'Transfer login to home-screen app'}
              </span>
              <Copy className="w-3.5 h-3.5 shrink-0 opacity-60" />
            </button>
          ) : (
            <p className="mb-2 px-2 text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
              {t('login.standaloneSessionNote') ||
                'You are in the home-screen app. Stay signed in here — Safari login does not apply to this icon.'}
            </p>
          )}

          {devices.length === 0 && !devicesLoading ? (
            <p className="text-xs text-slate-500 px-2 py-3">No active device sessions.</p>
          ) : (
            <ul className="space-y-1">
              {devices.map((device, index) => {
                const open = expandedDevice === device.deviceId;
                const title =
                  device.deviceLabel?.trim() ||
                  `Device ${index + 1}`;
                return (
                  <li
                    key={device.deviceId}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900/50"
                  >
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      onClick={() =>
                        setExpandedDevice(open ? null : device.deviceId)
                      }
                    >
                      <Monitor className="w-4 h-4 shrink-0 text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          {title}
                          {device.isCurrent ? (
                            <span className="ml-1.5 text-[10px] font-semibold uppercase text-primary-600 dark:text-primary-400">
                              · This device
                            </span>
                          ) : null}
                        </p>
                        <p className="text-[10px] text-slate-500 truncate">
                          Last active {formatWhen(device.lastActivity)}
                        </p>
                      </div>
                      {open ? (
                        <ChevronDown className="w-4 h-4 shrink-0 text-slate-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 shrink-0 text-slate-400" />
                      )}
                    </button>

                    {open ? (
                      <div className="px-3 pb-3 border-t border-slate-100 dark:border-slate-800">
                        <dl className="mt-2 space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                          <div className="flex justify-between gap-2">
                            <dt>Signed in</dt>
                            <dd className="text-slate-800 dark:text-slate-200">
                              {formatWhen(device.signedInAt)}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt>Session ends</dt>
                            <dd className="text-slate-800 dark:text-slate-200">
                              {formatWhen(device.sessionExpiresAt)}
                            </dd>
                          </div>
                        </dl>

                        <p className="mt-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          Recent activity
                        </p>
                        {device.recentLogs.length === 0 ? (
                          <p className="text-[11px] text-slate-500 py-1">No login events recorded yet.</p>
                        ) : (
                          <ul className="space-y-2 max-h-36 overflow-y-auto pr-1">
                            {device.recentLogs.map((log) => (
                              <li
                                key={log.id}
                                className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-2.5 py-2 text-[11px]"
                              >
                                <div className="flex justify-between gap-2 font-medium text-slate-800 dark:text-slate-200">
                                  <span>{actionLabel(log.action)}</span>
                                  <span className="text-slate-500 shrink-0">
                                    {formatWhen(log.createdAt)}
                                  </span>
                                </div>
                                {log.ipAddress ? (
                                  <p className="text-slate-500 mt-0.5">IP {log.ipAddress}</p>
                                ) : null}
                                {log.reason ? (
                                  <p className="text-amber-700 dark:text-amber-400 mt-0.5">
                                    {log.reason}
                                  </p>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        )}

                        <button
                          type="button"
                          disabled={revokingId === device.deviceId}
                          onClick={() => void handleTerminate(device)}
                          className="mt-3 w-full text-center text-xs font-semibold text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                        >
                          {revokingId === device.deviceId ? (
                            <span className="inline-flex items-center gap-1 justify-center">
                              <Loader2 className="w-3 h-3 animate-spin" /> Ending session…
                            </span>
                          ) : (
                            'Terminate session'
                          )}
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-200 dark:border-slate-700 p-2 space-y-0.5">
        <button
          type="button"
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          onClick={() => {
            onClose();
            goTo('/profile');
          }}
        >
          <ExternalLink className="w-4 h-4 text-slate-400" />
          View full profile
        </button>
        <button
          type="button"
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
          onClick={() => {
            onClose();
            void logout();
          }}
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </div>
  );

  if (compact) {
    return createPortal(
      <>
        <button
          type="button"
          className="fixed inset-0 cursor-default bg-black/45 backdrop-blur-[2px]"
          style={{ zIndex: Z_BACKDROP }}
          aria-label="Close account menu"
          onClick={onClose}
        />
        <div
          role="dialog"
          aria-label="Account"
          className="fixed inset-x-0 bottom-0 flex flex-col max-h-[min(92dvh,720px)] rounded-t-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-200 pb-[env(safe-area-inset-bottom)]"
          style={{ zIndex: Z_PANEL }}
        >
          {panelBody}
        </div>
      </>,
      document.body
    );
  }

  return (
    <>
      <ConfirmDialogHost />
      {createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 cursor-default bg-transparent"
        style={{ zIndex: Z_BACKDROP }}
        aria-label="Close account menu"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="Account"
        className="fixed flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 pointer-events-auto"
        style={{
          zIndex: Z_PANEL,
          top: style.top,
          right: style.right,
          width: style.width,
          maxHeight: `min(85vh, calc(100dvh - ${style.top}px - 16px))`,
        }}
      >
        {panelBody}
      </div>
    </>,
    document.body
      )}
    </>
  );
};
