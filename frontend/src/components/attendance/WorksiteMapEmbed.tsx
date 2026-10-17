import React from 'react';
import { MapPin } from 'lucide-react';
import { formatCoordinates, mapsLink, osmEmbedUrl } from '../../utils/attendanceGeo';

type WorksiteMapEmbedProps = {
  latitude: number;
  longitude: number;
  name?: string;
  className?: string;
};

/** Inline map preview with coordinate fallback (no third-party static image host). */
export const WorksiteMapEmbed: React.FC<WorksiteMapEmbedProps> = ({
  latitude,
  longitude,
  name,
  className = '',
}) => {
  const embedSrc = osmEmbedUrl(latitude, longitude);

  return (
    <div className={`relative overflow-hidden bg-slate-100 dark:bg-slate-900 ${className}`}>
      <iframe
        title={name ? `Map: ${name}` : 'Worksite map'}
        src={embedSrc}
        className="absolute inset-0 h-full w-full border-0"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-900/25 to-transparent" />
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2 rounded-lg bg-white/90 dark:bg-slate-900/90 backdrop-blur px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 shadow-sm">
        <span className="flex items-center gap-1.5 font-mono truncate">
          <MapPin className="w-3.5 h-3.5 shrink-0 text-primary-600" />
          {formatCoordinates(latitude, longitude)}
        </span>
        <a
          href={mapsLink(latitude, longitude)}
          target="_blank"
          rel="noreferrer"
          className="pointer-events-auto shrink-0 font-semibold text-primary-600 hover:underline"
        >
          Maps
        </a>
      </div>
    </div>
  );
};

export default WorksiteMapEmbed;
