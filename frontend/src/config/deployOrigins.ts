/** Render production hosts — keep in sync with render.yaml. */
export const RENDER_FRONTEND_HOST = 'iroc-hcms-frontend1.onrender.com';
export const RENDER_BACKEND_ORIGIN = 'https://iroc-service-hcms.onrender.com';

/** When the static UI is on Render, API calls must hit the backend service directly (rewrites are unreliable). */
export function resolveRenderBackendOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  if (window.location.hostname !== RENDER_FRONTEND_HOST) return null;
  return RENDER_BACKEND_ORIGIN;
}
