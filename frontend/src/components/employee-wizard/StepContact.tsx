import React, { useMemo } from 'react';
import { MapPin } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { SelectWithOther } from '../ui/SelectWithOther';
import {
  choiceLabel,
  personalChoicesWithLegacy,
} from '../../constants/khmerPersonalChoices';
import { SELECT_OTHER_VALUE } from '../../constants/selectOther';
import {
  ADDRESS_PLACEHOLDER_EN,
  ADDRESS_PLACEHOLDER_KM,
  CAMBODIA_CITY_CHOICES,
  CAMBODIA_COUNTRY_CHOICES,
  cityEnglishForKhmerValue,
  cityKhmerForValue,
} from '../../constants/cambodiaLocations';
import {
  WizardField,
  WizardFieldFull,
  WizardFieldGrid,
  WizardSectionCard,
  WizardStepStack,
  WIZARD_INPUT_CLASS,
  WIZARD_SELECT_CLASS,
  WIZARD_TEXTAREA_CLASS,
} from './wizardLayout';
import { WizardKhmerFieldGrid, WizardKhmerSubsection } from './wizardKhmerSection';

interface StepContactProps {
  register: any;
  errors: Record<string, any>;
  setValue: (name: string, value: string, options?: { shouldValidate?: boolean }) => void;
  watchCountry?: string;
  watchCity?: string;
  watchCityKh?: string;
}

export const StepContact: React.FC<StepContactProps> = ({
  register,
  errors,
  setValue,
  watchCountry = 'Cambodia',
  watchCity = '',
  watchCityKh = '',
}) => {
  const { t, language } = useLanguage();
  const lang: 'en' | 'km' = language === 'km' ? 'km' : 'en';

  const countryOptions = useMemo(
    () =>
      personalChoicesWithLegacy(CAMBODIA_COUNTRY_CHOICES, watchCountry).map((opt) => ({
        value: opt.value,
        label: choiceLabel(opt, lang),
      })),
    [lang, watchCountry]
  );

  const cityOptions = useMemo(
    () =>
      personalChoicesWithLegacy(CAMBODIA_CITY_CHOICES, watchCity).map((opt) => ({
        value: opt.value,
        label: choiceLabel(opt, lang),
      })),
    [lang, watchCity]
  );

  const cityKhOptions = useMemo(
    () =>
      personalChoicesWithLegacy(
        CAMBODIA_CITY_CHOICES.map((c) =>
          c.value === SELECT_OTHER_VALUE
            ? c
            : { ...c, value: c.km, en: c.km }
        ),
        watchCityKh
      ).map((opt) => ({
        value: opt.value,
        label: opt.km,
      })),
    [watchCityKh]
  );

  const handleCityChange = (v: string) => {
    setValue('city', v, { shouldValidate: true });
    const km = cityKhmerForValue(v);
    if (km) {
      setValue('cityKh', km, { shouldValidate: true });
    } else if (v === SELECT_OTHER_VALUE || !String(v).trim()) {
      setValue('cityKh', '', { shouldValidate: true });
    }
  };

  const handleCityKhChange = (v: string) => {
    setValue('cityKh', v, { shouldValidate: true });
    const en = cityEnglishForKhmerValue(v);
    if (en) {
      setValue('city', en, { shouldValidate: true });
    } else if (v === SELECT_OTHER_VALUE) {
      setValue('city', SELECT_OTHER_VALUE, { shouldValidate: true });
    } else if (!String(v).trim()) {
      setValue('city', '', { shouldValidate: true });
    }
  };

  return (
    <WizardStepStack>
      <WizardSectionCard
        icon={MapPin}
        title="Contact & location"
        description="Select country and city, then enter the street address for the employee record."
      >
        <WizardFieldGrid>
          <WizardField label="Country" error={errors.country?.message}>
            <SelectWithOther
              value={watchCountry}
              onChange={(v) => setValue('country', v, { shouldValidate: true })}
              options={countryOptions}
              selectClassName={WIZARD_SELECT_CLASS}
              inputClassName={WIZARD_INPUT_CLASS}
              emptyOption={{
                value: '',
                label: lang === 'km' ? 'សូមជ្រើសរើស' : 'Select country',
              }}
              otherPlaceholder={
                lang === 'km' ? 'វាយឈ្មោះប្រទេស រួចចុច Enter' : 'Type a country and press Enter'
              }
              selectAriaLabel="Country"
            />
          </WizardField>
          <WizardField label="City / Province" required error={errors.city?.message}>
            <SelectWithOther
              value={watchCity}
              onChange={handleCityChange}
              options={cityOptions}
              selectClassName={WIZARD_SELECT_CLASS}
              inputClassName={WIZARD_INPUT_CLASS}
              emptyOption={{
                value: '',
                label: lang === 'km' ? 'សូមជ្រើសរើស' : 'Select city / province',
              }}
              otherPlaceholder={
                lang === 'km' ? 'វាយឈ្មោះទីក្រុង រួចចុច Enter' : 'Type a city and press Enter'
              }
              selectAriaLabel="City / Province"
            />
          </WizardField>

          <WizardFieldFull>
            <WizardField label="Address" required error={errors.address?.message}>
              <textarea
                {...register('address')}
                rows={3}
                placeholder={lang === 'km' ? ADDRESS_PLACEHOLDER_KM : ADDRESS_PLACEHOLDER_EN}
                className={WIZARD_TEXTAREA_CLASS}
              />
            </WizardField>
          </WizardFieldFull>

          <WizardField
            label="Website"
            required={false}
            error={errors.website?.message}
            hint="Not stored on the employee record."
          >
            <input
              type="url"
              {...register('website')}
              placeholder="https://"
              className={WIZARD_INPUT_CLASS}
            />
          </WizardField>

          <WizardKhmerSubsection>
            <WizardKhmerFieldGrid>
              <div className="sm:col-span-2">
                <WizardField label={t('onboarding.khmer.address')} error={errors.addressKh?.message}>
                  <textarea
                    {...register('addressKh')}
                    rows={2}
                    placeholder={ADDRESS_PLACEHOLDER_KM}
                    className={WIZARD_TEXTAREA_CLASS}
                  />
                </WizardField>
              </div>
              <WizardField label={t('onboarding.khmer.city')} error={errors.cityKh?.message}>
                <SelectWithOther
                  value={watchCityKh}
                  onChange={handleCityKhChange}
                  options={cityKhOptions}
                  selectClassName={WIZARD_SELECT_CLASS}
                  inputClassName={WIZARD_INPUT_CLASS}
                  emptyOption={{ value: '', label: 'សូមជ្រើសរើស' }}
                  otherPlaceholder="វាយឈ្មោះទីក្រុង រួចចុច Enter"
                  selectAriaLabel={t('onboarding.khmer.city')}
                />
              </WizardField>
            </WizardKhmerFieldGrid>
          </WizardKhmerSubsection>
        </WizardFieldGrid>
      </WizardSectionCard>
    </WizardStepStack>
  );
};
