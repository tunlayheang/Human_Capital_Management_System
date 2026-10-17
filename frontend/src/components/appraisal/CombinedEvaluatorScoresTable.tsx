import React, { useMemo } from 'react';
import { formatAppraisalScore, type ComponentScore } from '../../types/appraisal';
import {
  buildEvaluatorScoreColumns,
  evaluatorDisplayLabel,
  resolveCombinedScoreSummary,
  roundComponentWeightedScore,
} from './appraisalDualScore';
import { AppraisalDualScoreHelp } from './AppraisalDualScoreHelp';

type EvaluatorRef = { userId: string; name?: string | null; submitted?: boolean };

type Props = {
  componentScores: ComponentScore[];
  evaluators?: EvaluatorRef[];
  description?: string;
  compact?: boolean;
};

export const CombinedEvaluatorScoresTable: React.FC<Props> = ({
  componentScores,
  evaluators = [],
  description,
  compact = false,
}) => {
  const headers = useMemo(() => {
    if (evaluators.length) {
      return evaluators.map((ev, index) => ({
        key: String(ev.userId),
        label: evaluatorDisplayLabel(ev.name, `Evaluator ${index + 1}`),
      }));
    }
    return [{ key: 'management', label: 'Management' }];
  }, [evaluators]);

  if (!componentScores.length) return null;

  let tableWeightedSum = 0;
  const metricThClass = compact
    ? 'py-2 text-right text-[10px] font-semibold uppercase'
    : 'py-2 text-right text-xs uppercase';
  const nameThClass = compact
    ? 'py-2 text-right text-[10px] font-semibold normal-case text-slate-600 dark:text-slate-400'
    : 'py-2 text-right text-xs font-medium normal-case text-slate-600 dark:text-slate-400';

  return (
    <div className="space-y-2">
      {description ? <p className="text-xs text-slate-500">{description}</p> : null}
      <div className="overflow-x-auto -mx-1">
        <table className={`w-full text-sm ${compact ? 'min-w-[32rem]' : 'min-w-[36rem]'}`}>
          <thead>
            <tr className="text-xs uppercase text-slate-500 border-b">
              <th className="py-2 text-left pl-1">Component</th>
              {headers.map((header) => (
                <th key={header.key} className={nameThClass} title={header.label}>
                  {header.label}
                </th>
              ))}
              <th className={metricThClass}>Employee</th>
              <th className={metricThClass}>Average</th>
              <th className={metricThClass}>Weight</th>
              <th className={`${metricThClass} pr-1`}>Weighted</th>
            </tr>
          </thead>
          <tbody>
            {componentScores.map((component) => {
              const summary = resolveCombinedScoreSummary(component, evaluators);
              const columns = buildEvaluatorScoreColumns(component, evaluators);
              const columnByUser = new Map(columns.map((col) => [col.userId, col.score]));
              const weighted = roundComponentWeightedScore(summary.averageScore, component.weightPercent);
              tableWeightedSum += weighted;

              return (
                <tr
                  key={component.id}
                  className="border-b border-slate-100 dark:border-slate-800 last:border-0"
                >
                  <td className="py-2 pl-1 font-medium">{component.componentName}</td>
                  {headers.map((header) => {
                    if (header.key === 'management') {
                      return (
                        <td key={header.key} className="py-2 text-right tabular-nums">
                          {summary.managementAverage != null
                            ? formatAppraisalScore(summary.managementAverage)
                            : '—'}
                        </td>
                      );
                    }
                    const score = columnByUser.get(header.key);
                    return (
                      <td key={header.key} className="py-2 text-right tabular-nums">
                        {score != null ? formatAppraisalScore(score) : '—'}
                      </td>
                    );
                  })}
                  <td className="py-2 text-right tabular-nums">
                    {summary.employeeScore != null
                      ? formatAppraisalScore(summary.employeeScore)
                      : '—'}
                  </td>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    <span className="inline-flex items-center justify-end gap-1">
                      {formatAppraisalScore(summary.averageScore)}
                      <AppraisalDualScoreHelp
                        componentName={component.componentName}
                        summary={summary}
                        autoCalculated={summary.isAutoCalculated}
                        className="h-3.5 w-3.5 text-[8px]"
                      />
                    </span>
                  </td>
                  <td className="py-2 text-right text-slate-500 tabular-nums">
                    {component.weightPercent}%
                  </td>
                  <td className="py-2 text-right font-semibold tabular-nums pr-1">
                    {formatAppraisalScore(weighted, 2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 dark:border-slate-700">
              <td
                colSpan={headers.length + 4}
                className="py-2 pl-1 text-right text-xs font-semibold uppercase text-slate-500"
              >
                Overall weighted score
              </td>
              <td className="py-2 text-right font-bold tabular-nums text-primary-600 pr-1">
                {formatAppraisalScore(Math.round(tableWeightedSum * 100) / 100)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};
