import React, { useMemo } from 'react';
import { Briefcase, Calendar, Target, UserCircle } from 'lucide-react';
import {
  ModalField,
  ModalFieldGrid,
  ModalFormSection,
  modalInputClass,
} from '../../components/ui/ModalForm';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import {
  Department,
  ProjectPriority,
  ProjectStatus,
  Role,
  User,
} from '../../types';
import { DatePickerInput } from '@/components/ui/shadcn/date-picker-input';
import { orderInclusiveStartEnd } from '../../utils/dateRangeFilter';
import { formatAccessRoleLabel } from '../../utils/accessRole';
import { SearchableSelect } from '../../components/ui/SearchableSelect';

export type CreateProjectForm = {
  title: string;
  description: string;
  startDate: string;
  deadline: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  departmentId: string;
  leadId: string;
  progress: number;
};

export const defaultCreateProjectForm = (creatorUserId?: string): CreateProjectForm => ({
  title: '',
  description: '',
  startDate: new Date().toISOString().split('T')[0],
  deadline: '',
  status: ProjectStatus.PLANNING,
  priority: 'MEDIUM',
  departmentId: '',
  leadId: creatorUserId ?? '',
  progress: 0,
});

export function validateCreateProjectForm(form: CreateProjectForm): string | null {
  if (!form.title.trim()) return 'Project title is required';
  if (!form.description.trim()) return 'Project description is required';
  if (!form.departmentId) return 'Department is required';
  if (!form.leadId) return 'Project lead is required';
  if (!form.deadline) return 'Deadline is required';
  if (form.startDate && form.deadline < form.startDate) {
    return 'Deadline must be on or after the start date';
  }
  return null;
}

export function projectLeadCandidates(users: User[]): User[] {
  return users.filter((u) =>
    [Role.MANAGER, Role.HR, Role.ADMIN].includes(u.role as Role)
  );
}

type Props = {
  isOpen: boolean;
  form: CreateProjectForm;
  onChange: (form: CreateProjectForm) => void;
  onClose: () => void;
  onSubmit: () => void;
  departments: Department[];
  employees: User[];
  currentUser?: User;
  isSubmitting?: boolean;
};

export const CreateProjectModal: React.FC<Props> = ({
  isOpen,
  form,
  onChange,
  onClose,
  onSubmit,
  departments,
  employees,
  currentUser,
  isSubmitting,
}) => {
  const set = (patch: Partial<CreateProjectForm>) => onChange({ ...form, ...patch });

  const leads = useMemo(() => projectLeadCandidates(employees), [employees]);

  const leadOptions = useMemo(
    () =>
      leads.map((u) => ({
        value: u.id,
        label: `${u.name}${u.id === currentUser?.id ? ' — You' : ''}`,
        description: formatAccessRoleLabel(u.role),
        searchText: `${u.email ?? ''} ${u.position ?? ''}`,
      })),
    [leads, currentUser?.id]
  );

  const leadName = leads.find((u) => u.id === form.leadId)?.name;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New project"
      description="Set the name, who is responsible, and key dates."
      size="lg"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="space-y-6"
      >
        <ModalFormSection
          title="Project overview"
          icon={Briefcase}
          description="What this project is about and how it is organized."
        >
          <ModalField label="Project title" htmlFor="proj-title" required>
            <input
              id="proj-title"
              required
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="e.g. Community outreach 2026"
              className={modalInputClass}
            />
          </ModalField>
          <ModalField
            label="Project description"
            htmlFor="proj-desc"
            required
            hint="Summarize goals and what success looks like."
          >
            <textarea
              id="proj-desc"
              required
              rows={3}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="What is this project about?"
              className={`${modalInputClass} resize-none`}
            />
          </ModalField>
          <ModalFieldGrid columns={2}>
            <ModalField label="Department" htmlFor="proj-dept" required>
              <select
                id="proj-dept"
                required
                value={form.departmentId}
                onChange={(e) => set({ departmentId: e.target.value })}
                className={modalInputClass}
              >
                <option value="" disabled hidden>— Select department —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </ModalField>
            <ModalField label="Initial status" htmlFor="proj-status" required>
              <select
                id="proj-status"
                value={form.status}
                onChange={(e) => set({ status: e.target.value as ProjectStatus })}
                className={modalInputClass}
              >
                {Object.values(ProjectStatus).map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </ModalField>
          </ModalFieldGrid>
          <ModalField label="Priority" htmlFor="proj-priority" required>
            <select
              id="proj-priority"
              value={form.priority}
              onChange={(e) => set({ priority: e.target.value as ProjectPriority })}
              className={modalInputClass}
            >
              {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as ProjectPriority[]).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </ModalField>
        </ModalFormSection>

        <ModalFormSection
          title="Project lead"
          icon={UserCircle}
          description={
            currentUser
              ? `Defaults to you (${currentUser.name}). Choose who is responsible for this project.`
              : 'Person responsible for this project and its decisions.'
          }
        >
          <ModalField label="Project lead" htmlFor="proj-lead" required>
            <SearchableSelect
              id="proj-lead"
              required
              value={form.leadId}
              onChange={(leadId) => set({ leadId })}
              options={leadOptions}
              className={modalInputClass}
              placeholder="Search project lead…"
              emptyLabel="— Select project lead —"
            />
          </ModalField>
          {leadName ? (
            <p className="text-xs text-slate-600 dark:text-slate-400 rounded-lg bg-primary-50/80 dark:bg-primary-950/30 border border-primary-100 dark:border-primary-900/40 px-3 py-2">
              <Target className="w-3.5 h-3.5 inline mr-1 -mt-0.5 text-primary-600" />
              <strong className="font-semibold">{leadName}</strong> will appear as project lead on
              the timeline and project detail.
            </p>
          ) : null}
        </ModalFormSection>

        <ModalFormSection title="Timeline" icon={Calendar}>
          <ModalFieldGrid columns={2}>
            <ModalField label="Start date" htmlFor="proj-start" required>
              <DatePickerInput id="proj-start"
                
                required
                value={form.startDate}
                max={form.deadline || undefined}
                onChange={(e) => {
                  const next = orderInclusiveStartEnd(
                    e.target.value,
                    form.deadline,
                    'startDate'
                  );
                  set({ startDate: next.startDate, deadline: next.endDate });
                }}
                className={modalInputClass}
              />
            </ModalField>
            <ModalField label="Deadline" htmlFor="proj-deadline" required>
              <DatePickerInput id="proj-deadline"
                
                required
                min={form.startDate || undefined}
                value={form.deadline}
                onChange={(e) => {
                  const next = orderInclusiveStartEnd(
                    form.startDate,
                    e.target.value,
                    'endDate'
                  );
                  set({ startDate: next.startDate, deadline: next.endDate });
                }}
                className={modalInputClass}
              />
            </ModalField>
          </ModalFieldGrid>
        </ModalFormSection>

        <div className="hcms-modal-actions hcms-modal-actions--between">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            className="bg-primary-600 hover:bg-primary-700"
            isLoading={isSubmitting}
          >
            Create project
          </Button>
        </div>
      </form>
    </Modal>
  );
};
