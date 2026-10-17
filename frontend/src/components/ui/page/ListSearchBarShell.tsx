import React from 'react';
import { listSearchBarShellClass } from '../../../constants/designSystem';
import { cn } from '../../../utils';

export type ListSearchBarShellProps = {
  children: React.ReactNode;
  className?: string;
};

/** White rounded container for pill search + circular filter controls. */
export const ListSearchBarShell: React.FC<ListSearchBarShellProps> = ({ children, className }) => (
  <div className={cn(listSearchBarShellClass, className)}>{children}</div>
);
