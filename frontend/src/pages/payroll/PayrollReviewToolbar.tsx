import React, { useMemo } from 'react';
import {
  FilterMenuField,
  FilterMenuRadioGroup,
  FilterMenuSelect,
  PageFilterMenu,
} from '../../components/ui/PageFilterMenu';
import { ListSearchFilterBar } from '../../components/ui/page';
import { countActiveFilters } from '../../utils/filterActiveCount';
import {
  DEFAULT_PAYROLL_REVIEW_FILTERS,
  type PayrollReviewFilterState,
  type PayrollReviewViewMode,
} from './payrollReviewFilters';

type Props = {
  filters: PayrollReviewFilterState;
  onChange: (next: Partial<PayrollReviewFilterState>) => void;
  departmentOptions: Array<{ id: string; name: string }>;
  changedCount?: number;
};

export const PayrollReviewToolbar: React.FC<Props> = ({
  filters,
  onChange,
  departmentOptions,
  changedCount = 0,
}) => {
  const activeCount = useMemo(
    () =>
      countActiveFilters([
        { value: filters.viewMode, defaultValue: DEFAULT_PAYROLL_REVIEW_FILTERS.viewMode },
        { value: filters.changedOnly, defaultValue: DEFAULT_PAYROLL_REVIEW_FILTERS.changedOnly },
        { value: filters.departmentId, defaultValue: DEFAULT_PAYROLL_REVIEW_FILTERS.departmentId },
      ]),
    [filters]
  );

  const filterSummary = useMemo(() => {
    if (filters.viewMode === 'simple') return 'Register';
    if (filters.changedOnly) return 'Detailed · Changed';
    if (filters.departmentId) {
      const dept = departmentOptions.find((d) => d.id === filters.departmentId);
      if (dept) return `Detailed · ${dept.name}`;
    }
    return 'Detailed';
  }, [filters, departmentOptions]);

  const clearFilters = () => {
    onChange({
      viewMode: DEFAULT_PAYROLL_REVIEW_FILTERS.viewMode,
      changedOnly: DEFAULT_PAYROLL_REVIEW_FILTERS.changedOnly,
      departmentId: DEFAULT_PAYROLL_REVIEW_FILTERS.departmentId,
      search: DEFAULT_PAYROLL_REVIEW_FILTERS.search,
    });
  };

  return (
    <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-900/20">
      <ListSearchFilterBar
        searchValue={filters.search}
        onSearchChange={(search) => onChange({ search })}
        searchPlaceholder="Search name, employee ID, department…"
        filter={
          <PageFilterMenu
            title="Review filters"
            periodSummary={filterSummary}
            activeCount={activeCount}
            onClear={clearFilters}
          >
            <FilterMenuRadioGroup<PayrollReviewViewMode>
              label="View"
              value={filters.viewMode}
              onChange={(viewMode) => onChange({ viewMode })}
              options={[
                { value: 'detailed', label: 'Detailed' },
                { value: 'simple', label: 'Register' },
              ]}
            />
            <FilterMenuField label="Changes">
              <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                  checked={filters.changedOnly}
                  onChange={(e) => onChange({ changedOnly: e.target.checked })}
                />
                <span className="text-sm text-slate-700 dark:text-slate-200">
                  Changed since prior run
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {changedCount} employee{changedCount === 1 ? '' : 's'} with net pay changes
                  </span>
                </span>
              </label>
            </FilterMenuField>
            {departmentOptions.length > 0 ? (
              <FilterMenuSelect
                label="Department"
                value={filters.departmentId}
                onChange={(departmentId) => onChange({ departmentId })}
                options={[
                  { value: '', label: 'All departments' },
                  ...departmentOptions.map((d) => ({ value: d.id, label: d.name })),
                ]}
              />
            ) : null}
          </PageFilterMenu>
        }
      />
    </div>
  );
};
