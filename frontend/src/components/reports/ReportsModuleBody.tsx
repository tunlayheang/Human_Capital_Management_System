import React from 'react';

/** Shared layout wrapper for Reports → Analytics & History sub-pages. */
export const ReportsModuleBody: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="reports-module-body w-full min-w-0 max-w-full space-y-4 animate-in fade-in duration-300">
    {children}
  </div>
);
