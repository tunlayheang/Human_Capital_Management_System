import React, { useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { usePinLock } from '../../context/PinLockContext';
import {
    LayoutDashboard, Clock, Briefcase,
    User, LayoutGrid, Users, BarChart3,
} from 'lucide-react';
import { BottomNavMoreSheet } from './BottomNavMoreSheet';
import { isAdminRole } from '../../utils/adminNavScope';

export const BottomNav: React.FC = () => {
    const { t, language } = useLanguage();
    const { user } = useAuth();
    const { restrictNavToDashboard } = usePinLock();
    const location = useLocation();
    const [moreOpen, setMoreOpen] = useState(false);

    const isAdmin = isAdminRole(user?.role);

    const mainItems = useMemo(() => {
        if (restrictNavToDashboard) {
            return [{ path: '/dashboard', icon: LayoutDashboard, label: t('nav.home') }];
        }
        if (isAdmin) {
            return [
                { path: '/dashboard', icon: LayoutDashboard, label: t('nav.home') },
                { path: '/reports', icon: BarChart3, label: t('nav.reports') || 'Reports' },
                { path: '/users', icon: Users, label: t('nav.users') || 'User Management' },
            ];
        }
        return [
            { path: '/dashboard', icon: LayoutDashboard, label: t('nav.home') },
            {
                path: '/attendance?scope=self',
                icon: Clock,
                label: t('nav.attendance') || 'Attendance',
            },
            { path: '/leaves', icon: Briefcase, label: t('nav.leaves') },
        ];
    }, [isAdmin, t, language, restrictNavToDashboard]);

    const showMore = !restrictNavToDashboard;

    return (
        <>
            <nav
                id="hcms-bottom-nav"
                role="navigation"
                aria-label="Primary mobile navigation"
                className="fixed bottom-0 left-0 right-0 z-50 glass-nav border-t flex items-stretch safe-area-bottom shadow-2xl"
            >
                <div className="flex flex-1 items-stretch justify-between px-[env(safe-area-inset-left)] pe-[env(safe-area-inset-right)]">
                {mainItems.map((item) => {
                    const pathOnly = item.path.split('?')[0] || item.path;
                    const isActive =
                        pathOnly === '/attendance'
                            ? location.pathname.startsWith('/attendance')
                            : pathOnly === '/reports'
                              ? location.pathname.startsWith('/reports')
                              : pathOnly === '/users'
                                ? location.pathname.startsWith('/users')
                                : location.pathname === pathOnly;
                    return (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            className={() =>
                                `flex-1 flex flex-col items-center justify-center py-2 gap-0.5 sm:py-2.5 sm:gap-1 transition-all duration-200 active:scale-95 min-w-0 ${
                                    isActive
                                        ? 'text-sidebar-primary'
                                        : 'text-muted-foreground hover:text-sidebar-foreground'
                                }`
                            }
                        >
                            <div className={`relative p-1 sm:p-1.5 rounded-xl ${isActive ? 'bg-sidebar-primary/10' : ''}`}>
                                <item.icon className={`w-4 h-4 sm:w-5 sm:h-5 ${isActive ? 'scale-110' : ''}`} />
                            </div>
                            <span
                                className={`text-[9px] xs:text-[10px] font-semibold leading-tight text-center px-0.5 line-clamp-2 ${
                                    isActive ? 'text-sidebar-primary' : ''
                                }`}
                            >
                                {item.label}
                            </span>
                        </NavLink>
                    );
                })}
                {showMore ? (
                    <button
                        type="button"
                        onClick={() => setMoreOpen(true)}
                        className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 sm:py-2.5 sm:gap-1 transition-all duration-200 active:scale-95 min-w-0 ${
                            moreOpen ? 'text-sidebar-primary' : 'text-muted-foreground hover:text-sidebar-foreground'
                        }`}
                        aria-label={t('nav.more') || 'More'}
                    >
                        <div className={`p-1 sm:p-1.5 rounded-xl ${moreOpen ? 'bg-sidebar-primary/10' : ''}`}>
                            <LayoutGrid className="w-4 h-4 sm:w-5 sm:h-5" />
                        </div>
                        <span className="text-[9px] xs:text-[10px] font-semibold leading-tight">
                            {t('nav.more') || 'More'}
                        </span>
                    </button>
                ) : (
                    <NavLink
                        to="/profile"
                        className={() =>
                            `flex-1 flex flex-col items-center justify-center py-2 gap-0.5 sm:py-2.5 sm:gap-1 transition-all duration-200 active:scale-95 min-w-0 ${
                                location.pathname === '/profile'
                                    ? 'text-sidebar-primary'
                                    : 'text-muted-foreground hover:text-sidebar-foreground'
                            }`
                        }
                    >
                        <div className={`p-1 sm:p-1.5 rounded-xl ${location.pathname === '/profile' ? 'bg-sidebar-primary/10' : ''}`}>
                            <User className="w-4 h-4 sm:w-5 sm:h-5" />
                        </div>
                        <span className={`text-[9px] xs:text-[10px] font-semibold leading-tight ${location.pathname === '/profile' ? 'text-sidebar-primary' : ''}`}>
                            {t('nav.profile')}
                        </span>
                    </NavLink>
                )}
                </div>
            </nav>
            <BottomNavMoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
        </>
    );
};
