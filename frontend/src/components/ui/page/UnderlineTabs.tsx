import type { ElementType } from 'react';
import { PillSegmentTabs, type PillSegmentTabItem } from './PillSegmentTabs';

export type UnderlineTabItem<T extends string = string> = {
  id: T;
  label: string;
  icon: ElementType;
  disabled?: boolean;
  hidden?: boolean;
  badge?: number | string;
};

type Props<T extends string> = {
  value: T;
  onChange: (id: T) => void;
  tabs: UnderlineTabItem<T>[];
  ariaLabel: string;
  className?: string;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
};

/** Segmented pill tabs — shared app-wide section switcher. */
export function UnderlineTabs<T extends string>({
  value,
  onChange,
  tabs,
  ariaLabel,
  className = '',
  fullWidth = false,
  size = 'md',
}: Props<T>) {
  const pillTabs: PillSegmentTabItem<T>[] = tabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    icon: tab.icon,
    disabled: tab.disabled,
    hidden: tab.hidden,
    badge: tab.badge,
  }));

  return (
    <PillSegmentTabs
      value={value}
      onChange={onChange}
      tabs={pillTabs}
      ariaLabel={ariaLabel}
      className={className}
      fullWidth={fullWidth}
      size={size}
    />
  );
}
