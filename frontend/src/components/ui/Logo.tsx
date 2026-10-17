import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { fetchPortalBranding, type PortalBranding } from '../../services/portalBranding';
import { resolveMediaUrl } from '../../utils/mediaUrl';

interface LogoProps {
  className?: string;
  showSubtitle?: boolean;
  showBrandName?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'light' | 'dark' | 'color';
  align?: 'start' | 'center' | 'end';
  layout?: 'horizontal' | 'mark-only';
  logoSrc?: string;
  brandName?: string;
  /** portal = wide uploaded logo without square frame (login / marketing) */
  presentation?: 'default' | 'portal';
}

const DEFAULT_LOGO_SRC = '/images/roc-logo.png';

const sizes = {
  sm: {
    frame: 'h-10 w-10',
    pad: 'p-1',
    brand: 'text-[15px] sm:text-base',
    sub: 'text-[10px] sm:text-[11px]',
    gap: 'gap-2.5 sm:gap-3',
    portalImg: 'h-9 sm:h-10 max-w-[11rem] sm:max-w-[13rem]',
  },
  md: {
    frame: 'h-12 w-12',
    pad: 'p-1',
    brand: 'text-lg',
    sub: 'text-xs',
    gap: 'gap-3',
    portalImg: 'h-11 max-w-[14rem]',
  },
  lg: {
    frame: 'h-16 w-16',
    pad: 'p-2',
    brand: 'text-xl',
    sub: 'text-sm',
    gap: 'gap-3.5',
    portalImg: 'h-14 max-w-[16rem]',
  },
  xl: {
    frame: 'h-20 w-20',
    pad: 'p-2.5',
    brand: 'text-2xl',
    sub: 'text-sm',
    gap: 'gap-4',
    portalImg: 'h-16 max-w-[18rem]',
  },
} as const;

const frameTone: Record<NonNullable<LogoProps['variant']>, string> = {
  color:
    'border-slate-200/90 bg-gradient-to-br from-white to-slate-50 shadow-sm dark:border-slate-600/80 dark:from-slate-800 dark:to-slate-900 dark:shadow-md dark:shadow-slate-950/40',
  light: 'border-slate-200/90 bg-white shadow-sm',
  dark:
    'border-primary-500/30 bg-gradient-to-br from-[#0c1829] to-[#071525] shadow-lg shadow-slate-950/50 ring-1 ring-white/10',
};

function LogoMarkFallback({ compact, label }: { compact?: boolean; label: string }) {
  return (
    <span
      className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-primary-600 to-primary-800 font-bold tracking-tight text-white ${
        compact ? 'text-[10px]' : 'text-xs'
      }`}
      aria-hidden
    >
      {label.slice(0, 3).toUpperCase() || 'ROC'}
    </span>
  );
}

function resolveLogoSrc(branding: PortalBranding, logoSrc?: string): string {
  if (logoSrc?.trim()) return resolveMediaUrl(logoSrc.trim()) || DEFAULT_LOGO_SRC;
  if (branding.logo) return resolveMediaUrl(branding.logo) || DEFAULT_LOGO_SRC;
  return DEFAULT_LOGO_SRC;
}

function hasCustomPortalLogo(branding: PortalBranding, logoSrc?: string): boolean {
  const raw = logoSrc?.trim() || branding.logo;
  return Boolean(raw && !raw.includes('iroc-logo.png') && !raw.includes('roc-logo.png'));
}

export const Logo: React.FC<LogoProps> = ({
  className = '',
  showSubtitle = true,
  showBrandName,
  size = 'md',
  variant = 'color',
  align = 'center',
  layout,
  logoSrc,
  brandName,
  presentation = 'default',
}) => {
  const { t } = useLanguage();
  const s = sizes[size];
  const [branding, setBranding] = useState<PortalBranding>({ logo: '', frontCover: '', companyName: '' });
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    if (logoSrc) return;
    let active = true;
    void fetchPortalBranding().then((data) => {
      if (active) setBranding(data);
    });
    return () => {
      active = false;
    };
  }, [logoSrc]);

  const resolvedLogoSrc = resolveLogoSrc(branding, logoSrc);
  const customLogo = hasCustomPortalLogo(branding, logoSrc);
  const resolvedBrandName = brandName?.trim() || branding.companyName || t('logo.brandName');
  const isPortalPresentation = presentation === 'portal' && customLogo && !imgError;

  useEffect(() => {
    setImgError(false);
  }, [resolvedLogoSrc]);

  const resolvedLayout = layout ?? (showSubtitle || showBrandName === true ? 'horizontal' : 'mark-only');
  const showName = showBrandName ?? (showSubtitle && resolvedLayout === 'horizontal' && !isPortalPresentation);

  const alignItems =
    align === 'start' ? 'items-start' : align === 'end' ? 'items-end' : 'items-center';
  const textAlign =
    align === 'start' ? 'text-left' : align === 'end' ? 'text-right' : 'text-center';

  if (isPortalPresentation) {
    return (
      <div className={`inline-flex select-none ${className}`} aria-label={resolvedBrandName}>
        <img
          src={resolvedLogoSrc}
          alt={resolvedBrandName}
          className={`${s.portalImg} w-auto object-contain object-left`}
          draggable={false}
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  const mark = (
    <div
      className={`logo-mark-frame shrink-0 overflow-hidden rounded-xl border ${s.frame} ${s.pad} ${frameTone[variant]} transition-transform duration-300 group-hover:scale-[1.02]`}
    >
      {imgError ? (
        <LogoMarkFallback compact={size === 'sm'} label={resolvedBrandName} />
      ) : (
        <img
          src={resolvedLogoSrc}
          alt=""
          className="h-full w-full object-contain object-center"
          draggable={false}
          onError={() => setImgError(true)}
        />
      )}
    </div>
  );

  if (resolvedLayout === 'mark-only') {
    return (
      <div className={`inline-flex select-none ${className} group`} aria-label={t('logo.subtitle')}>
        {mark}
      </div>
    );
  }

  return (
    <div
      className={`inline-flex ${alignItems} select-none ${className} group`}
      aria-label={`${resolvedBrandName} — ${t('logo.subtitle')}`}
    >
      <div className={`flex ${alignItems} ${s.gap}`}>
        {mark}
        {(showName || showSubtitle) && (
          <div className={`flex min-w-0 flex-col justify-center ${textAlign}`}>
            {showName && (
              <span
                className={`${s.brand} font-bold tracking-tight text-slate-900 dark:text-white leading-none`}
              >
                {resolvedBrandName}
              </span>
            )}
            {showSubtitle && (
              <span
                className={`${s.sub} mt-1 font-medium leading-snug text-slate-500 dark:text-slate-400 max-w-[10.5rem] sm:max-w-[15rem]`}
              >
                {t('logo.subtitle')}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
