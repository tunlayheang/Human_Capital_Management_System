import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { LoadingState } from '../../components/common/LoadingState';
import { Api } from '../../services/api';
import type { UnifiedPayrollRule, UnifiedRuleConflict } from '../../types/unifiedPayrollRules';
import { RulesConfigHelp } from '../../components/ui/RulesConfigHelp';
import type { LeaveType } from '../../types';
import { normalizeUnifiedRule } from './payrollRulesDisplay';
import { useLanguage } from '../../context/LanguageContext';
import {
  localizedLabelUsesKhmerFont,
  resolveLeaveTypeDisplayName,
} from '../../utils/localizedEntityLabel';
import { cn } from '../../utils';

const LEAVE_PRESETS = [
  {
    id: 'paid' as const,
    headline: 'Paid leave',
    payrollLine: 'Paid leave → payable day',
    tone: 'sky' as const,
  },
  {
    id: 'unpaid' as const,
    headline: 'Unpaid leave',
    payrollLine: 'Unpaid leave → deduct day',
    tone: 'amber' as const,
  },
] as const;

const sectionHeaderClass =
  'flex flex-row flex-wrap items-center justify-between gap-2 px-5 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700';

const toneStyles = {
  sky: {
    card: 'border-sky-200 bg-sky-50/70 dark:border-sky-800 dark:bg-sky-950/25',
    title: 'text-sky-900 dark:text-sky-100',
    body: 'text-sky-800/90 dark:text-sky-200/90',
    badge: 'info' as const,
  },
  amber: {
    card: 'border-amber-200 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/25',
    title: 'text-amber-900 dark:text-amber-100',
    body: 'text-amber-800/90 dark:text-amber-200/90',
    badge: 'warning' as const,
  },
};

type Props = { canEdit?: boolean };

/** View-only: paid vs unpaid leave always map to the two fixed payroll outcomes. */
export const UnifiedPayrollRulesSection: React.FC<Props> = () => {
  const { language } = useLanguage();
  const [rules, setRules] = useState<UnifiedPayrollRule[]>([]);
  const [conflicts, setConflicts] = useState<UnifiedRuleConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c, types] = await Promise.all([
        Api.payroll.getUnifiedPayrollRules(),
        Api.payroll.getUnifiedRuleConflicts(),
        Api.leaves.getTypes().catch(() => [] as LeaveType[]),
      ]);
      setRules(r.map(normalizeUnifiedRule).filter((rule) => rule.category === 'leave'));
      setConflicts(c);
      setLeaveTypes(Array.isArray(types) ? types : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { paidLeaveTypes, unpaidLeaveTypes } = useMemo(() => {
    const paid: LeaveType[] = [];
    const unpaid: LeaveType[] = [];
    for (const lt of leaveTypes) {
      if (lt.isPaid === false) unpaid.push(lt);
      else paid.push(lt);
    }
    return { paidLeaveTypes: paid, unpaidLeaveTypes: unpaid };
  }, [leaveTypes]);

  const renderLeaveTypeList = (items: LeaveType[], emptyLabel: string) => {
    if (!items.length) {
      return <p className="text-xs text-slate-400 italic py-2">{emptyLabel}</p>;
    }
    return (
      <ul className="space-y-1">
        {items.map((lt) => (
          <li
            key={lt.id}
            className={cn(
              'text-sm font-medium text-slate-800 dark:text-slate-200 py-1.5 px-2 rounded-md',
              localizedLabelUsesKhmerFont(lt.name, lt.nameKh, language) && 'font-khmer'
            )}
          >
            {resolveLeaveTypeDisplayName(lt, language)}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <Card className="overflow-hidden relative h-full border border-slate-200/80 dark:border-slate-700 shadow-sm">
      <RulesConfigHelp help="payroll.unifiedRules" className="absolute top-3 right-3 z-10" />
      <div className={`${sectionHeaderClass} pr-11 px-4 py-2.5`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">
              Leave payroll rules
            </p>
            <Badge variant="neutral" className="text-[10px] uppercase tracking-wide">
              View only
            </Badge>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {conflicts.length > 0 && (
          <Card className="border-amber-200 bg-amber-50/80 dark:bg-amber-950/30 dark:border-amber-800 p-3">
            <div className="flex gap-2 items-start">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <ul className="text-xs text-amber-800 dark:text-amber-200 space-y-0.5">
                {conflicts.map((c, i) => (
                  <li key={i}>{c.message}</li>
                ))}
              </ul>
            </div>
          </Card>
        )}

        {loading ? (
          <LoadingState variant="panel" layout="cards" label="Loading work & leave rules…" className="py-2" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-stretch">
            <div className="min-w-0 flex flex-col rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white/90 dark:bg-slate-800/90 shadow-sm overflow-hidden h-full">
              <div className="px-3 py-2.5 border-b flex flex-wrap items-center justify-between gap-2 bg-slate-50/80 dark:bg-slate-900/50">
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-slate-900 dark:text-white">Your leave types</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {leaveTypes.length} type{leaveTypes.length === 1 ? '' : 's'}
                  </p>
                </div>
                <Link
                  to="/leaves?scope=manage&tab=config"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-primary-600 hover:underline shrink-0"
                >
                  Configure
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
              <div className="p-3 space-y-3 flex-1 min-h-[10rem]">
                {LEAVE_PRESETS.map((preset) => {
                  const styles = toneStyles[preset.tone];
                  const items = preset.id === 'paid' ? paidLeaveTypes : unpaidLeaveTypes;
                  return (
                    <div key={preset.id} className={`rounded-lg border p-2.5 ${styles.card}`}>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <p className={`text-xs font-semibold ${styles.title}`}>{preset.headline}</p>
                        <Badge variant={styles.badge} className="text-[10px]">
                          {items.length}
                        </Badge>
                      </div>
                      <div className="max-h-28 overflow-y-auto">
                        {renderLeaveTypeList(
                          items,
                          preset.id === 'paid' ? 'No paid types yet' : 'No unpaid types yet'
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="min-w-0 flex flex-col rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white/90 dark:bg-slate-800/90 shadow-sm overflow-hidden h-full">
              <div className="px-3 py-2.5 border-b bg-slate-50/80 dark:bg-slate-900/50">
                <p className="font-semibold text-sm text-slate-900 dark:text-white">Payroll rules</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Always on for paid / unpaid leave</p>
              </div>
              <div className="p-3 flex-1 flex flex-col gap-3">
                {LEAVE_PRESETS.map((preset) => {
                  const styles = toneStyles[preset.tone];
                  return (
                    <div key={preset.id} className={`rounded-lg border px-2.5 py-2 ${styles.card}`}>
                      <p className={`text-[11px] font-semibold flex items-center gap-1.5 ${styles.title}`}>
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        {preset.payrollLine}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};
