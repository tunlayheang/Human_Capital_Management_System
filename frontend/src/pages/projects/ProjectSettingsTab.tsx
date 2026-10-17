import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Api } from '../../services/api';
import { Department, Project, ProjectPriority, ProjectStatus, User } from '../../types';
import { projectLeadCandidates } from './CreateProjectModal';
import { projectService } from '../../services/projectService';
import { DatePickerInput } from '@/components/ui/shadcn/date-picker-input';
import { orderInclusiveStartEnd } from '../../utils/dateRangeFilter';
import { formatAccessRoleLabel } from '../../utils/accessRole';
import { SearchableSelect } from '../../components/ui/SearchableSelect';

type Props = {
  project: Project;
  employees: User[];
  canEditInfo: boolean;
  canEditLead: boolean;
  canEditStatus: boolean;
  onUpdated: () => void;
  showToast: (msg: string, type: 'success' | 'error') => void;
  /** Inline page section (default) or embedded in a modal dialog. */
  variant?: 'inline' | 'modal';
  formId?: string;
};

export const ProjectSettingsTab: React.FC<Props> = ({
  project,
  employees,
  canEditInfo,
  canEditLead,
  canEditStatus,
  onUpdated,
  showToast,
  variant = 'inline',
  formId,
}) => {
  const [draft, setDraft] = useState<Project>({ ...project });
  const [saving, setSaving] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);

  useEffect(() => {
    setDraft({ ...project });
  }, [project]);

  useEffect(() => {
    void Api.departments
      .getAll()
      .then((data) => setDepartments(Array.isArray(data) ? data : []))
      .catch(() => setDepartments([]));
  }, []);

  const leads = useMemo(() => projectLeadCandidates(employees), [employees]);
  const leadOptions = useMemo(
    () =>
      leads.map((e) => ({
        value: e.id,
        label: e.name,
        description: formatAccessRoleLabel(e.role),
        searchText: `${e.email ?? ''} ${e.position ?? ''}`,
      })),
    [leads]
  );

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!draft.title.trim()) {
      showToast('Project title is required', 'error');
      return;
    }
    if (!draft.leadId) {
      showToast('Project lead is required', 'error');
      return;
    }
    if (draft.startDate && draft.deadline && draft.deadline < draft.startDate) {
      showToast('Deadline must be on or after the start date', 'error');
      return;
    }
    setSaving(true);
    try {
      await projectService.update(draft);
      showToast('Project settings updated', 'success');
      onUpdated();
      if (variant === 'modal') {
        return;
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update project', 'error');
    } finally {
      setSaving(false);
    }
  };

  const fieldClass =
    'mt-1 w-full px-3 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-600 dark:text-white';

  const body = (
    <>
      {variant === 'inline' ? (
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Project Configuration</h3>
      ) : null}

      {canEditInfo && (
        <div className="space-y-4 surface-card p-4 rounded-2xl">
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-slate-400">Title</label>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className={fieldClass}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-slate-400">Description</label>
            <textarea
              rows={3}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className={fieldClass}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-slate-400">Department</label>
            <select
              value={draft.departmentId ?? ''}
              onChange={(e) => setDraft({ ...draft, departmentId: e.target.value })}
              className={fieldClass}
            >
              <option value="" disabled hidden>— Select department —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-slate-400">Priority</label>
            <select
              value={draft.priority ?? 'MEDIUM'}
              onChange={(e) => setDraft({ ...draft, priority: e.target.value as ProjectPriority })}
              className={fieldClass}
            >
              {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as ProjectPriority[]).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="responsive-form-grid gap-4">
            <div>
              <label className="text-sm font-medium">Start Date</label>
              <DatePickerInput value={draft.startDate ?? ''}
                max={draft.deadline || undefined}
                onChange={(e) => {
                  const next = orderInclusiveStartEnd(
                    e.target.value,
                    draft.deadline ?? '',
                    'startDate'
                  );
                  setDraft({
                    ...draft,
                    startDate: next.startDate,
                    deadline: next.endDate || draft.deadline,
                  });
                }}
                className={fieldClass}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Deadline</label>
              <DatePickerInput value={draft.deadline ?? ''}
                min={draft.startDate || undefined}
                onChange={(e) => {
                  const next = orderInclusiveStartEnd(
                    draft.startDate ?? '',
                    e.target.value,
                    'endDate'
                  );
                  setDraft({
                    ...draft,
                    startDate: next.startDate || draft.startDate,
                    deadline: next.endDate,
                  });
                }}
                className={fieldClass}
              />
            </div>
          </div>
        </div>
      )}

      {canEditLead && (
        <div className="surface-card p-4 rounded-2xl">
          <label className="text-sm font-medium text-slate-600 dark:text-slate-400">Project lead</label>
          <p className="text-xs text-slate-500 mt-0.5 mb-2">Person responsible for this project.</p>
          <SearchableSelect
            value={draft.leadId}
            onChange={(leadId) => setDraft({ ...draft, leadId })}
            options={leadOptions}
            className={fieldClass}
            placeholder="Search project lead…"
            emptyLabel="— Select project lead —"
          />
        </div>
      )}

      {canEditStatus && (
        <div className="surface-card p-4 rounded-2xl">
          <label className="text-sm font-medium text-slate-600 dark:text-slate-400">Project status</label>
          <select
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as ProjectStatus })}
            className={fieldClass}
          >
            {Object.values(ProjectStatus).map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
      )}

      {variant === 'inline' ? (
        <Button onClick={() => void save()} disabled={saving} className="bg-primary-600">
          {saving ? 'Saving...' : 'Save settings'}
        </Button>
      ) : null}
    </>
  );

  if (variant === 'modal') {
    return (
      <form id={formId} onSubmit={(e) => void save(e)} className="space-y-6">
        {body}
      </form>
    );
  }

  return <div className="p-6 w-full min-w-0 space-y-6">{body}</div>;
};
