/**
 * Shared identity rules for owner employee restore (used by restoreOwnerAccounts + tests).
 */
export function ownerEmployeeNamePatch(opts: {
  created: boolean;
  currentFirst?: string | null;
  currentLast?: string | null;
  seedFirst: string;
  seedLast: string;
}): { first_name?: string; last_name?: string } {
  if (opts.created) {
    return { first_name: opts.seedFirst, last_name: opts.seedLast };
  }
  const curFirst = String(opts.currentFirst ?? '').trim().toLowerCase();
  const curLast = String(opts.currentLast ?? '').trim().toLowerCase();
  // One-time: replace the old demo placeholder only — never clobber customized names.
  if (curFirst === 'hr' && curLast === 'officer') {
    return { first_name: opts.seedFirst, last_name: opts.seedLast };
  }
  return {};
}
