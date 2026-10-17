import { SELECT_OTHER_VALUE } from '../constants/selectOther';

export function presetValuesExcludingOther(
  options: readonly string[],
  otherValue: string = SELECT_OTHER_VALUE
): string[] {
  return options.filter((v) => v !== otherValue);
}

/** True when the stored value matches a fixed list option (not Other / custom). */
export function isPresetSelectValue(
  stored: string | undefined,
  presetValues: readonly string[],
  otherValue: string = SELECT_OTHER_VALUE
): boolean {
  const trimmed = String(stored ?? '').trim();
  if (!trimmed || trimmed === otherValue) return false;
  const presets = new Set(presetValuesExcludingOther(presetValues, otherValue));
  return presets.has(trimmed);
}

/** True when the stored value is a custom "other" entry (not a fixed list item). */
export function isCustomOtherValue(
  stored: string | undefined,
  presetValues: readonly string[],
  otherValue: string = SELECT_OTHER_VALUE
): boolean {
  const trimmed = String(stored ?? '').trim();
  if (!trimmed || trimmed === otherValue) return false;
  return !isPresetSelectValue(trimmed, presetValues, otherValue);
}

export function selectControlValue(
  stored: string | undefined,
  presetValues: readonly string[],
  otherValue: string = SELECT_OTHER_VALUE
): string {
  if (isCustomOtherValue(stored, presetValues, otherValue) || stored === otherValue) {
    return otherValue;
  }
  return String(stored ?? '');
}

export function otherSpecificationText(
  stored: string | undefined,
  presetValues: readonly string[],
  otherValue: string = SELECT_OTHER_VALUE
): string {
  if (!isCustomOtherValue(stored, presetValues, otherValue)) return '';
  return String(stored ?? '').trim();
}

/** Validation message when value is empty, placeholder, or Other without custom text. */
export function validateOtherSpecification(
  stored: string | undefined,
  presetValues: readonly string[],
  message = 'Please specify your selection',
  otherValue: string = SELECT_OTHER_VALUE
): string | null {
  const trimmed = String(stored ?? '').trim();
  if (!trimmed) return message;
  if (isPresetSelectValue(trimmed, presetValues, otherValue)) return null;
  if (trimmed === otherValue) return message;
  if (isCustomOtherValue(trimmed, presetValues, otherValue)) return null;
  return message;
}
