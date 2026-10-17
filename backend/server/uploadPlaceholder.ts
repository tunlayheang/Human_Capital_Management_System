/** SVG placeholder when an uploaded image is missing (e.g. after Render redeploy). */
export const UPLOAD_MISSING_IMAGE_PLACEHOLDER =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" rx="32" fill="#e2e8f0"/>' +
  '<circle cx="32" cy="26" r="12" fill="#94a3b8"/>' +
  '<ellipse cx="32" cy="54" rx="18" ry="14" fill="#94a3b8"/>' +
  '</svg>';

/** True for avatar/branding-style paths where a neutral image placeholder is acceptable. */
export function isUploadImagePath(pathname: string): boolean {
  const base = String(pathname || '')
    .split('/')
    .pop()
    ?.split('?')[0] ?? '';
  if (!base) return false;
  if (/\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(base)) return true;
  if (/^[a-f0-9]{16,64}$/i.test(base)) return true;
  return false;
}
