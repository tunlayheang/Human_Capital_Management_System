/** API / fetch errors that may carry an HTTP status. */
export type HttpError = Error & {
  status?: number;
  code?: string;
  data?: Record<string, unknown>;
};

export function asHttpError(error: unknown): HttpError | null {
  if (!error || typeof error !== 'object') return null;
  return error as HttpError;
}

/** True when the server rejected the request as unauthenticated (expired / missing session). */
export function isUnauthorizedError(error: unknown): boolean {
  const err = asHttpError(error);
  if (!err) return false;
  if (err.status === 401) return true;
  const msg = String(err.message || '').toLowerCase();
  return (
    msg.includes('session expired') ||
    msg.includes('unauthorized') ||
    msg.includes('inactive or frozen') ||
    msg.includes('signed out because your account is active')
  );
}
