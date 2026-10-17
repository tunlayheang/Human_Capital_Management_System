/** Query param that separates employee self-service UI from management UI on shared routes. */
export const SELF_SERVICE_SCOPE = 'self';
export const MANAGE_SCOPE = 'manage';

export function getRouteScope(searchParams: URLSearchParams): string | null {
  const scope = searchParams.get('scope');
  if (scope === SELF_SERVICE_SCOPE || scope === MANAGE_SCOPE) return scope;
  return null;
}

export function isSelfServiceScope(searchParams: URLSearchParams): boolean {
  return searchParams.get('scope') !== MANAGE_SCOPE;
}

export function isManageScope(searchParams: URLSearchParams): boolean {
  return searchParams.get('scope') === MANAGE_SCOPE;
}

export function parseNavItemScope(search?: string): string | null {
  if (!search) return null;
  const q = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(q).get('scope');
}
