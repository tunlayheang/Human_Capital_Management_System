import React, { useMemo, useState } from 'react';
import { Check, ShieldAlert } from 'lucide-react';
import type { PermissionRecord } from '../../services/permissionService';
import { ListSearchBarShell, ListSearchInput } from '../ui/page';
import { resolvePermissionCategory, type CategoryKey } from './permissionCategories';
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  filterPickerPermissions,
  groupPickerPermissions,
} from './permissionPickerUtils';

type Props = {
  permissions: PermissionRecord[];
  /** Selected permission ids (multi-select). */
  value: string[];
  onChange: (permissionIds: string[]) => void;
  /** Permission ids that already have an active override for this user */
  existingOverrideIds?: Set<string>;
};

export const PermissionOverridePicker: React.FC<Props> = ({
  permissions,
  value,
  onChange,
  existingOverrideIds,
}) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryKey | 'all'>('all');

  const selectedIds = useMemo(() => new Set(value), [value]);

  const grouped = useMemo(() => groupPickerPermissions(permissions), [permissions]);
  const visibleCategories = useMemo(
    () => CATEGORY_ORDER.filter((cat) => grouped[cat].length > 0),
    [grouped]
  );

  const filtered = useMemo(
    () => filterPickerPermissions(permissions, query, category),
    [permissions, query, category]
  );

  const selectedPerms = useMemo(
    () => permissions.filter((p) => selectedIds.has(p.id)),
    [permissions, selectedIds]
  );

  const toggle = (permissionId: string) => {
    if (selectedIds.has(permissionId)) {
      onChange(value.filter((id) => id !== permissionId));
      return;
    }
    onChange([...value, permissionId]);
  };

  const selectVisible = () => {
    const next = new Set(value);
    for (const perm of filtered) next.add(perm.id);
    onChange([...next]);
  };

  const clearVisible = () => {
    const visible = new Set(filtered.map((p) => p.id));
    onChange(value.filter((id) => !visible.has(id)));
  };

  const clearAll = () => onChange([]);

  return (
    <div className="space-y-3">
      <ListSearchBarShell>
        <ListSearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search by name, module, or keyword…"
          className="flex-1 min-w-0 w-auto"
        />
      </ListSearchBarShell>

      <div className="flex flex-wrap gap-1.5">
        <CategoryChip
          active={category === 'all'}
          label="All modules"
          onClick={() => setCategory('all')}
        />
        {visibleCategories.map((cat) => (
          <CategoryChip
            key={cat}
            active={category === cat}
            label={CATEGORY_META[cat].label}
            count={grouped[cat].length}
            onClick={() => setCategory(cat)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={selectVisible}
          disabled={filtered.length === 0}
          className="font-medium text-primary-600 dark:text-primary-400 hover:underline disabled:opacity-40 disabled:no-underline"
        >
          Select visible ({filtered.length})
        </button>
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <button
          type="button"
          onClick={clearVisible}
          disabled={filtered.every((p) => !selectedIds.has(p.id))}
          className="font-medium text-slate-600 dark:text-slate-400 hover:underline disabled:opacity-40 disabled:no-underline"
        >
          Clear visible
        </button>
        {value.length > 0 ? (
          <>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <button
              type="button"
              onClick={clearAll}
              className="font-medium text-slate-600 dark:text-slate-400 hover:underline"
            >
              Clear all
            </button>
          </>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="max-h-80 overflow-y-auto custom-scrollbar divide-y divide-slate-100 dark:divide-slate-800">
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No permissions match your search.
            </p>
          ) : (
            filtered.map((perm) => {
              const cat = resolvePermissionCategory(perm);
              const hasOverride = existingOverrideIds?.has(perm.id);
              const isSelected = selectedIds.has(perm.id);
              return (
                <button
                  key={perm.id}
                  type="button"
                  onClick={() => toggle(perm.id)}
                  aria-pressed={isSelected}
                  className={`w-full text-left px-4 py-3 transition-colors ${
                    isSelected
                      ? 'bg-primary-50 dark:bg-primary-900/25 border-l-2 border-l-primary-500'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                        {perm.name}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                        {perm.description || perm.key}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          {CATEGORY_META[cat].label}
                        </span>
                        {perm.isSensitive && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-400">
                            <ShieldAlert className="w-3 h-3" />
                            Sensitive
                          </span>
                        )}
                        {hasOverride && (
                          <span className="text-[10px] font-medium text-primary-600 dark:text-primary-400">
                            Already overridden
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={`mt-0.5 h-4 w-4 rounded border-2 shrink-0 flex items-center justify-center ${
                        isSelected
                          ? 'border-primary-500 bg-primary-500 text-white'
                          : 'border-slate-300 dark:border-slate-600'
                      }`}
                      aria-hidden
                    >
                      {isSelected ? <Check className="w-3 h-3" strokeWidth={3} /> : null}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {selectedPerms.length > 0 ? (
        <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
          <p>
            Selected:{' '}
            <span className="font-medium text-slate-700 dark:text-slate-300 tabular-nums">
              {selectedPerms.length}
            </span>{' '}
            permission{selectedPerms.length === 1 ? '' : 's'}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {selectedPerms.map((perm) => (
              <li
                key={perm.id}
                className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5"
              >
                <span className="font-medium text-slate-700 dark:text-slate-300">{perm.name}</span>
                <code className="font-mono text-primary-600 dark:text-primary-400">{perm.key}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Select one or more permissions to include in this exception.
        </p>
      )}
    </div>
  );
};

function CategoryChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
        active
          ? 'bg-primary-600 text-white'
          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
      }`}
    >
      {label}
      {count != null ? ` (${count})` : ''}
    </button>
  );
}
