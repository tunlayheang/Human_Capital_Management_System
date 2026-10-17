import React from 'react';
import { ShieldOff } from 'lucide-react';

type Props = {
  title?: string;
  message?: string;
};

export const RestrictedAccess: React.FC<Props> = ({
  title = 'Access restricted',
  message = 'You do not have permission to view this page.',
}) => (
  <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
    <ShieldOff className="w-14 h-14 text-slate-400 mb-4" />
    <h2 className="text-xl font-bold text-slate-900 dark:text-white">{title}</h2>
    <p className="text-slate-500 dark:text-slate-400 mt-2 max-w-md">{message}</p>
  </div>
);
