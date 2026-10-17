import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GripVertical, Loader2, Plus, Trash2 } from 'lucide-react';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { setPositionLevelOptions } from '../../constants/positionCatalog';
import type { PositionLevelRecord, StructureTier } from '../../types/positionLevels';
import { RulesConfigHelp } from '../ui/RulesConfigHelp';
import { LoadingState } from '../common/LoadingState';
import {
  sortRowsByColumn,
  SortableTableHeader,
  useListColumnSort,
} from '../../utils/listColumnSort';

type StructureLevelSortCol = 'tier' | 'structureTier' | 'code' | 'label';

const structureLevelThClass =
  'px-4 py-2.5 text-xs uppercase tracking-wide text-slate-500 font-semibold';

type DraftRow = PositionLevelRecord & { _key: string };

const TIER_OPTIONS: { value: StructureTier; label: string; hint: string }[] = [
  { value: 'manager', label: 'Management', hint: 'Shown in the manager tier on the org chart' },
  { value: 'officer', label: 'Officer / leadership', hint: 'Senior roles below executive management' },
  { value: 'staff', label: 'Staff', hint: 'Individual contributors and support roles' },
];

function slugFromLabel(label: string): string {
  return label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function toDraftRows(levels: PositionLevelRecord[]): DraftRow[] {
  return levels.map((l, i) => ({
    ...l,
    _key: `${l.code}-${i}`,
    tier: l.tier ?? i + 1,
    sortOrder: l.sortOrder ?? i + 1,
  }));
}

function tierLabel(tier: StructureTier): string {
  return TIER_OPTIONS.find((o) => o.value === tier)?.label ?? tier;
}

function fromDraftRows(rows: DraftRow[]): PositionLevelRecord[] {
  return rows.map((row, index) => {
    const tier = index + 1;
    return {
      code: slugFromLabel(row.code || row.label),
      label: row.label.trim(),
      tier,
      sortOrder: tier,
      structureTier: row.structureTier,
    };
  });
}

type Props = {
  readOnly?: boolean;
};

export const CompanyStructureLevelsTab: React.FC<Props> = ({ readOnly = false }) => {
  const { showToast } = useToast();
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [original, setOriginal] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { sortBy, sortOrder, toggleSort } = useListColumnSort<StructureLevelSortCol>();

  const sortedReadOnlyRows = useMemo(() => {
    const getSortValue = (row: DraftRow, col: StructureLevelSortCol): string | number => {
      const index = rows.findIndex((r) => r._key === row._key);
      switch (col) {
        case 'tier':
          return index >= 0 ? index + 1 : 0;
        case 'structureTier':
          return tierLabel(row.structureTier);
        case 'code':
          return row.code;
        case 'label':
          return row.label;
        default:
          return '';
      }
    };
    const applyDefaultSort = (list: DraftRow[]) =>
      list.sort((a, b) => {
        const aIndex = rows.findIndex((r) => r._key === a._key);
        const bIndex = rows.findIndex((r) => r._key === b._key);
        return aIndex - bIndex;
      });
    return sortRowsByColumn(rows, sortBy, sortOrder, getSortValue, applyDefaultSort);
  }, [rows, sortBy, sortOrder]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await Api.system.getPositionLevels();
      const draft = toDraftRows(data.levels ?? []);
      setRows(draft);
      setOriginal(draft);
    } catch {
      showToast('Unable to load position levels', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasChanges = useMemo(
    () => JSON.stringify(fromDraftRows(rows)) !== JSON.stringify(fromDraftRows(original)),
    [rows, original]
  );

  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setRows((prev) => prev.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        _key: `new-${Date.now()}`,
        code: '',
        label: '',
        tier: prev.length + 1,
        sortOrder: prev.length + 1,
        structureTier: 'staff',
      },
    ]);
  };

  const removeRow = (key: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r._key !== key)));
  };

  const moveRow = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    setRows((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const handleSave = async () => {
    const payload = fromDraftRows(rows);
    if (!payload.length) {
      showToast('Add at least one position level', 'error');
      return;
    }
    if (payload.some((p) => !p.label)) {
      showToast('Every level needs a display name', 'error');
      return;
    }
    const codes = payload.map((p) => p.code);
    if (new Set(codes).size !== codes.length) {
      showToast('Level codes must be unique', 'error');
      return;
    }

    try {
      setSaving(true);
      const res = await Api.system.savePositionLevels(payload);
      const draft = toDraftRows(res.levels);
      setRows(draft);
      setOriginal(draft);
      const options = res.levels.map((l) => ({
        value: l.code,
        label: l.label,
        structureTier: l.structureTier,
        tier: l.tier,
        sortOrder: l.sortOrder,
      }));
      setPositionLevelOptions(options);
      showToast('Position levels saved', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setRows(original.map((r) => ({ ...r })));
    showToast('Changes discarded', 'warning');
  };

  if (loading) {
    return <LoadingState variant="panel" layout="table" rows={4} label="Loading position levels…" />;
  }

  if (readOnly) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-800/40 px-4 py-3">
          <p className="text-sm font-medium text-slate-900 dark:text-white">Position levels</p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            {rows.length} level{rows.length === 1 ? '' : 's'} configured for job positions.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/80 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <SortableTableHeader
                  label="Tier"
                  column="tier"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={structureLevelThClass}
                />
                <SortableTableHeader
                  label="Org chart tier"
                  column="structureTier"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={structureLevelThClass}
                />
                <SortableTableHeader
                  label="Code"
                  column="code"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={structureLevelThClass}
                />
                <SortableTableHeader
                  label="Display name"
                  column="label"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={structureLevelThClass}
                />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {sortedReadOnlyRows.map((row) => {
                const index = rows.findIndex((r) => r._key === row._key);
                return (
                <tr key={row._key} className="bg-white dark:bg-slate-900/30">
                  <td className="px-4 py-2.5 font-semibold text-primary-600">{index + 1}</td>
                  <td className="px-4 py-2.5 text-slate-600">{tierLabel(row.structureTier)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{row.code}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-white">{row.label}</td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-900 dark:text-white">Position levels</p>
        <RulesConfigHelp help="settings.companyStructureLevels" />
      </div>

      <div className="space-y-2">
        {rows.map((row, index) => (
          <div
            key={row._key}
            className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/30 p-3 sm:grid-cols-[auto_3rem_minmax(0,10rem)_1fr_1fr_auto]"
          >
            <div className="flex items-center gap-1 sm:flex-col sm:justify-center">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => moveRow(index, -1)}
                className="p-1 rounded text-slate-400 hover:bg-slate-100 disabled:opacity-30 text-xs"
                aria-label="Move up"
              >
                ▲
              </button>
              <GripVertical className="hidden sm:block w-4 h-4 text-slate-300" aria-hidden />
              <button
                type="button"
                disabled={index === rows.length - 1}
                onClick={() => moveRow(index, 1)}
                className="p-1 rounded text-slate-400 hover:bg-slate-100 disabled:opacity-30 text-xs"
                aria-label="Move down"
              >
                ▼
              </button>
            </div>

            <div className="flex flex-col justify-center items-center sm:items-center">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Tier
              </span>
              <span
                className="mt-1 inline-flex h-9 min-w-[2.25rem] items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/30 text-sm font-bold text-primary-700 dark:text-primary-300"
                aria-label={`Tier ${index + 1}`}
              >
                {index + 1}
              </span>
            </div>

            <label className="block min-w-0 space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Org chart tier
              </span>
              <select
                value={row.structureTier}
                onChange={(e) =>
                  updateRow(row._key, { structureTier: e.target.value as StructureTier })
                }
                className="w-full h-9 px-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-100"
              >
                {TIER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block min-w-0 space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Code
              </span>
              <input
                type="text"
                value={row.code}
                onChange={(e) => updateRow(row._key, { code: slugFromLabel(e.target.value) })}
                placeholder="SENIOR_OFFICER"
                className="w-full h-9 px-2.5 rounded-lg border border-slate-200 bg-white text-sm font-mono uppercase text-slate-900 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-100"
              />
            </label>

            <label className="block min-w-0 space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Display name
              </span>
              <input
                type="text"
                value={row.label}
                onChange={(e) => {
                  const label = e.target.value;
                  updateRow(row._key, {
                    label,
                    code: row.code ? row.code : slugFromLabel(label),
                  });
                }}
                placeholder="e.g. Senior Officer"
                className="w-full h-9 px-2.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-100"
              />
            </label>

            <button
              type="button"
              onClick={() => removeRow(row._key)}
              disabled={rows.length <= 1}
              className="h-9 w-9 self-end sm:self-center inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-40 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-400 dark:hover:border-red-800"
              aria-label="Remove level"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRow}
        className="inline-flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-700"
      >
        <Plus className="w-4 h-4" />
        Add level
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-700">
        <p className="text-xs text-slate-500">
          {hasChanges ? 'Unsaved changes' : 'All changes saved'}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleReset}
            disabled={!hasChanges || saving}
            className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!hasChanges || saving}
            className="px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Save levels
          </button>
        </div>
      </div>
    </div>
  );
};
