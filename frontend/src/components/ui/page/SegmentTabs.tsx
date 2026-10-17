import React from 'react';
import { PillSegmentTabs, type PillSegmentTabItem } from './PillSegmentTabs';

export type SegmentTabItem<T extends string = string> = {
  id: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  hidden?: boolean;
  disabled?: boolean;
  badge?: number | string;
};

type Props<T extends string = string> = {
  tabs: SegmentTabItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  className?: string;
  label?: string;
  ariaLabel?: string;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
};

/** Module section tabs — segmented pill control. */
export function SegmentTabs<T extends string = string>({
  tabs,
  activeId,
  onChange,
  className = '',
  ariaLabel = 'Module section',
  fullWidth = false,
  size = 'md',
}: Props<T>) {
  const pillTabs: PillSegmentTabItem<T>[] = tabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    icon: tab.icon,
    hidden: tab.hidden,
    disabled: tab.disabled,
    badge: tab.badge,
  }));

  return (
    <PillSegmentTabs
      value={activeId}
      onChange={onChange}
      tabs={pillTabs}
      ariaLabel={ariaLabel}
      className={className}
      fullWidth={fullWidth}
      size={size}
    />
  );
}
