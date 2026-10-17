import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense, useLayoutEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PageLoader } from '../common/PageLoader';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
const ChatWidget = lazy(() =>
  import('../chat/ChatWidget').then((m) => ({ default: m.ChatWidget }))
);
import { WorkspaceTabsProvider } from '../../context/WorkspaceTabsContext';
import { usePinLock } from '../../context/PinLockContext';
import { LayoutPageHeader } from './LayoutPageHeader';
import { WorkspaceTabBar } from './WorkspaceTabBar';
import {
    APP_OVERLAY_ROOT_ID,
    CHAT_WIDGET_ROOT_ID,
    attachPageOverlayAccessibilityManager,
    ensureWizardFooterRoot,
} from '../../utils/overlayPortal';
import {
    syncStickyActionBarInsets,
    subscribeStickyActionBarInsets,
} from '../../utils/stickyActionBarInsets';
import { NOTIFICATION_OPEN_EVENT, type BrowserNotificationOpenDetail } from '../../utils/browserNotifications';
import { DashboardAnnouncementTicker } from '../dashboard/DashboardAnnouncementTicker';
import { CompanyStructureModal } from '../company-structure/CompanyStructureModal';
import { BackendStatusBanner } from '../common/BackendStatusBanner';
import {
    PullToRefreshProvider,
    usePullToRefreshRegistry,
} from '../../context/PullToRefreshContext';
import { InAppLayoutProvider } from '../../context/InAppLayoutContext';
import {
    shouldEnablePullToRefresh,
    useMainPullToRefresh,
} from '../../hooks/useMainPullToRefresh';
import { PullToRefreshIndicator } from './PullToRefreshIndicator';
/** Tailwind `lg` — compact chrome gets bottom nav + overlay sidebar */
const LG_BREAKPOINT = 1024;
const MD_BREAKPOINT = 768;
/** Tailwind `xl` — default collapsed sidebar rail on wide desktop */
const XL_BREAKPOINT = 1280;
/** Expanded sidebar width (216px) — keep in sync with Sidebar.tsx */
const SIDEBAR_EXPANDED_CLASS = 'ml-[13.5rem] w-[calc(100%-13.5rem)] max-w-[calc(100%-13.5rem)]';
/** Desktop rail preference — survives refresh (`1` expanded, `0` collapsed). */
const SIDEBAR_EXPANDED_PREF_KEY = 'hcms_sidebar_expanded';

function readViewport() {
    const width = typeof window !== 'undefined' ? window.innerWidth : LG_BREAKPOINT;
    return {
        width,
        isMobile: width < MD_BREAKPOINT,
        useCompactChrome: width < LG_BREAKPOINT,
        preferCollapsedSidebar: width >= XL_BREAKPOINT,
    };
}

function readSidebarExpandedPref(): boolean | null {
    try {
        const stored = localStorage.getItem(SIDEBAR_EXPANDED_PREF_KEY);
        if (stored === '1') return true;
        if (stored === '0') return false;
    } catch {
        /* ignore quota / private mode */
    }
    return null;
}

function writeSidebarExpandedPref(expanded: boolean) {
    try {
        localStorage.setItem(SIDEBAR_EXPANDED_PREF_KEY, expanded ? '1' : '0');
    } catch {
        /* ignore quota / private mode */
    }
}

function resolveDesktopSidebarOpen(preferCollapsedSidebar: boolean): boolean {
    const stored = readSidebarExpandedPref();
    if (stored !== null) return stored;
    return !preferCollapsedSidebar;
}

export const Layout: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { restrictNavToDashboard } = usePinLock();
    const initial = readViewport();
    const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
        if (initial.useCompactChrome) return false;
        return resolveDesktopSidebarOpen(initial.preferCollapsedSidebar);
    });
    const [isMobile, setIsMobile] = useState(initial.isMobile);
    const [useCompactChrome, setUseCompactChrome] = useState(initial.useCompactChrome);
    const compactRef = useRef(initial.useCompactChrome);
    const appFooterRef = useRef<HTMLElement>(null);

    useLayoutEffect(() => {
        ensureWizardFooterRoot();
    }, []);

    useLayoutEffect(() => {
        const sync = () => {
            const compact = compactRef.current;
            syncStickyActionBarInsets({
                compact,
                mainInsetLeft: isSidebarOpen ? '13.5rem' : '4.5rem',
                appFooterHeightPx: appFooterRef.current?.getBoundingClientRect().height ?? 0,
            });
        };

        sync();
        // Bottom nav mounts with compact chrome; remeasure after paint so list footers clear it.
        const raf = requestAnimationFrame(sync);
        const unsubscribe = subscribeStickyActionBarInsets(sync);
        const footerEl = appFooterRef.current;
        const navEl =
            typeof document !== 'undefined' ? document.getElementById('hcms-bottom-nav') : null;
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
        if (footerEl && ro) ro.observe(footerEl);
        if (navEl && ro) ro.observe(navEl);
        return () => {
            cancelAnimationFrame(raf);
            unsubscribe();
            ro?.disconnect();
        };
    }, [isSidebarOpen, useCompactChrome]);

    useEffect(() => {
        let frame = 0;
        const checkDevice = () => {
            const { isMobile: mobile, useCompactChrome: compact } = readViewport();
            const wasCompact = compactRef.current;

            setIsMobile(mobile);
            setUseCompactChrome(compact);

            if (compact !== wasCompact) {
                compactRef.current = compact;
                if (compact) {
                    setIsSidebarOpen(false);
                } else {
                    setIsSidebarOpen(resolveDesktopSidebarOpen(readViewport().preferCollapsedSidebar));
                }
            }
        };

        const onResize = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(checkDevice);
        };

        window.addEventListener('resize', onResize);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('resize', onResize);
        };
    }, []);

    /** Close mobile/tablet drawer after route changes (not on first paint). */
    const routeKeyRef = useRef<string | null>(null);
    useEffect(() => {
        const key = `${location.pathname}${location.search}`;
        if (routeKeyRef.current === null) {
            routeKeyRef.current = key;
            return;
        }
        if (routeKeyRef.current === key) return;
        routeKeyRef.current = key;
        if (useCompactChrome) setIsSidebarOpen(false);
    }, [location.pathname, location.search, useCompactChrome]);

    /** Prevent background scroll when drawer is open */
    useEffect(() => {
        if (!useCompactChrome || !isSidebarOpen) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, [useCompactChrome, isSidebarOpen]);

    /** Escape closes drawer on compact layouts */
    useEffect(() => {
        if (!useCompactChrome || !isSidebarOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsSidebarOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [useCompactChrome, isSidebarOpen]);

    const toggleSidebar = useCallback(() => {
        setIsSidebarOpen((prev) => {
            const next = !prev;
            // Persist only the desktop rail preference (not mobile overlay open/close).
            if (!compactRef.current) writeSidebarExpandedPref(next);
            return next;
        });
    }, []);

    const handleOverlayClick = useCallback(() => {
        if (useCompactChrome) setIsSidebarOpen(false);
    }, [useCompactChrome]);

    const isChatRoute = location.pathname === '/chat';
    const isDashboardRoute =
        location.pathname === '/dashboard' || location.pathname.startsWith('/dashboard/');

    /** Room for fixed bottom nav + safe area when chat is full-page on phone/tablet */
    useEffect(() => {
        const cls = 'chat-compact-chrome';
        if (isChatRoute && useCompactChrome) {
            document.body.classList.add(cls);
            return () => document.body.classList.remove(cls);
        }
        document.body.classList.remove(cls);
    }, [isChatRoute, useCompactChrome]);

    // On desktop: content shifts right when sidebar is open (64px collapsed, 256px open)
    // On tablet: overlay sidebar, content doesn't shift
    // On mobile: bottom nav, content full width
    const mainContentClass = useMemo(() => {
        if (useCompactChrome) {
            return 'flex flex-1 flex-col min-h-0 min-w-0 w-full max-w-full ml-0';
        }
        return `flex flex-1 flex-col min-h-0 min-w-0 transition-all duration-300 ease-in-out ${
            isSidebarOpen
                ? SIDEBAR_EXPANDED_CLASS
                : 'ml-[4.5rem] w-[calc(100%-4.5rem)] max-w-[calc(100%-4.5rem)]'
        }`;
    }, [isSidebarOpen, useCompactChrome]);

    const workspaceTabsEnabled = !useCompactChrome && !restrictNavToDashboard;

    /** First login: keep user on Dashboard until password change / PIN setup finishes. */
    useEffect(() => {
        if (!restrictNavToDashboard) return;
        const path = location.pathname.replace(/\/$/, '') || '/';
        if (path !== '/dashboard') {
            navigate('/dashboard', { replace: true });
        }
    }, [restrictNavToDashboard, location.pathname, navigate]);

    useEffect(() => {
        const onNotificationOpen = (event: Event) => {
            const detail = (event as CustomEvent<BrowserNotificationOpenDetail>).detail;
            const link = String(detail?.link ?? '').trim();
            if (!link) return;
            navigate(link);
        };
        window.addEventListener(NOTIFICATION_OPEN_EVENT, onNotificationOpen);
        return () => window.removeEventListener(NOTIFICATION_OPEN_EVENT, onNotificationOpen);
    }, [navigate]);

    useEffect(() => {
        const root = document.getElementById(APP_OVERLAY_ROOT_ID);
        if (!root) return;
        return attachPageOverlayAccessibilityManager(root);
    }, []);

    return (
        <InAppLayoutProvider>
          <WorkspaceTabsProvider enabled={workspaceTabsEnabled}>
            <PullToRefreshProvider>
              <LayoutMainColumn
                isSidebarOpen={isSidebarOpen}
                useCompactChrome={useCompactChrome}
                isMobile={isMobile}
                isChatRoute={isChatRoute}
                isDashboardRoute={isDashboardRoute}
                mainContentClass={mainContentClass}
                workspaceTabsEnabled={workspaceTabsEnabled}
                toggleSidebar={toggleSidebar}
                handleOverlayClick={handleOverlayClick}
                appFooterRef={appFooterRef}
              />
            </PullToRefreshProvider>
          </WorkspaceTabsProvider>
        </InAppLayoutProvider>
    );
};

type LayoutMainColumnProps = {
    isSidebarOpen: boolean;
    useCompactChrome: boolean;
    isMobile: boolean;
    isChatRoute: boolean;
    isDashboardRoute: boolean;
    mainContentClass: string;
    workspaceTabsEnabled: boolean;
    toggleSidebar: () => void;
    handleOverlayClick: () => void;
    appFooterRef: React.RefObject<HTMLElement | null>;
};

function LayoutMainColumn({
    isSidebarOpen,
    useCompactChrome,
    isMobile,
    isChatRoute,
    isDashboardRoute,
    mainContentClass,
    workspaceTabsEnabled,
    toggleSidebar,
    handleOverlayClick,
    appFooterRef,
}: LayoutMainColumnProps) {
    const mainRef = useRef<HTMLElement>(null);
    const { runRefresh, refreshing } = usePullToRefreshRegistry();
    const ptrEnabled = !isChatRoute && shouldEnablePullToRefresh(useCompactChrome);
    const ptrState = useMainPullToRefresh(mainRef, {
        enabled: ptrEnabled,
        refreshing,
        onRefresh: runRefresh,
    });

    return (
        <div className="flex hcms-app-shell hcms-app-canvas bg-background overflow-hidden relative">
            <div className="hcms-ambient-bg" aria-hidden="true" />
            <div
                id={CHAT_WIDGET_ROOT_ID}
                className="fixed inset-0 z-[280] pointer-events-none flex flex-col items-end justify-end p-3 sm:p-6 gap-3 [&>*]:pointer-events-auto"
                aria-hidden
            />
            {isSidebarOpen && useCompactChrome && (
                <div
                    className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[55] touch-none"
                    onClick={handleOverlayClick}
                    onTouchMove={(e) => e.preventDefault()}
                    aria-hidden="true"
                />
            )}

            <Sidebar
                isOpen={isSidebarOpen}
                toggleSidebar={toggleSidebar}
                isMobile={isMobile}
                isOverlayLayout={useCompactChrome}
            />

            <div className={mainContentClass}>
                <Header
                    toggleSidebar={toggleSidebar}
                    isSidebarOpen={isSidebarOpen}
                    isMobile={isMobile}
                    isSmallScreen={useCompactChrome}
                />

                <div className="relative flex flex-1 flex-col min-h-0 min-w-0">
                    {workspaceTabsEnabled && <WorkspaceTabBar />}

                    <div className="flex flex-1 flex-col min-h-0 min-w-0">
                        <main
                            ref={mainRef}
                            className={
                                isChatRoute
                                    ? 'flex-1 flex flex-col min-h-0 overflow-hidden p-0'
                                    : `flex-1 overflow-y-auto overflow-x-clip min-h-0 p-2 xs:p-2.5 sm:p-3.5 md:p-5 lg:p-5 xl:p-6 custom-scrollbar touch-pan-y overscroll-y-contain ${
                                          useCompactChrome
                                              ? isDashboardRoute
                                                  ? 'hcms-main-scroll-compact hcms-main-scroll-compact--dashboard'
                                                  : 'hcms-main-scroll-compact'
                                              : ''
                                      }`
                            }
                        >
                            {ptrEnabled ? <PullToRefreshIndicator state={ptrState} /> : null}
                            <div
                                className={
                                    isChatRoute
                                        ? 'flex flex-col flex-1 min-h-0 w-full h-full'
                                        : 'w-full min-w-0 animate-in fade-in duration-300'
                                }
                            >
                                {!isChatRoute ? <BackendStatusBanner className="mb-2 sm:mb-3 md:mb-4" /> : null}
                                {!isChatRoute ? <LayoutPageHeader className="mb-3 sm:mb-4 md:mb-5" /> : null}
                                <Suspense fallback={<PageLoader layout="dashboard" />}>
                                  <Outlet />
                                </Suspense>
                            </div>
                        </main>

                        {isDashboardRoute && !isChatRoute && (
                            <DashboardAnnouncementTicker pinAboveMobileNav={useCompactChrome} />
                        )}

                        <footer
                            ref={appFooterRef}
                            className="hcms-app-copyright-footer hidden lg:flex shrink-0 items-center gap-3 px-6 py-2 border-t border-white/40 dark:border-white/10 glass-nav text-xs text-muted-foreground"
                        >
                            <span className="shrink-0 whitespace-nowrap">
                                © {new Date().getFullYear()} ROC · Labour &amp; Human Resource Consulting
                            </span>
                            <span className="shrink-0 tabular-nums text-slate-400 dark:text-slate-500 ml-auto">
                                HCMS
                            </span>
                        </footer>
                    </div>

                    <div
                        id={APP_OVERLAY_ROOT_ID}
                        className="absolute inset-0 z-[200] overflow-hidden pointer-events-none [&>*]:pointer-events-auto"
                        aria-hidden
                    />
                </div>

            </div>

            {/* Desktop only — skip chat chunk + hooks on compact chrome (More / /chat). */}
            {!useCompactChrome && (
              <Suspense fallback={null}>
                <ChatWidget />
              </Suspense>
            )}

            <CompanyStructureModal />

            {useCompactChrome && !isSidebarOpen && <BottomNav />}
        </div>
    );
}
