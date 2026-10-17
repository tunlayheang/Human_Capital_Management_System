import React, { useMemo, useState } from 'react';
import { ChevronDown, Loader2, Sparkles } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { inputClass } from '../../constants/designSystem';
import {
  clampKpiScore,
  formatAppraisalScore,
  type ComponentScore,
} from '../../types/appraisal';
import { resolveDualScoreSummary } from './appraisalDualScore';

export type EmployeeSelfEvalDraft = {
  scores: Record<string, number>;
  strengths: string;
  weaknesses: string;
  notes: string;
};

type Props = {
  periodName: string;
  componentScores: ComponentScore[];
  managerEvaluation?: {
    strengths?: string | null;
    weaknesses?: string | null;
    managerRecommendations?: string | null;
  } | null;
  submitting?: boolean;
  onSubmit: (draft: EmployeeSelfEvalDraft) => Promise<void>;
};

function suggestScore(component: ComponentScore): number {
  const dual = resolveDualScoreSummary(component, true);
  if (dual.hasManagerScore) return clampKpiScore(dual.averageScore);
  return clampKpiScore(Number(component.raw_score));
}

function scoreTone(score: number): string {
  if (score >= 85) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 70) return 'text-amber-600 dark:text-amber-400';
  return 'text-orange-600 dark:text-orange-400';
}

function scoreTrackClass(score: number): string {
  if (score >= 85) return 'accent-emerald-500';
  if (score >= 70) return 'accent-amber-500';
  return 'accent-orange-500';
}

export function buildInitialSelfEvalDraft(componentScores: ComponentScore[]): EmployeeSelfEvalDraft {
  const scores: Record<string, number> = {};
  for (const s of componentScores) {
    scores[s.component_id] = suggestScore(s);
  }
  return { scores, strengths: '', weaknesses: '', notes: '' };
}

export const EmployeeKpiSelfEvaluationForm: React.FC<Props> = ({
  periodName,
  componentScores,
  managerEvaluation,
  submitting = false,
  onSubmit,
}) => {
  const [draft, setDraft] = useState<EmployeeSelfEvalDraft>(() =>
    buildInitialSelfEvalDraft(componentScores)
  );
  const [showFeedback, setShowFeedback] = useState(false);

  const ratedCount = componentScores.length;
  const selfWeighted = useMemo(() => {
    let sum = 0;
    for (const s of componentScores) {
      const raw = draft.scores[s.component_id] ?? 0;
      sum += (raw * Number(s.weightPercent ?? 0)) / 100;
    }
    return Math.round(sum * 100) / 100;
  }, [componentScores, draft.scores]);

  const handleSubmit = () => {
    void onSubmit(draft);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-amber-200/80 dark:border-amber-900/40 bg-gradient-to-br from-amber-50/90 to-orange-50/50 dark:from-amber-950/30 dark:to-orange-950/20 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              Rate yourself for {periodName}
            </p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Slide each KPI to match how you see your performance. Manager scores are shown for
              reference — written comments are optional.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="inline-flex items-center gap-2 rounded-lg bg-white/80 dark:bg-slate-900/50 border border-amber-200/60 dark:border-amber-900/30 px-3 py-1.5">
            <span className="text-slate-500">Your overall</span>
            <span className={`font-bold tabular-nums text-lg ${scoreTone(selfWeighted)}`}>
              {formatAppraisalScore(selfWeighted)}
            </span>
          </span>
          <span className="text-slate-500">{ratedCount} KPI components</span>
        </div>
      </div>

      {managerEvaluation?.strengths || managerEvaluation?.weaknesses ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40 p-4 text-sm space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Manager feedback (for reference)
          </p>
          {managerEvaluation.strengths ? (
            <p>
              <span className="text-slate-500">Strengths: </span>
              {managerEvaluation.strengths}
            </p>
          ) : null}
          {managerEvaluation.weaknesses ? (
            <p>
              <span className="text-slate-500">Areas for improvement: </span>
              {managerEvaluation.weaknesses}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-3">
        {componentScores.map((component) => {
          const score = draft.scores[component.component_id] ?? suggestScore(component);
          const dual = resolveDualScoreSummary(component, true);
          const isAuto = Number(component.auto_calculated) === 1;

          return (
            <div
              key={component.component_id}
              className="rounded-xl border border-slate-200/80 dark:border-slate-700/60 bg-white dark:bg-slate-900/40 p-4 shadow-sm shadow-slate-200/20 dark:shadow-none"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {component.componentName}
                    </p>
                    {isAuto ? (
                      <Badge variant="success" className="text-[10px]">
                        Auto KPI
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">Weight {component.weightPercent}%</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {dual.evaluatorColumns.map((col) =>
                    col.score != null ? (
                      <span
                        key={col.userId}
                        className="inline-flex items-center rounded-md bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 text-[11px] text-indigo-700 dark:text-indigo-300"
                      >
                        {col.label} {formatAppraisalScore(col.score)}
                      </span>
                    ) : null
                  )}
                  {!dual.evaluatorColumns.length &&
                  dual.hasManagerScore &&
                  dual.managerScore != null ? (
                    <span className="inline-flex items-center rounded-md bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 text-[11px] text-indigo-700 dark:text-indigo-300">
                      Management {formatAppraisalScore(dual.managerScore)}
                    </span>
                  ) : null}
                  {dual.isAutoCalculated &&
                  dual.autoBaselineScore != null &&
                  !dual.evaluatorColumns.length ? (
                    <span className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                      Auto {formatAppraisalScore(dual.autoBaselineScore)}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={score}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      scores: {
                        ...prev.scores,
                        [component.component_id]: clampKpiScore(Number(e.target.value)),
                      },
                    }))
                  }
                  className={`flex-1 h-2 rounded-full cursor-pointer ${scoreTrackClass(score)}`}
                  aria-label={`Your score for ${component.componentName}`}
                />
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className={`${inputClass} w-16 text-center tabular-nums font-semibold`}
                    value={score}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        scores: {
                          ...prev.scores,
                          [component.component_id]: clampKpiScore(Number(e.target.value)),
                        },
                      }))
                    }
                  />
                  <span className="text-xs text-slate-400">/100</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowFeedback((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        >
          <span>Add written feedback (optional)</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${showFeedback ? 'rotate-180' : ''}`}
          />
        </button>
        {showFeedback ? (
          <div className="px-4 pb-4 space-y-3 border-t border-slate-100 dark:border-slate-800">
            <div>
              <label className="text-xs font-medium text-slate-600">Key strengths</label>
              <textarea
                className={`${inputClass} mt-1 w-full`}
                rows={2}
                value={draft.strengths}
                onChange={(e) => setDraft((p) => ({ ...p, strengths: e.target.value }))}
                placeholder="What went well this period?"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Areas for improvement</label>
              <textarea
                className={`${inputClass} mt-1 w-full`}
                rows={2}
                value={draft.weaknesses}
                onChange={(e) => setDraft((p) => ({ ...p, weaknesses: e.target.value }))}
                placeholder="What would you like to improve?"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Additional comments</label>
              <textarea
                className={`${inputClass} mt-1 w-full`}
                rows={2}
                value={draft.notes}
                onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Anything else HR should know?"
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
        <p className="text-xs text-slate-500">
          Submitting sends your scores to HR for final review. You can adjust sliders until you
          submit.
        </p>
        <Button disabled={submitting} onClick={handleSubmit} className="sm:min-w-[180px]">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit self-evaluation'}
        </Button>
      </div>
    </div>
  );
};
