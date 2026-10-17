import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, GripVertical, MoreHorizontal, X } from 'lucide-react';
import { useWorkspaceTabs } from '../../context/WorkspaceTabsContext';
import { useLanguage } from '../../context/LanguageContext';
import { fixedMenuBelowAnchor, Z_CHROME_MENU } from '../../utils/overlayPortal';
import { useHorizontalScrollOverflow } from '../../hooks/useHorizontalScrollOverflow';
import { HorizontalScrollArrow } from '../ui/HorizontalScrollArrow';

export const WorkspaceTabBar: React.FC = () => {
  const {
    tabs,
    activeTabId,
    activateTab,
    closeTab,
    closeOtherTabs,
    closeTabsToRight,
    closeAllTabs,
    reorderTabs,
  } = useWorkspaceTabs();
  const { t } = useLanguage();
  const stripRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const dropdownMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    right: number;
    minWidth: number;
  } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [insertAfter, setInsertAfter] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextTabId, setContextTabId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const anchorTabId = contextTabId || activeTabId || tabs[0]?.id || null;
  const anchorIndex = anchorTabId ? tabs.findIndex((t) => t.id === anchorTabId) : -1;
  const hasTabsToRight = anchorIndex >= 0 && anchorIndex < tabs.length - 1;

  const dismissMenus = useCallback(() => {
    setMenuOpen(false);
    setContextMenu(null);
    setContextTabId(null);
  }, []);

  const isInsideAnyMenu = useCallback((target: Node) => {
    return (
      menuRef.current?.contains(target) ||
      dropdownMenuRef.current?.contains(target) ||
      contextMenuRef.current?.contains(target) ||
      Boolean((target as HTMLElement).closest?.('[data-workspace-tab-menu]'))
    );
  }, []);

  const updateMenuPosition = useCallback(() => {
    const el = menuButtonRef.current;
    if (!el) return;
    setMenuPosition(fixedMenuBelowAnchor(el.getBoundingClientRect()));
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPosition(null);
      return;
    }
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [menuOpen, updateMenuPosition]);

  useEffect(() => {
    if (!menuOpen && !contextMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (isInsideAnyMenu(e.target as Node)) return;
      dismissMenus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [menuOpen, contextMenu, dismissMenus, isInsideAnyMenu]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!stripRef.current || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    stripRef.current.scrollLeft += e.deltaY;
  }, []);

  const { hasOverflow, canScrollLeft, canScrollRight, scrollByPage, scrollChildIntoView } =
    useHorizontalScrollOverflow(stripRef, [tabs.length, activeTabId]);

  useLayoutEffect(() => {
    if (!stripRef.current || !activeTabId) return;
    const activeEl = stripRef.current.querySelector<HTMLElement>(
      `[role="tab"][aria-selected="true"]`
    );
    scrollChildIntoView(activeEl, 'smooth');
  }, [activeTabId, scrollChildIntoView, tabs.length]);

  const clearDrag = useCallback(() => {
    setDragId(null);
    setDropTargetId(null);
    setInsertAfter(false);
  }, []);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, tabId: string) => {
      if ((e.target as HTMLElement).closest('[data-tab-close]')) {
        e.preventDefault();
        return;
      }
      setDragId(tabId);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tabId);
      if (e.dataTransfer.setDragImage) {
        const el = e.currentTarget;
        e.dataTransfer.setDragImage(el, el.offsetWidth / 2, el.offsetHeight / 2);
      }
    },
    []
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, tabId: string) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!dragId || dragId === tabId) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      setDropTargetId(tabId);
      setInsertAfter(after);
    },
    [dragId]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, targetId: string) => {
      e.preventDefault();
      const fromId = dragId || e.dataTransfer.getData('text/plain');
      if (!fromId || fromId === targetId) {
        clearDrag();
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      reorderTabs(fromId, targetId, after);
      clearDrag();
    },
    [dragId, reorderTabs, clearDrag]
  );

  const openContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextTabId(tabId);
    setContextMenu({ x: e.clientX, y: e.clientY });
    setMenuOpen(false);
  };

  const runMenuAction = (action: () => void) => {
    action();
    dismissMenus();
  };

  const menuItems = anchorTabId
    ? [
        {
          key: 'close',
          label: t('workspace.closeThisTab') || 'Close this tab',
          show: true,
          action: () => closeTab(anchorTabId),
        },
        {
          key: 'right',
          label: t('workspace.closeTabsToRight') || 'Close tabs to the right',
          show: hasTabsToRight,
          action: () => closeTabsToRight(anchorTabId),
        },
        {
          key: 'others',
          label: t('workspace.closeOtherTabs') || 'Close other tabs',
          show: tabs.length > 1,
          action: () => closeOtherTabs(anchorTabId),
        },
        {
          key: 'all',
          label: t('workspace.closeAllTabs') || 'Close all tabs',
          show: true,
          action: () => closeAllTabs(),
        },
      ].filter((item) => item.show)
    : [];

  const renderMenu = (className: string) => (
    <div
      data-workspace-tab-menu
      className={`py-1 min-w-[200px] rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 ${className}`}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {menuItems.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            runMenuAction(item.action);
          }}
          className="w-full px-3 py-2.5 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/80"
        >
          {item.label}
        </button>
      ))}
    </div>
  );

  if (tabs.length === 0) return null;

  return (
    <div
      className="workspace-tab-bar relative z-40 shrink-0 flex items-stretch border-b border-white/40 dark:border-white/10 glass-nav min-w-0"
      role="presentation"
    >
      {hasOverflow ? (
        <HorizontalScrollArrow
          direction="left"
          variant="neutral"
          disabled={!canScrollLeft}
          onClick={() => scrollByPage(-1)}
          className="self-center mx-0.5"
        />
      ) : null}
      <div
        ref={stripRef}
        onWheel={onWheel}
        role="tablist"
        aria-label={t('workspace.tabsLabel') || 'Open pages'}
        className={`flex-1 flex items-stretch gap-0.5 overflow-x-scroll overflow-y-hidden px-2 py-1 hcms-scrollbar-hidden scroll-smooth min-w-0 ${hasOverflow ? 'px-1' : ''}`}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const dragging = dragId === tab.id;
          const isDropTarget = dropTargetId === tab.id && dragId && dragId !== tab.id;

          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              draggable
              onDragStart={(e) => handleDragStart(e, tab.id)}
              onDragOver={(e) => handleDragOver(e, tab.id)}
              onDrop={(e) => handleDrop(e, tab.id)}
              onDragEnd={clearDrag}
              onContextMenu={(e) => openContextMenu(e, tab.id)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  if (dropTargetId === tab.id) setDropTargetId(null);
                }
              }}
              className={`group relative flex items-center max-w-[14rem] shrink-0 rounded-t-lg border border-b-0 transition-colors cursor-grab active:cursor-grabbing ${
                dragging ? 'opacity-50 scale-[0.98]' : ''
              } ${
                active
                  ? 'bg-sidebar-primary border-sidebar-primary shadow-sm z-[1]'
                  : 'bg-slate-200/60 dark:bg-slate-800/40 border-transparent hover:bg-slate-200 dark:hover:bg-slate-800/70'
              }`}
              title={t('workspace.dragToReorder') || 'Drag to reorder tabs'}
            >
              {isDropTarget && (
                <span
                  className={`pointer-events-none absolute top-1 bottom-1 w-0.5 rounded-full bg-sidebar-primary z-10 ${
                    insertAfter ? 'right-0' : 'left-0'
                  }`}
                  aria-hidden
                />
              )}
              <span
                className={`pl-1.5 shrink-0 hidden sm:flex ${
                  active
                    ? 'text-white/70 opacity-100'
                    : 'text-slate-400 opacity-0 group-hover:opacity-100'
                }`}
                aria-hidden
              >
                <GripVertical className="w-3 h-3" />
              </span>
              <button
                type="button"
                onClick={() => activateTab(tab.id)}
                className={`min-w-0 pl-1 sm:pl-0 pr-1 py-1.5 text-xs font-medium truncate cursor-inherit ${
                  active ? 'text-white' : 'text-slate-600 dark:text-slate-400'
                }`}
                title={tab.title}
              >
                {tab.title}
              </button>
              <button
                type="button"
                data-tab-close
                draggable={false}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className={`mr-1 p-1 rounded-md opacity-60 hover:opacity-100 cursor-pointer ${
                  active
                    ? 'text-white hover:bg-white/20'
                    : 'hover:bg-slate-300/50 dark:hover:bg-slate-600/50 text-slate-500 dark:text-slate-400'
                }`}
                aria-label={(t('workspace.closeTab') || 'Close tab').replace('{title}', tab.title)}
                title={
                  tabs.length === 1
                    ? t('workspace.closeToDashboard') || 'Close and go to Dashboard'
                    : undefined
                }
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {hasOverflow ? (
        <HorizontalScrollArrow
          direction="right"
          variant="neutral"
          disabled={!canScrollRight}
          onClick={() => scrollByPage(1)}
          className="self-center mx-0.5"
        />
      ) : null}

      <div ref={menuRef} className="relative shrink-0 flex items-center pr-1">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200/80 dark:hover:bg-slate-800 flex items-center gap-0.5"
          aria-label={t('workspace.tabMenu') || 'Tab options'}
          aria-expanded={menuOpen}
        >
          <MoreHorizontal className="w-4 h-4" />
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>
      </div>

      {menuOpen &&
        menuPosition &&
        createPortal(
          <div
            ref={dropdownMenuRef}
            style={{
              position: 'fixed',
              top: menuPosition.top,
              right: menuPosition.right,
              minWidth: menuPosition.minWidth,
              zIndex: Z_CHROME_MENU,
            }}
          >
            {renderMenu('')}
          </div>,
          document.body
        )}

      {contextMenu &&
        createPortal(
          <div
            ref={contextMenuRef}
            style={{
              position: 'fixed',
              left: Math.min(contextMenu.x, window.innerWidth - 220),
              top: contextMenu.y + 4,
              zIndex: Z_CHROME_MENU,
            }}
          >
            {renderMenu('')}
          </div>,
          document.body
        )}
    </div>
  );
};
