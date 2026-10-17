import React, { useMemo } from 'react';
import type { ProbationEvaluationRatings, ProbationRow } from '../../types';
import {
  PROBATION_CRITERION_LABELS,
  ratingLabel,
  resolveCriterionCombinedSummary,
} from './probationDualScore';

type EvaluatorRef = { userId: string; name?: string | null; submitted?: boolean };

type Props = {
  row: Pick<
    ProbationRow,
    'evaluatorRatingsByUserId' | 'employeeRatings' | 'managerRatings'
  >;
  evaluators?: EvaluatorRef[];
  description?: string;
  compact?: boolean;
};

export const CombinedProbationScoresTable: React.FC<Props> = ({
  row,
  evaluators = [],
  description,
  compact = false,
}) => {
  const evaluatorRatingsByUserId = useMemo(() => {
    const fromPayload = row.evaluatorRatingsByUserId ?? {};
    if (Object.keys(fromPayload).length) return fromPayload;
    if (row.managerRatings) {
      const legacyId = evaluators[0]?.userId ?? 'manager';
      return { [legacyId]: row.managerRatings };
    }
    return {};
  }, [evaluators, row.evaluatorRatingsByUserId, row.managerRatings]);

  const headers = useMemo(() => {
    if (evaluators.length) {
      return evaluators.map((ev, index) => ({
        key: String(ev.userId),
        label: String(ev.name ?? '').trim().split(/\s+/)[0] || `Evaluator ${index + 1}`,
      }));
    }
    return [{ key: 'management', label: 'Management' }];
  }, [evaluators]);

  const thClass = compact
    ? 'py-2 text-right text-[10px] font-semibold'
    : 'py-2 text-right text-xs uppercase';

  return (
    <div className="space-y-2">
      {description ? <p className="text-xs text-slate-500">{description}</p> : null}
      <div className="overflow-x-auto -mx-1">
        <table className={`w-full text-sm ${compact ? 'min-w-[32rem]' : 'min-w-[36rem]'}`}>
          <thead>
            <tr className="text-xs uppercase text-slate-500 border-b">
              <th className="py-2 text-left pl-1">Criterion</th>
              {headers.map((header) => (
                <th key={header.key} className={thClass}>
                  {header.label}
                </th>
              ))}
              <th className={thClass}>Employee</th>
              <th className={`${thClass} pr-1`}>Combined</th>
            </tr>
          </thead>
          <tbody>
            {PROBATION_CRITERION_LABELS.map(({ key, label }) => {
              const summary = resolveCriterionCombinedSummary(
                key,
                evaluatorRatingsByUserId,
                evaluators,
                row.employeeRatings ?? null
              );
              const columnByUser = new Map(
                summary.evaluatorColumns.map((col) => [col.userId, col.rating])
              );

              return (
                <tr
                  key={key}
                  className="border-b border-slate-100 dark:border-slate-800 last:border-0"
                >
                  <td className="py-2 pl-1 font-medium">{label}</td>
                  {headers.map((header) => {
                    if (header.key === 'management') {
                      return (
                        <td key={header.key} className="py-2 text-right">
                          {ratingLabel(summary.managementAverage)}
                        </td>
                      );
                    }
                    return (
                      <td key={header.key} className="py-2 text-right">
                        {ratingLabel(columnByUser.get(header.key) ?? null)}
                      </td>
                    );
                  })}
                  <td className="py-2 text-right">{ratingLabel(summary.employeeRating)}</td>
                  <td className="py-2 text-right font-semibold pr-1">
                    {ratingLabel(summary.combinedRating)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
