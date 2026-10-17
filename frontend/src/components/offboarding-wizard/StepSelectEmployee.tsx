import React from 'react';
import { CheckCircle2, Users } from 'lucide-react';
import { ContentSkeleton } from '../common/ContentSkeleton';
import { ListSearchBarShell, ListSearchInput } from '../ui/page';
import { useLanguage } from '../../context/LanguageContext';
import { filterEmployeesWithAssignedDisplayId } from '../../utils/employeeDirectoryEligibility';
import {
  EmployeeListIdentityBlock,
  employeeListIdentityFromEmployeeRow,
} from '../employee/EmployeeListIdentity';

export type EmployeePickRow = {
  employee_id: string;
  first_name: string;
  last_name: string;
  first_name_kh?: string | null;
  last_name_kh?: string | null;
  full_name?: string | null;
  full_name_kh?: string | null;
  avatar_url?: string | null;
  email?: string;
  phone?: string;
  status?: string;
  department?: { name?: string; name_kh?: string; nameKh?: string };
  position?: { title?: string; title_kh?: string; titleKh?: string };
};

type Props = {
  query: string;
  onQueryChange: (q: string) => void;
  rows: EmployeePickRow[];
  loading: boolean;
  selectedId: string | null;
  selectedRow?: EmployeePickRow | null;
  onSelect: (row: EmployeePickRow) => void;
};

export const StepSelectEmployee: React.FC<Props> = ({
  query,
  onQueryChange,
  rows,
  loading,
  selectedId,
  selectedRow,
  onSelect,
}) => {
  const { t } = useLanguage();
  const hasSearch = query.trim().length > 0;
  const eligibleRows = React.useMemo(() => {
    if (!hasSearch) return [];
    return filterEmployeesWithAssignedDisplayId(rows);
  }, [rows, hasSearch]);

  return (
    <div className="space-y-5 max-w-3xl mx-auto w-full">
      {selectedRow ? (
        <div className="flex items-center gap-3 rounded-xl border-2 border-primary-200 dark:border-primary-800 bg-primary-50/60 dark:bg-primary-950/30 px-4 py-3">
          <div className="min-w-0 flex-1">
            <EmployeeListIdentityBlock
              data={employeeListIdentityFromEmployeeRow({
                ...selectedRow,
                position_title: selectedRow.position?.title,
                position_title_kh:
                  selectedRow.position?.titleKh ?? selectedRow.position?.title_kh,
              })}
              avatarClassName="w-11 h-11 shrink-0 ring-2 ring-primary-200 dark:ring-primary-800"
            />
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 dark:text-primary-300 shrink-0">
            <CheckCircle2 className="w-4 h-4" aria-hidden />
            Selected
          </span>
        </div>
      ) : null}

      <ListSearchBarShell>
        <ListSearchInput
          value={query}
          onChange={onQueryChange}
          placeholder={t('offboarding.select.searchPlaceholder')}
          className="flex-1 min-w-0"
        />
      </ListSearchBarShell>

      <div className="flex items-center justify-between text-xs text-slate-500 px-0.5">
        <span className="inline-flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" aria-hidden />
          {loading
            ? t('offboarding.select.loading')
            : hasSearch
              ? `${eligibleRows.length} match${eligibleRows.length === 1 ? '' : 'es'}`
              : t('offboarding.select.pickHint')}
        </span>
        {selectedId ? (
          <span className="text-primary-600 dark:text-primary-400 font-medium">
            {t('offboarding.select.continueHint')}
          </span>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
        <div className="max-h-[min(28rem,52vh)] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {loading ? (
            <ContentSkeleton
              layout="list"
              rows={4}
              className="p-3"
              label={t('offboarding.select.loading')}
            />
          ) : !hasSearch ? (
            <p className="p-8 text-sm text-center text-slate-500">
              Type a name, ID, or email to find an employee.
            </p>
          ) : eligibleRows.length ? (
            eligibleRows.map((e) => {
              const active = selectedId === e.employee_id;
              const identity = employeeListIdentityFromEmployeeRow({
                ...e,
                position_title: e.position?.title,
                position_title_kh: e.position?.titleKh ?? e.position?.title_kh,
              });
              return (
                <button
                  key={e.employee_id}
                  type="button"
                  onClick={() => onSelect(e)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-all ${
                    active
                      ? 'bg-primary-50 dark:bg-primary-950/40 border-l-4 border-l-primary-500'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 border-l-4 border-l-transparent'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <EmployeeListIdentityBlock
                      data={identity}
                      avatarClassName="w-10 h-10 shrink-0"
                    />
                  </div>
                  {active ? (
                    <CheckCircle2
                      className="w-5 h-5 text-primary-600 dark:text-primary-400 shrink-0"
                      aria-hidden
                    />
                  ) : (
                    <span className="w-5 h-5 rounded-full border-2 border-slate-200 dark:border-slate-600 shrink-0" />
                  )}
                </button>
              );
            })
          ) : (
            <p className="p-8 text-sm text-center text-slate-500">{t('offboarding.select.empty')}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default StepSelectEmployee;
