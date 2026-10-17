import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useCompanyStructure } from '../../context/CompanyStructureContext';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import { useLanguage } from '../../context/LanguageContext';
import { Sun, Moon, Bell, Menu, User, Network } from 'lucide-react';
import { NotificationCenter } from '../ui/NotificationCenter';
import { ProfileMenuPopover } from './ProfileMenuPopover';
import { LanguageSelector } from '../ui/LanguageSelector';
import { resolveMediaUrl, onAvatarImageError } from '../../utils/mediaUrl';
import { AppBreadcrumbs } from '../common/AppBreadcrumbs';
import { useAppBreadcrumbs } from '../../hooks/useAppBreadcrumbs';
import { usePersonDisplayName } from '../../hooks/usePersonDisplayName';
import { formatAccessRoleLabel } from '../../utils/accessRole';
import { PERM } from '../../constants/permissionKeys';

interface HeaderProps {
    toggleSidebar: () => void;
    isSidebarOpen?: boolean;
    isMobile?: boolean;
    /** Viewport &lt; lg — fixed panels (notifications etc.) */
    isSmallScreen?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
    toggleSidebar,
    isSidebarOpen = false,
    isSmallScreen = false,
}) => {
    const { theme, toggleTheme } = useTheme();
    const { user, hasPermission } = useAuth();
    const { unreadCount: notifCount } = useNotification();
    const { isOpen: isCompanyStructureOpen, openCompanyStructure } = useCompanyStructure();
    const { t } = useLanguage();
    const displayName = usePersonDisplayName();
    const { crumbs, pageTitle } = useAppBreadcrumbs();
    const [headerAvatarBroken, setHeaderAvatarBroken] = useState(false);
    const headerAvatarSrc = resolveMediaUrl(user?.avatarUrl);
    const [isNotifOpen, setIsNotifOpen] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const profileAnchorRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLElement>(null);
    const menuLabel = isSmallScreen ? 'Open navigation menu' : 'Toggle sidebar';
    const canViewCompanyStructure = hasPermission(PERM.COMPANY_STRUCTURE_VIEW);
    const canViewNotifications = hasPermission(PERM.NOTIFICATIONS_VIEW);

    useLayoutEffect(() => {
        const el = headerRef.current;
        if (!el) return;
        const syncOffset = () => {
            document.documentElement.style.setProperty(
                '--hcms-header-offset',
                `${el.getBoundingClientRect().height}px`
            );
        };
        syncOffset();
        const ro = new ResizeObserver(syncOffset);
        ro.observe(el);
        window.addEventListener('resize', syncOffset);
        return () => {
            ro.disconnect();
            window.removeEventListener('resize', syncOffset);
        };
    }, []);

    useEffect(() => {
        setHeaderAvatarBroken(false);
    }, [user?.avatarUrl]);

    const iconBtn =
        'p-1.5 sm:p-2 rounded-full text-muted-foreground hover:bg-white/40 dark:hover:bg-white/10 backdrop-blur-sm transition-all hover:scale-105 active:scale-95 shrink-0';

    const activeIconBtn = 'bg-primary/10 text-primary';

    return (
        <header ref={headerRef} className="hcms-app-header sticky top-0 z-30 shrink-0 glass-nav border-b px-2 xs:px-3 sm:px-4 md:px-5 py-1 sm:py-1.5 pt-[max(0.25rem,env(safe-area-inset-top))] transition-all duration-300 relative">
            <div className="flex flex-nowrap items-center justify-between gap-1.5 sm:gap-2 min-h-8 sm:min-h-9">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <button
                        type="button"
                        onClick={toggleSidebar}
                        className={`${iconBtn} -ml-0.5 lg:hidden`}
                        aria-label={menuLabel}
                        aria-expanded={isSidebarOpen}
                    >
                        <Menu className="w-5 h-5" />
                    </button>
                    <AppBreadcrumbs crumbs={crumbs} pageTitle={pageTitle} />
                </div>

                <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                    <div className="flex items-center gap-0.5">
                        {canViewCompanyStructure ? (
                        <button
                            type="button"
                            onClick={openCompanyStructure}
                            className={`${iconBtn} ${isCompanyStructureOpen ? activeIconBtn : ''}`}
                            aria-label={t('header.companyStructure') || 'Company structure'}
                            title={t('header.companyStructure') || 'Company structure'}
                        >
                            <Network className="w-5 h-5" />
                        </button>
                        ) : null}

                        <div className="hidden lg:flex items-center gap-0.5">
                            <LanguageSelector />
                            <button
                                onClick={toggleTheme}
                                className={iconBtn}
                                aria-label="Toggle theme"
                            >
                                {theme === 'dark' ? (
                                    <Sun className="w-5 h-5 text-amber-400" />
                                ) : (
                                    <Moon className="w-5 h-5" />
                                )}
                            </button>
                        </div>

                        {canViewNotifications ? (
                        <button
                            type="button"
                            onClick={() => {
                                setIsProfileOpen(false);
                                setIsNotifOpen(true);
                            }}
                            className={`${iconBtn} relative ${isNotifOpen ? activeIconBtn : ''}`}
                            aria-label="Notifications"
                            aria-expanded={isNotifOpen}
                        >
                            <Bell className={`w-5 h-5 ${isNotifOpen ? 'fill-current' : ''}`} />
                            {notifCount > 0 && (
                                <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 inline-flex items-center justify-center bg-red-500 text-white text-[9px] font-bold leading-none rounded-full ring-2 ring-card tabular-nums">
                                  {notifCount > 99 ? '99+' : notifCount}
                                </span>
                            )}
                        </button>
                        ) : null}
                    </div>

                    <div
                        ref={profileAnchorRef}
                        className={`relative flex items-center gap-1 sm:gap-2 cursor-pointer p-1 sm:p-1.5 lg:pr-2.5 rounded-full transition-all border min-w-0 max-w-[2.75rem] sm:max-w-[3rem] lg:max-w-none ${
                            isProfileOpen
                                ? 'bg-primary/10 border-primary/30'
                                : 'hover:bg-muted/60 border-transparent hover:border-border'
                        }`}
                        onClick={() => {
                            setIsNotifOpen(false);
                            setIsProfileOpen((open) => !open);
                        }}
                        role="button"
                        tabIndex={0}
                        aria-expanded={isProfileOpen}
                        aria-haspopup="dialog"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setIsNotifOpen(false);
                                setIsProfileOpen((open) => !open);
                            }
                        }}
                    >
                        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-gradient-to-br from-primary to-primary/70 p-[2px] shadow-sm shrink-0">
                            <div className="w-full h-full rounded-full bg-card flex items-center justify-center overflow-hidden">
                                {headerAvatarSrc && !headerAvatarBroken ? (
                                    <img
                                        src={headerAvatarSrc}
                                        alt={displayName}
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                        decoding="async"
                                        onError={onAvatarImageError}
                                    />
                                ) : (
                                    <User className="w-4 h-4 text-primary" />
                                )}
                            </div>
                        </div>
                        <div className="text-left min-w-0 flex-1 hidden xl:block max-w-[8rem]">
                            <p
                                className="text-xs font-semibold text-foreground leading-none truncate"
                                title={displayName}
                            >
                                {displayName}
                            </p>
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide truncate mt-0.5">
                                {formatAccessRoleLabel(user?.role)}
                            </p>
                        </div>
                    </div>

                    <NotificationCenter open={isNotifOpen} onOpenChange={setIsNotifOpen} />
                    <ProfileMenuPopover
                        isOpen={isProfileOpen}
                        onClose={() => setIsProfileOpen(false)}
                        anchorRef={profileAnchorRef}
                    />
                </div>
            </div>
        </header>
    );
};
