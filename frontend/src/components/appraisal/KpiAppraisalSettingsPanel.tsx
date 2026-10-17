import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useUrlSyncedTab } from '../../hooks/useUrlSyncedTab';
import {
  Plus,
  Calendar,
  Layers,
  Trash2,
  Edit2,
  Save,
  SlidersHorizontal,
  Gauge,
} from 'lucide-react';
import { LoadingState } from '../common/LoadingState';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { ActiveStatusControl } from '../ui/ActiveStatusControl';
import { StatusLabel } from '../ui/StatusLabel';
import { Modal } from '../ui/Modal';
import { ResponsiveRowActions } from '../ui/ResponsiveRowActions';
import {
  ModalField,
  ModalFieldGrid,
  ModalFormSection,
  modalInputClass,
} from '../ui/ModalForm';
import { RulesConfigHelp } from '../ui/RulesConfigHelp';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { KpiGradeSettingsPanel } from '../settings/KpiGradeSettingsPanel';
import type {
  AppraisalPeriod,
  AppraisalPeriodType,
  AttendanceDeductionRule,
  KpiComponent,
  KpiPolicySettings,
  RecommendationRule,
} from '../../types/appraisal';
import { isAppraisalPeriodEnabled, PERIOD_TYPE_LABELS } from '../../types/appraisal';
import { orderInclusiveStartEnd } from '../../utils/dateRangeFilter';
import { DatePickerInput } from '@/components/ui/shadcn/date-picker-input';
import { promptActiveStatusChange } from '../../utils/activeStatusChange';
import { todayYmdInCompanyTz } from '../../utils/companyCalendar';
import {
  coerceFiniteNumber,
  numberInputFromRaw,
  type NumberInputValue,
} from '../../utils/formInputFilters';
import { cn } from '../../utils';
import { NumericField } from '../ui/NumericField';
import {
  sortRowsByColumn,
  SortableTableHeader,
  useListColumnSort,
} from '../../utils/listColumnSort';

type PeriodSortCol = 'name' | 'type' | 'reviewWindow' | 'alert' | 'workflow' | 'status';
type ComponentSortCol = 'name' | 'weight' | 'method' | 'autoMetric' | 'effectiveFrom' | 'status';
type AttRuleSortCol = 'type' | 'mode' | 'min' | 'max' | 'deduction';
type ComponentDraftSortCol = 'name' | 'weight' | 'method' | 'autoMetric' | 'effectiveFrom' | 'active';
type AttRuleDraftSortCol = 'type' | 'mode' | 'min' | 'max' | 'deduction';

const periodThClass = 'px-6 py-3 text-xs uppercase text-slate-500';
const componentThClass = 'px-6 py-3 text-xs uppercase text-slate-500';
const attRuleThClass = 'px-4 py-2 text-xs uppercase text-slate-500';
const componentDraftThClass = 'py-2 px-2 text-xs uppercase text-slate-500';
const attRuleDraftThClass = 'py-2 px-2 text-xs uppercase text-slate-500';

const PERIOD_TYPES: AppraisalPeriodType[] = ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL'];

type PeriodFormState = {
  name: string;
  periodType: AppraisalPeriodType;
  startDate: string;
  endDate: string;
  alertNotificationDate: string;
  status: 'active' | 'inactive';
};

type ComponentDraft = {
  key: string;
  id: string;
  name: string;
  description: string;
  weightPercent: NumberInputValue;
  scoringMethod: KpiComponent['scoring_method'];
  autoMetric: KpiComponent['auto_metric'];
  effectiveFrom: string;
  active: boolean;
};

type AttRuleDraft = Omit<AttendanceDeductionRule, 'min_count' | 'max_count' | 'deduction_points'> & {
  min_count: NumberInputValue;
  max_count: number | null | '';
  deduction_points: NumberInputValue;
};

type ConfigSection = 'periods' | 'components' | 'rules' | 'grades';
const CONFIG_SECTION_IDS = ['periods', 'components', 'rules', 'grades'] as const;

const CONFIG_SECTIONS: Array<{ id: ConfigSection; label: string }> = [
  { id: 'periods', label: 'Periods' },
  { id: 'components', label: 'KPI components' },
  { id: 'rules', label: 'Scoring rules' },
  { id: 'grades', label: 'Grade scale' },
];

function emptyPeriodForm(): PeriodFormState {
  return {
    name: '',
    periodType: 'QUARTERLY',
    startDate: '',
    endDate: '',
    alertNotificationDate: '',
    status: 'active',
  };
}

function periodToForm(p: AppraisalPeriod): PeriodFormState {
  return {
    name: p.name,
    periodType: p.period_type,
    startDate: String(p.start_date).slice(0, 10),
    endDate: String(p.end_date).slice(0, 10),
    alertNotificationDate: p.alert_notification_date
      ? String(p.alert_notification_date).slice(0, 10)
      : '',
    status: isAppraisalPeriodEnabled(p) ? 'active' : 'inactive',
  };
}

function newComponentId(): string {
  return `kpi-custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function toComponentDraft(c: KpiComponent): ComponentDraft {
  return {
    key: c.id,
    id: c.id,
    name: c.name,
    description: c.description ?? '',
    weightPercent: Number(c.weight_percent) || 0,
    scoringMethod: c.scoring_method,
    autoMetric: c.auto_metric,
    effectiveFrom: c.effective_from ? String(c.effective_from).slice(0, 10) : '',
    active: Number(c.active) === 1,
  };
}

function emptyComponentDraft(): ComponentDraft {
  const id = newComponentId();
  return {
    key: id,
    id,
    name: '',
    description: '',
    weightPercent: '',
    scoringMethod: 'MANUAL',
    autoMetric: null,
    effectiveFrom: todayYmdInCompanyTz(),
    active: true,
  };
}

function toAttRuleDraft(r: AttendanceDeductionRule): AttRuleDraft {
  return {
    ...r,
    min_count: Number(r.min_count) || 0,
    max_count: r.max_count,
    deduction_points: Number(r.deduction_points) || 0,
  };
}

function periodTypeLabel(period: AppraisalPeriod): string {
  const raw = period.period_type ?? (period as { periodType?: string }).periodType ?? '';
  const key = String(raw).toUpperCase() as AppraisalPeriodType;
  return PERIOD_TYPE_LABELS[key] ?? (raw ? String(raw) : '—');
}

function formatPeriodStatus(status: string): string {
  return String(status)
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatPeriodDate(value?: string | null) {
  return value ? String(value).slice(0, 10) : '';
}

export const KpiAppraisalSettingsPanel: React.FC = () => {
  const { showToast } = useToast();
  const { confirm, confirmEffectiveDate, ConfirmDialogHost } = useConfirmDialog();
  const [section, setSection] = useUrlSyncedTab<ConfigSection>({
    values: CONFIG_SECTION_IDS,
    defaultValue: 'periods',
    param: 'section',
  });
  const [periods, setPeriods] = useState<AppraisalPeriod[]>([]);
  const [components, setComponents] = useState<KpiComponent[]>([]);
  const [weightError, setWeightError] = useState<string | null>(null);
  const [attRules, setAttRules] = useState<AttendanceDeductionRule[]>([]);
  const [recRules, setRecRules] = useState<RecommendationRule[]>([]);
  const [policy, setPolicy] = useState<KpiPolicySettings>({ manualCommentThreshold: 60 });
  const [loading, setLoading] = useState(true);

  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<AppraisalPeriod | null>(null);
  const [periodForm, setPeriodForm] = useState<PeriodFormState>(emptyPeriodForm());
  const [periodBaseline, setPeriodBaseline] = useState<string | null>(null);
  const [periodSaving, setPeriodSaving] = useState(false);
  const [deletePeriodTarget, setDeletePeriodTarget] = useState<AppraisalPeriod | null>(null);
  const [togglingPeriodId, setTogglingPeriodId] = useState<string | null>(null);

  const [componentModalOpen, setComponentModalOpen] = useState(false);
  const [componentsDraft, setComponentsDraft] = useState<ComponentDraft[]>([]);
  const [componentsBaseline, setComponentsBaseline] = useState<string | null>(null);
  const [componentSaving, setComponentSaving] = useState(false);

  const [rulesModalOpen, setRulesModalOpen] = useState(false);
  const [rulesDraftPolicy, setRulesDraftPolicy] = useState<{
    manualCommentThreshold: NumberInputValue;
  }>({
    manualCommentThreshold: 60,
  });
  const [rulesDraftAtt, setRulesDraftAtt] = useState<AttRuleDraft[]>([]);
  const [rulesBaseline, setRulesBaseline] = useState<string | null>(null);
  const [rulesSaving, setRulesSaving] = useState(false);

  const periodDirty =
    periodModalOpen && periodBaseline != null && JSON.stringify(periodForm) !== periodBaseline;
  const componentsDirty =
    componentModalOpen &&
    componentsBaseline != null &&
    JSON.stringify(componentsDraft) !== componentsBaseline;
  const rulesDirty =
    rulesModalOpen &&
    rulesBaseline != null &&
    JSON.stringify({ policy: rulesDraftPolicy, att: rulesDraftAtt }) !== rulesBaseline;

  const { confirmDiscardIfDirty } = useUnsavedChangesGuard({
    isDirty: periodDirty || componentsDirty || rulesDirty,
    confirm,
  });
  const {
    sortBy: periodSortBy,
    sortOrder: periodSortOrder,
    toggleSort: togglePeriodSort,
  } = useListColumnSort<PeriodSortCol>();
  const {
    sortBy: componentSortBy,
    sortOrder: componentSortOrder,
    toggleSort: toggleComponentSort,
  } = useListColumnSort<ComponentSortCol>();
  const {
    sortBy: attRuleSortBy,
    sortOrder: attRuleSortOrder,
    toggleSort: toggleAttRuleSort,
  } = useListColumnSort<AttRuleSortCol>();
  const {
    sortBy: componentDraftSortBy,
    sortOrder: componentDraftSortOrder,
    toggleSort: toggleComponentDraftSort,
  } = useListColumnSort<ComponentDraftSortCol>();
  const {
    sortBy: attRuleDraftSortBy,
    sortOrder: attRuleDraftSortOrder,
    toggleSort: toggleAttRuleDraftSort,
  } = useListColumnSort<AttRuleDraftSortCol>();

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const [p, c, r, pol, rec] = await Promise.all([
        Api.appraisal.getPeriods(),
        Api.appraisal.getComponents(),
        Api.appraisal.getAttendanceRules(),
        Api.appraisal.getPolicy(),
        Api.appraisal.getRecommendationRules(),
      ]);
      setPeriods(Array.isArray(p) ? (p as AppraisalPeriod[]) : []);
      const compRes = c as { components?: KpiComponent[]; weightError?: string | null };
      setComponents(compRes.components ?? []);
      setWeightError(compRes.weightError ?? null);
      const ruleRes = r as { rules?: AttendanceDeductionRule[] };
      setAttRules(ruleRes.rules ?? []);
      setPolicy(pol as KpiPolicySettings);
      const recRes = rec as { rules?: RecommendationRule[] };
      setRecRules(recRes.rules ?? []);
    } catch {
      showToast('Could not load KPI settings', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedPeriods = useMemo(() => {
    const getSortValue = (p: AppraisalPeriod, col: PeriodSortCol): string | number => {
      switch (col) {
        case 'name':
          return p.name;
        case 'type':
          return periodTypeLabel(p);
        case 'reviewWindow':
          return String(p.start_date).slice(0, 10);
        case 'alert':
          return p.alert_notification_date ? String(p.alert_notification_date).slice(0, 10) : '';
        case 'workflow':
          return formatPeriodStatus(p.status);
        case 'status':
          return isAppraisalPeriodEnabled(p) ? 0 : 1;
        default:
          return '';
      }
    };
    const applyDefaultSort = (rows: AppraisalPeriod[]) =>
      rows.sort((a, b) => {
        const aActive = isAppraisalPeriodEnabled(a) ? 0 : 1;
        const bActive = isAppraisalPeriodEnabled(b) ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return String(b.start_date).localeCompare(String(a.start_date));
      });
    return sortRowsByColumn(periods, periodSortBy, periodSortOrder, getSortValue, applyDefaultSort);
  }, [periods, periodSortBy, periodSortOrder]);

  const sortedComponents = useMemo(() => {
    const getSortValue = (c: KpiComponent, col: ComponentSortCol): string | number => {
      switch (col) {
        case 'name':
          return c.name;
        case 'weight':
          return Number(c.weight_percent);
        case 'method':
          return c.scoring_method;
        case 'autoMetric':
          return c.auto_metric ?? '';
        case 'effectiveFrom':
          return c.effective_from ? String(c.effective_from).slice(0, 10) : '';
        case 'status':
          return Number(c.active) === 1 ? 0 : 1;
        default:
          return '';
      }
    };
    const applyDefaultSort = (rows: KpiComponent[]) =>
      rows.sort((a, b) => {
        const aActive = Number(a.active) === 1 ? 0 : 1;
        const bActive = Number(b.active) === 1 ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return Number(a.sort_order) - Number(b.sort_order);
      });
    return sortRowsByColumn(
      components,
      componentSortBy,
      componentSortOrder,
      getSortValue,
      applyDefaultSort
    );
  }, [components, componentSortBy, componentSortOrder]);

  const sortedAttRules = useMemo(() => {
    const getSortValue = (r: AttendanceDeductionRule, col: AttRuleSortCol): string | number => {
      switch (col) {
        case 'type':
          return r.rule_type;
        case 'mode':
          return r.deduction_mode || 'RANGE';
        case 'min':
          return Number(r.min_count);
        case 'max':
          return r.max_count ?? Number.MAX_SAFE_INTEGER;
        case 'deduction':
          return Number(r.deduction_points);
        default:
          return '';
      }
    };
    return sortRowsByColumn(attRules, attRuleSortBy, attRuleSortOrder, getSortValue);
  }, [attRules, attRuleSortBy, attRuleSortOrder]);

  const sortedComponentsDraft = useMemo(() => {
    const indexed = componentsDraft.map((row, index) => ({ row, index }));
    const getSortValue = (
      item: { row: ComponentDraft; index: number },
      col: ComponentDraftSortCol
    ): string | number => {
      const c = item.row;
      switch (col) {
        case 'name':
          return c.name;
        case 'weight':
          return coerceFiniteNumber(c.weightPercent, 0);
        case 'method':
          return c.scoringMethod;
        case 'autoMetric':
          return c.autoMetric ?? '';
        case 'effectiveFrom':
          return c.effectiveFrom;
        case 'active':
          return c.active ? 0 : 1;
        default:
          return '';
      }
    };
    return sortRowsByColumn(
      indexed,
      componentDraftSortBy,
      componentDraftSortOrder,
      getSortValue
    );
  }, [componentsDraft, componentDraftSortBy, componentDraftSortOrder]);

  const sortedRulesDraftAtt = useMemo(() => {
    const indexed = rulesDraftAtt.map((row, index) => ({ row, index }));
    const getSortValue = (
      item: { row: AttRuleDraft; index: number },
      col: AttRuleDraftSortCol
    ): string | number => {
      const r = item.row;
      switch (col) {
        case 'type':
          return r.rule_type;
        case 'mode':
          return r.deduction_mode || 'RANGE';
        case 'min':
          return typeof r.min_count === 'number' ? r.min_count : coerceFiniteNumber(r.min_count, 0);
        case 'max':
          return r.max_count === '' || r.max_count == null
            ? Number.MAX_SAFE_INTEGER
            : Number(r.max_count);
        case 'deduction':
          return typeof r.deduction_points === 'number'
            ? r.deduction_points
            : coerceFiniteNumber(r.deduction_points, 0);
        default:
          return '';
      }
    };
    return sortRowsByColumn(
      indexed,
      attRuleDraftSortBy,
      attRuleDraftSortOrder,
      getSortValue
    );
  }, [rulesDraftAtt, attRuleDraftSortBy, attRuleDraftSortOrder]);

  const activeWeightTotal = useMemo(
    () =>
      components
        .filter((c) => Number(c.active) === 1)
        .reduce((s, c) => s + Number(c.weight_percent), 0),
    [components]
  );

  const buildComponentsPayload = (rows: ComponentDraft[]) =>
    rows.map((c, i) => ({
      id: c.id.startsWith('kpi-custom-') ? undefined : c.id,
      name: c.name.trim() || `Custom KPI ${i + 1}`,
      description: c.description.trim() || null,
      weightPercent: coerceFiniteNumber(c.weightPercent, 0),
      scoringMethod: c.scoringMethod,
      autoMetric: c.scoringMethod === 'AUTOMATIC' ? c.autoMetric || 'ATTENDANCE' : null,
      sortOrder: i + 1,
      active: c.active,
      effectiveFrom:
        c.active && !c.effectiveFrom.trim()
          ? todayYmdInCompanyTz()
          : c.effectiveFrom.trim() || null,
    }));

  const draftActiveWeightTotal = useMemo(
    () =>
      componentsDraft
        .filter((c) => c.active)
        .reduce((s, c) => s + coerceFiniteNumber(c.weightPercent, 0), 0),
    [componentsDraft]
  );

  const validateComponentsDraft = (rows: ComponentDraft[]): string | null => {
    if (!rows.length) return 'At least one KPI component is required';
    if (!rows.some((c) => c.active)) return 'At least one active KPI component is required';
    for (const c of rows) {
      if (!c.name.trim()) return 'Each component needs a name';
      if (c.weightPercent === '') return `Weight % is required for "${c.name.trim() || 'Untitled'}"`;
      const w = coerceFiniteNumber(c.weightPercent, -1);
      if (w < 0 || w > 100) return `Weight % for "${c.name.trim()}" must be between 0 and 100`;
    }
    const total = rows
      .filter((c) => c.active)
      .reduce((s, c) => s + coerceFiniteNumber(c.weightPercent, 0), 0);
    if (Math.abs(total - 100) > 0.01) {
      return `Active weights must total 100% when you save (currently ${total.toFixed(1)}%)`;
    }
    return null;
  };

  /* ─── Periods ─── */

  const openAddPeriod = () => {
    const next = emptyPeriodForm();
    setEditingPeriod(null);
    setPeriodForm(next);
    setPeriodBaseline(JSON.stringify(next));
    setPeriodModalOpen(true);
  };

  const openEditPeriod = (period: AppraisalPeriod) => {
    const next = periodToForm(period);
    setEditingPeriod(period);
    setPeriodForm(next);
    setPeriodBaseline(JSON.stringify(next));
    setPeriodModalOpen(true);
  };

  const requestClosePeriodModal = async () => {
    if (!(await confirmDiscardIfDirty())) return;
    setPeriodModalOpen(false);
    setEditingPeriod(null);
    setPeriodBaseline(null);
  };

  const submitPeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!periodForm.name.trim() || !periodForm.startDate || !periodForm.endDate) {
      showToast('Period name and dates are required', 'error');
      return;
    }
    if (periodForm.startDate > periodForm.endDate) {
      showToast('Start date must be on or before end date', 'error');
      return;
    }
    if (periodForm.alertNotificationDate && periodForm.alertNotificationDate < periodForm.startDate) {
      showToast('Alert date must be on or after the period start date', 'error');
      return;
    }

    const nextActive = periodForm.status === 'active';
    const prevActive = editingPeriod ? isAppraisalPeriodEnabled(editingPeriod) : true;
    let effectiveFrom: string | null = null;
    if (editingPeriod && prevActive !== nextActive) {
      effectiveFrom = await promptActiveStatusChange(confirmEffectiveDate, {
        entityLabel: 'appraisal period',
        entityName: periodForm.name || 'this period',
        nextActive,
      });
      if (!effectiveFrom) return;
    }

    if (editingPeriod && Number(editingPeriod.appraisal_count ?? 0) > 0) {
      const windowChanged =
        periodForm.startDate !== String(editingPeriod.start_date).slice(0, 10) ||
        periodForm.endDate !== String(editingPeriod.end_date).slice(0, 10);
      const ok = await confirm({
        title: 'Update period in use?',
        description: windowChanged
          ? `This period already has ${editingPeriod.appraisal_count} employee appraisal(s). Review-window changes will recalculate unlocked appraisal scores.`
          : `This period already has ${editingPeriod.appraisal_count} employee appraisal(s). Saving will update it for all linked appraisals.`,
        variant: 'danger',
        confirmLabel: 'Save changes',
      });
      if (!ok) return;
    }

    setPeriodSaving(true);
    try {
      if (editingPeriod) {
        const res = (await Api.appraisal.updatePeriod(editingPeriod.id, {
          name: periodForm.name.trim(),
          periodType: periodForm.periodType,
          startDate: periodForm.startDate,
          endDate: periodForm.endDate,
          alertNotificationDate: periodForm.alertNotificationDate.trim() || null,
          isActive: nextActive ? 1 : 0,
          ...(effectiveFrom ? { effective_from: effectiveFrom } : {}),
        })) as { recalc?: { refreshed?: number; skippedLocked?: number } };
        const refreshed = Number(res?.recalc?.refreshed ?? 0);
        const skipped = Number(res?.recalc?.skippedLocked ?? 0);
        const extra =
          refreshed > 0 || skipped > 0
            ? ` Recalculated ${refreshed} appraisal${refreshed === 1 ? '' : 's'}${
                skipped ? ` (${skipped} locked skipped)` : ''
              }.`
            : '';
        showToast(`Appraisal period saved.${extra}`, 'success');
      } else {
        await Api.appraisal.createPeriod({
          name: periodForm.name.trim(),
          periodType: periodForm.periodType,
          startDate: periodForm.startDate,
          endDate: periodForm.endDate,
          alertNotificationDate: periodForm.alertNotificationDate.trim() || null,
          status: 'DRAFT',
          isActive: nextActive ? 1 : 0,
        });
        showToast('Appraisal period created', 'success');
      }
      setPeriodModalOpen(false);
      setEditingPeriod(null);
      setPeriodBaseline(null);
      await load({ silent: true });
    } catch (err: unknown) {
      showToast((err as Error)?.message || 'Failed to save period', 'error');
    } finally {
      setPeriodSaving(false);
    }
  };

  const togglePeriodActive = async (period: AppraisalPeriod) => {
    const currentlyEnabled = isAppraisalPeriodEnabled(period);
    const nextEnabled = !currentlyEnabled;
    const effectiveFrom = await promptActiveStatusChange(confirmEffectiveDate, {
      entityLabel: 'appraisal period',
      entityName: period.name,
      nextActive: nextEnabled,
    });
    if (!effectiveFrom) return;
    setTogglingPeriodId(period.id);
    try {
      await Api.appraisal.updatePeriod(period.id, {
        isActive: nextEnabled ? 1 : 0,
        ...(effectiveFrom ? { effective_from: effectiveFrom } : {}),
      } as Parameters<typeof Api.appraisal.updatePeriod>[1] & { effective_from?: string });
      showToast(nextEnabled ? 'Appraisal period enabled' : 'Appraisal period disabled', 'success');
      await load({ silent: true });
    } catch (err: unknown) {
      showToast((err as Error)?.message || 'Failed to update period', 'error');
    } finally {
      setTogglingPeriodId(null);
    }
  };

  const confirmDeletePeriod = async () => {
    const period = deletePeriodTarget;
    if (!period) return;
    try {
      const res = (await Api.appraisal.deletePeriod(period.id)) as { deletedAppraisals?: number };
      const deleted = Number(res?.deletedAppraisals ?? 0);
      showToast(
        deleted > 0
          ? `Period deleted. Reverted ${deleted} employee appraisal${deleted === 1 ? '' : 's'}.`
          : 'Appraisal period deleted',
        'success'
      );
      setDeletePeriodTarget(null);
      await load({ silent: true });
    } catch (err: unknown) {
      showToast((err as Error)?.message || 'Failed to delete period', 'error');
    }
  };

  /* ─── Components (batch edit like Scoring rules) ─── */

  const openComponentsModal = () => {
    const draft = components.length
      ? components.map(toComponentDraft)
      : [emptyComponentDraft()];
    setComponentsDraft(draft);
    setComponentsBaseline(JSON.stringify(draft));
    setComponentModalOpen(true);
  };

  const requestCloseComponentsModal = async () => {
    if (!(await confirmDiscardIfDirty())) return;
    setComponentModalOpen(false);
    setComponentsBaseline(null);
  };

  const updateComponentDraft = (key: string, patch: Partial<ComponentDraft>) => {
    setComponentsDraft((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row))
    );
  };

  const addComponentDraftRow = () => {
    setComponentsDraft((prev) => [...prev, emptyComponentDraft()]);
  };

  const removeComponentDraftRow = (key: string) => {
    setComponentsDraft((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((row) => row.key !== key);
    });
  };

  const submitComponents = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateComponentsDraft(componentsDraft);
    if (err) {
      showToast(err, 'error');
      return;
    }
    setComponentSaving(true);
    try {
      const res = (await Api.appraisal.saveComponents(
        buildComponentsPayload(componentsDraft)
      )) as { components: KpiComponent[]; weightError?: string | null };
      setComponents(res.components ?? []);
      setWeightError(res.weightError ?? null);
      showToast('KPI components saved', 'success');
      setComponentModalOpen(false);
      setComponentsBaseline(null);
      await load({ silent: true });
    } catch (err: unknown) {
      showToast((err as Error)?.message || 'Failed to save components', 'error');
    } finally {
      setComponentSaving(false);
    }
  };

  /* ─── Scoring rules ─── */

  const openRulesModal = () => {
    const policyDraft = {
      manualCommentThreshold: Number(policy.manualCommentThreshold) || 60,
    };
    const attDraft = attRules.map(toAttRuleDraft);
    setRulesDraftPolicy(policyDraft);
    setRulesDraftAtt(attDraft);
    setRulesBaseline(JSON.stringify({ policy: policyDraft, att: attDraft }));
    setRulesModalOpen(true);
  };

  const requestCloseRulesModal = async () => {
    if (!(await confirmDiscardIfDirty())) return;
    setRulesModalOpen(false);
    setRulesBaseline(null);
  };

  const submitRules = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rulesDraftPolicy.manualCommentThreshold === '') {
      showToast('Comment threshold is required', 'error');
      return;
    }
    const threshold = coerceFiniteNumber(rulesDraftPolicy.manualCommentThreshold, -1);
    if (threshold < 0 || threshold > 100) {
      showToast('Comment threshold must be between 0 and 100', 'error');
      return;
    }
    for (const r of rulesDraftAtt) {
      if (r.min_count === '' || r.deduction_points === '') {
        showToast(`Fill min and deduction for ${r.rule_type}`, 'error');
        return;
      }
    }
    setRulesSaving(true);
    try {
      const saved = (await Api.appraisal.savePolicy({
        manualCommentThreshold: threshold,
      })) as KpiPolicySettings;
      setPolicy(saved);
      const payload = rulesDraftAtt.map((r, i) => ({
        id: r.id,
        ruleType: r.rule_type,
        minCount: coerceFiniteNumber(r.min_count, 0),
        maxCount: r.max_count === '' || r.max_count == null ? null : Number(r.max_count),
        deductionPoints: coerceFiniteNumber(r.deduction_points, 0),
        deductionMode: r.deduction_mode || 'RANGE',
        sortOrder: i + 1,
        active: Number(r.active) === 1,
      }));
      const res = (await Api.appraisal.saveAttendanceRules(payload)) as {
        rules: AttendanceDeductionRule[];
      };
      setAttRules(res.rules ?? []);
      showToast('Scoring rules saved', 'success');
      setRulesModalOpen(false);
      setRulesBaseline(null);
      await load({ silent: true });
    } catch (err: unknown) {
      showToast((err as Error)?.message || 'Failed to save scoring rules', 'error');
    } finally {
      setRulesSaving(false);
    }
  };

  const updateRulesDraftAtt = (index: number, patch: Partial<AttRuleDraft>) => {
    setRulesDraftAtt((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  return (
    <div className="space-y-4">
      <ConfirmDialogHost />

      <div className="flex flex-wrap gap-2">
        {CONFIG_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              section === s.id
                ? 'bg-primary-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-xl sm:rounded-2xl border bg-white dark:bg-slate-800 p-4 sm:p-6">
          <LoadingState variant="panel" layout="table" rows={5} label="Loading KPI configuration…" />
        </div>
      ) : null}

      {!loading && section === 'periods' && (
        <div className="relative surface-card shadow-sm overflow-hidden">
          <RulesConfigHelp help="kpi.appraisalPeriods" className="absolute top-3 right-3 z-10" />
          <div className="flex flex-row flex-wrap items-center justify-between gap-2 px-3 py-2 pr-12 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2 min-w-0">
              <Calendar className="w-5 h-5 text-primary-600 shrink-0" aria-hidden />
              <h3 className="text-lg font-bold text-slate-900 dark:text-white min-w-0">
                Appraisal periods
              </h3>
              <Badge variant="neutral" className="border border-slate-200 dark:border-slate-600 shrink-0">
                {periods.length}
              </Badge>
            </div>
            <Button onClick={openAddPeriod} className="w-auto shrink-0">
              <Plus className="w-4 h-4 mr-1" /> Add New Period
            </Button>
          </div>

          {sortedPeriods.length === 0 ? (
            <p className="p-8 text-center text-slate-500">
              No appraisal periods configured. Click &quot;Add New Period&quot; to get started.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500">
                  <tr>
                    <SortableTableHeader
                      label="Period name"
                      column="name"
                      sortBy={periodSortBy}
                      sortOrder={periodSortOrder}
                      onToggle={togglePeriodSort}
                      className={periodThClass}
                    />
                    <SortableTableHeader
                      label="Type"
                      column="type"
                      sortBy={periodSortBy}
                      sortOrder={periodSortOrder}
                      onToggle={togglePeriodSort}
                      className={periodThClass}
                    />
                    <SortableTableHeader
                      label="Review window"
                      column="reviewWindow"
                      sortBy={periodSortBy}
                      sortOrder={periodSortOrder}
                      onToggle={togglePeriodSort}
                      className={periodThClass}
                    />
                    <SortableTableHeader
                      label="Alert"
                      column="alert"
                      sortBy={periodSortBy}
                      sortOrder={periodSortOrder}
                      onToggle={togglePeriodSort}
                      className={periodThClass}
                    />
                    <SortableTableHeader
                      label="Workflow"
                      column="workflow"
                      sortBy={periodSortBy}
                      sortOrder={periodSortOrder}
                      onToggle={togglePeriodSort}
                      className={periodThClass}
                    />
                    <SortableTableHeader
                      label="Status"
                      column="status"
                      sortBy={periodSortBy}
                      sortOrder={periodSortOrder}
                      onToggle={togglePeriodSort}
                      className={periodThClass}
                    />
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sortedPeriods.map((p) => {
                    const enabled = isAppraisalPeriodEnabled(p);
                    return (
                      <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="truncate">{p.name}</span>
                            {!enabled ? (
                              <Badge variant="neutral" className="shrink-0 text-[10px]">
                                Disabled
                              </Badge>
                            ) : null}
                          </div>
                          {Number(p.appraisal_count ?? 0) > 0 ? (
                            <p className="text-[10px] text-slate-500 mt-0.5">
                              {p.appraisal_count} appraisal{p.appraisal_count === 1 ? '' : 's'}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                          {periodTypeLabel(p)}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">
                          {formatPeriodDate(p.start_date)}
                          <span className="mx-1.5 text-slate-400">→</span>
                          {formatPeriodDate(p.end_date)}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400 tabular-nums">
                          {p.alert_notification_date ? (
                            <span>
                              {formatPeriodDate(p.alert_notification_date)}
                              {p.alert_notification_sent_at ? (
                                <span className="ml-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                                  Notified
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <StatusLabel
                            status={p.status}
                            context="appraisal"
                            label={formatPeriodStatus(p.status)}
                            size="sm"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <ActiveStatusControl
                            active={enabled}
                            loading={togglingPeriodId === p.id}
                            disabled={togglingPeriodId === p.id}
                            onRequestToggle={() => void togglePeriodActive(p)}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <ResponsiveRowActions
                            menuLabel="Period actions"
                            actions={[
                              {
                                key: 'edit',
                                label: 'Edit period',
                                icon: <Edit2 className="w-4 h-4" />,
                                onClick: () => openEditPeriod(p),
                              },
                              {
                                key: 'delete',
                                label: 'Delete period',
                                icon: <Trash2 className="w-4 h-4" />,
                                destructive: true,
                                onClick: () => setDeletePeriodTarget(p),
                              },
                            ]}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!loading && section === 'components' && (
        <div className="relative surface-card shadow-sm overflow-hidden">
          <div className="flex flex-row flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-primary-600 shrink-0" aria-hidden />
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">KPI components</h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 pl-7">
                Active weights total:{' '}
                <span
                  className={
                    Math.abs(activeWeightTotal - 100) > 0.01
                      ? 'text-red-600 font-bold'
                      : 'text-green-600 font-bold'
                  }
                >
                  {activeWeightTotal.toFixed(1)}%
                </span>
                {weightError ? <span className="text-red-600 ml-2">{weightError}</span> : null}
              </p>
            </div>
            <Button onClick={openComponentsModal} variant="outline" className="w-auto shrink-0">
              <Edit2 className="w-4 h-4 mr-1" /> Edit KPI components
            </Button>
          </div>

          {sortedComponents.length === 0 ? (
            <p className="p-8 text-center text-slate-500">
              No KPI components configured. Click &quot;Edit KPI components&quot; to get started.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500">
                  <tr>
                    <SortableTableHeader
                      label="Component"
                      column="name"
                      sortBy={componentSortBy}
                      sortOrder={componentSortOrder}
                      onToggle={toggleComponentSort}
                      className={componentThClass}
                    />
                    <SortableTableHeader
                      label="Weight %"
                      column="weight"
                      sortBy={componentSortBy}
                      sortOrder={componentSortOrder}
                      onToggle={toggleComponentSort}
                      className={componentThClass}
                    />
                    <SortableTableHeader
                      label="Method"
                      column="method"
                      sortBy={componentSortBy}
                      sortOrder={componentSortOrder}
                      onToggle={toggleComponentSort}
                      className={componentThClass}
                    />
                    <SortableTableHeader
                      label="Auto metric"
                      column="autoMetric"
                      sortBy={componentSortBy}
                      sortOrder={componentSortOrder}
                      onToggle={toggleComponentSort}
                      className={componentThClass}
                    />
                    <SortableTableHeader
                      label="Effective from"
                      column="effectiveFrom"
                      sortBy={componentSortBy}
                      sortOrder={componentSortOrder}
                      onToggle={toggleComponentSort}
                      className={componentThClass}
                    />
                    <SortableTableHeader
                      label="Status"
                      column="status"
                      sortBy={componentSortBy}
                      sortOrder={componentSortOrder}
                      onToggle={toggleComponentSort}
                      className={componentThClass}
                    />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sortedComponents.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">
                        {c.name}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{Number(c.weight_percent).toFixed(2)}</td>
                      <td className="px-3 py-2 capitalize">{c.scoring_method.toLowerCase()}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {c.scoring_method === 'AUTOMATIC'
                          ? c.auto_metric === 'TASK_COMPLETION'
                            ? 'Task completion'
                            : 'Attendance'
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-500 tabular-nums">
                        {c.effective_from ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        {Number(c.active) === 1 ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="neutral">Inactive</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!loading && section === 'rules' && (
        <div className="space-y-4">
          <div className="relative surface-card shadow-sm overflow-hidden">
            <RulesConfigHelp help="kpi.scoringRules" className="absolute top-3 right-3 z-10" />
            <div className="flex flex-row flex-wrap items-center justify-between gap-2 px-3 py-2 pr-12 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 min-w-0">
                <Gauge className="w-5 h-5 text-primary-600 shrink-0" aria-hidden />
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Scoring rules</h3>
                  <p className="text-xs text-slate-500">
                    Manual comment threshold and attendance deductions
                  </p>
                </div>
              </div>
              <Button onClick={openRulesModal} variant="outline" className="w-auto shrink-0">
                <Edit2 className="w-4 h-4 mr-1" /> Edit scoring rules
              </Button>
            </div>

            <div className="p-4 sm:p-5 space-y-5">
              <div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">
                  Manual scoring policy
                </h4>
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  Comment threshold: <strong>{policy.manualCommentThreshold}%</strong>
                </p>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
                  Attendance deduction rules
                </h4>
                {attRules.length === 0 ? (
                  <p className="text-sm text-slate-500">No attendance deduction rules configured.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500">
                        <tr>
                          <SortableTableHeader
                            label="Type"
                            column="type"
                            sortBy={attRuleSortBy}
                            sortOrder={attRuleSortOrder}
                            onToggle={toggleAttRuleSort}
                            className={attRuleThClass}
                          />
                          <SortableTableHeader
                            label="Mode"
                            column="mode"
                            sortBy={attRuleSortBy}
                            sortOrder={attRuleSortOrder}
                            onToggle={toggleAttRuleSort}
                            className={attRuleThClass}
                          />
                          <SortableTableHeader
                            label="Min"
                            column="min"
                            sortBy={attRuleSortBy}
                            sortOrder={attRuleSortOrder}
                            onToggle={toggleAttRuleSort}
                            className={attRuleThClass}
                          />
                          <SortableTableHeader
                            label="Max"
                            column="max"
                            sortBy={attRuleSortBy}
                            sortOrder={attRuleSortOrder}
                            onToggle={toggleAttRuleSort}
                            className={attRuleThClass}
                          />
                          <SortableTableHeader
                            label="Deduction"
                            column="deduction"
                            sortBy={attRuleSortBy}
                            sortOrder={attRuleSortOrder}
                            onToggle={toggleAttRuleSort}
                            className={attRuleThClass}
                          />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {sortedAttRules.map((r) => (
                          <tr key={r.id}>
                            <td className="px-4 py-2 font-medium text-slate-900 dark:text-white">
                              {r.rule_type}
                            </td>
                            <td className="px-4 py-2 text-slate-600">{r.deduction_mode || 'RANGE'}</td>
                            <td className="px-4 py-2 tabular-nums">{r.min_count}</td>
                            <td className="px-4 py-2 tabular-nums">{r.max_count ?? '∞'}</td>
                            <td className="px-4 py-2 tabular-nums">{r.deduction_points}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {recRules.length > 0 ? (
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
                    Grade-based recommendations
                  </h4>
                  <div className="space-y-2">
                    {recRules.map((r) => {
                      let grades: string[] = [];
                      try {
                        grades = JSON.parse(r.grade_codes_json) as string[];
                      } catch {
                        /* ignore */
                      }
                      return (
                        <div
                          key={r.id}
                          className="flex flex-wrap items-center gap-2 text-sm border-b border-slate-100 dark:border-slate-800 pb-2"
                        >
                          <Badge variant="info">{grades.join(', ')}</Badge>
                          <span className="text-slate-600 dark:text-slate-300">{r.message}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {!loading && section === 'grades' && <KpiGradeSettingsPanel mode="config" />}

      {/* Period modal */}
      <Modal
        isOpen={periodModalOpen}
        onClose={() => void requestClosePeriodModal()}
        title={editingPeriod ? 'Edit Appraisal Period' : 'Add New Period'}
        help="kpi.appraisalPeriods"
        size="lg"
        disableClose={periodSaving}
      >
        <form onSubmit={(e) => void submitPeriod(e)} className="space-y-4">
          <ModalFormSection title="Period details" icon={Calendar}>
            <ModalField label="Period name" required>
              <input
                required
                placeholder="e.g. H1 2026 Performance Review"
                value={periodForm.name}
                onChange={(e) => setPeriodForm({ ...periodForm, name: e.target.value })}
                className={modalInputClass}
              />
            </ModalField>
            <ModalField label="Period type" required>
              <select
                value={periodForm.periodType}
                onChange={(e) =>
                  setPeriodForm({
                    ...periodForm,
                    periodType: e.target.value as AppraisalPeriodType,
                  })
                }
                className={modalInputClass}
              >
                {PERIOD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PERIOD_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </ModalField>
            <ModalFieldGrid columns={2}>
              <ModalField label="Start date" required>
                <DatePickerInput
                  className={modalInputClass}
                  value={periodForm.startDate}
                  max={periodForm.endDate || undefined}
                  required
                  aria-label="Period start date"
                  onChange={(e) => {
                    const next = orderInclusiveStartEnd(
                      e.target.value,
                      periodForm.endDate,
                      'startDate'
                    );
                    setPeriodForm({
                      ...periodForm,
                      startDate: next.startDate,
                      endDate: next.endDate,
                    });
                  }}
                />
              </ModalField>
              <ModalField label="End date" required>
                <DatePickerInput
                  className={modalInputClass}
                  value={periodForm.endDate}
                  min={periodForm.startDate || undefined}
                  required
                  aria-label="Period end date"
                  onChange={(e) => {
                    const next = orderInclusiveStartEnd(
                      periodForm.startDate,
                      e.target.value,
                      'endDate'
                    );
                    setPeriodForm({
                      ...periodForm,
                      startDate: next.startDate,
                      endDate: next.endDate,
                    });
                  }}
                />
              </ModalField>
            </ModalFieldGrid>
            <ModalField label="Alert date" hint="Optional — notify managers before the window closes.">
              <DatePickerInput
                className={modalInputClass}
                value={periodForm.alertNotificationDate}
                aria-label="Alert notification date"
                onChange={(e) =>
                  setPeriodForm({ ...periodForm, alertNotificationDate: e.target.value })
                }
              />
            </ModalField>
            <ModalField label="Status">
              <select
                value={periodForm.status}
                onChange={(e) =>
                  setPeriodForm({
                    ...periodForm,
                    status: e.target.value as 'active' | 'inactive',
                  })
                }
                className={modalInputClass}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </ModalField>
          </ModalFormSection>

          <div className="hcms-modal-actions hcms-modal-actions--between">
            <Button
              type="button"
              variant="outline"
              onClick={() => void requestClosePeriodModal()}
              disabled={periodSaving}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={periodSaving} className="w-full sm:w-auto">
              {editingPeriod ? (
                <>
                  <Save className="w-4 h-4 mr-1" /> Save changes
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-1" /> Add period
                </>
              )}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={!!deletePeriodTarget}
        onClose={() => setDeletePeriodTarget(null)}
        title="Delete Appraisal Period"
        description="This permanently removes the period."
        size="sm"
      >
        <p className="text-slate-600 dark:text-slate-300">
          Delete <strong>{deletePeriodTarget?.name}</strong>?
          {Number(deletePeriodTarget?.appraisal_count ?? 0) > 0
            ? ` This will also revert ${deletePeriodTarget?.appraisal_count} linked appraisal(s).`
            : null}
        </p>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={() => setDeletePeriodTarget(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void confirmDeletePeriod()}>
            <Trash2 className="w-4 h-4 mr-1" /> Delete
          </Button>
        </div>
      </Modal>

      {/* Components batch-edit: compact table on md+, stacked cards on small screens */}
      <Modal
        isOpen={componentModalOpen}
        onClose={() => void requestCloseComponentsModal()}
        title="Edit KPI Components"
        size="wide"
        contentClassName="!overflow-y-auto"
        disableClose={componentSaving}
      >
        <form onSubmit={(e) => void submitComponents(e)} className="space-y-4">
          <div className="flex flex-row flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500 leading-relaxed min-w-0 flex-1">
              Adjust all components together. Active weights must total{' '}
              <span
                className={
                  Math.abs(draftActiveWeightTotal - 100) > 0.01
                    ? 'text-red-600 font-bold'
                    : 'text-green-600 font-bold'
                }
              >
                {draftActiveWeightTotal.toFixed(1)}%
              </span>{' '}
              when you save.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addComponentDraftRow}
              className="w-auto shrink-0"
            >
              <Plus className="w-4 h-4 mr-1" /> Add component
            </Button>
          </div>

          {/* Mobile: stacked cards */}
          <div className="space-y-3 max-h-[min(65vh,560px)] overflow-y-auto overscroll-contain pr-0.5 md:hidden">
            {componentsDraft.map((row, index) => (
              <div
                key={row.key}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 p-3 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Component {index + 1}
                  </p>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40"
                    disabled={componentsDraft.length <= 1}
                    onClick={() => removeComponentDraftRow(row.key)}
                    aria-label={`Remove ${row.name || `component ${index + 1}`}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove
                  </button>
                </div>

                <ModalField label="Name" required>
                  <input
                    required
                    placeholder="e.g. Attendance, Quality of Work"
                    value={row.name}
                    onChange={(e) => updateComponentDraft(row.key, { name: e.target.value })}
                    className={modalInputClass}
                  />
                </ModalField>

                <ModalFieldGrid columns={2}>
                  <ModalField label="Weight %" required>
                    <NumericField
                      kind="decimal"
                      filterOptions={{ maxDecimals: 2 }}
                      required
                      placeholder="e.g. 20"
                      value={row.weightPercent}
                      onValueChange={(v) =>
                        updateComponentDraft(row.key, { weightPercent: numberInputFromRaw(v) })
                      }
                      className={modalInputClass}
                    />
                  </ModalField>
                  <ModalField label="Scoring method" required>
                    <select
                      value={row.scoringMethod}
                      onChange={(e) => {
                        const method = e.target.value as KpiComponent['scoring_method'];
                        updateComponentDraft(row.key, {
                          scoringMethod: method,
                          autoMetric:
                            method === 'AUTOMATIC' ? row.autoMetric || 'ATTENDANCE' : null,
                        });
                      }}
                      className={modalInputClass}
                    >
                      <option value="AUTOMATIC">Automatic</option>
                      <option value="MANUAL">Manual</option>
                    </select>
                  </ModalField>
                </ModalFieldGrid>

                <ModalFieldGrid columns={2}>
                  {row.scoringMethod === 'AUTOMATIC' ? (
                    <ModalField label="Auto metric" required>
                      <select
                        value={row.autoMetric ?? 'ATTENDANCE'}
                        onChange={(e) =>
                          updateComponentDraft(row.key, {
                            autoMetric: e.target.value as KpiComponent['auto_metric'],
                          })
                        }
                        className={modalInputClass}
                      >
                        <option value="ATTENDANCE">Attendance</option>
                        <option value="TASK_COMPLETION">Task completion</option>
                      </select>
                    </ModalField>
                  ) : (
                    <ModalField label="Auto metric">
                      <p className="text-sm text-slate-500 py-2.5">Not used for manual scoring</p>
                    </ModalField>
                  )}
                  <ModalField label="Effective from" hint="Defaults to today if left blank when active.">
                    <DatePickerInput
                      className={`${modalInputClass} hcms-modal-date-input`}
                      value={row.effectiveFrom}
                      aria-label={`Effective from for ${row.name || `component ${index + 1}`}`}
                      onChange={(e) =>
                        updateComponentDraft(row.key, { effectiveFrom: e.target.value })
                      }
                    />
                  </ModalField>
                </ModalFieldGrid>

                <ActiveStatusControl
                  layout="field"
                  size="md"
                  active={row.active}
                  onChange={(next) =>
                    updateComponentDraft(row.key, {
                      active: next,
                      ...(next && !row.effectiveFrom
                        ? { effectiveFrom: todayYmdInCompanyTz() }
                        : {}),
                    })
                  }
                  description="Inactive components are excluded from the 100% weight total."
                />
              </div>
            ))}
          </div>

          {/* Desktop: compact wide table */}
          <div className="hidden md:block overflow-x-auto max-h-[min(60vh,520px)] overflow-y-auto overscroll-contain">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="text-xs uppercase text-slate-500 border-b sticky top-0 bg-white dark:bg-slate-800 z-10">
                <tr>
                  <SortableTableHeader
                    label="Name"
                    column="name"
                    sortBy={componentDraftSortBy}
                    sortOrder={componentDraftSortOrder}
                    onToggle={toggleComponentDraftSort}
                    className={componentDraftThClass}
                  />
                  <SortableTableHeader
                    label="Weight %"
                    column="weight"
                    sortBy={componentDraftSortBy}
                    sortOrder={componentDraftSortOrder}
                    onToggle={toggleComponentDraftSort}
                    className={`${componentDraftThClass} w-24`}
                  />
                  <SortableTableHeader
                    label="Method"
                    column="method"
                    sortBy={componentDraftSortBy}
                    sortOrder={componentDraftSortOrder}
                    onToggle={toggleComponentDraftSort}
                    className={`${componentDraftThClass} w-32`}
                  />
                  <SortableTableHeader
                    label="Auto metric"
                    column="autoMetric"
                    sortBy={componentDraftSortBy}
                    sortOrder={componentDraftSortOrder}
                    onToggle={toggleComponentDraftSort}
                    className={`${componentDraftThClass} w-40`}
                  />
                  <SortableTableHeader
                    label="Effective"
                    column="effectiveFrom"
                    sortBy={componentDraftSortBy}
                    sortOrder={componentDraftSortOrder}
                    onToggle={toggleComponentDraftSort}
                    className={`${componentDraftThClass} w-36`}
                  />
                  <SortableTableHeader
                    label="Active"
                    column="active"
                    sortBy={componentDraftSortBy}
                    sortOrder={componentDraftSortOrder}
                    onToggle={toggleComponentDraftSort}
                    className={`${componentDraftThClass} w-24`}
                  />
                  <th className="py-2 px-2 text-right w-12" />
                </tr>
              </thead>
              <tbody>
                {sortedComponentsDraft.map(({ row }) => (
                  <tr
                    key={row.key}
                    className="border-b border-slate-100 dark:border-slate-800 align-top"
                  >
                    <td className="py-2 px-2">
                      <input
                        required
                        placeholder="Component name"
                        value={row.name}
                        onChange={(e) => updateComponentDraft(row.key, { name: e.target.value })}
                        className={modalInputClass}
                      />
                    </td>
                    <td className="py-2 px-2">
                      <NumericField
                        kind="decimal"
                        filterOptions={{ maxDecimals: 2 }}
                        required
                        placeholder="0"
                        value={row.weightPercent}
                        onValueChange={(v) =>
                          updateComponentDraft(row.key, { weightPercent: numberInputFromRaw(v) })
                        }
                        className={modalInputClass}
                      />
                    </td>
                    <td className="py-2 px-2">
                      <select
                        value={row.scoringMethod}
                        onChange={(e) => {
                          const method = e.target.value as KpiComponent['scoring_method'];
                          updateComponentDraft(row.key, {
                            scoringMethod: method,
                            autoMetric:
                              method === 'AUTOMATIC' ? row.autoMetric || 'ATTENDANCE' : null,
                          });
                        }}
                        className={modalInputClass}
                      >
                        <option value="AUTOMATIC">Automatic</option>
                        <option value="MANUAL">Manual</option>
                      </select>
                    </td>
                    <td className="py-2 px-2">
                      {row.scoringMethod === 'AUTOMATIC' ? (
                        <select
                          value={row.autoMetric ?? 'ATTENDANCE'}
                          onChange={(e) =>
                            updateComponentDraft(row.key, {
                              autoMetric: e.target.value as KpiComponent['auto_metric'],
                            })
                          }
                          className={modalInputClass}
                        >
                          <option value="ATTENDANCE">Attendance</option>
                          <option value="TASK_COMPLETION">Task completion</option>
                        </select>
                      ) : (
                        <span className="text-slate-400 text-xs px-1">—</span>
                      )}
                    </td>
                    <td className="py-2 px-2">
                      <DatePickerInput
                        className={`${modalInputClass} hcms-modal-date-input`}
                        value={row.effectiveFrom}
                        aria-label={`Effective from for ${row.name || 'component'}`}
                        onChange={(e) =>
                          updateComponentDraft(row.key, { effectiveFrom: e.target.value })
                        }
                      />
                    </td>
                    <td className="py-2 px-2">
                      <ActiveStatusControl
                        active={row.active}
                        onChange={(next) =>
                          updateComponentDraft(row.key, {
                            active: next,
                            ...(next && !row.effectiveFrom
                              ? { effectiveFrom: todayYmdInCompanyTz() }
                              : {}),
                          })
                        }
                      />
                    </td>
                    <td className="py-2 px-2 text-right">
                      <button
                        type="button"
                        className="inline-flex p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40"
                        disabled={componentsDraft.length <= 1}
                        onClick={() => removeComponentDraftRow(row.key)}
                        aria-label={`Remove ${row.name || 'component'}`}
                        title="Remove row"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="hcms-modal-actions hcms-modal-actions--between">
            <Button
              type="button"
              variant="outline"
              onClick={() => void requestCloseComponentsModal()}
              disabled={componentSaving}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={componentSaving}>
              <Save className="w-4 h-4 mr-1" /> Save changes
            </Button>
          </div>
        </form>
      </Modal>

      {/* Scoring rules: compact table on md+, stacked cards on small screens */}
      <Modal
        isOpen={rulesModalOpen}
        onClose={() => void requestCloseRulesModal()}
        title="Edit Scoring Rules"
        help="kpi.scoringRules"
        size="2xl"
        disableClose={rulesSaving}
      >
        <form onSubmit={(e) => void submitRules(e)} className="space-y-4">
          <ModalFormSection title="Manual scoring policy" icon={SlidersHorizontal}>
            <ModalField
              label="Comment threshold %"
              hint="Managers must comment when a manual score is at or below this value."
            >
              <NumericField
                kind="integer"
                min={0}
                max={100}
                required
                value={rulesDraftPolicy.manualCommentThreshold}
                onValueChange={(v) =>
                  setRulesDraftPolicy({
                    manualCommentThreshold: numberInputFromRaw(v),
                  })
                }
                className={modalInputClass}
              />
            </ModalField>
          </ModalFormSection>

          <ModalFormSection title="Attendance deduction rules" icon={Gauge}>
            {/* Mobile: stacked cards */}
            <div className="space-y-3 max-h-[min(50vh,420px)] overflow-y-auto overscroll-contain md:hidden">
              {rulesDraftAtt.map((r, i) => (
                <div
                  key={r.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 p-3 space-y-3"
                >
                  <p className="text-sm font-semibold text-slate-900 dark:text-white break-words">
                    {r.rule_type}
                  </p>
                  <ModalField label="Mode">
                    <select
                      className={modalInputClass}
                      value={r.deduction_mode || 'RANGE'}
                      onChange={(e) =>
                        updateRulesDraftAtt(i, { deduction_mode: e.target.value })
                      }
                    >
                      <option value="RANGE">Range</option>
                      <option value="PER_OCCURRENCE">Per occurrence</option>
                    </select>
                  </ModalField>
                  <ModalFieldGrid columns={3}>
                    <ModalField label="Min count">
                      <NumericField
                        kind="integer"
                        className={modalInputClass}
                        value={r.min_count}
                        onValueChange={(v) =>
                          updateRulesDraftAtt(i, { min_count: numberInputFromRaw(v) })
                        }
                      />
                    </ModalField>
                    <ModalField label="Max count" hint="Leave empty for ∞">
                      <NumericField
                        kind="integer"
                        className={modalInputClass}
                        placeholder="∞"
                        value={r.max_count ?? ''}
                        onValueChange={(v) =>
                          updateRulesDraftAtt(i, {
                            max_count: v === '' ? null : numberInputFromRaw(v),
                          })
                        }
                      />
                    </ModalField>
                    <ModalField label="Deduction points">
                      <NumericField
                        kind="decimal"
                        filterOptions={{ maxDecimals: 2 }}
                        className={modalInputClass}
                        value={r.deduction_points}
                        onValueChange={(v) =>
                          updateRulesDraftAtt(i, {
                            deduction_points: numberInputFromRaw(v),
                          })
                        }
                      />
                    </ModalField>
                  </ModalFieldGrid>
                </div>
              ))}
              {rulesDraftAtt.length === 0 ? (
                <p className="text-sm text-slate-500 py-2">No attendance deduction rules configured.</p>
              ) : null}
            </div>

            {/* Desktop: compact table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-500 border-b">
                  <tr>
                    <SortableTableHeader
                      label="Type"
                      column="type"
                      sortBy={attRuleDraftSortBy}
                      sortOrder={attRuleDraftSortOrder}
                      onToggle={toggleAttRuleDraftSort}
                      className={attRuleDraftThClass}
                    />
                    <SortableTableHeader
                      label="Mode"
                      column="mode"
                      sortBy={attRuleDraftSortBy}
                      sortOrder={attRuleDraftSortOrder}
                      onToggle={toggleAttRuleDraftSort}
                      className={`${attRuleDraftThClass} w-44`}
                    />
                    <SortableTableHeader
                      label="Min"
                      column="min"
                      sortBy={attRuleDraftSortBy}
                      sortOrder={attRuleDraftSortOrder}
                      onToggle={toggleAttRuleDraftSort}
                      className={`${attRuleDraftThClass} w-24`}
                    />
                    <SortableTableHeader
                      label="Max"
                      column="max"
                      sortBy={attRuleDraftSortBy}
                      sortOrder={attRuleDraftSortOrder}
                      onToggle={toggleAttRuleDraftSort}
                      className={`${attRuleDraftThClass} w-24`}
                    />
                    <SortableTableHeader
                      label="Deduction"
                      column="deduction"
                      sortBy={attRuleDraftSortBy}
                      sortOrder={attRuleDraftSortOrder}
                      onToggle={toggleAttRuleDraftSort}
                      className={`${attRuleDraftThClass} w-28`}
                    />
                  </tr>
                </thead>
                <tbody>
                  {sortedRulesDraftAtt.map(({ row: r, index: i }) => (
                    <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-2 px-2 font-medium whitespace-nowrap">{r.rule_type}</td>
                      <td className="py-2 px-2">
                        <select
                          className={modalInputClass}
                          value={r.deduction_mode || 'RANGE'}
                          onChange={(e) => updateRulesDraftAtt(i, { deduction_mode: e.target.value })}
                        >
                          <option value="RANGE">Range</option>
                          <option value="PER_OCCURRENCE">Per occurrence</option>
                        </select>
                      </td>
                      <td className="py-2 px-2">
                        <NumericField
                          kind="integer"
                          className={modalInputClass}
                          value={r.min_count}
                          onValueChange={(v) =>
                            updateRulesDraftAtt(i, { min_count: numberInputFromRaw(v) })
                          }
                        />
                      </td>
                      <td className="py-2 px-2">
                        <NumericField
                          kind="integer"
                          className={modalInputClass}
                          placeholder="∞"
                          value={r.max_count ?? ''}
                          onValueChange={(v) =>
                            updateRulesDraftAtt(i, {
                              max_count: v === '' ? null : numberInputFromRaw(v),
                            })
                          }
                        />
                      </td>
                      <td className="py-2 px-2">
                        <NumericField
                          kind="decimal"
                          filterOptions={{ maxDecimals: 2 }}
                          className={modalInputClass}
                          value={r.deduction_points}
                          onValueChange={(v) =>
                            updateRulesDraftAtt(i, {
                              deduction_points: numberInputFromRaw(v),
                            })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rulesDraftAtt.length === 0 ? (
                <p className="text-sm text-slate-500 py-2">No attendance deduction rules configured.</p>
              ) : null}
            </div>
          </ModalFormSection>

          <div className="hcms-modal-actions hcms-modal-actions--between">
            <Button
              type="button"
              variant="outline"
              onClick={() => void requestCloseRulesModal()}
              disabled={rulesSaving}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={rulesSaving}>
              <Save className="w-4 h-4 mr-1" /> Save changes
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
