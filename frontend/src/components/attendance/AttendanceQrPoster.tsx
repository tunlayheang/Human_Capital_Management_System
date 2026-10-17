import React, { forwardRef, memo } from 'react';
import { MapPin, Smartphone, ScanLine, Clock } from 'lucide-react';
import { BrandedAttendanceQr, QR_LOGO_SRC } from './BrandedAttendanceQr';

export type AttendanceQrPosterProps = {
  officeName: string;
  qrValue: string;
  ttlSeconds: number;
  /** Screen-only hint under QR (hidden when exporting if needed via class) */
  refreshHint: string;
  subtitle: string;
  instructionTitle: string;
  steps: [string, string, string];
  footnote: string;
  brandLine: string;
  className?: string;
};

/**
 * Printable / downloadable attendance QR poster (white card on branded frame).
 */
export const AttendanceQrPoster = memo(
  forwardRef<HTMLDivElement, AttendanceQrPosterProps>(function AttendanceQrPoster(
    {
      officeName,
      qrValue,
      ttlSeconds,
      refreshHint,
      subtitle,
      instructionTitle,
      steps,
      footnote,
      brandLine,
      className = '',
    },
    ref
  ) {
    const stepIcons = [Smartphone, ScanLine, Clock];

    return (
      <div
        ref={ref}
        className={`attendance-qr-poster w-full max-w-[22rem] mx-auto ${className}`}
        data-qr-poster
      >
        <div className="rounded-3xl p-1.5 bg-gradient-to-br from-slate-900 via-primary-900 to-slate-900 shadow-2xl shadow-slate-900/40 ring-1 ring-white/10">
          <div className="rounded-[1.35rem] bg-white px-6 py-7 text-center">
            <div className="flex items-center justify-center gap-3 mb-5">
              <div className="logo-circle-frame logo-circle-frame--app flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden bg-white ring-2 ring-primary-100">
                <img src={QR_LOGO_SRC} alt="" className="h-[88%] w-[88%] object-contain" />
              </div>
              <div className="text-left min-w-0">
                <p className="text-sm font-bold text-primary-700 tracking-wide">ROC</p>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  {brandLine}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-center gap-1.5 text-primary-600 mb-1">
              <MapPin className="w-4 h-4 shrink-0" aria-hidden />
              <p className="text-[10px] font-bold uppercase tracking-[0.14em]">Office</p>
            </div>
            <h2 className="text-xl font-extrabold text-slate-900 leading-tight mb-1 px-1">
              {officeName}
            </h2>
            <p className="text-xs text-slate-500 mb-5">{subtitle}</p>

            <div className="inline-flex rounded-2xl border-[3px] border-primary-500 bg-white p-4 shadow-lg shadow-primary-500/15 qr-poster-qr-wrap">
              <BrandedAttendanceQr value={qrValue} size={248} />
            </div>

            <p
              className="mt-4 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 qr-poster-live-hint"
              data-ttl={ttlSeconds}
            >
              {refreshHint}
            </p>

            <p className="mt-5 text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">
              {instructionTitle}
            </p>
            <ol className="space-y-2.5 text-left max-w-[16rem] mx-auto">
              {steps.map((step, i) => {
                const Icon = stepIcons[i] ?? ScanLine;
                return (
                  <li key={i} className="flex items-start gap-2.5 text-xs text-slate-600">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-600 text-[10px] font-bold text-white">
                      {i + 1}
                    </span>
                    <span className="flex items-start gap-1.5 pt-0.5 leading-snug">
                      <Icon className="w-3.5 h-3.5 shrink-0 text-primary-600 mt-0.5" aria-hidden />
                      {step}
                    </span>
                  </li>
                );
              })}
            </ol>

            <p className="mt-5 pt-4 border-t border-slate-100 text-[10px] text-slate-400 leading-relaxed">
              {footnote}
            </p>
          </div>
          <p className="py-3 text-center text-[9px] font-semibold uppercase tracking-[0.2em] text-white/80">
            ROC · Human Capital Management
          </p>
        </div>
      </div>
    );
  })
);
