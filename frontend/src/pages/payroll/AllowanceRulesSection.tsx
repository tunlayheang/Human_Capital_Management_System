import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useUrlSyncedTab } from '../../hooks/useUrlSyncedTab';
import {
  Wallet,
  ListChecks,
  Layers,
  ChevronDown,
  ChevronUp,
  Plus,
  Loader2,
  Pencil,
  Trash2,
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { LoadingState } from '../../components/common/LoadingState';
import { RulesConfigHelp } from '../../components/ui/RulesConfigHelp';
import {
  FilterMenuDateRange,
  FilterMenuSelect,
  PageFilterMenu,
} from '../../components/ui/PageFilterMenu';
import { countActiveFilters } from '../../utils/filterActiveCount';
import {
  EMPTY_DATE_RANGE,
  intervalOverlapsDateRange,
  countDateRangeFilters,
} from '../../utils/dateRangeFilter';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ActiveStatusControl } from '../../components/ui/ActiveStatusControl';
import { ListSearchFilterBar, PillSegmentTabs } from '../../components/ui/page';
import { SectionEditToolbar } from '../../components/ui/SectionEditToolbar';
import { Modal } from '../../components/ui/Modal';
import { NumericField } from '../../components/ui/NumericField';
import { CurrencyAmountField } from '../../components/ui/CurrencyAmountField';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import type { AllowanceRule, AllowanceTemplate, AllowanceType } from '../../types';
import {
  allowanceRuleTypeHelpId,
  normalizeAllowanceRule,
  normalizeAllowanceType,
  parseConditionJson,
} from './allowanceRuleUtils';
import {
  AllowanceRuleConditionForm,
  TRIGGER_OPTIONS,
  defaultConditionsForTrigger,
} from './AllowanceRuleConditionForm';
import { AllowanceTemplatesTab } from './AllowanceTemplatesTab';
import { DatePickerInput } from '@/components/ui/shadcn/date-picker-input';
import { usePayrollRulesCurrency } from '../../context/PayrollRulesCurrencyContext';
import { formatRulesAmountFromUsd } from '../../utils/payrollRulesCurrency';
import { promptActiveStatusChange } from '../../utils/activeStatusChange';
import { promptPolicySaveEffectiveDate } from '../../utils/policyEffectiveDate';

const LEGACY_SENIORITY_CODE = 'SENIORITY';
const RETIRED_OT_MEAL_CODE = 'OT_MEAL';

function isLegacySeniorityType(type: AllowanceType): boolean {
  return String(type.code ?? '').toUpperCase() === LEGACY_SENIORITY_CODE;
}

function isRetiredOtMealType(type: AllowanceType): boolean {
  return String(type.code ?? '').toUpperCase() === RETIRED_OT_MEAL_CODE;
}

function isHiddenAllowanceType(type: AllowanceType): boolean {
  return isLegacySeniorityType(type) || isRetiredOtMealType(type);
}

const sectionHeaderClass =
  'flex items-center justify-between gap-3 px-5 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700';

const calcBadge = (t: string) => (
  <Badge variant="neutral" className="text-[10px] uppercase tracking-wide">
    {t.replace(/_/g, ' ')}
  </Badge>
);

const inputClass =
  'rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm w-full';

type TabId = 'types' | 'rules' | 'templates';
const ALLOWANCE_SECTION_TABS = ['types', 'rules', 'templates'] as const;

export const AllowanceRulesSection: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const { showToast } = useToast();
  const { confirm, confirmEffectiveDate, ConfirmDialogHost } = useConfirmDialog();
  const { currency, exchangeRateKhrPerUsd } = usePayrollRulesCurrency();
  const [tab, setTab] = useUrlSyncedTab<TabId>({
    values: ALLOWANCE_SECTION_TABS,
    defaultValue: 'rules',
    param: 'section',
  });
  const [loading, setLoading] = useState(true);
  const [types, setTypes] = useState<AllowanceType[]>([]);
  const [rules, setRules] = useState<AllowanceRule[]>([]);
  const [templates, setTemplates] = useState<AllowanceTemplate[]>([]);
  const [typesSearch, setTypesSearch] = useState('');
  const [typesStatusFilter, setTypesStatusFilter] = useState('');
  const [typesTaxableFilter, setTypesTaxableFilter] = useState('');
  const [rulesSearch, setRulesSearch] = useState('');
  const [rulesStatusFilter, setRulesStatusFilter] = useState('');
  const [filterTypeId, setFilterTypeId] = useState('');
  const [effectiveRange, setEffectiveRange] = useState(EMPTY_DATE_RANGE);
  const typesFilterActiveCount = useMemo(
    () =>
      countActiveFilters([
        { value: typesStatusFilter, defaultValue: '' },
        { value: typesTaxableFilter, defaultValue: '' },
      ]),
    [typesStatusFilter, typesTaxableFilter]
  );
  const rulesFilterActiveCount = useMemo(
    () =>
      countActiveFilters([
        { value: filterTypeId, defaultValue: '' },
        { value: rulesStatusFilter, defaultValue: '' },
      ]) + countDateRangeFilters(effectiveRange),
    [filterTypeId, rulesStatusFilter, effectiveRange]
  );
  const [expanded, setExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingRuleId, setTogglingRuleId] = useState<string | null>(null);
  const [togglingTypeId, setTogglingTypeId] = useState<string | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);

  const [editRule, setEditRule] = useState<AllowanceRule | null>(null);
  const { confirmDiscardIfDirty } = useUnsavedChangesGuard({
    isDirty: isEditing || editRule != null,
    confirm,
  });

  const [conditionJsonText, setConditionJsonText] = useState('{}');
  const [conditionJsonError, setConditionJsonError] = useState<string | null>(null);
  const [showAdvancedJson, setShowAdvancedJson] = useState(false);
  const [ruleConditions, setRuleConditions] = useState<Record<string, unknown>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, r, tpl] = await Promise.all([
        Api.payroll.getAllowanceTypes(),
        Api.payroll.getAllowanceRules(),
        Api.payroll.getAllowanceTemplates(),
      ]);
      setTypes((t as AllowanceType[]).map(normalizeAllowanceType));
      setRules((r as AllowanceRule[]).map(normalizeAllowanceRule));
      setTemplates(tpl as AllowanceTemplate[]);
    } catch (e) {
      console.error(e);
      showToast('Failed to load allowance configuration', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleTypes = useMemo(
    () => types.filter((t) => !isHiddenAllowanceType(t)),
    [types]
  );

  const filteredTypes = useMemo(() => {
    const q = typesSearch.trim().toLowerCase();
    return visibleTypes.filter((t) => {
      if (typesStatusFilter === 'active' && !t.active) return false;
      if (typesStatusFilter === 'inactive' && t.active) return false;
      if (typesTaxableFilter === 'taxable' && !t.taxable) return false;
      if (typesTaxableFilter === 'non' && t.taxable) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        String(t.code ?? '')
          .toLowerCase()
          .includes(q) ||
        String(t.category ?? '')
          .toLowerCase()
          .includes(q)
      );
    });
  }, [visibleTypes, typesSearch, typesStatusFilter, typesTaxableFilter]);

  const filteredRules = useMemo(() => {
    const q = rulesSearch.trim().toLowerCase();
    return rules.filter((r) => {
      const type = types.find((t) => t.id === r.allowance_type_id);
      if (type && isHiddenAllowanceType(type)) return false;
      if (filterTypeId && r.allowance_type_id !== filterTypeId) return false;
      if (rulesStatusFilter === 'active' && r.active === false) return false;
      if (rulesStatusFilter === 'inactive' && r.active !== false) return false;
      if (
        !intervalOverlapsDateRange(
          r.effective_from,
          r.effective_to ?? r.effective_from,
          effectiveRange
        )
      ) {
        return false;
      }
      if (!q) return true;
      const typeName = (type?.name ?? r.allowance_type_id).toLowerCase();
      return (
        r.rule_name.toLowerCase().includes(q) ||
        typeName.includes(q) ||
        String(r.trigger_type ?? '')
          .toLowerCase()
          .includes(q)
      );
    });
  }, [rules, types, filterTypeId, rulesStatusFilter, effectiveRange, rulesSearch]);

  const openEditRule = (rule: AllowanceRule) => {
    const normalized = normalizeAllowanceRule(rule);
    const cond = normalized.condition_json ?? {};
    setEditRule(normalized);
    setRuleConditions(cond);
    setConditionJsonText(JSON.stringify(cond, null, 2));
    setConditionJsonError(null);
    setShowAdvancedJson(false);
  };

  const openNewRule = () => {
    const trigger = 'fixed';
    const cond = defaultConditionsForTrigger(trigger);
    const draft: AllowanceRule = {
      id: '',
      allowance_type_id: filterTypeId || visibleTypes[0]?.id || '',
      rule_name: 'New rule',
      trigger_type: trigger,
      condition_json: cond,
      fixed_amount: 0,
      percentage_rate: 0,
      priority: 100,
      active: true,
      stackable: true,
    };
    setEditRule(draft);
    setRuleConditions(cond);
    setConditionJsonText(JSON.stringify(cond, null, 2));
    setConditionJsonError(null);
    setShowAdvancedJson(false);
  };

  const closeEditRule = async () => {
    if (!(await confirmDiscardIfDirty())) return;
    setEditRule(null);
    setConditionJsonError(null);
    setShowAdvancedJson(false);
  };

  const forceCloseEditRule = () => {
    setEditRule(null);
    setConditionJsonError(null);
    setShowAdvancedJson(false);
  };

  const handleTriggerChange = (trigger: string) => {
    if (!editRule) return;
    const cond = defaultConditionsForTrigger(trigger);
    setEditRule({ ...editRule, trigger_type: trigger, condition_json: cond });
    setRuleConditions(cond);
    setConditionJsonText(JSON.stringify(cond, null, 2));
  };

  const handleSaveRule = async () => {
    if (!editRule?.allowance_type_id || !editRule.rule_name?.trim()) {
      showToast('Rule name and allowance type are required', 'error');
      return;
    }
    let condition_json: Record<string, unknown>;
    try {
      condition_json = JSON.parse(conditionJsonText) as Record<string, unknown>;
      setConditionJsonError(null);
    } catch {
      setConditionJsonError('Invalid JSON in conditions');
      return;
    }

    const effective_from = await promptPolicySaveEffectiveDate(confirmEffectiveDate, {
      title: editRule.id ? 'Save allowance rule?' : 'Create allowance rule?',
      description:
        'Choose when this allowance rule takes effect. The change is scheduled — it does not apply instantly.',
      confirmLabel: editRule.id ? 'Save rule' : 'Create rule',
      defaultEffectiveDate: editRule.effective_from || undefined,
    });
    if (!effective_from) return;

    setSaving(true);
    try {
      const commissionPct =
        editRule.trigger_type === 'commission'
          ? Number(
              (condition_json as { commission_pct?: unknown }).commission_pct ??
                editRule.percentage_rate
            ) || 0
          : Number(editRule.percentage_rate) || 0;
      await Api.payroll.saveAllowanceRule({
        ...editRule,
        condition_json:
          editRule.trigger_type === 'commission'
            ? { ...condition_json, commission_pct: commissionPct }
            : condition_json,
        effective_from,
        fixed_amount: Number(editRule.fixed_amount) || 0,
        percentage_rate:
          editRule.trigger_type === 'commission'
            ? commissionPct
            : Number(editRule.percentage_rate) || 0,
        // Priority is not user-facing; keep a stable default for engine ordering.
        priority: editRule.id ? Number(editRule.priority) || 100 : 100,
        active: editRule.active !== false,
        stackable: editRule.stackable !== false,
      });
      showToast(editRule.id ? 'Rule updated' : 'Rule created', 'success');
      forceCloseEditRule();
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to save rule', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleRuleActive = async (rule: AllowanceRule) => {
    if (!canEdit) return;
    const next = !rule.active;
    const effectiveFrom = await promptActiveStatusChange(confirmEffectiveDate, {
      entityLabel: 'rule',
      entityName: rule.rule_name,
      nextActive: next,
      defaultEffectiveDate: rule.effective_from ?? undefined,
    });
    if (!effectiveFrom) return;
    setTogglingRuleId(rule.id);
    try {
      await Api.payroll.saveAllowanceRule({
        ...rule,
        active: next,
        effective_from: effectiveFrom,
        condition_json: parseConditionJson(rule.condition_json),
      });
      setRules((prev) =>
        prev.map((r) =>
          r.id === rule.id ? { ...r, active: next, effective_from: effectiveFrom } : r
        )
      );
      showToast(next ? 'Rule activated' : 'Rule deactivated', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to update rule', 'error');
    } finally {
      setTogglingRuleId(null);
    }
  };

  const deleteRule = async (rule: AllowanceRule) => {
    if (!canEdit || !rule.id) return;
    const ok = await confirm({
      title: 'Delete rule permanently?',
      description:
        'This permanently deletes the rule. It cannot be restored. Templates and employee assignments that used this rule will lose the rule link.',
      variant: 'danger',
      confirmLabel: 'Delete forever',
    });
    if (!ok) return;
    setDeletingRuleId(rule.id);
    try {
      await Api.payroll.deleteAllowanceRule(rule.id);
      showToast('Rule deleted permanently', 'success');
      if (editRule?.id === rule.id) forceCloseEditRule();
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to delete rule', 'error');
    } finally {
      setDeletingRuleId(null);
    }
  };

  const toggleTypeActive = async (type: AllowanceType) => {
    if (!canEdit) return;
    const next = !type.active;
    const effectiveFrom = await promptActiveStatusChange(confirmEffectiveDate, {
      entityLabel: 'allowance type',
      entityName: type.name,
      nextActive: next,
    });
    if (!effectiveFrom) return;
    setTogglingTypeId(type.id);
    try {
      await Api.payroll.saveAllowanceType({
        ...type,
        active: next,
        // Collected for scheduling UX / audit; types are not versioned by date today.
        ...(effectiveFrom ? { effective_from: effectiveFrom } : {}),
      } as Partial<AllowanceType> & { effective_from?: string });
      setTypes((prev) =>
        prev.map((t) => (t.id === type.id ? { ...t, active: next } : t))
      );
      showToast(next ? 'Allowance type enabled' : 'Allowance type disabled', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to update type', 'error');
    } finally {
      setTogglingTypeId(null);
    }
  };

  const tabs: { id: TabId; label: string; icon: typeof Wallet }[] = [
    { id: 'types', label: 'Allowance types', icon: Wallet },
    { id: 'rules', label: 'Rule builder', icon: ListChecks },
    { id: 'templates', label: 'Templates', icon: Layers },
  ];

  const ruleModalOpen = editRule != null && tab === 'rules';
  const canMutate = canEdit && isEditing;

  const startEdit = () => setIsEditing(true);
  const cancelEdit = async () => {
    if (!(await confirmDiscardIfDirty())) return;
    setIsEditing(false);
    setEditRule(null);
    await load();
  };

  return (
    <>
      <ConfirmDialogHost />
      <Card className={`relative border-none shadow-sm overflow-hidden ${isEditing ? 'ring-2 ring-primary-500/20' : ''}`}>
        <RulesConfigHelp help="payroll.allowanceRules" className="absolute top-3 right-3 z-20" />
        <div className={`${sectionHeaderClass} pr-12`}>
          <button
            type="button"
            className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200 min-w-0 text-left"
            onClick={() => setExpanded((v) => !v)}
          >
            <Wallet className="w-4 h-4 shrink-0 text-primary-600" />
            Allowance Rules Configuration
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="info">Dynamic engine</Badge>
            <SectionEditToolbar
              canEdit={canEdit}
              isEditing={isEditing}
              onEdit={startEdit}
              onCancel={() => void cancelEdit()}
              onSave={() => setIsEditing(false)}
            />
          </div>
        </div>

        {expanded && (
          <div className="p-5 space-y-5">
            {!canEdit && (
              <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg">
                View only — you need payroll rules edit permission to change allowances.
              </p>
            )}

            <PillSegmentTabs
              value={tab}
              onChange={(id) => setTab(id as TabId)}
              ariaLabel="Allowance configuration sections"
              tabs={tabs.map((item) => ({
                id: item.id,
                label: item.label,
                icon: item.icon,
              }))}
            />

            {loading && (
              <LoadingState
                variant="panel"
                layout="list"
                label="Loading allowance configuration…"
                className="py-2"
              />
            )}

            {!loading && tab === 'types' && (
              <div className="space-y-4">
                <ListSearchFilterBar
                  searchValue={typesSearch}
                  onSearchChange={setTypesSearch}
                  searchPlaceholder="Search allowance types..."
                  filter={
                    <PageFilterMenu
                      activeCount={typesFilterActiveCount}
                      onClear={() => {
                        setTypesStatusFilter('');
                        setTypesTaxableFilter('');
                      }}
                    >
                      <FilterMenuSelect
                        label="Status"
                        value={typesStatusFilter}
                        onChange={setTypesStatusFilter}
                        options={[
                          { value: '', label: 'All statuses' },
                          { value: 'active', label: 'Active' },
                          { value: 'inactive', label: 'Inactive' },
                        ]}
                      />
                      <FilterMenuSelect
                        label="Tax"
                        value={typesTaxableFilter}
                        onChange={setTypesTaxableFilter}
                        options={[
                          { value: '', label: 'All' },
                          { value: 'taxable', label: 'Taxable' },
                          { value: 'non', label: 'Non-taxable' },
                        ]}
                      />
                    </PageFilterMenu>
                  }
                />
                <div className="space-y-3">
                  {filteredTypes.map((t) => (
                    <div
                      key={t.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30"
                    >
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">{t.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {t.code} · {t.category}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 items-center">
                        {calcBadge(t.calculation_type)}
                        <ActiveStatusControl
                          active={Boolean(t.active)}
                          loading={togglingTypeId === t.id}
                          disabled={!canMutate || togglingTypeId === t.id}
                          readOnly={!canMutate}
                          onRequestToggle={canMutate ? () => void toggleTypeActive(t) : undefined}
                        />
                        <Badge variant={t.taxable ? 'warning' : 'neutral'}>
                          {t.taxable ? 'Taxable' : 'Non-taxable'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                  {filteredTypes.length === 0 && (
                    <p className="text-sm text-slate-500 italic">No allowance types match your search or filters.</p>
                  )}
                </div>
              </div>
            )}

            {!loading && tab === 'rules' && (
              <div className="space-y-4">
                <ListSearchFilterBar
                  searchValue={rulesSearch}
                  onSearchChange={setRulesSearch}
                  searchPlaceholder="Search rules by name or type..."
                  filter={
                    <PageFilterMenu
                      activeCount={rulesFilterActiveCount}
                      onClear={() => {
                        setFilterTypeId('');
                        setRulesStatusFilter('');
                        setEffectiveRange(EMPTY_DATE_RANGE);
                      }}
                    >
                      <FilterMenuDateRange
                        from={effectiveRange.from}
                        to={effectiveRange.to}
                        onChange={setEffectiveRange}
                        fromLabel="Effective from"
                        toLabel="Effective to"
                      />
                      <FilterMenuSelect
                        label="Allowance type"
                        value={filterTypeId}
                        onChange={setFilterTypeId}
                        options={[
                          { value: '', label: 'All types' },
                          ...visibleTypes.map((t) => ({ value: t.id, label: t.name })),
                        ]}
                      />
                      <FilterMenuSelect
                        label="Status"
                        value={rulesStatusFilter}
                        onChange={setRulesStatusFilter}
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
                      <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={openNewRule}>
                        Add rule
                      </Button>
                    ) : undefined
                  }
                />

                <div className="space-y-2">
                  {filteredRules.map((r) => {
                    const typeName =
                      visibleTypes.find((t) => t.id === r.allowance_type_id)?.name ??
                      types.find((t) => t.id === r.allowance_type_id)?.name ??
                      r.allowance_type_id;
                    const isToggling = togglingRuleId === r.id;
                    const isDeleting = deletingRuleId === r.id;
                    const isActive = r.active !== false;
                    return (
                      <div
                        key={r.id}
                        className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 flex flex-wrap justify-between gap-3 items-center"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 dark:text-white">{r.rule_name}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {typeName} ·{' '}
                            {formatRulesAmountFromUsd(
                              Number(r.fixed_amount),
                              currency,
                              exchangeRateKhrPerUsd
                            )}
                          </p>
                        </div>
                        <div className="flex gap-1.5 items-center shrink-0">
                          {calcBadge(r.trigger_type)}
                          <ActiveStatusControl
                            active={isActive}
                            loading={isToggling}
                            disabled={!canMutate || isToggling || isDeleting}
                            readOnly={!canMutate}
                            onRequestToggle={
                              canMutate ? () => void toggleRuleActive(r) : undefined
                            }
                          />
                          {canMutate ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                iconOnly
                                title="Edit rule"
                                aria-label="Edit rule"
                                disabled={isToggling || isDeleting}
                                onClick={() => openEditRule(r)}
                                icon={<Pencil className="w-3.5 h-3.5" />}
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                iconOnly
                                title="Delete rule permanently"
                                aria-label="Delete rule permanently"
                                disabled={isToggling || isDeleting}
                                isLoading={isDeleting}
                                onClick={() => void deleteRule(r)}
                                icon={<Trash2 className="w-3.5 h-3.5 text-red-500" />}
                              />
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                  {filteredRules.length === 0 && (
                    <p className="text-sm text-slate-500 italic">
                      No rules match your search or filters.
                    </p>
                  )}
                </div>
              </div>
            )}

            {!loading && tab === 'templates' && (
              <AllowanceTemplatesTab
                canEdit={canMutate}
                types={visibleTypes}
                rules={rules}
                templates={templates}
                onTemplatesChange={load}
              />
            )}
          </div>
        )}
      </Card>

      <Modal
        isOpen={ruleModalOpen}
        onClose={() => void closeEditRule()}
        title={editRule?.id ? 'Edit allowance rule' : 'New allowance rule'}
        size="lg"
        help={allowanceRuleTypeHelpId(editRule?.trigger_type ?? 'fixed')}
      >
        {editRule && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-sm flex flex-col gap-1">
                <span className="text-slate-500">Rule name</span>
                <input
                  className={inputClass}
                  value={editRule.rule_name}
                  onChange={(e) => setEditRule({ ...editRule, rule_name: e.target.value })}
                />
              </label>
              <label className="text-sm flex flex-col gap-1">
                <span className="text-slate-500">Allowance type</span>
                <select
                  className={inputClass}
                  value={editRule.allowance_type_id}
                  onChange={(e) =>
                    setEditRule({ ...editRule, allowance_type_id: e.target.value })
                  }
                >
                  {visibleTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm flex flex-col gap-1 sm:col-span-2">
                <span className="text-slate-500">Rule type</span>
                <select
                  className={inputClass}
                  value={editRule.trigger_type}
                  onChange={(e) => handleTriggerChange(e.target.value)}
                >
                  {TRIGGER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-slate-500">
                  {TRIGGER_OPTIONS.find((o) => o.value === editRule.trigger_type)?.hint}
                </span>
              </label>
              <label className="text-sm flex flex-col gap-1">
                <span className="text-slate-500">Fixed amount ({currency})</span>
                <CurrencyAmountField
                  storage="usd"
                  className={inputClass}
                  value={Number(editRule.fixed_amount) || 0}
                  currency={currency}
                  exchangeRateKhrPerUsd={exchangeRateKhrPerUsd}
                  onValueChange={(fixed_amount) => setEditRule({ ...editRule, fixed_amount })}
                />
              </label>
              {editRule.trigger_type === 'commission' ? (
                <label className="text-sm flex flex-col gap-1">
                  <span className="text-slate-500">Percentage rate</span>
                  <NumericField
                    kind="decimal"
                    filterOptions={{ maxDecimals: 2 }}
                    className={inputClass}
                    value={editRule.percentage_rate}
                    onValueChange={(v) =>
                      setEditRule({ ...editRule, percentage_rate: Number(v) || 0 })
                    }
                  />
                  <span className="text-xs text-slate-500">
                    Fallback if Commission % is not set in conditions below.
                  </span>
                </label>
              ) : null}
              <label className="text-sm flex flex-col gap-1">
                <span className="text-slate-500">Effective to</span>
                <DatePickerInput className={inputClass}
                  value={editRule.effective_to ?? ''}
                  onChange={(e) =>
                    setEditRule({
                      ...editRule,
                      effective_to: e.target.value || null,
                    })
                  }
                />
              </label>
              <div className="sm:col-span-2 space-y-3 pt-1">
                <ActiveStatusControl
                  layout="field"
                  size="md"
                  active={editRule.active !== false}
                  onChange={(next) => setEditRule({ ...editRule, active: next })}
                  description="Inactive rules are skipped in payroll. Status changes are scheduled with an effective date when you save."
                />
                <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editRule.stackable !== false}
                    onChange={(e) => setEditRule({ ...editRule, stackable: e.target.checked })}
                  />
                  Stackable with other rules
                </label>
              </div>
            </div>

            <AllowanceRuleConditionForm
              triggerType={editRule.trigger_type}
              conditions={ruleConditions}
              fixedAmount={Number(editRule.fixed_amount) || 0}
              onChange={(next) => {
                setRuleConditions(next);
                setEditRule({ ...editRule, condition_json: next });
              }}
              showAdvancedJson={showAdvancedJson}
              onToggleAdvanced={() => setShowAdvancedJson((v) => !v)}
              conditionJsonText={conditionJsonText}
              onConditionJsonTextChange={(text) => {
                setConditionJsonText(text);
                setConditionJsonError(null);
                try {
                  const parsed = JSON.parse(text) as Record<string, unknown>;
                  setRuleConditions(parsed);
                  setEditRule({ ...editRule, condition_json: parsed });
                } catch {
                  /* user still typing */
                }
              }}
              conditionJsonError={conditionJsonError}
            />
            <div className="hcms-modal-actions hcms-modal-actions--end gap-2">
              <Button variant="outline" onClick={() => void closeEditRule()} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={() => void handleSaveRule()} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                    Saving…
                  </>
                ) : (
                  'Save rule'
                )}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};
