import React from 'react';
import { motion } from 'framer-motion';
import { Logo } from '../ui/Logo';
import { BackendStatusBanner } from '../common/BackendStatusBanner';
import { LanguageSelector } from '../ui/LanguageSelector';
import { Shield, type LucideIcon } from 'lucide-react';
import './authPortal.css';

export type AuthFeatureItem = {
  title: string;
  icon: LucideIcon;
  /** @deprecated Descriptions are no longer shown on the brand panel. */
  description?: string;
};

type Props = {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  features?: AuthFeatureItem[];
  footer?: React.ReactNode;
};

export const AuthSplitLayout: React.FC<Props> = ({
  children,
  title,
  subtitle = 'Human Capital Management System',
  features = [],
  footer,
}) => (
  <div className="auth-portal-root hcms-min-viewport flex flex-col lg:flex-row">
    <aside className="auth-portal-brand relative hidden lg:flex lg:w-[min(44%,540px)] lg:max-w-[540px] lg:shrink-0 overflow-hidden text-white flex-col">
      <div className="auth-portal-brand-grid absolute inset-0 pointer-events-none" aria-hidden />

      <div className="relative z-10 flex flex-col flex-1 px-9 xl:px-11 py-8 xl:py-10">
        <Logo size="md" align="start" showSubtitle={false} variant="dark" />
        <motion.div
          className="flex-1 flex flex-col justify-center py-10 max-w-[24rem]"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <span className="auth-brand-badge mb-5">
            <Shield className="w-3 h-3" strokeWidth={2.25} />
            HCMS · ROC
          </span>
          <h2 className="auth-brand-title">{title}</h2>
          <p className="auth-brand-subtitle">{subtitle}</p>
          {features.length > 0 && (
            <ul className="mt-8 space-y-1.5 list-none p-0 m-0" aria-label="Platform features">
              {features.map(({ title: ft, icon: Icon }) => (
                <li key={ft} className="auth-feature-tile">
                  <div className="auth-feature-tile-icon" aria-hidden>
                    <Icon className="w-4 h-4" strokeWidth={2} />
                  </div>
                  <p className="auth-feature-tile-title">{ft}</p>
                </li>
              ))}
            </ul>
          )}
        </motion.div>
        <p className="relative z-10 text-[11px] text-slate-500/90">
          © {new Date().getFullYear()} ROC · Labour &amp; Human Resource Consulting
        </p>
      </div>
    </aside>

    <main className="auth-portal-main flex-1 flex flex-col min-h-0 min-w-0">
      <div className="auth-portal-topbar flex items-center justify-between gap-3 px-4 sm:px-8 py-3 shrink-0">
        <div className="flex-1 min-w-0">
          <BackendStatusBanner />
        </div>
        <LanguageSelector />
      </div>

      <div className="lg:hidden px-4 sm:px-6 pt-3 shrink-0">
        <div className="auth-mobile-hero rounded-[var(--auth-radius-lg)] px-4 py-3 flex items-center gap-3 text-white">
          <Logo size="sm" showSubtitle={false} variant="dark" className="shrink-0 scale-[0.88] origin-left" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold leading-snug truncate">{title}</p>
            <p className="text-[10px] text-slate-300/90 mt-0.5 line-clamp-2 leading-relaxed">{subtitle}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 sm:px-8 py-5 sm:py-8 min-h-0 overflow-y-auto">
        <div className="w-full max-w-[21.5rem] sm:max-w-[23rem] my-auto">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="auth-form-card p-6 sm:p-7"
          >
            {children}
          </motion.div>
          {footer && <div className="auth-portal-footer mt-5">{footer}</div>}
        </div>
      </div>
    </main>
  </div>
);
