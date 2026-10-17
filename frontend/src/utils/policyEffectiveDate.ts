import { formatLocalDateIso } from './localDate';
import { formatDateOnlyDisplay, formatDateTimeDisplay } from './formatDisplayDate';

/** Default effective date when scheduling a policy change (today, company timezone). */
export function defaultPolicyEffectiveDate(today = new Date()): string {
  return formatLocalDateIso(today);
}

/** @deprecated Prefer `defaultPolicyEffectiveDate` — kept for existing imports. */
export function suggestedNextPolicyEffectiveDate(today = new Date()): string {
  return defaultPolicyEffectiveDate(today);
}

export function formatPolicyEffectiveLabel(iso: string | null | undefined): string {
  return formatDateOnlyDisplay(iso);
}

export function formatPolicyLastUpdatedLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.includes('T') || iso.includes(' ')
    ? formatDateTimeDisplay(iso)
    : formatDateOnlyDisplay(iso);
}

type ConfirmEffectiveDateFn = (options: {
  title: string;
  description: string;
  variant?: 'danger' | 'success';
  confirmLabel?: string;
  effectiveDateLabel?: string;
  defaultEffectiveDate?: string;
}) => Promise<string | null>;

/** Confirm a payroll policy save and require an effective date in the dialog. */
export async function promptPolicySaveEffectiveDate(
  confirmEffectiveDate: ConfirmEffectiveDateFn,
  opts: {
    title?: string;
    description?: string;
    confirmLabel?: string;
    defaultEffectiveDate?: string;
  } = {}
): Promise<string | null> {
  return confirmEffectiveDate({
    title: opts.title ?? 'Save policy changes?',
    description:
      opts.description ??
      'Choose the effective date for these changes. Policy updates are scheduled — they do not apply instantly.',
    variant: 'success',
    confirmLabel: opts.confirmLabel ?? 'Save',
    effectiveDateLabel: 'Effective from',
    defaultEffectiveDate: opts.defaultEffectiveDate ?? defaultPolicyEffectiveDate(),
  });
}
