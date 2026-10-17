import React from 'react';
import { Database } from 'lucide-react';
import { useBackendHealth } from '../../hooks/useBackendHealth';

/** Shown when API or MySQL is unreachable. */
export const BackendStatusBanner: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { ok, database, loading } = useBackendHealth();

  if (loading || ok) return null;

  return (
    <div
      className={`rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 flex gap-3 items-start ${className}`}
      role="alert"
    >
      <Database className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
      <div className="text-sm text-amber-900 dark:text-amber-100">
        <p className="font-semibold">
          {database === 'disconnected' ? 'Database is not running' : 'Backend is not reachable'}
        </p>
        <p className="mt-1 text-amber-800/90 dark:text-amber-200/90">
          From the project root: start <strong>MySQL</strong> (XAMPP), then run{' '}
          <code className="text-xs bg-amber-100 dark:bg-amber-950 px-1 rounded">npm run dev</code>{' '}
          and open the UI at{' '}
          <code className="text-xs bg-amber-100 dark:bg-amber-950 px-1 rounded">http://localhost:3000</code>{' '}
          (not the API port). The HR API runs on port 4000 in the background.
        </p>
      </div>
    </div>
  );
};
