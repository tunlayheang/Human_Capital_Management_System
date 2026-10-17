import { Api } from '../services/api';
import { EXPORT_BRAND } from './export/exportDocumentStandard';

export type DocumentBranding = {
  companyName: string;
  companyShort: string;
  payslipFooter: string;
  reportHeader: string;
  reportFooter: string;
  emailSignature: string;
};

/** Where each Documents tab template is applied in the product. */
export const DOCUMENT_TEMPLATE_COVERAGE = {
  payslipFooter: [
    'My Pay payslip view and print',
    'Payslip PDF download from payroll runs',
    'Employee payslip export',
  ],
  reportHeader: [
    'Payroll run exports (PDF, CSV, Excel)',
    'Payroll approval PDF',
    'Leave, overtime, movement, probation, and appraisal review PDFs',
    'Employee profile PDF',
    'Roster and access governance exports',
  ],
  reportFooter: [
    'All report PDF footers (including Employee profile PDF)',
    'Payroll, roster, and audit CSV / Excel footers',
    'Print-friendly tabular exports',
  ],
  emailSignature: [
    'HR notification emails (when enabled)',
  ],
} as const;

const DEFAULT_PAYSLIP_FOOTER =
  'This is a system-generated payslip for your records. Cambodia Labor Law 1997 · NSSF Sub-Decree No. 28 · GDT Tax Prakas. Retain for your personal tax and employment records.';

let cache: { branding: DocumentBranding; at: number } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export function stripRichTextToPlain(value: unknown): string {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (!/[<>]/.test(raw)) return raw;
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function defaultDocumentBranding(): DocumentBranding {
  return {
    companyName: EXPORT_BRAND.companyName,
    companyShort: EXPORT_BRAND.companyShort,
    payslipFooter: DEFAULT_PAYSLIP_FOOTER,
    reportHeader: '',
    reportFooter: EXPORT_BRAND.documentFooter,
    emailSignature: '',
  };
}

export function brandingFromSettings(settings: Record<string, unknown>): DocumentBranding {
  const defaults = defaultDocumentBranding();
  const companyName =
    stripRichTextToPlain(settings['company.name']) ||
    stripRichTextToPlain(settings['company.legal_name']) ||
    defaults.companyName;
  const companyShort =
    stripRichTextToPlain(settings['company.short_name']) || companyName || defaults.companyShort;
  const payslipFooter =
    stripRichTextToPlain(settings['documents.payslip_footer']) || defaults.payslipFooter;
  const reportHeader = stripRichTextToPlain(settings['documents.report_header']);
  const reportFooter =
    stripRichTextToPlain(settings['documents.report_footer']) || defaults.reportFooter;
  const emailSignature = stripRichTextToPlain(settings['documents.email_signature']);
  return {
    companyName,
    companyShort,
    reportHeader,
    reportFooter,
    payslipFooter,
    emailSignature,
  };
}

export async function loadDocumentBranding(force = false): Promise<DocumentBranding> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    return cache.branding;
  }
  try {
    const response = await Api.system.getCompanySettings();
    const branding = brandingFromSettings((response.settings ?? {}) as Record<string, unknown>);
    cache = { branding, at: Date.now() };
    return branding;
  } catch {
    return defaultDocumentBranding();
  }
}

export function invalidateDocumentBrandingCache(): void {
  cache = null;
}

export function resolveReportFooterText(branding?: DocumentBranding): string {
  return branding?.reportFooter?.trim() || EXPORT_BRAND.documentFooter;
}

export function resolvePayslipFooterText(branding?: DocumentBranding): string {
  return branding?.payslipFooter?.trim() || DEFAULT_PAYSLIP_FOOTER;
}
