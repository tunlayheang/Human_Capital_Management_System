import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRightLeft,
  BadgeDollarSign,
  CheckCircle2,
  ExternalLink,
  TrendingUp,
} from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Api } from '../../services/api';
import type { EmployeeAppraisal } from '../../types/appraisal';
import type { EmployeeMovementRow } from '../../types/employeeMovement';
import type { KpiGradeDefinition } from '../settings/KpiGradeSettingsPanel';
import {
  isAppraisalReadyForMovement,
  payRaiseRateForGrade,
  suggestMovementTypeFromGrade,
} from './appraisalMovementUtils';
import { MovementSummaryRow } from '../employee/employeeMovementDisplay';

type Props = {
  appraisal: EmployeeAppraisal & { employeeCode?: string | null; periodEndDate?: string | null };
  linkedMovements: EmployeeMovementRow[];
  onRecordMovement: (type: 'promotion' | 'salary_update' | 'transfer') => void;
};

export const AppraisalMovementFollowUp: React.FC<Props> = ({
  appraisal,
  linkedMovements,
  onRecordMovement,
}) => {
  const [grades, setGrades] = useState<KpiGradeDefinition[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Api.analytics
      .getKpiGrades()
      .then((res) => {
        if (cancelled) return;
        const rows = (res as { grades?: KpiGradeDefinition[] })?.grades;
        setGrades(Array.isArray(rows) ? rows : null);
      })
      .catch(() => {
        if (!cancelled) setGrades(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = isAppraisalReadyForMovement(appraisal.workflow_status);
  const hasEmployee = Boolean(String(appraisal.employeeCode ?? '').trim());
  const suggested = suggestMovementTypeFromGrade(appraisal.final_grade);
  const raiseRate = payRaiseRateForGrade(appraisal.final_grade, grades);

  if (!ready) {
    return (
      <Card className="p-4 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
          Employee movement follow-up
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Final-approve this appraisal first. After approval, you can record a promotion or pay change
          in Employee movements with the appraisal linked for audit.
        </p>
      </Card>
    );
  }

  if (!hasEmployee) {
    return (
      <Card className="p-4 border-amber-200 bg-amber-50/80 dark:bg-amber-950/30 dark:border-amber-800">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
          Cannot link to employee movement
        </p>
        <p className="text-xs text-amber-800/90 dark:text-amber-200/90 mt-1">
          This user account is not linked to an HR employee record. Link the user to an employee profile
          before recording a movement from this appraisal.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4 border-primary-200 dark:border-primary-800 bg-primary-50/40 dark:bg-primary-950/20">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              Next step: record in Employee movements
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-xl">
              Appraisal outcomes (promotion, role change, or pay adjustment) are applied through{' '}
              <strong>Employee movements</strong>. The movement will stay linked to this appraisal.
            </p>
            {appraisal.recommendation && (
              <p className="text-xs text-amber-800 dark:text-amber-300 mt-2">
                System recommendation: {appraisal.recommendation}
              </p>
            )}
            {raiseRate > 0 && (suggested === 'promotion' || suggested === 'salary_update') ? (
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                Pay raise rate for grade {appraisal.final_grade}:{' '}
                <span className="font-semibold text-primary-600 dark:text-primary-400">
                  {raiseRate}%
                </span>
              </p>
            ) : null}
          </div>
          <Link
            to="/employees/movements"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline shrink-0"
          >
            Open movements
            <ExternalLink className="w-3 h-3" />
          </Link>
        </div>

        {linkedMovements.length > 0 && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/50 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
            {linkedMovements.map((m) => (
              <MovementSummaryRow key={m.id} row={m} />
            ))}
          </div>
        )}

        {linkedMovements.length === 0 ? (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              variant={suggested === 'promotion' ? 'primary' : 'outline'}
              onClick={() => onRecordMovement('promotion')}
            >
              <TrendingUp className="w-4 h-4 mr-1" />
              Record promotion
            </Button>
            <Button
              size="sm"
              variant={suggested === 'salary_update' ? 'primary' : 'outline'}
              onClick={() => onRecordMovement('salary_update')}
            >
              <BadgeDollarSign className="w-4 h-4 mr-1" />
              Record pay change
            </Button>
            <Button size="sm" variant="outline" onClick={() => onRecordMovement('transfer')}>
              <ArrowRightLeft className="w-4 h-4 mr-1" />
              Record transfer
            </Button>
          </div>
        ) : (
          <p className="text-xs text-emerald-700 dark:text-emerald-300 pt-1">
            Movement recorded — this appraisal will appear under Complete after you refresh.
          </p>
        )}

        {suggested && linkedMovements.length === 0 && (
          <Badge variant="info" className="self-start text-[10px]">
            Suggested for grade {appraisal.final_grade}:{' '}
            {suggested === 'promotion' ? 'promotion' : 'pay change'}
          </Badge>
        )}
      </div>
    </Card>
  );
};
