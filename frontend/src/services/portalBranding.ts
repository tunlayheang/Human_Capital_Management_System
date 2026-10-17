import { useEffect, useState } from 'react';
import { API_BASE_URL } from './api';

export type PortalBranding = {
  logo: string;
  frontCover: string;
  companyName: string;
};

const EMPTY_BRANDING: PortalBranding = {
  logo: '',
  frontCover: '',
  companyName: '',
};

let cached: PortalBranding | null = null;
let inflight: Promise<PortalBranding> | null = null;

export function invalidatePortalBrandingCache(): void {
  cached = null;
  inflight = null;
}

export async function fetchPortalBranding(force = false): Promise<PortalBranding> {
  if (!force && cached) return cached;
  if (!force && inflight) return inflight;

  if (force) {
    cached = null;
  }

  inflight = fetch(`${API_BASE_URL}/public/portal-branding`)
    .then(async (res) => {
      if (!res.ok) throw new Error('Unable to load portal branding');
      const data = (await res.json()) as Partial<PortalBranding>;
      cached = {
        logo: String(data.logo ?? '').trim(),
        frontCover: String(data.frontCover ?? '').trim(),
        companyName: String(data.companyName ?? '').trim(),
      };
      return cached;
    })
    .catch(() => EMPTY_BRANDING)
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function usePortalBranding(): PortalBranding & { loading: boolean } {
  const [branding, setBranding] = useState<PortalBranding>(cached ?? EMPTY_BRANDING);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    let active = true;
    void fetchPortalBranding(true).then((data) => {
      if (active) setBranding(data);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return { ...branding, loading };
}
