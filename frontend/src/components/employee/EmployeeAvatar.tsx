import React, { useState } from 'react';
import { resolveMediaUrl } from '../../utils/mediaUrl';

export type EmployeeAvatarProps = {
  avatarUrl?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** Tailwind size classes, e.g. `h-10 w-10` */
  className?: string;
  alt?: string;
};

/**
 * Lazy-loaded circular avatar. Falls back to initials when there is no URL,
 * the URL is invalid/truncated, or the image fails to load.
 *
 * Performance: uses native `loading="lazy"` so off-screen rows do not compete
 * for bandwidth; keep uploaded files ≤ 5 MB on the server.
 */
export function EmployeeAvatar({
  avatarUrl,
  firstName,
  lastName,
  className = 'h-10 w-10',
  alt = '',
}: EmployeeAvatarProps) {
  const [failed, setFailed] = useState(false);
  const src = resolveMediaUrl(avatarUrl);
  const initials =
    `${(lastName?.trim() && !/^[—–−\-]+$/.test(lastName.trim()) ? lastName.trim()[0] : '') || ''}${
      (firstName?.trim() && !/^[—–−\-]+$/.test(firstName.trim()) ? firstName.trim()[0] : '') || ''
    }`.toUpperCase() || '?';

  if (!src || failed) {
    return (
      <div
        className={`${className} rounded-full bg-slate-300 dark:bg-slate-600 flex items-center justify-center flex-shrink-0`}
      >
        <span className="text-[10px] sm:text-xs md:text-sm font-medium text-slate-700 dark:text-slate-300">
          {initials}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${className} rounded-full object-cover flex-shrink-0 border border-slate-200/80 dark:border-slate-600`}
    />
  );
}
