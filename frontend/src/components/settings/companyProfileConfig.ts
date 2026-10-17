import type { LucideIcon } from 'lucide-react';
import { Building2, Image as ImageIcon, Network } from 'lucide-react';

/** Visible company-profile tabs. Legacy keys may still appear on field defs (hidden). */
export type CompanyInnerTabKey =
  | 'general'
  | 'branding'
  | 'structure'
  /** @deprecated Hidden — fields kept for data compatibility only */
  | 'contact'
  | 'regional'
  | 'compliance'
  | 'documents';

export const COMPANY_TABS: Array<{
  key: 'general' | 'branding' | 'structure';
  label: string;
  icon: LucideIcon;
}> = [
  { key: 'general', label: 'General', icon: Building2 },
  { key: 'branding', label: 'Portal appearance', icon: ImageIcon },
  { key: 'structure', label: 'Structure', icon: Network },
];

export const COMPANY_TAB_HINTS: Record<'general' | 'branding' | 'structure', string> = {
  general: 'Company identity, classification, website, and contact details.',
  branding: 'Portal logo shown on the login page and inside the app.',
  structure: 'Job levels used when defining positions.',
};

/** Group fields within a tab for clearer scanning. */
export const COMPANY_FIELD_GROUPS: Partial<
  Record<CompanyInnerTabKey, Array<{ title: string; keys: string[] }>>
> = {
  general: [
    {
      title: 'Company identity',
      keys: ['company.name', 'company.legal_name', 'company.short_name'],
    },
    {
      title: 'Classification',
      keys: ['company.industry_type', 'company.business_type', 'company.founded_date'],
    },
    { title: 'Online', keys: ['company.website'] },
    {
      title: 'Phone & email',
      keys: [
        'contact.main_phone',
        'contact.secondary_phone',
        'contact.company_email',
        'contact.hr_email',
        'contact.support_email',
        'contact.fax_number',
      ],
    },
  ],
  branding: [
    {
      title: 'Portal logo',
      keys: ['branding.logo'],
    },
  ],
};
