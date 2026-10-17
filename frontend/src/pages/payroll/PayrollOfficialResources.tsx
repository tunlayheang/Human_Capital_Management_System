import React from 'react';
import { ExternalLink } from 'lucide-react';

export const PAYROLL_OFFICIAL_LINKS = [
  {
    name: 'General Department of Taxation',
    url: 'https://www.tax.gov.kh',
    domain: 'tax.gov.kh',
  },
  {
    name: 'Ministry of Labor & Vocational Training',
    url: 'https://www.mlvt.gov.kh',
    domain: 'mlvt.gov.kh',
  },
] as const;

/** Compact official links for the Payroll module header. */
export const PayrollOfficialResources: React.FC = () => (
  <div className="w-full md:w-auto md:max-w-xl">
    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2 md:text-right">
      Official Resources
    </p>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {PAYROLL_OFFICIAL_LINKS.map((link) => (
        <a
          key={link.url}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-start gap-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/80 dark:bg-slate-900/40 px-3 py-2.5 hover:border-primary-300 dark:hover:border-primary-700 hover:bg-primary-50/60 dark:hover:bg-primary-900/20 transition-colors"
        >
          <ExternalLink
            className="w-4 h-4 shrink-0 mt-0.5 text-slate-400 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors"
            aria-hidden
          />
          <span className="min-w-0 text-left">
            <span className="block text-xs font-semibold text-slate-800 dark:text-slate-100 leading-snug group-hover:text-primary-700 dark:group-hover:text-primary-300 transition-colors">
              {link.name}
            </span>
            <span className="block text-[11px] text-primary-600 dark:text-primary-400 mt-0.5 font-medium">
              {link.domain}
            </span>
          </span>
        </a>
      ))}
    </div>
  </div>
);
