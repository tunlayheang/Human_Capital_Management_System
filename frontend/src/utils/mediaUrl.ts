/**
 * Resolve stored avatar/media paths for use in <img src>.
 *
 * Uploads are served by the API (`/uploads/*`), not the static frontend host.
 * On Render, uploads load from the backend origin when VITE_API_BASE_URL is set.
 */
import { resolveRenderBackendOrigin } from '../config/deployOrigins';

/** Static frontend hosts that must never serve `/uploads/*` directly. */
const FRONTEND_UPLOAD_HOSTS = new Set([
  'iroc-hcms-frontend1.onrender.com',
  'localhost',
  '127.0.0.1',
]);

/** Use same-origin `/uploads/…` unless an explicit API/uploads base URL is configured. */
function preferRelativeMediaPaths(): boolean {
  if (import.meta.env.VITE_API_BASE_URL?.trim()) return false;
  if (import.meta.env.VITE_DEV_BACKEND_URL?.trim()) return false;
  if (import.meta.env.VITE_UPLOADS_BASE_URL?.trim()) return false;
  return true;
}

/** API origin without `/api` — only when callers set VITE_* base URLs explicitly. */
export function resolveUploadsOrigin(): string {
  const uploadsBase = import.meta.env.VITE_UPLOADS_BASE_URL?.trim()?.replace(/\/$/, '');
  if (uploadsBase) {
    return uploadsBase.replace(/\/api\/?$/i, '');
  }

  const configured = import.meta.env.VITE_API_BASE_URL?.trim()?.replace(/\/$/, '');
  if (configured) {
    return configured.replace(/\/api\/?$/i, '');
  }

  if (import.meta.env.DEV) {
    const devBackend = import.meta.env.VITE_DEV_BACKEND_URL?.trim()?.replace(/\/$/, '');
    if (devBackend) return devBackend.replace(/\/api\/?$/i, '');
  }

  const renderBackend = resolveRenderBackendOrigin();
  if (renderBackend) return renderBackend;

  return '';
}

function uploadsPathFromStored(raw: string): string | null {
  const s = raw.trim();
  const match = s.match(/\/uploads\/[^?#]+/i);
  if (match) return match[0];
  if (/^uploads\/[^?#]+/i.test(s)) return `/${s}`;
  if (/^[\w-]+\.(jpe?g|png|gif|webp)$/i.test(s) || /^[a-f0-9]{16,}/i.test(s)) {
    return `/uploads/${s.replace(/^\//, '')}`;
  }
  return null;
}

function absoluteUploadUrl(uploadsPath: string): string {
  if (preferRelativeMediaPaths()) return uploadsPath;
  const origin = resolveUploadsOrigin();
  if (origin) return `${origin.replace(/\/$/, '')}${uploadsPath}`;
  return uploadsPath;
}

function rewriteKnownUploadHost(url: URL): string | null {
  if (!url.pathname.startsWith('/uploads/')) return null;
  const pathWithQuery = `${url.pathname}${url.search}`;
  const host = url.hostname.toLowerCase();

  if (preferRelativeMediaPaths()) {
    if (FRONTEND_UPLOAD_HOSTS.has(host) || host.endsWith('.onrender.com')) {
      return pathWithQuery;
    }
    const apiOrigin = resolveUploadsOrigin().replace(/\/$/, '').toLowerCase();
    if (apiOrigin && `${url.protocol}//${url.host}`.toLowerCase() === apiOrigin) {
      return pathWithQuery;
    }
    return null;
  }

  const apiOrigin = resolveUploadsOrigin().replace(/\/$/, '').toLowerCase();
  const current = `${url.protocol}//${url.host}`.toLowerCase();
  if (current === apiOrigin) return null;
  if (FRONTEND_UPLOAD_HOSTS.has(host)) {
    return absoluteUploadUrl(pathWithQuery);
  }
  return null;
}

export function resolveMediaUrl(raw: string | null | undefined): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return null;

  if (s.startsWith('data:')) {
    if (s.startsWith('data:image') && s.length < 800) {
      return null;
    }
    return s;
  }

  if (/^https?:\/\//i.test(s)) {
    try {
      const parsed = new URL(s);
      const rewritten = rewriteKnownUploadHost(parsed);
      if (rewritten) return rewritten;
    } catch {
      /* ignore malformed URL */
    }
    return s;
  }

  const uploadsPath = uploadsPathFromStored(s);
  if (uploadsPath) {
    return absoluteUploadUrl(uploadsPath);
  }

  if (s.startsWith('/uploads/')) {
    return absoluteUploadUrl(s.split('?')[0] + (s.includes('?') ? `?${s.split('?')[1]}` : ''));
  }

  return s.startsWith('/') ? s : `/${s}`;
}

/** Neutral placeholder when an upload is missing (e.g. after Render redeploy). */
export const AVATAR_FALLBACK_SRC =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#e2e8f0"/><circle cx="32" cy="26" r="12" fill="#94a3b8"/><ellipse cx="32" cy="54" rx="18" ry="14" fill="#94a3b8"/></svg>'
  );

export function onAvatarImageError(event: { currentTarget: HTMLImageElement }): void {
  const img = event.currentTarget;
  if (img.dataset.fallbackApplied === '1') {
    img.style.display = 'none';
    return;
  }
  img.dataset.fallbackApplied = '1';
  img.src = AVATAR_FALLBACK_SRC;
}
