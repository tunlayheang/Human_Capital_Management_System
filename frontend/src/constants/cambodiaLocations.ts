import { SELECT_OTHER_VALUE } from './selectOther';
import type { PersonalSelectChoice } from './khmerPersonalChoices';
export const CAMBODIA_COUNTRY_CHOICES: PersonalSelectChoice[] = [
  { value: 'Cambodia', km: 'កម្ពុជា', en: 'Cambodia' },
  { value: SELECT_OTHER_VALUE, km: 'ផ្សេងៗ', en: 'Other' },
];

export const COUNTRY_PRESET_VALUES = CAMBODIA_COUNTRY_CHOICES.map((c) => c.value);

/**
 * Capitals / provinces of Cambodia (English stored on employee.city).
 * Choose Other in the list to type a custom city for this session.
 */
export const CAMBODIA_CITY_CHOICES: PersonalSelectChoice[] = [
  { value: 'Phnom Penh', km: 'ភ្នំពេញ', en: 'Phnom Penh' },
  { value: 'Siem Reap', km: 'សៀមរាប', en: 'Siem Reap' },
  { value: 'Battambang', km: 'បាត់ដំបង', en: 'Battambang' },
  { value: 'Sihanoukville', km: 'ព្រះសីហនុ', en: 'Sihanoukville (Preah Sihanouk)' },
  { value: 'Kampong Cham', km: 'កំពង់ចាម', en: 'Kampong Cham' },
  { value: 'Kampong Chhnang', km: 'កំពង់ឆ្នាំង', en: 'Kampong Chhnang' },
  { value: 'Kampong Speu', km: 'កំពង់ស្ពឺ', en: 'Kampong Speu' },
  { value: 'Kampong Thom', km: 'កំពង់ធំ', en: 'Kampong Thom' },
  { value: 'Kampot', km: 'កំពត', en: 'Kampot' },
  { value: 'Kandal', km: 'កណ្ដាល', en: 'Kandal' },
  { value: 'Koh Kong', km: 'កោះកុង', en: 'Koh Kong' },
  { value: 'Kratie', km: 'ក្រចេះ', en: 'Kratie' },
  { value: 'Mondulkiri', km: 'មណ្ឌលគិរី', en: 'Mondulkiri' },
  { value: 'Oddar Meanchey', km: 'ឧត្តរមានជ័យ', en: 'Oddar Meanchey' },
  { value: 'Pailin', km: 'ប៉ៃលិន', en: 'Pailin' },
  { value: 'Preah Vihear', km: 'ព្រះវិហារ', en: 'Preah Vihear' },
  { value: 'Prey Veng', km: 'ព្រៃវែង', en: 'Prey Veng' },
  { value: 'Pursat', km: 'ពោធិ៍សាត់', en: 'Pursat' },
  { value: 'Ratanakiri', km: 'រតនគិរី', en: 'Ratanakiri' },
  { value: 'Stung Treng', km: 'ស្ទឹងត្រែង', en: 'Stung Treng' },
  { value: 'Svay Rieng', km: 'ស្វាយរៀង', en: 'Svay Rieng' },
  { value: 'Takeo', km: 'តាកែវ', en: 'Takeo' },
  { value: 'Tbong Khmum', km: 'ត្បូងឃ្មុំ', en: 'Tbong Khmum' },
  { value: 'Kep', km: 'កែប', en: 'Kep' },
  { value: 'Banteay Meanchey', km: 'បន្ទាយមានជ័យ', en: 'Banteay Meanchey' },
  { value: SELECT_OTHER_VALUE, km: 'ផ្សេងៗ', en: 'Other' },
];

export const CITY_PRESET_VALUES = CAMBODIA_CITY_CHOICES.map((c) => c.value);

export const ADDRESS_PLACEHOLDER_EN =
  'Street, house no., village, sangkat/commune, district…';
export const ADDRESS_PLACEHOLDER_KM =
  'ផ្លូវ, ផ្ទះលេខ, ភូមិ, សង្កាត់/ឃុំ, ស្រុក/ខណ្ឌ…';

export function cityKhmerForValue(city?: string): string {
  const trimmed = String(city ?? '').trim();
  if (!trimmed || trimmed === SELECT_OTHER_VALUE) return '';
  return CAMBODIA_CITY_CHOICES.find((c) => c.value === trimmed)?.km ?? '';
}

/** Reverse lookup: Khmer city label → English stored value (employee.city). */
export function cityEnglishForKhmerValue(cityKh?: string): string {
  const trimmed = String(cityKh ?? '').trim();
  if (!trimmed || trimmed === SELECT_OTHER_VALUE) return '';
  return CAMBODIA_CITY_CHOICES.find((c) => c.km === trimmed)?.value ?? '';
}

export function resolveCityLabel(
  stored?: string | null,
  language: 'en' | 'km' = 'en',
  storedKh?: string | null
): string {
  const value = String(stored ?? '').trim();
  const khOverride = String(storedKh ?? '').trim();
  if (!value && !khOverride) return '—';
  const match = CAMBODIA_CITY_CHOICES.find(
    (c) =>
      c.value === value ||
      c.km === value ||
      c.en.toLowerCase() === value.toLowerCase()
  );
  if (match) return language === 'km' ? match.km : match.en;
  if (language === 'km') return khOverride || value || '—';
  return value || khOverride || '—';
}
