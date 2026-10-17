import React from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import type { FieldArrayWithId, UseFieldArrayAppend, UseFieldArrayRemove } from 'react-hook-form';
import { PHONE_FORMAT_HINT, registerDigitsOnly } from '../../utils/digitsOnlyInput';
import type { SpouseHasWork } from '../../utils/taxDependents';
import { computeTaxDependents, isPopulatedChildRow } from '../../utils/taxDependents';
import type { EmployeeChildFormRow } from '../../types/employeeChild';
import { EMPTY_CHILD_ROW } from '../../types/employeeChild';
import {
  WizardField,
  WizardFieldFull,
  WizardFieldGrid,
  WizardSectionCard,
  WizardStepStack,
  WizardSubsectionTitle,
  WizardInput,
  WIZARD_INPUT_CLASS,
  WIZARD_SELECT_CLASS,
} from './wizardLayout';
import { Button } from '../ui/Button';
import { useLanguage } from '../../context/LanguageContext';
import { WizardKhmerFieldGrid, WizardKhmerSubsection } from './wizardKhmerSection';

interface StepFamilyProps {
  register: any;
  errors: Record<string, any>;
  watchMaritalStatus: string;
  watchSpouseHasWork: SpouseHasWork | undefined;
  watchChildren: EmployeeChildFormRow[];
  childFields: FieldArrayWithId<{ children: EmployeeChildFormRow[] }, 'children', 'id'>[];
  appendChild: UseFieldArrayAppend<{ children: EmployeeChildFormRow[] }, 'children'>;
  removeChild: UseFieldArrayRemove;
}

const MARITAL_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
] as const;

const GENDER_OPTIONS = ['Male', 'Female', 'Other'] as const;

export const StepFamily: React.FC<StepFamilyProps> = ({
  register,
  errors,
  watchMaritalStatus,
  watchSpouseHasWork,
  watchChildren,
  childFields,
  appendChild,
  removeChild,
}) => {
  const { t } = useLanguage();
  const isMarried = watchMaritalStatus === 'married';
  const taxDependents = computeTaxDependents(
    watchMaritalStatus || 'single',
    watchChildren ?? [],
    isMarried ? watchSpouseHasWork : undefined
  );
  const dependentChildren = (watchChildren ?? []).filter(
    (c) => isPopulatedChildRow(c) && c.hasJob === 'no'
  ).length;

  return (
    <WizardStepStack>
      <WizardSectionCard
        icon={Users}
        title="Family & dependents"
      >
        <WizardFieldGrid>
          <WizardFieldFull>
            <WizardField label="Marital status" required error={errors.maritalStatus?.message}>
              <div className="flex flex-wrap gap-3">
                {MARITAL_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                      watchMaritalStatus === opt.value
                        ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/40 text-violet-900 dark:text-violet-100'
                        : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      value={opt.value}
                      {...register('maritalStatus')}
                      className="sr-only"
                    />
                    <span className="text-sm font-medium">{opt.label}</span>
                  </label>
                ))}
              </div>
            </WizardField>
          </WizardFieldFull>

          {isMarried && (
            <>
              <WizardSubsectionTitle>Spouse</WizardSubsectionTitle>

              <WizardFieldFull>
                <WizardField label="Spouse name" required error={errors.spouseName?.message}>
                  <WizardInput register={register} name="spouseName" filter="name" />
                </WizardField>
              </WizardFieldFull>

              <WizardField
                label="Spouse has a job?"
                required
                error={errors.spouseHasWork?.message}
                hint='Select "No" if the spouse has no paid work — they count as +1 tax dependent.'
              >
                <div className="flex flex-wrap gap-3">
                  {(
                    [
                      { value: 'yes', label: 'Yes' },
                      { value: 'no', label: 'No' },
                    ] as const
                  ).map((opt) => (
                    <label
                      key={opt.value}
                      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                        watchSpouseHasWork === opt.value
                          ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/40 text-violet-900 dark:text-violet-100'
                          : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        value={opt.value}
                        {...register('spouseHasWork')}
                        className="sr-only"
                      />
                      <span className="text-sm font-medium">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </WizardField>

              <WizardField label="Spouse phone" required error={errors.spousePhone?.message}>
                <input
                  {...registerDigitsOnly(register, 'spousePhone', { maxLength: 11 })}
                  placeholder={PHONE_FORMAT_HINT}
                  className={`${WIZARD_INPUT_CLASS} font-mono`}
                />
              </WizardField>

              <WizardKhmerSubsection>
                <WizardKhmerFieldGrid>
                  <div className="sm:col-span-2">
                    <WizardField
                      label={t('onboarding.khmer.spouseName')}
                      error={errors.spouseNameKh?.message}
                    >
                      <WizardInput register={register} name="spouseNameKh" filter="name" />
                    </WizardField>
                  </div>
                </WizardKhmerFieldGrid>
              </WizardKhmerSubsection>

              <WizardSubsectionTitle>Children</WizardSubsectionTitle>

              <WizardFieldFull>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Add each child with details. Children with a job are not tax dependents.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => appendChild({ ...EMPTY_CHILD_ROW })}
                    disabled={childFields.length >= 20}
                  >
                    <Plus className="w-4 h-4 mr-1.5" />
                    Add child
                  </Button>
                </div>

                {childFields.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400 rounded-xl border border-dashed border-slate-200 dark:border-slate-600 px-4 py-6 text-center">
                    No children added. Use &quot;Add child&quot; to register dependents for tax.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {childFields.map((field, index) => {
                      const childErrors = (errors.children as Record<string, unknown>[] | undefined)?.[
                        index
                      ] as Record<string, { message?: string }> | undefined;
                      const hasJob = watchChildren[index]?.hasJob ?? 'no';
                      return (
                        <div
                          key={field.id}
                          className="rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/80 dark:bg-slate-900/40 p-4 space-y-4"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                              Child {index + 1}
                            </p>
                            <button
                              type="button"
                              onClick={() => removeChild(index)}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700 dark:text-rose-400"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Remove
                            </button>
                          </div>

                          <WizardFieldGrid>
                            <WizardField label="Child name" error={childErrors?.name?.message}>
                              <WizardInput
                                register={register}
                                name={`children.${index}.name`}
                                filter="name"
                              />
                            </WizardField>

                            <WizardField
                              label={t('onboarding.khmer.childName')}
                              error={childErrors?.nameKh?.message}
                            >
                              <WizardInput
                                register={register}
                                name={`children.${index}.nameKh`}
                                filter="name"
                              />
                            </WizardField>

                            <WizardField label="Age" error={childErrors?.age?.message}>
                              <WizardInput
                                register={register}
                                name={`children.${index}.age`}
                                filter="integer"
                                filterOptions={{ maxLength: 2 }}
                              />
                            </WizardField>

                            <WizardField label="Gender" error={childErrors?.gender?.message}>
                              <select
                                {...register(`children.${index}.gender`)}
                                className={WIZARD_SELECT_CLASS}
                              >
                                <option value="" disabled hidden>— Select —</option>
                                {GENDER_OPTIONS.map((g) => (
                                  <option key={g} value={g}>
                                    {g}
                                  </option>
                                ))}
                              </select>
                            </WizardField>

                            <WizardField label="Occupation" error={childErrors?.occupation?.message}>
                              <input
                                {...register(`children.${index}.occupation`)}
                                placeholder="e.g. Student, Homemaker"
                                className={WIZARD_INPUT_CLASS}
                              />
                            </WizardField>

                            <WizardFieldFull>
                              <WizardField
                                label="Child has a job?"
                                error={childErrors?.hasJob?.message}
                                hint='Select "Yes" if this child has paid work — they will not count as a tax dependent.'
                              >
                                <div className="flex flex-wrap gap-3">
                                  {(
                                    [
                                      { value: 'yes', label: 'Yes' },
                                      { value: 'no', label: 'No' },
                                    ] as const
                                  ).map((opt) => (
                                    <label
                                      key={opt.value}
                                      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                                        hasJob === opt.value
                                          ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/40 text-violet-900 dark:text-violet-100'
                                          : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                                      }`}
                                    >
                                      <input
                                        type="radio"
                                        value={opt.value}
                                        {...register(`children.${index}.hasJob`)}
                                        className="sr-only"
                                      />
                                      <span className="text-sm font-medium">{opt.label}</span>
                                    </label>
                                  ))}
                                </div>
                              </WizardField>
                            </WizardFieldFull>
                          </WizardFieldGrid>
                        </div>
                      );
                    })}
                  </div>
                )}
              </WizardFieldFull>

              <WizardFieldFull>
                <div className="rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/90 dark:bg-slate-900/40 px-4 py-3">
                  <p className="text-sm text-slate-700 dark:text-slate-300">
                    <span className="font-semibold">Tax dependents for payroll: </span>
                    {taxDependents}
                    <span className="text-slate-500 dark:text-slate-400 text-xs ml-2">
                      ({dependentChildren} child{dependentChildren === 1 ? '' : 'ren'}
                      {watchSpouseHasWork === 'no' ? ' + non-working spouse' : ''})
                    </span>
                  </p>
                </div>
              </WizardFieldFull>
            </>
          )}
        </WizardFieldGrid>
      </WizardSectionCard>
    </WizardStepStack>
  );
};
