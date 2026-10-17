import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../../hooks/useWorkspaceTabCache';
import { useUrlSyncedTab } from '../../hooks/useUrlSyncedTab';
import {
  ShieldCheck,
  BarChart3,
  Plus,
  Calculator,
  Shield,
  Layers,
  GitBranch,
  Award,
} from 'lucide-react';
import { UnderlineTabs } from '../../components/ui/page';
import { useLanguage } from '../../context/LanguageContext';
import { PayrollExchangeRateCard } from './PayrollExchangeRateCard';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { LoadingState } from '../../components/common/LoadingState';
import { Badge } from '../../components/ui/Badge';
import { Api } from '../../services/api';
import type {
  PayrollComplianceRule,
  PayrollExchangeRateDetails,
  PayrollTaxBracket,
  PayrollNssfWageBracket,
} from '../../types';
import { NssfAssumedWageEditor } from './NssfAssumedWageEditor';
import { AllowanceRulesSection } from './AllowanceRulesSection';
import { UnifiedPayrollRulesSection } from './UnifiedPayrollRulesSection';
import { SeniorityIndemnityRulesSection } from './SeniorityIndemnityRulesSection';
import { PayrollWorkDayPolicySection } from '../../components/settings/PayrollWorkDayPolicySection';
import { TaxBracketEditSection } from './EditPayrollRulesSections';
import { normalizePayrollTaxBrackets } from '../../utils/payrollTaxRate';
import {
  parseKhrBracketField,
  sanitizePayrollTaxBrackets,
  validatePayrollTaxBrackets,
} from '../../utils/payrollTaxBracketSanitize';
import { PayrollCurrencyToggle } from '../../components/payroll/PayrollCurrencyToggle';
import { ComplianceRuleViewCard, ComplianceRuleEditCard } from './ComplianceRuleCard';
import { SectionEditToolbar } from './SectionEditToolbar';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { sortComplianceRules } from './complianceRuleDisplay';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { PERM } from '../../constants/permissionKeys';
import { isAdminRole } from '../../utils/adminNavScope';
import { RulesConfigHelp } from '../../components/ui/RulesConfigHelp';
import { PayrollPolicyVersionMetaLine } from '../../components/payroll/PayrollPolicyVersionMetaLine';
import { PayrollRulesCurrencyProvider, usePayrollRulesCurrency } from '../../context/PayrollRulesCurrencyContext';
import {
  formatRulesAmountFromKhr,
  formatTaxBracketRange,
} from '../../utils/payrollRulesCurrency';
import {
  getConfiguredExchangeRateKhrPerUsd,
  setPayrollExchangeRateCache,
} from '../../utils/payrollExchangeRateCache';
import { notifyPayrollExchangeRateUpdated } from '../../context/PayrollExchangeRateContext';
import type { PayrollNssfWagePolicy, PayrollTaxBracketPolicy } from '../../types';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { promptPolicySaveEffectiveDate } from '../../utils/policyEffectiveDate';

type EditingSection = 'exchange' | 'tax' | 'nssf' | string | null;

const VALID_RULES_TABS = ['tax', 'nssf', 'allowance', 'seniority', 'unified'] as const;
type RulesTab = (typeof VALID_RULES_TABS)[number];

function normalizeRulesTab(tab: string | undefined): RulesTab {
  if (tab && (VALID_RULES_TABS as readonly string[]).includes(tab)) return tab as RulesTab;
  return 'tax';
}

function bracketRange(min: number, max: number): string {
  const minLabel = min.toLocaleString();
  return max >= 9_999_999_999 ? `> ${minLabel} KHR` : `${minLabel} – ${max.toLocaleString()} KHR`;
}

const TAX_CHART_HEIGHT = 250;
const TAX_CHART_HEIGHT_COMPACT = 168;

const sectionHeaderClass =
  'flex items-center justify-between gap-3 px-5 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700';

const TaxBracketChart: React.FC<{
  loading: boolean;
  taxBrackets: PayrollTaxBracket[];
  height?: number;
}> = ({ loading, taxBrackets, height = TAX_CHART_HEIGHT }) => {
  const { currency, exchangeRateKhrPerUsd } = usePayrollRulesCurrency();
  const chartBrackets = React.useMemo(
    () =>
      taxBrackets.map((b) => ({
        ...b,
        range: formatTaxBracketRange(b.min, b.max, currency, exchangeRateKhrPerUsd),
      })),
    [taxBrackets, currency, exchangeRateKhrPerUsd]
  );
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const next = Math.floor(el.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const showChart = !loading && chartBrackets.length > 0 && width > 0;

  return (
    <div ref={containerRef} className="w-full min-w-0" style={{ height }}>
      {!showChart ? (
        <p className="h-full flex items-center justify-center text-sm italic text-slate-500">
          No data available for chart
        </p>
      ) : (
        <ResponsiveContainer width={width} height={height} minWidth={0}>
          <BarChart data={chartBrackets}>
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            <XAxis
              dataKey="range"
              tickLine={false}
              axisLine={false}
              fontSize={9}
              interval={0}
              angle={height < TAX_CHART_HEIGHT ? -28 : 0}
              textAnchor={height < TAX_CHART_HEIGHT ? 'end' : 'middle'}
              height={height < TAX_CHART_HEIGHT ? 52 : 30}
            />
            <YAxis tickLine={false} axisLine={false} fontSize={10} />
            <Tooltip
              formatter={(value: number) => [`${value}%`, 'Rate']}
              contentStyle={{
                borderRadius: '0.5rem',
                border: 'none',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              }}
            />
            <Bar dataKey="rate" radius={[4, 4, 0, 0]} barSize={height < TAX_CHART_HEIGHT ? 22 : 30}>
              {chartBrackets.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={index === chartBrackets.length - 1 ? '#ef4444' : '#6366f1'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};

const TaxBracketViewList: React.FC<{ taxBrackets: PayrollTaxBracket[] }> = ({ taxBrackets }) => {
  const { currency, exchangeRateKhrPerUsd } = usePayrollRulesCurrency();
  return (
    <ul className="mt-3 space-y-0.5 text-xs sm:text-sm">
      {taxBrackets.map((b) => (
        <li
          key={`${b.min}-${b.max}-${b.rate}`}
          className="flex justify-between gap-2 py-1 px-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800 min-w-0"
        >
          <span className="text-slate-600 dark:text-slate-400 truncate">
            {formatTaxBracketRange(b.min, b.max, currency, exchangeRateKhrPerUsd)}
          </span>
          <span className="font-bold text-slate-900 dark:text-white text-right shrink-0 tabular-nums">
            {b.rate}% −{' '}
            {formatRulesAmountFromKhr(b.deduction ?? 0, currency, exchangeRateKhrPerUsd)}
          </span>
        </li>
      ))}
    </ul>
  );
};

function SeniorityRulesTabPanels({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="w-full min-w-0">
      <SeniorityIndemnityRulesSection canEdit={canEdit} />
    </div>
  );
}

const PayrollRulesContent: React.FC = () => {
  const { hasPermission, user } = useAuth();
  const { t } = useLanguage();
  const { showToast } = useToast();
  const canEditRules = hasPermission(PERM.PAYROLL_RULES_EDIT);
  const canEditExchangeRate =
    isAdminRole(user?.role) || hasPermission(PERM.PAYROLL_RULES_EDIT);
  const [complianceRules, setComplianceRules] = useState<PayrollComplianceRule[]>([]);
  const [taxBrackets, setTaxBrackets] = useState<PayrollTaxBracket[]>([]);
  const [exchangeDetails, setExchangeDetails] = useState<PayrollExchangeRateDetails>({
    exchangeRateKhrPerUsd: getConfiguredExchangeRateKhrPerUsd(),
    dependentAllowanceUsd: 36.59,
    dependentAllowanceKhr: 150_000,
    isConfigured: false,
  });
  const [exchangeDraft, setExchangeDraft] = useState(getConfiguredExchangeRateKhrPerUsd());
  const [nssfWageBrackets, setNssfWageBrackets] = useState<PayrollNssfWageBracket[]>([]);
  const [editingSection, setEditingSection] = useState<EditingSection>(null);
  const [savingSection, setSavingSection] = useState<EditingSection>(null);
  const { confirm, confirmEffectiveDate, ConfirmDialogHost } = useConfirmDialog();
  const { confirmDiscardIfDirty } = useUnsavedChangesGuard({
    isDirty: editingSection != null,
    confirm,
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useUrlSyncedTab<RulesTab>({
    values: VALID_RULES_TABS,
    defaultValue: 'tax',
    param: 'tab',
  });
  const [taxPolicyMeta, setTaxPolicyMeta] = useState<
    Pick<
      PayrollTaxBracketPolicy,
      'effectiveFrom' | 'scheduledEffectiveFrom' | 'lastUpdatedAt'
    >
  >({});
  const [nssfPolicyMeta, setNssfPolicyMeta] = useState<
    Pick<
      PayrollNssfWagePolicy,
      'effectiveFrom' | 'scheduledEffectiveFrom' | 'lastUpdatedAt'
    >
  >({});

  const tabCache = useWorkspaceTabCache<{
    complianceRules: PayrollComplianceRule[];
    taxBrackets: PayrollTaxBracket[];
    exchangeDetails: PayrollExchangeRateDetails;
    exchangeDraft: number;
    nssfWageBrackets: PayrollNssfWageBracket[];
    activeTab: RulesTab;
  }>({
    slot: 'payroll-rules-v1',
    cacheKey: 'rules',
    getSnapshot: () => ({
      complianceRules,
      taxBrackets,
      exchangeDetails,
      exchangeDraft,
      nssfWageBrackets,
      activeTab,
    }),
    applySnapshot: (cached) => {
      setComplianceRules(cached.complianceRules);
      setTaxBrackets(cached.taxBrackets);
      setExchangeDetails(cached.exchangeDetails);
      setExchangeDraft(cached.exchangeDraft);
      setNssfWageBrackets(cached.nssfWageBrackets);
      setActiveTab(normalizeRulesTab(cached.activeTab));
      setLoading(false);
    },
    shouldPersist: (cached) => cached.taxBrackets.length > 0 || cached.complianceRules.length > 0,
    persistDeps: [complianceRules, taxBrackets, exchangeDetails, exchangeDraft, nssfWageBrackets, activeTab],
  });

  const fetchAll = useCallback(async (opts?: WorkspaceLoadOptions) => {
    if (!opts?.background) setLoading(true);
    try {
      const [rules, taxPolicy, nssfPolicy, fx] = await Promise.all([
        Api.payroll.getComplianceRules(),
        Api.payroll.getTaxBracketPolicy(),
        Api.payroll.getNssfWagePolicy(),
        Api.payroll.getExchangeRateDetails(),
      ]);
      setComplianceRules(rules);
      const configuredRate = fx.latestExchangeRateKhrPerUsd ?? fx.exchangeRateKhrPerUsd;
      setPayrollExchangeRateCache({
        configured: configuredRate,
        active: fx.exchangeRateKhrPerUsd,
      });
      setTaxBrackets(normalizePayrollTaxBrackets(taxPolicy.brackets, configuredRate));
      setTaxPolicyMeta({
        effectiveFrom: taxPolicy.effectiveFrom,
        scheduledEffectiveFrom: taxPolicy.scheduledEffectiveFrom,
        lastUpdatedAt: taxPolicy.lastUpdatedAt,
      });
      setNssfWageBrackets(nssfPolicy.brackets);
      setNssfPolicyMeta({
        effectiveFrom: nssfPolicy.effectiveFrom,
        scheduledEffectiveFrom: nssfPolicy.scheduledEffectiveFrom,
        lastUpdatedAt: nssfPolicy.lastUpdatedAt,
      });
      setExchangeDetails(fx);
      setExchangeDraft(fx.latestExchangeRateKhrPerUsd ?? fx.exchangeRateKhrPerUsd);
    } catch (e) {
      console.error(e);
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, []);

  useWorkspaceTabMountLoad(fetchAll, [fetchAll], tabCache);

  const startEdit = async (section: NonNullable<EditingSection>) => {
    if (editingSection && editingSection !== section) {
      if (!(await confirmDiscardIfDirty())) return;
      setEditingSection(null);
      await fetchAll();
    }
    if (section === 'exchange') {
      setExchangeDraft(
        exchangeDetails.latestExchangeRateKhrPerUsd ?? exchangeDetails.exchangeRateKhrPerUsd
      );
    }
    setEditingSection(section);
  };

  const cancelEdit = async () => {
    if (!(await confirmDiscardIfDirty())) return;
    setEditingSection(null);
    await fetchAll();
  };

  const updateComplianceConfig = (
    ruleKey: string,
    field: string,
    raw: string,
    type: 'number' | 'text' = 'number'
  ) => {
    setComplianceRules((prev) =>
      prev.map((rule) => {
        if (rule.ruleKey !== ruleKey) return rule;
        const config = { ...rule.config };
        if (type === 'text') config[field] = raw;
        else config[field] = raw === '' ? 0 : Number(raw);
        return { ...rule, config };
      })
    );
  };

  const updateComplianceMeta = (
    ruleKey: string,
    field: 'name' | 'legalRef' | 'description',
    value: string
  ) => {
    setComplianceRules((prev) =>
      prev.map((rule) => (rule.ruleKey === ruleKey ? { ...rule, [field]: value } : rule))
    );
  };

  const updateBracket = (index: number, field: keyof PayrollTaxBracket, raw: string) => {
    setTaxBrackets((prev) => {
      const next = [...prev];
      const row = { ...next[index] };
      if (field === 'min' || field === 'max' || field === 'deduction') {
        const previous = Number(row[field] ?? 0);
        row[field] = parseKhrBracketField(raw, previous);
      } else if (field === 'rate') {
        const previous = Number(row.rate ?? 0);
        const trimmed = String(raw ?? '').trim();
        row.rate = trimmed === '' || trimmed === '.' ? previous : Number(trimmed) || previous;
      } else if (field === 'range') {
        row.range = raw;
      } else if (field === 'currency') {
        row.currency = raw as PayrollTaxBracket['currency'];
      }
      row.range = bracketRange(row.min, row.max);
      next[index] = row;
      return next;
    });
  };

  const addBracket = () => {
    setTaxBrackets((prev) => {
      if (!prev.length) return [{ min: 0, max: 0, rate: 0, deduction: 0, range: bracketRange(0, 0), currency: 'KHR' }];
      return [...prev, { min: 0, max: 0, rate: 0, deduction: 0, range: bracketRange(0, 0) }];
    });
  };

  const removeBracket = (index: number) => {
    setTaxBrackets((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveExchange = async () => {
    const effectiveFrom = await promptPolicySaveEffectiveDate(confirmEffectiveDate, {
      title: 'Save exchange rate?',
      description:
        'Choose when the new KHR per USD rate takes effect. The change is scheduled — it does not apply instantly.',
      confirmLabel: 'Save exchange rate',
      defaultEffectiveDate: exchangeDetails.scheduledEffectiveFrom ?? exchangeDetails.effectiveFrom ?? undefined,
    });
    if (!effectiveFrom) return;
    setSavingSection('exchange');
    try {
      const saved = await Api.payroll.saveExchangeRate(exchangeDraft, effectiveFrom);
      setExchangeDetails((prev) => ({
        ...prev,
        exchangeRateKhrPerUsd: saved.exchangeRateKhrPerUsd,
        latestExchangeRateKhrPerUsd:
          saved.latestExchangeRateKhrPerUsd ?? saved.exchangeRateKhrPerUsd,
        dependentAllowanceUsd: saved.dependentAllowanceUsd,
        dependentAllowanceKhr: saved.dependentAllowanceKhr ?? 150_000,
        isConfigured: saved.isConfigured ?? true,
        effectiveFrom: saved.effectiveFrom ?? effectiveFrom,
        scheduledEffectiveFrom: saved.scheduledEffectiveFrom ?? null,
        lastUpdatedAt: saved.lastUpdatedAt ?? null,
        lastUpdatedBy: saved.lastUpdatedBy ?? null,
      }));
      setExchangeDraft(saved.latestExchangeRateKhrPerUsd ?? saved.exchangeRateKhrPerUsd);
      setPayrollExchangeRateCache({
        configured: saved.latestExchangeRateKhrPerUsd ?? saved.exchangeRateKhrPerUsd,
        active: saved.exchangeRateKhrPerUsd,
      });
      notifyPayrollExchangeRateUpdated();
      showToast('Exchange rate saved', 'success');
      setEditingSection(null);
      await fetchAll();
    } catch (e) {
      console.error(e);
      showToast(e instanceof Error ? e.message : 'Failed to save exchange rate.', 'error');
    } finally {
      setSavingSection(null);
    }
  };

  const handleSaveTax = async () => {
    const sanitized = sanitizePayrollTaxBrackets(taxBrackets);
    const validationErrors = validatePayrollTaxBrackets(sanitized);
    if (validationErrors.length) {
      showToast(validationErrors.join('\n'), 'error');
      return;
    }
    const effectiveFrom = await promptPolicySaveEffectiveDate(confirmEffectiveDate, {
      title: 'Save tax brackets?',
      description:
        'Choose when these Tax on Salary (ToS) brackets take effect. The change is scheduled — it does not apply instantly.',
      confirmLabel: 'Save tax brackets',
      defaultEffectiveDate: taxPolicyMeta.scheduledEffectiveFrom ?? taxPolicyMeta.effectiveFrom ?? undefined,
    });
    if (!effectiveFrom) return;
    setSavingSection('tax');
    try {
      await Api.payroll.saveTaxBrackets(sanitized, effectiveFrom);
      showToast('Tax brackets saved', 'success');
      setEditingSection(null);
      await fetchAll();
    } catch (e) {
      console.error(e);
      showToast('Failed to save tax brackets. Please try again.', 'error');
    } finally {
      setSavingSection(null);
    }
  };

  const handleSaveRule = async (ruleKey: string) => {
    const rule = complianceRules.find((r) => r.ruleKey === ruleKey);
    if (!rule) return;
    const effectiveFrom = await promptPolicySaveEffectiveDate(confirmEffectiveDate, {
      title: `Save ${rule.name || 'rule'}?`,
      description:
        'Choose when this compliance rule change takes effect. The change is scheduled — it does not apply instantly.',
      confirmLabel: 'Save rule',
      defaultEffectiveDate: rule.scheduledEffectiveFrom ?? rule.effectiveFrom ?? undefined,
    });
    if (!effectiveFrom) return;
    setSavingSection(ruleKey);
    try {
      await Api.payroll.saveComplianceRules(
        [
          {
            ruleKey: rule.ruleKey,
            name: rule.name,
            legalRef: rule.legalRef,
            description: rule.description,
            config: rule.config,
          },
        ],
        effectiveFrom
      );
      showToast(`${rule.name || 'Rule'} saved`, 'success');
      setEditingSection(null);
      await fetchAll();
    } catch (e) {
      console.error(e);
      showToast('Failed to save rule. Please try again.', 'error');
    } finally {
      setSavingSection(null);
    }
  };

  const handleSaveNssf = async () => {
    const effectiveFrom = await promptPolicySaveEffectiveDate(confirmEffectiveDate, {
      title: 'Save NSSF wage table?',
      description:
        'Choose when the NSSF assumed wage brackets take effect. The change is scheduled — it does not apply instantly.',
      confirmLabel: 'Save NSSF table',
      defaultEffectiveDate: nssfPolicyMeta.scheduledEffectiveFrom ?? nssfPolicyMeta.effectiveFrom ?? undefined,
    });
    if (!effectiveFrom) return;
    setSavingSection('nssf');
    try {
      await Api.payroll.saveNssfAssumedWageBrackets(nssfWageBrackets, effectiveFrom);
      showToast('NSSF wage table saved', 'success');
      setEditingSection(null);
      await fetchAll();
    } catch (e) {
      console.error(e);
      showToast('Failed to save NSSF wage table. Please try again.', 'error');
    } finally {
      setSavingSection(null);
    }
  };

  const sectionToolbar = (section: NonNullable<EditingSection>, onSave: () => void) => (
    <SectionEditToolbar
      canEdit={canEditRules}
      isEditing={editingSection === section}
      saving={savingSection === section}
      onEdit={() => void startEdit(section)}
      onCancel={() => void cancelEdit()}
      onSave={onSave}
    />
  );

  const activeRules = sortComplianceRules(complianceRules);
  const nssfRuleKeys = new Set(['nssf_occupational_risk', 'nssf_healthcare', 'nssf_pension']);
  const nssfRules = activeRules.filter((rule) => nssfRuleKeys.has(rule.ruleKey));
  const exchangeEditing = editingSection === 'exchange';
  const taxEditing = editingSection === 'tax';
  const nssfEditing = editingSection === 'nssf';
  const payrollExchangeRate =
    exchangeDetails.latestExchangeRateKhrPerUsd ?? exchangeDetails.exchangeRateKhrPerUsd;

  const rulesTabs = useMemo(
    () => [
      {
        id: 'tax' as const,
        label: t('nav.modules.pay-rules-tax') || 'Tax',
        icon: Calculator,
      },
      {
        id: 'nssf' as const,
        label: t('nav.modules.pay-rules-nssf') || 'NSSF',
        icon: Shield,
      },
      {
        id: 'allowance' as const,
        label: t('nav.modules.pay-rules-allowance') || 'Allowance',
        icon: Layers,
      },
      {
        id: 'unified' as const,
        label: t('nav.modules.pay-rules-work') || 'Work & leave',
        icon: GitBranch,
      },
      {
        id: 'seniority' as const,
        label: t('nav.modules.pay-rules-seniority') || 'Siniority',
        icon: Award,
      },
    ],
    [t]
  );

  return (
    <PayrollRulesCurrencyProvider exchangeRateKhrPerUsd={payrollExchangeRate}>
    <div className="space-y-6">
      <ConfirmDialogHost />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <UnderlineTabs
          value={activeTab}
          onChange={setActiveTab}
          tabs={rulesTabs}
          ariaLabel={t('payroll.rulesTab') || 'Payroll rules'}
        />
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <PayrollCurrencyToggle />
          <Badge variant="success" className="gap-1 shrink-0">
            <ShieldCheck className="w-3.5 h-3.5" />
            Engine Verified
          </Badge>
        </div>
      </div>

      <div className="space-y-6">
        {activeTab === 'tax' && (
          <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <div className="min-w-0 self-start w-full">
            <PayrollExchangeRateCard
              details={exchangeDetails}
              loading={loading}
              canEdit={canEditExchangeRate}
              isEditing={exchangeEditing}
              saving={savingSection === 'exchange'}
              draftRate={exchangeDraft}
              onDraftRateChange={setExchangeDraft}
              onEdit={() => void startEdit('exchange')}
              onCancel={() => void cancelEdit()}
              onSave={() => void handleSaveExchange()}
              compact
            />
          </div>

          <Card
            className={`min-w-0 flex flex-col border border-slate-200/80 dark:border-slate-700 shadow-sm overflow-hidden ${taxEditing ? 'ring-2 ring-primary-500/20' : ''}`}
          >
            <RulesConfigHelp help="payroll.taxBrackets" className="absolute top-3 right-3 z-20" />
            <div className={`${sectionHeaderClass} pr-11`}>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200 min-w-0">
                <BarChart3 className="w-4 h-4 shrink-0" />
                <span className="truncate">Tax on Salary (ToS)</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                {taxEditing && (
                  <Button size="sm" variant="outline" icon={<Plus className="w-4 h-4" />} onClick={addBracket}>
                    Add Bracket
                  </Button>
                )}
                <Badge variant="neutral" className="border border-slate-200 dark:border-slate-600">
                  GDT ToS
                </Badge>
                {sectionToolbar('tax', () => void handleSaveTax())}
              </div>
            </div>
            {taxEditing ? (
              <TaxBracketEditSection
                taxBrackets={taxBrackets}
                exchangeRateKhrPerUsd={payrollExchangeRate}
                updateBracket={updateBracket}
                removeBracket={removeBracket}
              />
            ) : (
              <div className="p-4 flex-1 min-w-0">
                <PayrollPolicyVersionMetaLine
                  className="text-[11px] text-slate-400 mb-2 truncate"
                  lastUpdatedAt={taxPolicyMeta.lastUpdatedAt}
                  effectiveFrom={taxPolicyMeta.effectiveFrom}
                  scheduledEffectiveFrom={taxPolicyMeta.scheduledEffectiveFrom}
                />
                <TaxBracketChart
                  loading={loading}
                  taxBrackets={taxBrackets}
                  height={TAX_CHART_HEIGHT_COMPACT}
                />
                <TaxBracketViewList taxBrackets={taxBrackets} />
              </div>
            )}
          </Card>
        </div>
          </>
        )}

        {activeTab === 'nssf' && (
          <>
            <NssfAssumedWageEditor
              mode={nssfEditing ? 'edit' : 'view'}
              loading={loading}
              brackets={nssfWageBrackets}
              onChange={setNssfWageBrackets}
              headerActions={sectionToolbar('nssf', () => void handleSaveNssf())}
            />

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 px-1 mb-3">
                NSSF rules
              </p>
              {loading && nssfRules.length === 0 ? (
                <Card className="border-none shadow-sm p-4">
                  <LoadingState variant="panel" layout="cards" label="Loading rules…" className="py-2" />
                </Card>
              ) : (
                <div className="space-y-4">
                  {nssfRules.map((rule) => {
                    const ruleEditing = editingSection === rule.ruleKey;
                    const toolbar = sectionToolbar(rule.ruleKey, () => void handleSaveRule(rule.ruleKey));
                    return ruleEditing ? (
                      <ComplianceRuleEditCard
                        key={rule.ruleKey}
                        rule={rule}
                        headerActions={toolbar}
                        onMetaChange={updateComplianceMeta}
                        onConfigChange={updateComplianceConfig}
                      />
                    ) : (
                      <ComplianceRuleViewCard key={rule.ruleKey} rule={rule} headerActions={toolbar} />
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'allowance' && (
          <AllowanceRulesSection canEdit={canEditRules} />
        )}

        {activeTab === 'seniority' && (
          <SeniorityRulesTabPanels canEdit={canEditRules} />
        )}

        {activeTab === 'unified' && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            <div className="min-w-0">
              <PayrollWorkDayPolicySection canEdit={canEditRules} compact />
            </div>
            <div className="min-w-0">
              <UnifiedPayrollRulesSection canEdit={canEditRules} />
            </div>
          </div>
        )}
      </div>
    </div>
    </PayrollRulesCurrencyProvider>
  );
};

export const PayrollRules: React.FC = () => <PayrollRulesContent />;

export default PayrollRules;
