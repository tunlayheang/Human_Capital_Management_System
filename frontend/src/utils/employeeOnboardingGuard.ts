/**
 * Backward-compatible re-exports — prefer importing from `unsavedChangesGuard`.
 */
export {
  isEmployeeOnboardingPath,
  registerEmployeeOnboardingGuard,
  registerUnsavedChangesGuard,
  shouldPromptLeaveNavigation,
  tryLeaveEmployeeOnboarding,
  tryLeaveWithUnsavedChanges,
  type UnsavedChangesGuard,
} from './unsavedChangesGuard';
