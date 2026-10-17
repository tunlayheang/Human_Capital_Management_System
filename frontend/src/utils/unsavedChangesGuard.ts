/**
 * App-wide unsaved-changes leave guard (HashRouter-safe).
 * Any feature can register while dirty; sidebar / workspace tabs call
 * {@link shouldPromptLeaveNavigation} + {@link tryLeaveWithUnsavedChanges}.
 */

export type UnsavedChangesGuard = {
  id: string;
  hasUnsavedEdits: () => boolean;
  /** Show confirm UI, then call exit() only if the user discards changes. */
  requestLeave: (exit: () => void) => void;
};

const guards: UnsavedChangesGuard[] = [];

function normalizePath(path: string): string {
  return (path || '').split('?')[0].replace(/\/$/, '') || '/';
}

export function registerUnsavedChangesGuard(guard: UnsavedChangesGuard): () => void {
  const existing = guards.findIndex((g) => g.id === guard.id);
  if (existing >= 0) guards.splice(existing, 1);
  guards.push(guard);
  return () => {
    const i = guards.findIndex((g) => g.id === guard.id);
    if (i >= 0) guards.splice(i, 1);
  };
}

/** True when navigating away while any registered form has unsaved edits. */
export function shouldPromptLeaveNavigation(fromPath: string, toPath: string): boolean {
  const from = normalizePath(fromPath);
  const to = normalizePath(toPath);
  if (from === to) return false;
  return guards.some((g) => {
    try {
      return g.hasUnsavedEdits();
    } catch {
      return false;
    }
  });
}

/** Run exit immediately, or ask the topmost dirty guard to confirm first. */
export function tryLeaveWithUnsavedChanges(exit: () => void): void {
  for (let i = guards.length - 1; i >= 0; i -= 1) {
    const g = guards[i];
    try {
      if (g.hasUnsavedEdits()) {
        g.requestLeave(exit);
        return;
      }
    } catch {
      /* ignore broken guard */
    }
  }
  exit();
}

/* ─── Backward-compatible onboarding aliases ─── */

const ONBOARDING_GUARD_ID = 'employee-onboarding';

export function isEmployeeOnboardingPath(pathname: string): boolean {
  const p = (pathname || '').replace(/\/$/, '') || '/';
  if (p === '/employees/onboarding/new' || p.endsWith('/employees/new')) return true;
  if (/\/employees\/[^/]+\/edit$/.test(p)) return true;
  if (/\/employees\/edit\/[^/]+$/.test(p)) return true;
  return false;
}

/** @deprecated Prefer {@link registerUnsavedChangesGuard} */
export function registerEmployeeOnboardingGuard(
  guard: { hasUnsavedEdits: () => boolean; requestLeave: (exit: () => void) => void } | null
): void {
  // Remove previous onboarding registration
  const i = guards.findIndex((g) => g.id === ONBOARDING_GUARD_ID);
  if (i >= 0) guards.splice(i, 1);
  if (!guard) return;
  guards.push({
    id: ONBOARDING_GUARD_ID,
    hasUnsavedEdits: guard.hasUnsavedEdits,
    requestLeave: guard.requestLeave,
  });
}

/** @deprecated Prefer {@link tryLeaveWithUnsavedChanges} */
export function tryLeaveEmployeeOnboarding(exit: () => void): void {
  tryLeaveWithUnsavedChanges(exit);
}
