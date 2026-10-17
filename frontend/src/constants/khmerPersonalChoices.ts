import { SELECT_OTHER_VALUE } from './selectOther';

/** Bilingual dropdown choices for Cambodia HR (stored `value` is English for DB consistency). */
export type PersonalSelectChoice = {
  value: string;
  km: string;
  en: string;
};

export const KHMER_NATIONALITY_CHOICES: PersonalSelectChoice[] = [
  { value: 'Cambodia', km: 'កម្ពុជា', en: 'Cambodia' },
  { value: 'Vietnam', km: 'វៀតណាម', en: 'Vietnam' },
  { value: 'Laos', km: 'ឡាវ', en: 'Laos' },
  { value: 'Myanmar', km: 'មីយ៉ានម៉ា', en: 'Myanmar' },
  { value: 'China', km: 'ចិន', en: 'China' },
  { value: 'South Korea', km: 'កូរ៉េខាងត្បូង', en: 'South Korea' },
  { value: 'Japan', km: 'ជប៉ុន', en: 'Japan' },
  { value: 'Malaysia', km: 'ម៉ាឡេស៊ី', en: 'Malaysia' },
  { value: 'Singapore', km: 'សិង្ហបុរី', en: 'Singapore' },
  { value: 'Indonesia', km: 'ឥណ្ឌូណេស៊ី', en: 'Indonesia' },
  { value: 'Philippines', km: 'ហ្វីលីពីន', en: 'Philippines' },
  { value: 'India', km: 'ឥណ្ឌា', en: 'India' },
  { value: 'United States', km: 'សហរដ្ឋអាមេរិក', en: 'United States' },
  { value: 'United Kingdom', km: 'ចក្រភពអង់គ្លេស', en: 'United Kingdom' },
  { value: 'France', km: 'បារាំង', en: 'France' },
  { value: 'Australia', km: 'អូស្ត្រាលី', en: 'Australia' },
  { value: SELECT_OTHER_VALUE, km: 'ផ្សេងៗ', en: 'Other' },
];

export const NATIONALITY_PRESET_VALUES = KHMER_NATIONALITY_CHOICES.map((c) => c.value);

/** Religions commonly recorded for employees in Cambodia. */
export const KHMER_RELIGION_CHOICES: PersonalSelectChoice[] = [
  { value: 'Buddhism', km: 'ព្រះពុទ្ធសាសនា', en: 'Buddhism' },
  { value: 'Islam', km: 'ឥស្លាម', en: 'Islam' },
  { value: 'Christianity', km: 'គ្រិស្តានុសាសនា', en: 'Christianity' },
  { value: 'Hinduism', km: 'ហិណ្ឌូសាសនា', en: 'Hinduism' },
  { value: 'None', km: 'គ្មាន', en: 'None' },
  { value: SELECT_OTHER_VALUE, km: 'ផ្សេងៗ', en: 'Other' },
];

export const RELIGION_PRESET_VALUES = KHMER_RELIGION_CHOICES.map((c) => c.value);

/** Emergency contact relationship (English stored; Khmer synced in onboarding). */
export const KHMER_EMERGENCY_RELATION_CHOICES: PersonalSelectChoice[] = [
  { value: 'Spouse', km: 'ប្តី/ប្រពន្ធ', en: 'Spouse' },
  { value: 'Parent', km: 'ឪពុកម្តាយ', en: 'Parent' },
  { value: 'Sibling', km: 'បងប្អូន', en: 'Sibling' },
  { value: 'Child', km: 'កូន', en: 'Child' },
  { value: 'Friend', km: 'មិត្តភក្តិ', en: 'Friend' },
  { value: SELECT_OTHER_VALUE, km: 'ផ្សេងៗ', en: 'Other' },
];

export const EMERGENCY_RELATION_PRESET_VALUES = KHMER_EMERGENCY_RELATION_CHOICES.map(
  (c) => c.value
);

export function emergencyRelationKhmerForValue(relation?: string): string {
  const trimmed = String(relation ?? '').trim();
  if (!trimmed || trimmed === SELECT_OTHER_VALUE) return '';
  return KHMER_EMERGENCY_RELATION_CHOICES.find((c) => c.value === trimmed)?.km ?? '';
}

const NATIONALITY_VALUES = new Set(KHMER_NATIONALITY_CHOICES.map((c) => c.value));
const RELIGION_VALUES = new Set(KHMER_RELIGION_CHOICES.map((c) => c.value));

const RELIGION_ALIASES: Record<string, string> = {
  budha: 'Buddhism',
  buddha: 'Buddhism',
  buddhism: 'Buddhism',
  buddhist: 'Buddhism',
  islam: 'Islam',
  muslim: 'Islam',
  christian: 'Christianity',
  christianity: 'Christianity',
  catholic: 'Christianity',
  protestant: 'Christianity',
  hindu: 'Hinduism',
  hinduism: 'Hinduism',
  none: 'None',
  'n/a': 'None',
  na: 'None',
};

const NATIONALITY_ALIASES: Record<string, string> = {
  khmer: 'Cambodia',
  cambodian: 'Cambodia',
  cambodia: 'Cambodia',
  'កម្ពុជា': 'Cambodia',
  vietnam: 'Vietnam',
  vietnamese: 'Vietnam',
  thai: 'Thailand',
  thailand: 'Thailand',
  lao: 'Laos',
  laos: 'Laos',
  chinese: 'China',
  china: 'China',
};

export function normalizeReligionValue(raw?: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  const key = trimmed.toLowerCase();
  if (RELIGION_ALIASES[key]) return RELIGION_ALIASES[key];
  if (RELIGION_VALUES.has(trimmed)) return trimmed;
  const byKm = KHMER_RELIGION_CHOICES.find((c) => c.km === trimmed);
  if (byKm) return byKm.value;
  return trimmed;
}

export function normalizeNationalityValue(raw?: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return 'Cambodia';
  const key = trimmed.toLowerCase();
  if (NATIONALITY_ALIASES[key]) return NATIONALITY_ALIASES[key];
  if (NATIONALITY_VALUES.has(trimmed)) return trimmed;
  const byKm = KHMER_NATIONALITY_CHOICES.find((c) => c.km === trimmed);
  if (byKm) return byKm.value;
  return trimmed;
}

export function personalChoicesWithLegacy(
  choices: PersonalSelectChoice[],
  current?: string
): PersonalSelectChoice[] {
  const value = String(current ?? '').trim();
  if (!value) return choices;
  if (choices.some((c) => c.value === value)) return choices;
  return [{ value, km: value, en: value }, ...choices];
}

export function choiceLabel(choice: PersonalSelectChoice, language: 'en' | 'km'): string {
  return language === 'km' ? choice.km : choice.en;
}

/**
 * Resolve a stored English (or Khmer) personal-choice value for display in the active UI language.
 * Custom / Other values fall back to the stored text (or optional Khmer override).
 */
export function resolvePersonalChoiceLabel(
  choices: PersonalSelectChoice[],
  stored?: string | null,
  language: 'en' | 'km' = 'en',
  storedKh?: string | null
): string {
  const value = String(stored ?? '').trim();
  const khOverride = String(storedKh ?? '').trim();
  if (!value && !khOverride) return '—';

  const match =
    choices.find((c) => c.value === value) ||
    choices.find((c) => c.km === value) ||
    choices.find((c) => c.en.toLowerCase() === value.toLowerCase());

  if (match) return choiceLabel(match, language);

  if (language === 'km') return khOverride || value || '—';
  return value || khOverride || '—';
}

export function resolveNationalityLabel(
  stored?: string | null,
  language: 'en' | 'km' = 'en'
): string {
  return resolvePersonalChoiceLabel(KHMER_NATIONALITY_CHOICES, stored, language);
}

export function resolveReligionLabel(
  stored?: string | null,
  language: 'en' | 'km' = 'en'
): string {
  return resolvePersonalChoiceLabel(KHMER_RELIGION_CHOICES, stored, language);
}

export function resolveEmergencyRelationLabel(
  stored?: string | null,
  language: 'en' | 'km' = 'en',
  storedKh?: string | null
): string {
  return resolvePersonalChoiceLabel(
    KHMER_EMERGENCY_RELATION_CHOICES,
    stored,
    language,
    storedKh
  );
}
