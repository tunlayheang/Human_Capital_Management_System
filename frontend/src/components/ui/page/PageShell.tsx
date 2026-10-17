import React from 'react';

type Props = {
  children: React.ReactNode;
  className?: string;
};

/** Standard vertical rhythm for authenticated pages inside Layout. */
export const PageShell: React.FC<Props> = ({ children, className = '' }) => (
  <div className={`page-shell w-full min-w-0 max-w-full ${className}`.trim()}>{children}</div>
);
