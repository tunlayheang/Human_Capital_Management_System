import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ShieldAlert, ArrowLeft, LayoutDashboard } from 'lucide-react';
import { ButtonLink } from '../components/ui/Button';
import { useAuth } from '../context/AuthContext';
import { formatAccessRoleLabel } from '../utils/accessRole';

export const Forbidden: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string })?.from;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
          <ShieldAlert className="w-8 h-8 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Access restricted</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2 text-sm leading-relaxed">
            Your role ({formatAccessRoleLabel(user?.role) || 'guest'}) does not have access to this page.
            {from ? ` (${from})` : ''}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <ButtonLink to="/dashboard" variant="primary" className="inline-flex items-center gap-2">
            <LayoutDashboard className="w-4 h-4" />
            Go to dashboard
          </ButtonLink>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="w-4 h-4" />
            Go back
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Need access? Contact your{' '}
          <Link to="/profile" className="text-primary-600 font-medium hover:underline">
            administrator
          </Link>
          .
        </p>
      </div>
    </div>
  );
};

export default Forbidden;