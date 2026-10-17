import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDateOnlyDisplay } from './formatDisplayDate';

export { resolveMediaUrl } from './mediaUrl';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const formatTime = (isoString: string) => {
    if (!isoString) return '';
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/** Human-readable relative time, e.g. "5 min ago", "12 hours ago". */
export const formatRelativeTime = (isoString: string): string => {
  if (!isoString) return '';
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  return formatDateOnlyDisplay(isoString, '');
};

export const formatCurrency = (amount: number, currency = 'USD', locale = 'en-US') => {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
};

export const formatCurrencyKM = (amount: number) => {
    return formatCurrency(amount, 'KHR', 'km-KH');
};

export const keysToCamel = (o: any): any => {
  if (o === Object(o) && !Array.isArray(o) && typeof o !== 'function') {
    const n: any = {};
    Object.keys(o).forEach((k) => {
      n[k.replace(/_([a-z])/g, (g) => g[1].toUpperCase())] = keysToCamel(o[k]);
    });
    return n;
  } else if (Array.isArray(o)) {
    return o.map((i) => keysToCamel(i));
  }
  return o;
};

export const keysToSnake = (o: any): any => {
  if (o === Object(o) && !Array.isArray(o) && typeof o !== 'function') {
    const n: any = {};
    Object.keys(o).forEach((k) => {
      n[k.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] = keysToSnake(o[k]);
    });
    return n;
  } else if (Array.isArray(o)) {
    return o.map((i) => keysToSnake(i));
  }
  return o;
};

export const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3; // metres
  const φ1 = lat1 * Math.PI/180; // φ, λ in radians
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  const d = R * c; // in metres
  return d;
};

export function debounce<T extends (...args: any[]) => any>(fn: T, delay: number) {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function throttle<T extends (...args: any[]) => any>(fn: T, limit: number) {
  let inThrottle = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => { inThrottle = false; }, limit);
    }
  };
}

/**
 * Normalize login / badge EmpIDs to the current formats:
 * - legacy EMP / IROC → ROC##### (5 digits)
 * - ADM / ADM###### → ADM##### (5 digits)
 */
export function normalizeEmployeeDisplayId(id: unknown): string {
  const s = String(id ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const emp = s.match(/^(?:IROC|ROC|EMP)(\d+)$/i);
  if (emp) return `ROC${emp[1].padStart(5, '0')}`;
  const adm = s.match(/^ADM(\d+)$/i);
  if (adm) return `ADM${adm[1].padStart(5, '0')}`;
  return s;
}
