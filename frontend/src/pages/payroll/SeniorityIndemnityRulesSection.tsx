import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, ChevronDown, ChevronUp, Plus, Save, Trash2 } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ActiveStatusControl } from '../../components/ui/ActiveStatusControl';
import { Api } from '../../services/api';
import type {
  SeniorityIndemnityDailyRateMethod,
  SeniorityIndemnityExtendedConfig,
  SeniorityIndemnityInclusionRule,
  SeniorityIndemnityPolicy,
  SeniorityIndemnityResignationPolicy,
  SeniorityIndemnitySalaryComponent,
  SeniorityIndemnityWorkingDaysDivisor,
} from '../../types/seniorityIndemnityPolicy';
import { RulesConfigHelp } from '../../components/ui/RulesConfigHelp';
import { SectionEditToolbar } from '../../components/ui/SectionEditToolbar';
import { Modal } from '../../components/ui/Modal';
import { describeIndemnityPolicy } from './payrollRulesDisplay';
import { LoadingState } from '../../components/common/LoadingState';
import { defaultPolicyEffectiveDate, promptPolicySaveEffectiveDate } from '../../utils/policyEffectiveDate';
import { useToast } from '../../context/ToastContext';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { numericInputAttrs, onFilteredChange } from '../../utils/formInputFilters';
import { ListSearchFilterBar } from '../../components/ui/page';
import { FilterMenuSelect, PageFilterMenu } from '../../components/ui/PageFilterMenu';
import { countActiveFilters } from '../../utils/filterActiveCount';

const sectionHeaderClass =
  'flex flex-row flex-wrap items-center justify-between gap-2 px-5 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700';

const inputClass =
  'rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-base w-full';

const SALARY_BASIS_OPTIONS: { id: SeniorityIndemnitySalaryComponent; label: string }[] = [
  { id: 'base_salary', label: 'Base salary' },
  { id: 'position_allowance', label: 'Position allowance' },
  { id: 'commission', label: 'Commission' },
  { id: 'fixed_allowance', label: 'Other fixed allowances' },
];

function defaultExtendedConfig(): SeniorityIndemnityExtendedConfig {
  return {
    semesterMinDaysForFullMonth: 21,
    terminationPartialSemesterDays: 7,
    resignationIndemnityPolicy: 'none',
    fdcSeveranceRuleEnabled: true,
    pre2019BackPay: {
      enabled: true,
      capDays: 156,
      capMonths: 6,
      sectorKey: 'other',
      schedule: [],
    },
  };
}

function defaultPolicy(): Partial<SeniorityIndemnityPolicy> {
  return {
    name: 'Company siniority',
    legal_ref: 'Labor Law Art. 89 (New), Prakas 443/2018, MLVT 058/19',
    description:
      'Semi-annual siniority (7.5 days in June and December). UDC only; starts after probation.',
    effective_from: defaultPolicyEffectiveDate(),
    days_per_year: 15,
    payout_june_days: 7.5,
    payout_december_days: 7.5,
    daily_rate_method: 'scheduled_26',
    working_days_divisor: 26,
    salary_basis: ['base_salary', 'fixed_allowance', 'position_allowance', 'commission'],
    eligible_contract_types: ['UDC'],
    excluded_employment_types: ['Intern', 'Consultant', 'Freelancer', 'Contract'],
    inclusion_rule: 'after_probation',
    inclusion_months: 0,
    extended_config: defaultExtendedConfig(),
    priority: 100,
    active: false,
  };
}

function mergeExtendedConfig(
  policy: Partial<SeniorityIndemnityPolicy>
): SeniorityIndemnityExtendedConfig {
  return { ...defaultExtendedConfig(), ...(policy.extended_config ?? {}) };
}

type Props = {
  canEdit: boolean;
  compact?: boolean;
};

export const SeniorityIndemnityRulesSection: React.FC<Props> = ({ canEdit, compact = false }) => {
  const { showToast } = useToast();
  const { confirm, confirmEffectiveDate, ConfirmDialogHost } = useConfirmDialog();
  const [policies, setPolicies] = useState<SeniorityIndemnityPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<SeniorityIndemnityPolicy> | null>(null);
  const [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [isSectionEditing, setIsSectionEditing] = useState(false);
  const { confirmDiscardIfDirty } = useUnsavedChangesGuard({
    isDirty: isSectionEditing || editing != null,
    confirm,
  });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const filterActiveCount = useMemo(
    () => countActiveFilters([{ value: statusFilter, defaultValue: '' }]),
    [statusFilter]
  );

  const canMutate = canEdit && isSectionEditing;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPolicies(await Api.payroll.getSeniorityIndemnityPolicies());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { activePolicies, inactivePolicies } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (p: SeniorityIndemnityPolicy) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        describeIndemnityPolicy(p).toLowerCase().includes(q)
      );
    };
    const active = policies.filter((p) => p.active && matches(p));
    const inactive = policies.filter((p) => !p.active && matches(p));
    return { activePolicies: active, inactivePolicies: inactive };
  }, [policies, search]);

  const showActiveSection = statusFilter !== 'inactive';
  const showInactiveSection = statusFilter !== 'active';

  const save = async () => {
    if (!editing?.name) return;
    const effective_from = await promptPolicySaveEffectiveDate(confirmEffectiveDate, {
      title: editing.id ? 'Save siniority policy?' : 'Create siniority policy?',
      description:
        'Choose when this siniority policy takes effect. The change is scheduled — it does not apply instantly.',
      confirmLabel: editing.id ? 'Save policy' : 'Create policy',
      defaultEffectiveDate: editing.effective_from || undefined,
    });
    if (!effective_from) return;
    setSaving(true);
    try {
      const payload: SeniorityIndemnityPolicy = {
        ...(editing as SeniorityIndemnityPolicy),
        effective_from,
        extended_config: mergeExtendedConfig(editing),
        daily_rate_method: editing.daily_rate_method ?? 'scheduled_26',
      };
      await Api.payroll.saveSeniorityIndemnityPolicy(payload);
      showToast(editing.id ? 'Siniority policy updated' : 'Siniority policy saved', 'success');
      setEditing(null);
      await load();
    } catch (e) {
      showToast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleSalaryBasis = (id: SeniorityIndemnitySalaryComponent) => {
    const current = (editing?.salary_basis ?? ['base_salary']) as SeniorityIndemnitySalaryComponent[];
    const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
    setEditing({ ...editing, salary_basis: next.length ? next : ['base_salary'] });
  };

  const renderPolicyRow = (p: SeniorityIndemnityPolicy) => (
    <div key={p.id} className="px-4 py-3 flex justify-between gap-3 items-start">
      <div className="min-w-0">
        <p className="font-medium text-sm">{p.name}</p>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{describeIndemnityPolicy(p)}</p>
        {p.legal_ref && (
          <p className="text-[10px] text-primary-600 dark:text-primary-400 mt-0.5">{p.legal_ref}</p>
        )}
        <p className="text-[10px] text-slate-400 mt-1">Effective from {p.effective_from}</p>
      </div>
      {canMutate && (
        <div className="flex gap-1 shrink-0">
          <Button variant="ghost" size="sm" onClick={() => setEditing({ ...p })}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-600"
            onClick={async () => {
              const ok = await confirm({
                title: 'Delete siniority policy?',
                description: 'Delete this siniority policy?',
                variant: 'danger',
                confirmLabel: 'Delete',
              });
              if (!ok) return;
              try {
                await Api.payroll.deleteSeniorityIndemnityPolicy(p.id);
                showToast('Siniority policy deleted', 'success');
                if (editing?.id === p.id) setEditing(null);
                await load();
              } catch (e) {
                showToast(e instanceof Error ? e.message : 'Failed to delete policy', 'error');
              }
            }}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <Card
      className={`overflow-hidden relative ${compact ? 'h-auto' : 'h-full'} border border-slate-200/80 dark:border-slate-700 shadow-sm ${isSectionEditing ? 'ring-2 ring-primary-500/20' : ''}`}
    >
      <ConfirmDialogHost />
      <RulesConfigHelp help="payroll.seniority_indemnity" className="absolute top-3 right-3 z-10" />
      <div className={`${sectionHeaderClass} pr-11 ${compact ? 'px-4 py-2.5' : ''}`}>
        <div className="flex items-center gap-2 min-w-0">
          <Award className="w-5 h-5 shrink-0 text-primary-600" />
          <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">
            {compact ? 'Siniority (Jun / Dec)' : 'Siniority (Jun / Dec)'}
          </span>
          <Badge variant="neutral" className="shrink-0">
            {activePolicies.length} active
          </Badge>
        </div>
        <SectionEditToolbar
          canEdit={canEdit}
          isEditing={isSectionEditing}
          saving={saving}
          onEdit={() => setIsSectionEditing(true)}
          onCancel={async () => {
            if (!(await confirmDiscardIfDirty())) return;
            setIsSectionEditing(false);
            setEditing(null);
            await load();
          }}
          onSave={() => {
            setIsSectionEditing(false);
            setEditing(null);
          }}
        />
      </div>

      <div className={`${compact ? 'p-4 space-y-3' : 'p-5 space-y-5'}`}>
        <ListSearchFilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search siniority policies..."
          filter={
            <PageFilterMenu
              activeCount={filterActiveCount}
              onClear={() => setStatusFilter('')}
            >
              <FilterMenuSelect
                label="Status"
                value={statusFilter}
                onChange={(value) => {
                  setStatusFilter(value);
                  if (value === 'inactive') setShowInactive(true);
                }}
                options={[
                  { value: '', label: 'All statuses' },
                  { value: 'active', label: 'Active' },
                  { value: 'inactive', label: 'Inactive' },
                ]}
              />
            </PageFilterMenu>
          }
          trailing={
            canMutate ? (
              <Button size="sm" onClick={() => setEditing(defaultPolicy())}>
                <Plus className="w-4 h-4 mr-1" />
                New policy
              </Button>
            ) : undefined
          }
        />

        {showActiveSection && (
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <span className="font-semibold text-sm">Active policies</span>
              <Badge variant="neutral">{activePolicies.length}</Badge>
            </div>
            {loading ? (
              <LoadingState variant="panel" layout="table" />
            ) : activePolicies.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">
                {search.trim() || statusFilter
                  ? 'No active policies match your search or filters.'
                  : 'No active policy.'}
              </p>
            ) : (
              <div className="divide-y">{activePolicies.map(renderPolicyRow)}</div>
            )}
          </Card>
        )}

        {showInactiveSection && inactivePolicies.length > 0 && (
          <Card className="overflow-hidden">
            <button
              type="button"
              className="w-full px-4 py-3 border-b flex items-center justify-between text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-900/50"
              onClick={() => setShowInactive((v) => !v)}
            >
              <span>Inactive / templates ({inactivePolicies.length})</span>
              {showInactive || statusFilter === 'inactive' ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
            {(showInactive || statusFilter === 'inactive') && (
              <div className="divide-y">{inactivePolicies.map(renderPolicyRow)}</div>
            )}
          </Card>
        )}
      </div>

      <Modal
        isOpen={canMutate && editing != null}
        onClose={() => {
          if (saving) return;
          setEditing(null);
        }}
        title={editing?.id ? 'Edit siniority policy' : 'New siniority policy'}
        help="payroll.seniority_indemnity"
        size="xl"
        disableClose={saving}
        footer={
          editing ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(null)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={saving || !editing.name}>
                <Save className="w-4 h-4 mr-1" />
                {saving ? 'Saving…' : 'Save policy'}
              </Button>
            </div>
          ) : null
        }
      >
        {editing && (
          <div className="space-y-4">
            <div className="grid md:grid-cols-2 gap-3">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block">
                Policy name
                <input
                  className={inputClass + ' mt-1'}
                  value={editing.name ?? ''}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </label>
            </div>

            <ActiveStatusControl
              layout="field"
              size="md"
              active={Boolean(editing.active)}
              onChange={(next) => setEditing({ ...editing, active: next })}
              label={editing.active ? 'Active policy' : 'Inactive policy'}
              description="Schedule with the Effective from banner above. Only active policies are included in payroll."
            />

            <div className="grid sm:grid-cols-3 gap-3">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block">
                Days per year
                <input
                  {...numericInputAttrs('decimal')}
                  className={inputClass + ' mt-1'}
                  value={editing.days_per_year ?? 15}
                  onChange={onFilteredChange('decimal', (v) =>
                    setEditing({ ...editing, days_per_year: Number(v) || 0 })
                  )}
                />
              </label>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block">
                June payout (days)
                <input
                  {...numericInputAttrs('decimal')}
                  className={inputClass + ' mt-1'}
                  value={editing.payout_june_days ?? 7.5}
                  onChange={onFilteredChange('decimal', (v) =>
                    setEditing({ ...editing, payout_june_days: Number(v) || 0 })
                  )}
                />
              </label>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block">
                December payout (days)
                <input
                  {...numericInputAttrs('decimal')}
                  className={inputClass + ' mt-1'}
                  value={editing.payout_december_days ?? 7.5}
                  onChange={onFilteredChange('decimal', (v) =>
                    setEditing({ ...editing, payout_december_days: Number(v) || 0 })
                  )}
                />
              </label>
            </div>

            <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block">
              Working days divisor (Instruction 058/19)
              <select
                className={inputClass + ' mt-1'}
                value={editing.working_days_divisor ?? 26}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    working_days_divisor: Number(e.target.value) as SeniorityIndemnityWorkingDaysDivisor,
                  })
                }
              >
                <option value={22}>22 days / month</option>
                <option value={24}>24 days / month</option>
                <option value={26}>26 days / month</option>
              </select>
            </label>

            <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block">
              Daily rate method (legacy / actual-days override)
              <select
                className={inputClass + ' mt-1'}
                value={editing.daily_rate_method ?? 'scheduled_26'}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    daily_rate_method: e.target.value as SeniorityIndemnityDailyRateMethod,
                  })
                }
              >
                <option value="scheduled_26">Average monthly ÷ working days divisor</option>
                <option value="actual_working_days">Average monthly ÷ actual working days in period</option>
              </select>
            </label>

            <div>
              <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Salary basis</p>
              <div className="flex flex-wrap gap-3">
                {SALARY_BASIS_OPTIONS.map((opt) => (
                  <label key={opt.id} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={(editing.salary_basis ?? ['base_salary']).includes(opt.id)}
                      onChange={() => toggleSalaryBasis(opt.id)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block">
              Eligible contract types (comma-separated)
              <input
                className={inputClass + ' mt-1'}
                value={(editing.eligible_contract_types ?? ['UDC']).join(', ')}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    eligible_contract_types: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>

            <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block">
              Excluded employment types (comma-separated)
              <input
                className={inputClass + ' mt-1'}
                value={(editing.excluded_employment_types ?? []).join(', ')}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    excluded_employment_types: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block">
                Seniority start
                <select
                  className={inputClass + ' mt-1'}
                  value={editing.inclusion_rule ?? 'after_probation'}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      inclusion_rule: e.target.value as SeniorityIndemnityInclusionRule,
                    })
                  }
                >
                  <option value="after_probation">After probation ends (Art. 89 default)</option>
                  <option value="after_months">After fixed months</option>
                </select>
              </label>
              {editing.inclusion_rule === 'after_months' && (
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block">
                  Wait (months)
                  <input
                    {...numericInputAttrs('integer')}
                    className={inputClass + ' mt-1'}
                    value={editing.inclusion_months ?? 0}
                    onChange={onFilteredChange('integer', (v) =>
                      setEditing({ ...editing, inclusion_months: Number(v) || 0 })
                    )}
                  />
                </label>
              )}
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block">
                Min days for full seniority month
                <input
                  {...numericInputAttrs('integer')}
                  className={inputClass + ' mt-1'}
                  value={mergeExtendedConfig(editing).semesterMinDaysForFullMonth ?? 21}
                  onChange={onFilteredChange('integer', (v) =>
                    setEditing({
                      ...editing,
                      extended_config: {
                        ...mergeExtendedConfig(editing),
                        semesterMinDaysForFullMonth: Number(v) || 21,
                      },
                    })
                  )}
                />
              </label>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block">
                Termination partial semester (days)
                <input
                  {...numericInputAttrs('decimal')}
                  className={inputClass + ' mt-1'}
                  value={mergeExtendedConfig(editing).terminationPartialSemesterDays ?? 7}
                  onChange={onFilteredChange('decimal', (v) =>
                    setEditing({
                      ...editing,
                      extended_config: {
                        ...mergeExtendedConfig(editing),
                        terminationPartialSemesterDays: Number(v) || 7,
                      },
                    })
                  )}
                />
              </label>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block">
                Resignation siniority
                <select
                  className={inputClass + ' mt-1'}
                  value={mergeExtendedConfig(editing).resignationIndemnityPolicy ?? 'none'}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      extended_config: {
                        ...mergeExtendedConfig(editing),
                        resignationIndemnityPolicy: e.target.value as SeniorityIndemnityResignationPolicy,
                      },
                    })
                  }
                >
                  <option value="none">None (conservative default)</option>
                  <option value="employer_parity">Same as employer termination</option>
                </select>
              </label>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
};
