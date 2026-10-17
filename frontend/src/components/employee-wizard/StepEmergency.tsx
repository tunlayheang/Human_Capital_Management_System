import React, { useMemo } from 'react';
import { Heart } from 'lucide-react';
import { PHONE_FORMAT_HINT, registerDigitsOnly } from '../../utils/digitsOnlyInput';
import { SelectWithOther } from '../ui/SelectWithOther';
import { useLanguage } from '../../context/LanguageContext';
import { SELECT_OTHER_VALUE } from '../../constants/selectOther';
import {
  choiceLabel,
  emergencyRelationKhmerForValue,
  KHMER_EMERGENCY_RELATION_CHOICES,
  personalChoicesWithLegacy,
} from '../../constants/khmerPersonalChoices';
import {
  WizardField,
  WizardFieldFull,
  WizardFieldGrid,
  WizardSectionCard,
  WizardStepStack,
  WizardInput,
  WIZARD_INPUT_CLASS,
  WIZARD_SELECT_CLASS,
} from './wizardLayout';
import { WizardKhmerFieldGrid, WizardKhmerSubsection } from './wizardKhmerSection';

interface StepEmergencyProps {
  register: any;
  errors?: Record<string, any>;
  setValue: (name: string, value: string, options?: { shouldValidate?: boolean }) => void;
  watchEmergencyRelation?: string;
  watchEmergencyRelationKh?: string;
}

export const StepEmergency: React.FC<StepEmergencyProps> = ({
  register,
  errors = {},
  setValue,
  watchEmergencyRelation = '',
  watchEmergencyRelationKh = '',
}) => {
  const { t, language } = useLanguage();
  const lang: 'en' | 'km' = language === 'km' ? 'km' : 'en';

  const relationOptions = useMemo(
    () =>
      personalChoicesWithLegacy(KHMER_EMERGENCY_RELATION_CHOICES, watchEmergencyRelation).map(
        (opt) => ({
          value: opt.value,
          label: choiceLabel(opt, lang),
        })
      ),
    [lang, watchEmergencyRelation]
  );

  const relationKhOptions = useMemo(
    () =>
      personalChoicesWithLegacy(
        KHMER_EMERGENCY_RELATION_CHOICES.map((c) =>
          c.value === SELECT_OTHER_VALUE
            ? c
            : { ...c, value: c.km, en: c.km }
        ),
        watchEmergencyRelationKh
      ).map((opt) => ({
        value: opt.value,
        label: opt.km,
      })),
    [watchEmergencyRelationKh]
  );

  const handleRelationChange = (v: string) => {
    setValue('emergencyRelation', v, { shouldValidate: true });
    const km = emergencyRelationKhmerForValue(v);
    if (km) {
      setValue('emergencyRelationKh', km, { shouldValidate: true });
    } else if (v === SELECT_OTHER_VALUE || !String(v).trim()) {
      // Other / empty — clear Khmer so the user can type a matching value.
      setValue('emergencyRelationKh', '', { shouldValidate: true });
    }
  };

  const handleRelationKhChange = (v: string) => {
    setValue('emergencyRelationKh', v, { shouldValidate: true });
    const match = KHMER_EMERGENCY_RELATION_CHOICES.find(
      (c) => c.value !== SELECT_OTHER_VALUE && c.km === v
    );
    if (match) {
      setValue('emergencyRelation', match.value, { shouldValidate: true });
    }
  };

  return (
    <WizardStepStack>
      <WizardSectionCard
        icon={Heart}
        title="Emergency contact details"
      >
        <WizardFieldGrid>
          <WizardField label="Contact name" required error={errors.emergencyName?.message}>
            <WizardInput register={register} name="emergencyName" filter="name" />
          </WizardField>
          <WizardField label="Relationship" required error={errors.emergencyRelation?.message}>
            <SelectWithOther
              value={watchEmergencyRelation}
              onChange={handleRelationChange}
              options={relationOptions}
              selectClassName={WIZARD_SELECT_CLASS}
              inputClassName={WIZARD_INPUT_CLASS}
              emptyOption={{
                value: '',
                label: lang === 'km' ? 'សូមជ្រើសរើស' : 'Select relationship',
              }}
              otherPlaceholder="e.g. Cousin, Guardian, Neighbor…"
              otherLabel="Specify relationship"
            />
          </WizardField>
          <WizardFieldFull>
            <WizardField label="Phone" required error={errors.emergencyPhone?.message}>
              <input
                {...registerDigitsOnly(register, 'emergencyPhone', { maxLength: 11 })}
                placeholder={PHONE_FORMAT_HINT}
                className={`${WIZARD_INPUT_CLASS} font-mono`}
              />
            </WizardField>
          </WizardFieldFull>

          <WizardKhmerSubsection>
            <WizardKhmerFieldGrid>
              <WizardField label={t('onboarding.khmer.emergencyName')} error={errors.emergencyNameKh?.message}>
                <WizardInput register={register} name="emergencyNameKh" filter="name" />
              </WizardField>
              <WizardField
                label={t('onboarding.khmer.emergencyRelation')}
                error={errors.emergencyRelationKh?.message}
                hint="Synced from English when you pick a preset. Choose Other to type a custom value."
              >
                <SelectWithOther
                  value={watchEmergencyRelationKh}
                  onChange={handleRelationKhChange}
                  options={relationKhOptions}
                  selectClassName={`${WIZARD_SELECT_CLASS} font-khmer`}
                  inputClassName={`${WIZARD_INPUT_CLASS} font-khmer`}
                  emptyOption={{ value: '', label: 'សូមជ្រើសរើសទំនាក់ទំនង' }}
                  otherPlaceholder="វាយទំនាក់ទំនង រួចចុច Enter"
                  otherLabel="បញ្ជាក់ទំនាក់ទំនង"
                  otherOptionLabel="ផ្សេងៗ"
                />
              </WizardField>
            </WizardKhmerFieldGrid>
          </WizardKhmerSubsection>
        </WizardFieldGrid>
      </WizardSectionCard>
    </WizardStepStack>
  );
};
