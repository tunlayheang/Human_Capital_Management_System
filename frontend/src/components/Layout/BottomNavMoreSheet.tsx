import React, { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutGrid, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useMenuConfigOptional } from '../../context/MenuConfigContext';
import { usePinLock } from '../../context/PinLockContext';
import { filterNavSections } from '../../config/navUtils';
import type { NavItemConfig } from '../../config/navConfig';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/shadcn/sheet';

/** Paths already on the bottom bar — omit from More. Profile stays in More when More is shown. */
const PRIMARY_PATHS = new Set(['/dashboard', '/attendance', '/leaves', '/reports', '/users']);

function navLabel(item: NavItemConfig, t: (key: string) => string): string {
  const translated = t(item.labelKey);
  if (translated && translated !== item.labelKey && !translated.includes('.')) {
    return translated;
  }
  return item.fallbackLabel;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const BottomNavMoreSheet: React.FC<Props> = ({ open, onOpenChange }) => {
  const { hasRole, hasPermission, user } = useAuth();
  const { t } = useLanguage();
  const menuConfig = useMenuConfigOptional();
  const { restrictNavToDashboard } = usePinLock();

  const sections = useMemo(
    () =>
      filterNavSections(
        hasRole,
        menuConfig?.isPathVisible,
        hasPermission,
        user?.role,
        { dashboardOnly: restrictNavToDashboard }
      ),
    [hasRole, menuConfig?.isPathVisible, hasPermission, user?.role, restrictNavToDashboard]
  );

  const moreItems = useMemo(
    () =>
      sections.flatMap((section) =>
        section.items.filter((item) => !PRIMARY_PATHS.has(item.path))
      ),
    [sections]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl p-0 max-h-[min(85dvh,640px)] flex flex-col pb-[env(safe-area-inset-bottom)] [&>button]:hidden"
        aria-describedby={undefined}
      >
        <SheetHeader className="px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="text-base font-semibold flex items-center gap-2">
              <LayoutGrid className="w-4 h-4 text-primary" />
              {t('nav.more') || 'More'}
            </SheetTitle>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="p-2 rounded-full hover:bg-muted text-muted-foreground"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </SheetHeader>
        <nav className="flex-1 overflow-y-auto custom-scrollbar px-3 py-3 space-y-4">
          {sections.map((section) => {
            const items = section.items.filter((item) => !PRIMARY_PATHS.has(item.path));
            if (!items.length) return null;
            return (
              <div key={section.title}>
                <p className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {section.titleKey ? t(section.titleKey) : section.title}
                </p>
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const href = `${item.path}${item.search ?? ''}`;
                    return (
                      <li key={item.navKey}>
                        <NavLink
                          to={href}
                          onClick={() => onOpenChange(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                              isActive
                                ? 'bg-primary/10 text-primary font-medium'
                                : 'text-foreground hover:bg-muted'
                            }`
                          }
                        >
                          <Icon className="w-5 h-5 shrink-0 opacity-80" />
                          <span className="truncate">{navLabel(item, t)}</span>
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {moreItems.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {t('nav.noMoreItems') || 'All modules are in the bottom bar.'}
            </p>
          ) : null}
        </nav>
      </SheetContent>
    </Sheet>
  );
};
