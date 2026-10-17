import React, { useMemo } from 'react';
import { Camera, IdCard, UserCircle2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { SelectWithOther } from '../ui/SelectWithOther';
import {
  KHMER_NATIONALITY_CHOICES,
  KHMER_RELIGION_CHOICES,
  choiceLabel,
  personalChoicesWithLegacy,
} from '../../constants/khmerPersonalChoices';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import {
  NATIONAL_ID_FORMAT_HINT,
  PASSPORT_NUMBER_FORMAT_HINT,
  registerDigitsOnly,
} from '../../utils/digitsOnlyInput';
import { formatEmployeeAge } from '../../utils/employeeAge';
import {
  WizardField,
  WizardFieldGrid,
  WizardSectionCard,
  WizardStepStack,
  WIZARD_INPUT_CLASS,
  WIZARD_SELECT_CLASS,
} from './wizardLayout';
import { DatePickerInput } from '@/components/ui/shadcn/date-picker-input';

interface StepPersonalProps {
  register: any;
  errors: Record<string, any>;
  setValue: (name: string, value: string, options?: { shouldValidate?: boolean }) => void;
  watchNationality?: string;
  watchReligion?: string;
  watchBirthDate?: string;
  avatarPreview: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleImageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export const StepPersonal: React.FC<StepPersonalProps> = ({
  register,
  errors,
  setValue,
  watchNationality = '',
  watchReligion = '',
  watchBirthDate = '',
  avatarPreview,
  fileInputRef,
  handleImageChange,
}) => {
  const { t, language } = useLanguage();
  const lang: 'en' | 'km' = language === 'km' ? 'km' : 'en';
  const photoReq = t('onboarding.personal.photoRequirements').replace('\\n', ' · ');

  const nationalityOptions = useMemo(
    () =>
      personalChoicesWithLegacy(KHMER_NATIONALITY_CHOICES, watchNationality).map((opt) => ({
        value: opt.value,
        label: choiceLabel(opt, lang),
      })),
    [lang, watchNationality]
  );

  const religionOptions = useMemo(
    () =>
      personalChoicesWithLegacy(KHMER_RELIGION_CHOICES, watchReligion).map((opt) => ({
        value: opt.value,
        label: choiceLabel(opt, lang),
      })),
    [lang, watchReligion]
  );

  return (
    <WizardStepStack>
      <WizardSectionCard
        icon={Camera}
        title={t('onboarding.personal.profilePhoto')}
        description="Optional. Official photo for ID cards and the employee profile."
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="relative shrink-0 mx-auto sm:mx-0">
            <img
              src={
                resolveMediaUrl(avatarPreview) ||
                'https://ui-avatars.com/api/?name=Employee&background=e2e8f0&color=475569&size=128'
              }
              alt=""
              className="h-28 w-28 rounded-2xl object-cover ring-2 ring-white dark:ring-slate-700 shadow-md border border-slate-200 dark:border-slate-600"
            />
          </div>
          <div className="flex-1 text-center sm:text-left space-y-3 min-w-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-100 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <Camera className="h-4 w-4 text-primary-600 dark:text-primary-400" aria-hidden />
              {t('onboarding.personal.upload')} photo
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              onChange={handleImageChange}
              className="hidden"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-md">
              {photoReq}
            </p>
          </div>
        </div>
      </WizardSectionCard>

      <WizardSectionCard icon={UserCircle2} title={t('onboarding.personal.title')}>
        <WizardFieldGrid>
          <WizardField label={t('onboarding.personal.gender')} required error={errors.gender?.message}>
            <select {...register('gender')} className={WIZARD_SELECT_CLASS}>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </WizardField>
          <WizardField label={t('onboarding.personal.dob')} required error={errors.birthDate?.message}>
            <DatePickerInput
              {...register('birthDate')}
              value={watchBirthDate || ''}
              className={WIZARD_INPUT_CLASS}
              disableFuture
            />
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {t('onboarding.personal.age')}: {formatEmployeeAge(watchBirthDate)}
            </p>
          </WizardField>
          <WizardField label={t('onboarding.personal.nationality')} required error={errors.nationality?.message}>
            <SelectWithOther
              value={watchNationality}
              onChange={(v) => setValue('nationality', v, { shouldValidate: true })}
              options={nationalityOptions}
              inputClassName={WIZARD_INPUT_CLASS}
              emptyOption={{
                value: '',
                label: lang === 'km' ? 'សូមជ្រើសរើស' : 'Select nationality',
              }}
              otherPlaceholder={
                lang === 'km' ? 'វាយហើយចុច Enter' : 'Type a nationality and press Enter'
              }
              selectAriaLabel={t('onboarding.personal.nationality')}
            />
          </WizardField>
          <WizardField label={t('onboarding.personal.religion')} required error={errors.religion?.message}>
            <SelectWithOther
              value={watchReligion}
              onChange={(v) => setValue('religion', v, { shouldValidate: true })}
              options={religionOptions}
              inputClassName={WIZARD_INPUT_CLASS}
              emptyOption={{
                value: '',
                label: lang === 'km' ? 'សូមជ្រើសរើស' : 'Select religion',
              }}
              otherPlaceholder={
                lang === 'km' ? 'វាយហើយចុច Enter' : 'Type a religion and press Enter'
              }
              selectAriaLabel={t('onboarding.personal.religion')}
            />
          </WizardField>
        </WizardFieldGrid>
      </WizardSectionCard>

      <WizardSectionCard
        icon={IdCard}
        title={lang === 'km' ? 'ឯកសារអត្តសញ្ញាណ' : 'Identification documents'}
        description={
          lang === 'km' ? 'ជម្រើស — បំពេញតាមដែលមាន' : 'Optional — complete when available'
        }
      >
        <WizardFieldGrid className="grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          <WizardField
            label={t('onboarding.personal.nationalId')}
            error={errors.nationalId?.message}
          >
            <input
              {...registerDigitsOnly(register, 'nationalId', { maxLength: 15 })}
              placeholder={NATIONAL_ID_FORMAT_HINT}
              className={`${WIZARD_INPUT_CLASS} font-mono tracking-wide`}
            />
          </WizardField>
          <WizardField
            label={t('onboarding.personal.passport')}
            error={errors.passport?.message}
          >
            <input
              {...registerDigitsOnly(register, 'passport', { maxLength: 15 })}
              placeholder={PASSPORT_NUMBER_FORMAT_HINT}
              className={`${WIZARD_INPUT_CLASS} font-mono tracking-wide`}
            />
          </WizardField>
          <div className="sm:col-span-2 xl:col-span-1 min-w-0">
            <WizardField label={t('onboarding.personal.birthCertificate')}>
              <input
                {...register('birthCertificate')}
                placeholder="e.g. BC-2024-00123"
                className={`${WIZARD_INPUT_CLASS} font-mono tracking-wide`}
                maxLength={100}
              />
            </WizardField>
          </div>
        </WizardFieldGrid>
      </WizardSectionCard>
    </WizardStepStack>
  );
};
