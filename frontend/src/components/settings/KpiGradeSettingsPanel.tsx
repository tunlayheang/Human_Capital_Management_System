import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Edit2, Save } from 'lucide-react';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { RulesConfigHelp } from '../ui/RulesConfigHelp';
import { inputClass } from '../../constants/designSystem';
import { LoadingState } from '../common/LoadingState';
import { modalInputClass } from '../ui/ModalForm';
import { NumericField } from '../ui/NumericField';
import {
  coerceFiniteNumber,
  numberInputFromRaw,
  type NumberInputValue,
} from '../../utils/formInputFilters';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import {
  sortRowsByColumn,
  SortableTableHeader,
  useListColumnSort,
} from '../../utils/listColumnSort';

type KpiGradeSortCol = 'code' | 'label' | 'minScore' | 'numeric' | 'payRaiseRate';

const gradeThClass = 'py-2 px-3 text-left text-xs uppercase text-slate-500';

export type KpiGradeDefinition = {
  code: string;
  label: string;
  minScore: number;
  numeric: number;
  /** Suggested salary increase percent for this grade. */
  payRaiseRate: number;
};

type GradeDraft = {
  code: string;
  label: string;
  minScore: NumberInputValue;
  numeric: NumberInputValue;
  payRaiseRate: NumberInputValue;
};

type Props = {
  /**
   * `config` — Leave/OT-style card with Edit → modal (Performance → Configuration).
   * `legacy` — controlled edit toolbar for older embed sites.
   */
  mode?: 'config' | 'legacy';
  isEditing?: boolean;
  canEdit?: boolean;
  saving?: boolean;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
  onSave?: () => void;
  onSavingChange?: (saving: boolean) => void;
};

const NUMERIC_FIELDS = new Set<keyof GradeDraft>(['minScore', 'numeric', 'payRaiseRate']);

function toDraft(g: KpiGradeDefinition): GradeDraft {
  return {
    code: g.code,
    label: g.label,
    minScore: Number(g.minScore) || 0,
    numeric: Number(g.numeric) || 0,
    payRaiseRate: Number(g.payRaiseRate) || 0,
  };
}

export const KpiGradeSettingsPanel: React.FC<Props> = ({
  mode = 'legacy',
  isEditing: isEditingExternal = false,
  canEdit = true,
  saving: savingExternal,
  onStartEdit,
  onCancelEdit,
  onSave,
  onSavingChange,
}) => {
  const { showToast } = useToast();
  const { confirm, ConfirmDialogHost } = useConfirmDialog();
  const [grades, setGrades] = useState<KpiGradeDefinition[]>([]);
  const [draft, setDraft] = useState<GradeDraft[]>([]);
  const [draftBaseline, setDraftBaseline] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingInternal, setSavingInternal] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const saving = savingExternal ?? savingInternal;
  const isConfig = mode === 'config';
  const isEditing = isConfig ? modalOpen : isEditingExternal;

  const isDirty =
    isEditing && draftBaseline != null && JSON.stringify(draft) !== draftBaseline;
  const { confirmDiscardIfDirty } = useUnsavedChangesGuard({
    isDirty,
    confirm,
  });
  const { sortBy, sortOrder, toggleSort } = useListColumnSort<KpiGradeSortCol>();

  const sortedGradeRows = useMemo(() => {
    type GradeRow = KpiGradeDefinition | GradeDraft;
    const source = (isEditing ? draft : grades) as GradeRow[];
    const indexed = source.map((row, index) => ({ row, index }));
    const getSortValue = (item: { row: GradeRow; index: number }, col: KpiGradeSortCol): string | number => {
      const row = item.row;
      switch (col) {
        case 'code':
          return row.code;
        case 'label':
          return row.label;
        case 'minScore':
          return typeof row.minScore === 'number' ? row.minScore : coerceFiniteNumber(row.minScore, 0);
        case 'numeric':
          return typeof row.numeric === 'number' ? row.numeric : coerceFiniteNumber(row.numeric, 0);
        case 'payRaiseRate':
          return typeof row.payRaiseRate === 'number'
            ? row.payRaiseRate
            : coerceFiniteNumber(row.payRaiseRate, 0);
        default:
          return '';
      }
    };
    return sortRowsByColumn(indexed, sortBy, sortOrder, getSortValue);
  }, [draft, grades, isEditing, sortBy, sortOrder]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await Api.analytics.getKpiGrades()) as { grades: KpiGradeDefinition[] };
      const list = (res.grades ?? []).map((g) => ({
        ...g,
        payRaiseRate: Number(g.payRaiseRate) || 0,
      }));
      setGrades(list);
      setDraft(list.map(toDraft));
    } catch {
      showToast('Could not load KPI grade scale', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isConfig && isEditingExternal) {
      const next = grades.map(toDraft);
      setDraft(next);
      setDraftBaseline(JSON.stringify(next));
    }
  }, [isConfig, isEditingExternal, grades]);

  const updateRow = (index: number, field: keyof GradeDraft, value: string) => {
    setDraft((prev) =>
      prev.map((g, i) => {
        if (i !== index) return g;
        if (NUMERIC_FIELDS.has(field)) {
          return { ...g, [field]: numberInputFromRaw(value) };
        }
        return { ...g, [field]: value };
      })
    );
  };

  const openEdit = () => {
    const next = grades.map(toDraft);
    setDraft(next);
    setDraftBaseline(JSON.stringify(next));
    if (isConfig) {
      setModalOpen(true);
    } else {
      onStartEdit?.();
    }
  };

  const cancelEdit = async () => {
    if (!(await confirmDiscardIfDirty())) return;
    setDraft(grades.map(toDraft));
    setDraftBaseline(null);
    if (isConfig) {
      setModalOpen(false);
    } else {
      onCancelEdit?.();
    }
  };

  const persist = async () => {
    for (const g of draft) {
      if (!g.code.trim() || !g.label.trim()) {
        showToast('Each grade needs a code and label', 'error');
        return;
      }
      if (g.minScore === '' || g.numeric === '' || g.payRaiseRate === '') {
        showToast(`Fill all numeric fields for grade ${g.code || 'row'}`, 'error');
        return;
      }
    }
    setSavingInternal(true);
    onSavingChange?.(true);
    try {
      const payload = draft.map((g) => ({
        code: g.code.trim(),
        label: g.label.trim(),
        minScore: coerceFiniteNumber(g.minScore, 0),
        numeric: coerceFiniteNumber(g.numeric, 0),
        payRaiseRate: Math.max(0, coerceFiniteNumber(g.payRaiseRate, 0)),
      }));
      const res = (await Api.analytics.saveKpiGrades(payload)) as { grades: KpiGradeDefinition[] };
      const next = res.grades ?? payload;
      setGrades(next);
      setDraft(next.map(toDraft));
      setDraftBaseline(null);
      showToast('KPI grade scale saved', 'success');
      if (isConfig) setModalOpen(false);
      onSave?.();
    } catch {
      showToast('Failed to save KPI grades', 'error');
    } finally {
      setSavingInternal(false);
      onSavingChange?.(false);
    }
  };

  const gradeTable = (editable: boolean, inputCls: string) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-slate-500 border-b border-slate-200 dark:border-slate-700">
          <tr>
            <SortableTableHeader
              label="Grade"
              column="code"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onToggle={toggleSort}
              className={gradeThClass}
            />
            <SortableTableHeader
              label="Label"
              column="label"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onToggle={toggleSort}
              className={gradeThClass}
            />
            <SortableTableHeader
              label="Min score %"
              column="minScore"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onToggle={toggleSort}
              className={gradeThClass}
            />
            <SortableTableHeader
              label="Chart value"
              column="numeric"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onToggle={toggleSort}
              className={gradeThClass}
            />
            <SortableTableHeader
              label="Pay raise rate %"
              column="payRaiseRate"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onToggle={toggleSort}
              className={gradeThClass}
            />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {sortedGradeRows.map(({ row: g, index: rowIndex }) => (
            <tr key={g.code || rowIndex}>
              {editable ? (
                <>
                  <td className="py-2 px-3">
                    <input
                      className={`${inputCls} w-16`}
                      value={g.code}
                      onChange={(e) => updateRow(rowIndex, 'code', e.target.value)}
                    />
                  </td>
                  <td className="py-2 px-3">
                    <input
                      className={`${inputCls} min-w-[12rem]`}
                      value={g.label}
                      onChange={(e) => updateRow(rowIndex, 'label', e.target.value)}
                    />
                  </td>
                  <td className="py-2 px-3">
                    <NumericField
                      kind="decimal"
                      filterOptions={{ maxDecimals: 2 }}
                      className={`${inputCls} w-20`}
                      value={(g as GradeDraft).minScore}
                      onValueChange={(v) => updateRow(rowIndex, 'minScore', v)}
                    />
                  </td>
                  <td className="py-2 px-3">
                    <NumericField
                      kind="integer"
                      className={`${inputCls} w-16`}
                      value={(g as GradeDraft).numeric}
                      onValueChange={(v) => updateRow(rowIndex, 'numeric', v)}
                    />
                  </td>
                  <td className="py-2 px-3">
                    <NumericField
                      kind="decimal"
                      filterOptions={{ maxDecimals: 2 }}
                      className={`${inputCls} w-24`}
                      value={(g as GradeDraft).payRaiseRate}
                      onValueChange={(v) => updateRow(rowIndex, 'payRaiseRate', v)}
                      title="Suggested salary increase percent for this grade"
                    />
                  </td>
                </>
              ) : (
                <>
                  <td className="py-2 px-3 font-semibold text-slate-900 dark:text-white">{g.code}</td>
                  <td className="py-2 px-3 text-slate-600 dark:text-slate-400">{g.label}</td>
                  <td className="py-2 px-3 text-slate-500 tabular-nums">≥ {g.minScore}%</td>
                  <td className="py-2 px-3 text-slate-400 tabular-nums">{g.numeric}</td>
                  <td className="py-2 px-3 text-primary-600 dark:text-primary-400 font-medium tabular-nums">
                    {Number(g.payRaiseRate) || 0}%
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (isConfig) {
    return (
      <>
        <ConfirmDialogHost />
        <div className="relative surface-card shadow-sm overflow-hidden">
          <RulesConfigHelp help="kpi.gradeScale" className="absolute top-3 right-3 z-10" />
          <div className="flex flex-row flex-wrap items-center justify-between gap-2 px-3 py-2 pr-12 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">KPI grade scale</h3>
              <Badge variant="neutral" className="border border-slate-200 dark:border-slate-600 shrink-0">
                {loading ? '…' : `${grades.length} grades`}
              </Badge>
            </div>
            {canEdit ? (
              <Button onClick={openEdit} variant="outline" size="sm" className="w-auto shrink-0">
                <Edit2 className="w-4 h-4 mr-1" /> Edit grade scale
              </Button>
            ) : null}
          </div>

          {loading ? (
            <LoadingState variant="panel" layout="table" rows={4} label="Loading…" className="px-5 py-4" />
          ) : (
            <div className="p-4 sm:p-5">{gradeTable(false, inputClass)}</div>
          )}
        </div>

        <Modal
          isOpen={modalOpen}
          onClose={() => void cancelEdit()}
          title="Edit Grade Scale"
          help="kpi.gradeScale"
          size="lg"
          disableClose={saving}
        >
          <div className="space-y-4">
            {gradeTable(true, modalInputClass)}
            <div className="hcms-modal-actions hcms-modal-actions--between">
              <Button type="button" variant="outline" onClick={() => void cancelEdit()} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" isLoading={saving} onClick={() => void persist()}>
                <Save className="w-4 h-4 mr-1" /> Save changes
              </Button>
            </div>
          </div>
        </Modal>
      </>
    );
  }

  return (
    <>
    <ConfirmDialogHost />
    <div
      className={`relative surface-card shadow-sm overflow-hidden ${
        isEditing ? 'ring-2 ring-primary-500/20' : ''
      }`}
    >
      <RulesConfigHelp help="kpi.gradeScale" className="absolute top-3 right-3 z-10" />
      <div className="flex flex-row flex-wrap items-center justify-between gap-2 px-5 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700 pr-12">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">KPI grade scale</h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="neutral" className="border border-slate-200 dark:border-slate-600">
            {loading ? 'Loading…' : `${grades.length} grades`}
          </Badge>
          {canEdit && !isEditing ? (
            <Button size="sm" variant="outline" onClick={openEdit}>
              <Edit2 className="w-3.5 h-3.5 mr-1" /> Edit
            </Button>
          ) : null}
          {canEdit && isEditing ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => void cancelEdit()} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" isLoading={saving} onClick={() => void persist()}>
                Save
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {loading ? (
        <LoadingState variant="panel" layout="table" rows={4} label="Loading…" className="px-5 py-4" />
      ) : (
        <div className="p-5">{gradeTable(isEditing, inputClass)}</div>
      )}
    </div>
    </>
  );
};
