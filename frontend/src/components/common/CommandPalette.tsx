import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useMenuConfigOptional } from '@/context/MenuConfigContext';
import { usePinLock } from '@/context/PinLockContext';
import { filterNavSections, moduleSidebarChildLabel } from '@/config/navUtils';
import type { NavItemConfig } from '@/config/navConfig';
import { getVisibleModuleChildren } from '@/config/moduleSidebarNav';
import { useModuleSidebarContext } from '@/hooks/useModuleSidebarContext';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/shadcn/command';

function navItemHref(item: NavItemConfig): string {
  return `${item.path}${item.search ?? ''}`;
}

export const CommandPalette: React.FC = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { hasRole, hasPermission, user } = useAuth();
  const { t } = useLanguage();
  const menuConfig = useMenuConfigOptional();
  const { restrictNavToDashboard } = usePinLock();
  const moduleCtx = useModuleSidebarContext();

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpenEvent = () => setOpen(true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('hcms:command-palette', onOpenEvent);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('hcms:command-palette', onOpenEvent);
    };
  }, []);

  const run = useCallback(
    (href: string) => {
      setOpen(false);
      navigate(href);
    },
    [navigate]
  );

  const labelFor = (item: NavItemConfig) => {
    const key = item.labelKey?.trim();
    if (key) {
      const translated = t(key);
      if (translated && translated !== key && !translated.includes('.')) {
        return translated;
      }
    }
    return item.fallbackLabel;
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={t('command.searchPlaceholder') || 'Search modules, pages…'} />
      <CommandList>
        <CommandEmpty>{t('command.noResults') || 'No results found.'}</CommandEmpty>
        {sections.map((section, idx) => (
          <React.Fragment key={section.title}>
            {idx > 0 ? <CommandSeparator /> : null}
            <CommandGroup
              heading={
                section.titleKey?.trim()
                  ? t(section.titleKey) || section.title
                  : section.title
              }
            >
              {section.items.flatMap((item) => {
                const Icon = item.icon;
                const parentLabel = labelFor(item);
                const parentHref = navItemHref(item);
                const children = getVisibleModuleChildren(item.navKey, moduleCtx);
                const rows: React.ReactNode[] = [];

                if (!children?.length) {
                  rows.push(
                    <CommandItem
                      key={item.navKey}
                      value={`${parentLabel} ${parentHref}`}
                      onSelect={() => run(parentHref)}
                    >
                      <Icon className="mr-2 h-4 w-4 shrink-0 opacity-70" />
                      <span>{parentLabel}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{item.path}</span>
                    </CommandItem>
                  );
                  return rows;
                }

                children.forEach((child) => {
                  const ChildIcon = child.icon;
                  const childLabel = moduleSidebarChildLabel(child, t);
                  const href = `${child.path}${child.search ?? ''}`;
                  rows.push(
                    <CommandItem
                      key={child.navKey}
                      value={`${parentLabel} ${childLabel} ${href}`}
                      onSelect={() => run(href)}
                    >
                      <ChildIcon className="mr-2 h-4 w-4 shrink-0 opacity-70" />
                      <span>
                        <span className="text-muted-foreground">{parentLabel}</span>
                        <span className="mx-1 text-muted-foreground/60">/</span>
                        {childLabel}
                      </span>
                    </CommandItem>
                  );
                });
                return rows;
              })}
            </CommandGroup>
          </React.Fragment>
        ))}
      </CommandList>
    </CommandDialog>
  );
};

/** Compact search trigger for the header. */
export const CommandPaletteTrigger: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { t } = useLanguage();

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent('hcms:command-palette'))}
      className={`inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground shadow-sm transition hover:bg-muted/60 ${className}`}
      aria-label={t('command.open') || 'Open command palette'}
    >
      <Search className="h-4 w-4" />
      <span className="hidden sm:inline">{t('command.search') || 'Search…'}</span>
      <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground md:inline">
        Ctrl K
      </kbd>
    </button>
  );
};
