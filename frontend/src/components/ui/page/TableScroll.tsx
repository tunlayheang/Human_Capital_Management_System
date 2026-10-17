import React from 'react';

type Props = {
  children: React.ReactNode;
  className?: string;
};

/** Contained horizontal scroll for wide tables — avoids negative-margin bleed on mobile. */
export const TableScroll: React.FC<Props> = ({ children, className = '' }) => (
  <div className={`hcms-table-scroll ${className}`.trim()}>{children}</div>
);
