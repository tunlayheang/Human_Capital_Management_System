import React, { useMemo, useState } from 'react';
import { Filter } from 'lucide-react';
import { listFilterIconPillClass, filterMenuPanelClass, filterMenuPanelHeaderClass, filterMenuOptionSelectedClass } from '../../constants/designSystem';
import { cn } from '../../utils';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/shadcn/popover';
import { PillSegmentTabs } from '../ui/page/PillSegmentTabs';

export type WorkflowQueueTab = {
  id: string;
  label: string;
  count: number;
};

export type WorkflowFilterSection = {
  id: string;
  title: string;
  tabs: WorkflowQueueTab[];
  activeTab: string;
  onChange: (tabId: string) => void;
  defaultTabId?: string;
  urgentTabIds?: string[];
  excludeTabIds?: string[];
  alwaysShow?: boolean;
};

export type WorkflowQueueFilterConfig = {
  tabs?: WorkflowQueueTab[];
  activeTab?: string;
  onChange?: (tabId: string) => void;
  title?: string;
  defaultTabId?: string;
  urgentTabIds?: string[];
  excludeTabIds?: string[];
  alwaysShow?: boolean;
  /** When true, hide inline pill tabs — filters live in the menu only. */
  hideInlineTabs?: boolean;
  menuTitle?: string;
  sections?: WorkflowFilterSection[];
};

type Props = WorkflowQueueFilterConfig;

function useVisibleWorkflowQueueTabs({
  tabs,
  excludeTabIds = [],
  alwaysShow = false,
  activeTab,
}: Pick<WorkflowFilterSection, 'tabs' | 'excludeTabIds' | 'alwaysShow' | 'activeTab'>) {
  return useMemo(
    () =>
      tabs
        .filter((tab) => !excludeTabIds.includes(tab.id))
        .filter((tab) => alwaysShow || tab.count > 0 || activeTab === tab.id),
    [tabs, excludeTabIds, alwaysShow, activeTab]
  );
}

function normalizeSections(config: WorkflowQueueFilterConfig): WorkflowFilterSection[] {
  if (config.sections?.length) return config.sections;
  if (config.tabs && config.activeTab != null && config.onChange) {
    return [
      {
        id: 'default',
        title: config.title ?? 'Status',
        tabs: config.tabs,
        activeTab: config.activeTab,
        onChange: config.onChange,
        defaultTabId: config.defaultTabId,
        urgentTabIds: config.urgentTabIds,
        excludeTabIds: config.excludeTabIds,
        alwaysShow: config.alwaysShow,
      },
    ];
  }
  return [];
}

function sectionIsFiltered(section: WorkflowFilterSection): boolean {
  return Boolean(section.defaultTabId && section.activeTab !== section.defaultTabId);
}

/** Horizontal pill tabs for workflow queue status filters. */
export function WorkflowQueueTabs({
  tabs,
  activeTab,
  onChange,
  title = 'Status',
  excludeTabIds = [],
  alwaysShow = false,
  size = 'sm',
}: WorkflowFilterSection & { size?: 'sm' | 'md' }) {
  const visible = useVisibleWorkflowQueueTabs({ tabs, excludeTabIds, alwaysShow, activeTab });
  if (visible.length <= 1) return null;

  return (
    <PillSegmentTabs
      value={activeTab}
      onChange={onChange}
      ariaLabel={title}
      size={size}
      tabs={visible.map((tab) => ({
        id: tab.id,
        label: tab.label,
        badge: tab.count,
      }))}
    />
  );
}

function FilterSectionList({
  section,
  onSelect,
}: {
  section: WorkflowFilterSection;
  onSelect: () => void;
}) {
  const visible = useVisibleWorkflowQueueTabs(section);
  if (!visible.length) return null;
  const filteredAwayFromDefault = sectionIsFiltered(section);

  return (
    <div className="p-1.5">
      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {section.title}
      </p>
      <ul role="listbox" aria-label={section.title}>
        {visible.map((tab) => {
          const selected = section.activeTab === tab.id;
          const urgent = Boolean(section.urgentTabIds?.includes(tab.id) && tab.count > 0);
          const showAttention =
            (filteredAwayFromDefault && selected) || (urgent && !selected);
          return (
            <li key={tab.id}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  section.onChange(tab.id);
                  onSelect();
                }}
                className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm text-left transition-colors ${
                  selected
                    ? filterMenuOptionSelectedClass
                    : urgent
                      ? 'text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-950/80'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <span className="flex min-w-0 items-center gap-1.5 truncate">
                  {showAttention ? (
                    <span
                      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold leading-none text-white"
                      aria-hidden
                    >
                      !
                    </span>
                  ) : null}
                  <span className="truncate">{tab.label}</span>
                </span>
                <span
                  className={`shrink-0 tabular-nums rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    selected
                      ? 'bg-primary-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function WorkflowQueueFilterMenu({
  title = 'Status',
  defaultTabId,
  menuTitle,
  sections: sectionsProp,
  tabs,
  activeTab,
  onChange,
  urgentTabIds,
  excludeTabIds,
  alwaysShow,
}: Props) {
  const [open, setOpen] = useState(false);

  const sections = useMemo(
    () =>
      normalizeSections({
        sections: sectionsProp,
        tabs,
        activeTab,
        onChange,
        title,
        defaultTabId,
        urgentTabIds,
        excludeTabIds,
        alwaysShow,
      }),
    [
      sectionsProp,
      tabs,
      activeTab,
      onChange,
      title,
      defaultTabId,
      urgentTabIds,
      excludeTabIds,
      alwaysShow,
    ]
  );

  const isFiltered = sections.some(sectionIsFiltered);
  const activeSummary = sections
    .map((section) => {
      const tab = section.tabs.find((t) => t.id === section.activeTab);
      return tab ? `${tab.label} (${tab.count})` : null;
    })
    .filter(Boolean)
    .join(' · ');

  if (!sections.length) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={isFiltered ? 'Open filters (active)' : 'Open filters'}
          aria-expanded={open}
          title={activeSummary || menuTitle || 'Filters'}
          className={cn(
            listFilterIconPillClass,
            isFiltered &&
              'border-primary-400/80 dark:border-primary-500/60 bg-primary-50/90 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300'
          )}
        >
          <Filter
            className={cn(
              'w-[1.05rem] h-[1.05rem]',
              isFiltered
                ? 'text-primary-600 dark:text-primary-400'
                : 'text-slate-500 dark:text-slate-400'
            )}
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className={cn(filterMenuPanelClass, 'w-80 p-0 overflow-hidden bg-white dark:bg-slate-900')}
      >
        <div className={cn('px-3 py-2.5', filterMenuPanelHeaderClass)}>
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
            {menuTitle ?? 'Filters'}
          </p>
          {activeSummary ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2 inline-flex items-start gap-1.5">
              {isFiltered ? (
                <span
                  className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold leading-none text-white"
                  aria-hidden
                >
                  !
                </span>
              ) : null}
              <span className="min-w-0">{activeSummary}</span>
            </p>
          ) : null}
        </div>
        <div className="max-h-[min(24rem,60vh)] overflow-y-auto divide-y divide-slate-200 dark:divide-slate-700 bg-white dark:bg-slate-900">
          {sections.map((section) => (
            <FilterSectionList
              key={section.id}
              section={section}
              onSelect={() => setOpen(false)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
