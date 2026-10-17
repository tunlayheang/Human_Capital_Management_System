import React from 'react';
import { PillSegmentTabs, type PillSegmentTabItem } from '../ui/page/PillSegmentTabs';

export type ProfileSectionId = 'personal' | 'emergency' | 'financial' | 'work';

export type SectionTab<T extends string = ProfileSectionId> = {
  id: T;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number | string;
};

type ProfileSectionTabsProps<T extends string = ProfileSectionId> = {
  tabs: SectionTab<T>[];
  active: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
  fullWidth?: boolean;
  className?: string;
};

export const ProfileSectionTabs = <T extends string = ProfileSectionId>({
  tabs,
  active,
  onChange,
  ariaLabel = 'Sections',
  fullWidth = false,
  className = '',
}: ProfileSectionTabsProps<T>) => {
  if (tabs.length <= 1) return null;

  const pillTabs: PillSegmentTabItem<T>[] = tabs.map(({ id, label, icon, badge }) => ({
    id,
    label,
    icon,
    badge,
  }));

  return (
    <PillSegmentTabs
      value={active}
      onChange={onChange}
      tabs={pillTabs}
      ariaLabel={ariaLabel}
      fullWidth={fullWidth}
      className={className}
    />
  );
};
