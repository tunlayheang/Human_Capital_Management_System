import React, { memo } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export const QR_LOGO_SRC = '/images/roc-logo.png';
const DEFAULT_SIZE = 220;
const LOGO_RATIO = 0.2;
const BADGE_PADDING_RATIO = 0.06;

type Props = {
  value: string;
  size?: number;
  className?: string;
};

/** QR with circular ROC logo centered (high error correction for reliable scanning). */
export const BrandedAttendanceQr = memo(function BrandedAttendanceQr({
  value,
  size = DEFAULT_SIZE,
  className = '',
}: Props) {
  const logoSize = Math.round(size * LOGO_RATIO);
  const badgeSize = logoSize + Math.round(size * BADGE_PADDING_RATIO) * 2;

  return (
    <div
      className={`relative inline-flex shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <QRCodeSVG
        value={value}
        size={size}
        level="H"
        includeMargin
        imageSettings={{
          src: QR_LOGO_SRC,
          width: logoSize,
          height: logoSize,
          excavate: true,
        }}
      />
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        aria-hidden
      >
        <div
          className="logo-circle-frame logo-circle-frame--app flex items-center justify-center overflow-hidden bg-white shadow-sm ring-4 ring-white dark:ring-slate-800 border border-slate-200/80 dark:border-slate-700/80 dark:bg-slate-900 dark:shadow-slate-950/30"
          style={{ width: badgeSize, height: badgeSize }}
        >
          <img
            src={QR_LOGO_SRC}
            alt=""
            className="h-[88%] w-[88%] object-contain object-center"
          />
        </div>
      </div>
    </div>
  );
});
