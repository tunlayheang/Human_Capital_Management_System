import React from 'react';
import { Badge } from '../ui/Badge';
import { StatusLabel } from '../ui/StatusLabel';
import type { ProbationRow } from '../../types';
import { probationStatusLabel } from './probationReviewUi';
import { ProbationApprovalTracker, probationRecommendationLabel } from './probationApprovalDisplay';
import { EmployeeListIdentityBlock, employeeListIdentityFromProbationRow } from '../employee/EmployeeListIdentity';

const RATING_LABELS: Record<string, string> = {
  excellent: 'Excellent',
  good: 'Good',
  satisfactory: 'Satisfactory',
  needs_improvement: 'Needs improvement',
  unsatisfactory: 'Unsatisfactory',
};

function RatingGrid({
  title,
  ratings,
  strengths,
  areas,
  recommendation,
}: {
  title: string;
  ratings?: ProbationRow['ratings'] | null;
  strengths?: string;
  areas?: string;
  recommendation?: string | null;
}) {
  if (!ratings && !strengths && !areas && !recommendation) return null;
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 p-4 space-y-3">
      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h4>
      {ratings ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          {(['jobPerformance', 'attendance', 'workAttitude', 'teamwork'] as const).map((key) => (
            <div key={key}>
              <p className="text-slate-500 uppercase tracking-wide font-semibold mb-1">
                {key.replace(/([A-Z])/g, ' $1')}
              </p>
              <p className="text-slate-800 dark:text-slate-200">
                {ratings[key] ? RATING_LABELS[ratings[key] as string] ?? ratings[key] : '—'}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {strengths ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Strengths</p>
          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{strengths}</p>
        </div>
      ) : null}
      {areas ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
            Areas for improvement
          </p>
          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{areas}</p>
        </div>
      ) : null}
      {recommendation ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
            Overall recommendation
          </p>
          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{recommendation}</p>
        </div>
      ) : null}
    </section>
  );
}

export const ProbationReviewDocument: React.FC<{
  row: ProbationRow;
  viewerUserId?: string;
}> = ({ row, viewerUserId }) => {
  const pendingRec = row.recommendation;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="surface-card shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-teal-700 to-teal-900 px-5 py-4 text-white">
          <p className="text-xs uppercase tracking-[0.18em] text-teal-100/90">Probation review</p>
          <h3 className="text-xl font-semibold mt-1">{row.name}</h3>
          <p className="text-sm text-teal-100/90 mt-1">
            {row.departmentName ?? 'Department'} · End {row.probationEnd ?? '—'}
          </p>
        </div>
        <div className="p-5 space-y-4">
          <EmployeeListIdentityBlock data={employeeListIdentityFromProbationRow(row)} showSubtitle />
          <div className="flex flex-wrap gap-2">
            <StatusLabel
              status={row.status}
              context="probation"
              label={probationStatusLabel(row.status)}
            />
            {pendingRec ? (
              <Badge variant="neutral">Outcome: {probationRecommendationLabel(pendingRec)}</Badge>
            ) : null}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">HR assignee</p>
              <p className="text-slate-800 dark:text-slate-200">{row.assignedHrName ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Manager assignee</p>
              <p className="text-slate-800 dark:text-slate-200">{row.assignedManagerName ?? '—'}</p>
            </div>
          </div>
          {row.hrNotes ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-950/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">HR notes</p>
              <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{row.hrNotes}</p>
            </div>
          ) : null}
          <ProbationApprovalTracker row={row} viewerUserId={viewerUserId} />
        </div>
      </div>

      <RatingGrid
        title="Manager evaluation"
        ratings={row.managerRatings ?? row.ratings}
        strengths={row.managerStrengths || row.strengths}
        areas={row.managerAreasForImprovement || row.areasForImprovement}
        recommendation={row.managerOverallRecommendation || row.overallRecommendation}
      />
      <RatingGrid
        title="Employee self-evaluation"
        ratings={row.employeeRatings}
        strengths={row.employeeStrengths}
        areas={row.employeeAreasForImprovement}
      />
    </div>
  );
};

export default ProbationReviewDocument;
