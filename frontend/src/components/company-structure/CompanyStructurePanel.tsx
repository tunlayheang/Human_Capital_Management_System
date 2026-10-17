import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Api } from '../../services/api';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useLanguage } from '../../context/LanguageContext';
import { CompanyStructureTree } from './CompanyStructureTree';
import { CompanyStructureEmployeeModal } from './CompanyStructureEmployeeModal';
import type { CompanyStructureMember, CompanyStructurePayload } from '../../types/companyStructure';
import { LoadingState } from '../common/LoadingState';

type Props = {
  /** When false, skips fetch and clears selection (modal closed). */
  active?: boolean;
  /** Notifies parent when the employee brief popup is open (for nested modal close handling). */
  onEmployeeModalOpenChange?: (open: boolean) => void;
};

export const CompanyStructurePanel: React.FC<Props> = ({
  active = true,
  onEmployeeModalOpenChange,
}) => {
  const { t } = useLanguage();
  const [data, setData] = useState<CompanyStructurePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<CompanyStructureMember | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = (await Api.companyStructure.get()) as CompanyStructurePayload;
      setData(payload);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : 'Failed to load company structure');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) {
      setSelectedMember(null);
      return;
    }
    void load();
  }, [active, load]);

  useEffect(() => {
    onEmployeeModalOpenChange?.(!!selectedMember);
  }, [selectedMember, onEmployeeModalOpenChange]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2 mb-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void load()}
          disabled={loading || !active}
          title="Refresh"
          aria-label="Refresh"
          iconOnly
          icon={<RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />}
        />
      </div>

      {data && !loading && (
        <div className="flex flex-wrap gap-3 text-sm mb-4">
          <Card className="px-4 py-2 flex items-center gap-2 shadow-none border-slate-200 dark:border-slate-700">
            <span className="text-slate-500">{t('companyStructure.statOffices') || 'Offices'}</span>
            <span className="font-bold text-slate-900 dark:text-white">{data.totals.offices}</span>
          </Card>
          <Card className="px-4 py-2 flex items-center gap-2 shadow-none border-slate-200 dark:border-slate-700">
            <span className="text-slate-500">
              {t('companyStructure.statDepartments') || 'Departments'}
            </span>
            <span className="font-bold text-slate-900 dark:text-white">{data.totals.departments}</span>
          </Card>
          <Card className="px-4 py-2 flex items-center gap-2 shadow-none border-slate-200 dark:border-slate-700">
            <span className="text-slate-500">{t('companyStructure.statEmployees') || 'Employees'}</span>
            <span className="font-bold text-slate-900 dark:text-white">{data.totals.employees}</span>
          </Card>
        </div>
      )}

      {loading && (
        <Card className="p-4">
          <LoadingState
            variant="panel"
            layout="cards"
            label={t('companyStructure.loading') || 'Loading organization…'}
          />
        </Card>
      )}

      {error && !loading && (
        <Card className="p-8 text-center">
          <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
          <Button onClick={() => void load()}>{t('common.retry') || 'Retry'}</Button>
        </Card>
      )}

      {data && !loading && !error && data.offices.length === 0 && data.totals.employees === 0 && (
        <Card className="hcms-empty-state">
          {t('companyStructure.empty') || 'No active employees to display.'}
        </Card>
      )}

      {data && !loading && !error && (data.offices.length > 0 || data.totals.employees > 0) && (
        <CompanyStructureTree
          data={data}
          selectedMemberId={selectedMember?.id ?? null}
          onSelectMember={setSelectedMember}
        />
      )}

      {selectedMember && (
        <CompanyStructureEmployeeModal
          member={selectedMember}
          onClose={() => setSelectedMember(null)}
        />
      )}
    </>
  );
};
