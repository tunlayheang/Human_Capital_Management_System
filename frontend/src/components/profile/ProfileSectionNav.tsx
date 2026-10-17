import React from 'react';
import type { SectionTab } from './ProfileSectionTabs';
import { ProfileSectionTabs } from './ProfileSectionTabs';

type ProfileSectionNavProps<T extends string> = {
  tabs: SectionTab<T>[];
  active: T;
  onChange: (id: T) => void;
  title?: string;
};

/** @deprecated Use ProfileSectionTabs — horizontal pill tabs on all breakpoints. */
export const ProfileSectionNav = <T extends string>({
  tabs,
  active,
  onChange,
  title,
}: ProfileSectionNavProps<T>) => {
  return (
    <ProfileSectionTabs
      tabs={tabs}
      active={active}
      onChange={onChange}
      ariaLabel={title || 'Sections'}
    />
  );
};
