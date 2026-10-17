import { defaultPolicyEffectiveDate } from './policyEffectiveDate';

type ConfirmEffectiveDateFn = (options: {
  title: string;
  description: string;
  variant?: 'danger' | 'success';
  confirmLabel?: string;
  effectiveDateLabel?: string;
  defaultEffectiveDate?: string;
}) => Promise<string | null>;

/** Prompt to activate/deactivate a record and require an effective date. */
export async function promptActiveStatusChange(
  confirmEffectiveDate: ConfirmEffectiveDateFn,
  opts: {
    entityLabel: string;
    entityName: string;
    nextActive: boolean;
    defaultEffectiveDate?: string;
  }
): Promise<string | null> {
  const action = opts.nextActive ? 'Activate' : 'Deactivate';
  return confirmEffectiveDate({
    title: `${action} ${opts.entityLabel}?`,
    description: opts.nextActive
      ? `Activate "${opts.entityName}" from the effective date you choose.`
      : `Deactivate "${opts.entityName}" from the effective date you choose. It will no longer apply after that date.`,
    variant: opts.nextActive ? 'success' : 'danger',
    confirmLabel: action,
    effectiveDateLabel: 'Effective date',
    defaultEffectiveDate: opts.defaultEffectiveDate ?? defaultPolicyEffectiveDate(),
  });
}
