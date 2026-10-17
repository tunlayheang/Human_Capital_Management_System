import React, { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, ShieldAlert, X } from 'lucide-react';
import { Api } from '../../services/api';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useToast } from '../../context/ToastContext';
import { useConfirmDialog, asPromptReason } from '../../hooks/useConfirmDialog';
import type { EmployeeSensitiveChange, SensitiveFieldChange } from '../../types';
import { normalizeEmployeeDisplayId } from '../../utils';

function formatWhen(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function fieldChangeLabel(change: SensitiveFieldChange): string {
  const label = String(change.label ?? '').trim();
  if (label) return label;
  const field = String(change.field ?? '').trim();
  if (!field) return 'Field';
  return field
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function FieldDiffTable({ changes }: { changes: SensitiveFieldChange[] }) {
  if (!changes.length) return <p className="text-xs text-slate-500">No field diff recorded.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 uppercase tracking-wide">
          <tr>
            <th className="text-left py-2 px-3 font-semibold">Field</th>
            <th className="text-left py-2 px-3 font-semibold">Before</th>
            <th className="text-left py-2 px-3 font-semibold">After</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {changes.map((c, index) => (
            <tr key={`${c.field || 'field'}-${index}`}>
              <td className="py-2 px-3 font-medium text-slate-700 dark:text-slate-200">
                {fieldChangeLabel(c)}
              </td>
              <td className="py-2 px-3 text-slate-500">
                {String(c.beforeDisplay ?? c.before ?? '—')}
              </td>
              <td className="py-2 px-3 text-slate-900 dark:text-white font-medium">
                {String(c.afterDisplay ?? c.after ?? '—')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const EmployeeSensitiveChangesPanel: React.FC = () => {
  const { showToast } = useToast();
  const { prompt, ConfirmDialogHost } = useConfirmDialog();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<EmployeeSensitiveChange[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await Api.employees.listSensitiveChanges({ status: 'pending', limit: 100 });
      setRows((res.changes ?? []).filter((row) => row.status === 'pending'));
    } catch (e) {
      console.error(e);
      showToast('Could not load sensitive changes.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async (id: string) => {
    setBusyId(id);
    try {
      await Api.employees.approveSensitiveChange(id);
      showToast('Change approved and applied.', 'success');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Approval failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id: string) => {
    const notes = asPromptReason(
      await prompt({
        title: 'Reject change',
        description: 'Add a reason why this change is being rejected. The requester will be notified.',
        variant: 'danger',
        confirmLabel: 'Reject',
        reasonPlaceholder: 'Rejection reason (required)',
        reasonRequired: true,
      })
    );
    if (notes === null) return;
    setBusyId(id);
    try {
      await Api.employees.rejectSensitiveChange(id, notes.trim());
      showToast('Change rejected.', 'success');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Rejection failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <Card className="border-none shadow-sm p-5 text-sm text-slate-500 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading sensitive changes…
      </Card>
    );
  }

  if (!rows.length) return null;

  return (
    <>
      <ConfirmDialogHost />
      <Card className="border-none shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200/70 dark:border-amber-900/40">
        <ShieldAlert className="w-4 h-4 text-amber-700 dark:text-amber-300 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            Sensitive change approvals
          </p>
          <p className="text-xs text-slate-500">
            Pending placement and pay changes only. Applied, approved, and rejected history is in Audit
            Trail.
          </p>
        </div>
        <Badge variant="warning">{rows.length} pending</Badge>
      </div>

      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((row) => {
          const changes = Array.isArray(row.field_changes) ? row.field_changes : [];
          return (
            <div key={row.id} className="p-4 sm:p-5 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white break-words">
                    {normalizeEmployeeDisplayId(row.employee_id)}
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      {row.change_source === 'movement'
                        ? 'Movement'
                        : row.change_source === 'field_correction'
                          ? 'Field correction'
                          : 'Profile update'}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Submitted {formatWhen(row.created_at)}
                  </p>
                </div>
              </div>
              <Badge variant="warning" className="max-w-full">
                pending
              </Badge>
              <p className="text-sm text-slate-700 dark:text-slate-300 break-words">
                <span className="text-slate-400">Reason: </span>
                {row.change_reason}
              </p>
              {row.effective_date ? (
                <p className="text-xs text-slate-500">
                  Effective {row.effective_date.slice(0, 10)}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  icon={<X className="w-3.5 h-3.5" />}
                  disabled={busyId === row.id}
                  onClick={() => void reject(row.id)}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  icon={<Check className="w-3.5 h-3.5" />}
                  disabled={busyId === row.id}
                  onClick={() => void approve(row.id)}
                >
                  Approve
                </Button>
              </div>
              <FieldDiffTable changes={changes} />
            </div>
          );
        })}
      </div>
    </Card>
    </>
  );
};
