import React, { forwardRef, memo } from 'react';
import { MapPin } from 'lucide-react';
import { BrandedAttendanceQr } from './BrandedAttendanceQr';

type Props = {
  officeName: string;
  qrValue: string;
  subtitle: string;
  className?: string;
};

/** In-app live QR preview — not the printable poster layout. */
export const AttendanceQrLiveDisplay = memo(
  forwardRef<HTMLDivElement, Props>(function AttendanceQrLiveDisplay(
    { officeName, qrValue, subtitle, className = '' },
    ref
  ) {
    return (
      <div
        ref={ref}
        className={`w-full max-w-md mx-auto flex flex-col items-center text-center ${className}`}
      >
        <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400 mb-1">
          <MapPin className="w-4 h-4 shrink-0" aria-hidden />
          <span className="text-[10px] font-bold uppercase tracking-[0.14em]">Office</span>
        </div>
        <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">{officeName}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-6 max-w-xs">{subtitle}</p>

        <div className="rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-lg shadow-slate-200/60 dark:shadow-black/30 ring-1 ring-slate-200/80 dark:ring-slate-700 qr-live-qr-wrap">
          <BrandedAttendanceQr value={qrValue} size={240} />
        </div>
      </div>
    );
  })
);
