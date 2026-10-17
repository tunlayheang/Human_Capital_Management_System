import React from 'react';
import { Check, FileText, Loader2, Pencil, Save, X } from 'lucide-react';
import { PillSegmentTabs } from '../ui/page/PillSegmentTabs';
import { ContentSkeleton } from '../common/ContentSkeleton';
import { CompanyStructureLevelsTab } from './CompanyStructureLevelsTab';
import {
  COMPANY_FIELD_GROUPS,
  COMPANY_TABS,
  type CompanyInnerTabKey,
} from './companyProfileConfig';
import { displaySettingText } from '../../utils/settingValue';
import { RulesConfigHelp } from '../ui/RulesConfigHelp';

export type CompanyFieldDef = {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  fullWidth?: boolean;
  helperText?: string;
  tab?: CompanyInnerTabKey;
};

type Props = {
  companyTab: CompanyInnerTabKey;
  onTabChange: (tab: CompanyInnerTabKey) => void;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  loading: boolean;
  saving: boolean;
  hasUnsavedChanges: boolean;
  hasValidationErrors: boolean;
  onSave: () => void;
  onReset: () => void;
  fields: CompanyFieldDef[];
  fieldErrors: Record<string, string>;
  settings: Record<string, unknown>;
  renderEditableField: (field: CompanyFieldDef) => React.ReactNode;
  renderReadOnlyValue: (field: CompanyFieldDef) => React.ReactNode;
};

const inputShellClass =
  '[&_input]:h-10 [&_input]:rounded-lg [&_input]:border-slate-200 [&_select]:h-10 [&_select]:rounded-lg [&_select]:border-slate-200';

function groupFields(
  tab: CompanyInnerTabKey,
  fields: CompanyFieldDef[]
): Array<{ title: string | null; fields: CompanyFieldDef[] }> {
  const groups = COMPANY_FIELD_GROUPS[tab];
  if (!groups?.length) {
    return [{ title: null, fields }];
  }
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const used = new Set<string>();
  const result: Array<{ title: string | null; fields: CompanyFieldDef[] }> = [];
  for (const g of groups) {
    const sectionFields = g.keys.map((k) => byKey.get(k)).filter(Boolean) as CompanyFieldDef[];
    sectionFields.forEach((f) => used.add(f.key));
    if (sectionFields.length) result.push({ title: g.title, fields: sectionFields });
  }
  const rest = fields.filter((f) => !used.has(f.key));
  if (rest.length) result.push({ title: null, fields: rest });
  return result;
}

export const CompanyProfilePanel: React.FC<Props> = ({
  companyTab,
  onTabChange,
  editing,
  onStartEdit,
  onCancelEdit,
  loading,
  saving,
  hasUnsavedChanges,
  hasValidationErrors,
  onSave,
  onReset,
  fields,
  fieldErrors,
  settings,
  renderEditableField,
  renderReadOnlyValue,
}) => {
  const isStructure = companyTab === 'structure';
  const sectionGroups = groupFields(companyTab, fields);

  return (
    <div className="flex flex-col min-h-0">
      {/* Toolbar — help (!) stays in the upper-right corner */}
      <div className="relative flex flex-col gap-4 px-5 py-4 sm:px-6 border-b border-slate-200/80 dark:border-slate-700/80 sm:flex-row sm:items-center sm:justify-between">
        <RulesConfigHelp help="settings.companyProfile" className="absolute top-3 right-3 z-10 sm:top-4 sm:right-4" />
        <div className="min-w-0 pr-10">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                editing
                  ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200/80'
                  : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/80 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600'
              }`}
            >
              {editing ? (
                <>
                  <Pencil className="w-3 h-3" aria-hidden />
                  Editing
                </>
              ) : (
                <>
                  <FileText className="w-3 h-3" aria-hidden />
                  View only
                </>
              )}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 pr-10">
          {editing ? (
            <button
              type="button"
              onClick={onCancelEdit}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-sm rounded-lg border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <X className="w-4 h-4" aria-hidden />
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={onStartEdit}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700"
            >
              <Pencil className="w-4 h-4" aria-hidden />
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="px-5 sm:px-6 pt-4 min-w-0 w-full">
        <PillSegmentTabs
          value={companyTab}
          onChange={onTabChange}
          ariaLabel="Company profile sections"
          tabs={COMPANY_TABS.map((tab) => ({
            id: tab.key,
            label: tab.label,
            icon: tab.icon,
          }))}
        />
      </div>

      {/* Body */}
      <div className="p-5 sm:p-6 flex-1 min-w-0 w-full">
        {loading ? (
          <ContentSkeleton layout="form" rows={2} className="w-full" />
        ) : isStructure ? (
          <CompanyStructureLevelsTab readOnly={!editing} />
        ) : editing ? (
          <div className={`space-y-8 w-full min-w-0 ${inputShellClass}`}>
            {sectionGroups.map((group, gi) => (
              <section key={gi}>
                {group.title ? (
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-4">
                    {group.title}
                  </h3>
                ) : null}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                  {group.fields.map((field) => (
                    <div
                      key={field.key}
                      className={`space-y-1.5 ${field.fullWidth ? 'sm:col-span-2' : ''}`}
                    >
                      <label
                        htmlFor={`field-${field.key}`}
                        className="hcms-field-label"
                      >
                        {field.label}
                        {field.required ? <span className="text-red-500 ml-0.5">*</span> : null}
                      </label>
                      {renderEditableField(field as CompanyFieldDef)}
                      {field.helperText && !fieldErrors[field.key] ? (
                        <p className="hcms-field-hint">{field.helperText}</p>
                      ) : null}
                      {fieldErrors[field.key] ? (
                        <p className="text-xs text-red-600" role="alert">
                          {fieldErrors[field.key]}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="w-full min-w-0 divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-700/80 overflow-hidden bg-slate-50/30 dark:bg-slate-900/20">
            {sectionGroups.map((group, gi) => (
              <div key={gi} className="p-4 sm:p-5">
                {group.title ? (
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
                    {group.title}
                  </h3>
                ) : null}
                <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
                  {group.fields.map((field) => (
                    <div
                      key={field.key}
                      className={field.fullWidth ? 'sm:col-span-2 lg:col-span-3' : ''}
                    >
                      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                        {field.label}
                      </dt>
                      <dd className="text-sm text-slate-900 dark:text-slate-100 break-words">
                        {field.type === 'upload' || field.type === 'cover-upload' || field.type === 'richtext'
                          ? renderReadOnlyValue(field)
                          : displaySettingText(settings[field.key], {
                              masked: Boolean((field as { maskInSummary?: boolean }).maskInSummary),
                            })}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {editing && !isStructure ? (
        <div className="sticky bottom-0 z-10 border-t border-slate-200/90 dark:border-slate-700/80 hcms-sticky-footer px-5 py-3 sm:px-6">
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              {hasUnsavedChanges ? (
                <span className="text-amber-700 dark:text-amber-400">You have unsaved changes</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                  <Check className="w-3.5 h-3.5" />
                  Saved
                </span>
              )}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onReset}
                disabled={!hasUnsavedChanges || saving}
                className="h-9 px-4 text-sm rounded-lg border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={!hasUnsavedChanges || saving || hasValidationErrors}
                className="h-9 px-4 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save changes
              </button>
            </div>
          </div>
        </div>
      ) : !editing ? (
        <div className="border-t border-slate-100 dark:border-slate-800 px-5 py-2.5 sm:px-6">
          <p className="text-xs text-slate-500 dark:text-slate-400 text-center sm:text-left">
            Select <span className="font-medium text-slate-700 dark:text-slate-300">Edit</span> to update
            this section.
          </p>
        </div>
      ) : null}
    </div>
  );
};
