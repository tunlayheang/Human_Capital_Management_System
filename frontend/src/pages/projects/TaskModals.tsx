import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ClipboardList, Flag, Search, UserCircle, X } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import {
  ModalField,
  ModalFieldGrid,
  ModalFormSection,
  modalInputClass,
} from '../../components/ui/ModalForm';
import {
  Task,
  TaskStatus,
  TaskPriority,
  User,
  Project,
  Department,
} from '../../types';
import { formatLongDate, isTaskOverdue } from './projectUtils';
import { NumericField } from '../../components/ui/NumericField';
import { DatePickerInput } from '@/components/ui/shadcn/date-picker-input';
import { orderInclusiveStartEnd } from '../../utils/dateRangeFilter';

export type NewTaskForm = {
  title: string;
  description: string;
  assigneeId: string;
  status: TaskStatus;
  priority: TaskPriority;
  startDate: string;
  dueDate: string;
  estimatedHours: number;
};

export const defaultNewTaskForm = (): NewTaskForm => ({
  title: '',
  description: '',
  assigneeId: '',
  status: TaskStatus.TODO,
  priority: 'MEDIUM',
  startDate: new Date().toISOString().split('T')[0],
  dueDate: '',
  estimatedHours: 0,
});

const PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.TODO]: 'To do',
  [TaskStatus.IN_PROGRESS]: 'In progress',
  [TaskStatus.REVIEW]: 'In review',
  [TaskStatus.DONE]: 'Done',
  [TaskStatus.BLOCKED]: 'Blocked',
};

/** Progress band linked to each workflow state (slider + status stay in sync). */
export const TASK_STATUS_PROGRESS: Record<
  TaskStatus,
  { min: number; max: number; /** Applied when the workflow state is selected */ default: number }
> = {
  [TaskStatus.TODO]: { min: 0, max: 0, default: 0 },
  [TaskStatus.IN_PROGRESS]: { min: 10, max: 70, default: 40 },
  [TaskStatus.REVIEW]: { min: 75, max: 95, default: 85 },
  [TaskStatus.DONE]: { min: 100, max: 100, default: 100 },
  /** Blocked keeps work paused — progress may stay where it was, within 0–95. */
  [TaskStatus.BLOCKED]: { min: 0, max: 95, default: 25 },
};

const PROGRESS_STEP = 5;

function clampProgress(value: number, min: number, max: number): number {
  const stepped = Math.round(value / PROGRESS_STEP) * PROGRESS_STEP;
  return Math.min(max, Math.max(min, stepped));
}

function progressForStatus(status: TaskStatus, currentProgress?: number | null): number {
  const band = TASK_STATUS_PROGRESS[status];
  if (status === TaskStatus.BLOCKED && currentProgress != null) {
    return clampProgress(Number(currentProgress) || 0, band.min, band.max);
  }
  return band.default;
}

/** Map a free slider value to the matching workflow state (Blocked stays until changed in the dropdown). */
function statusForProgress(progress: number, previous: TaskStatus): TaskStatus {
  if (previous === TaskStatus.BLOCKED && progress < 100) return TaskStatus.BLOCKED;
  if (progress >= 100) return TaskStatus.DONE;
  if (progress <= 0) return TaskStatus.TODO;
  if (progress >= TASK_STATUS_PROGRESS[TaskStatus.REVIEW].min) return TaskStatus.REVIEW;
  if (progress >= TASK_STATUS_PROGRESS[TaskStatus.IN_PROGRESS].min) return TaskStatus.IN_PROGRESS;
  return TaskStatus.TODO;
}

const priorityChipClass = (p: TaskPriority, selected: boolean) => {
  if (!selected) {
    return 'border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800';
  }
  const map: Record<TaskPriority, string> = {
    LOW: 'bg-emerald-50 text-emerald-700 ring-2 ring-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-300',
    MEDIUM: 'bg-amber-50 text-amber-700 ring-2 ring-amber-500/40 dark:bg-amber-950/40 dark:text-amber-300',
    HIGH: 'bg-orange-50 text-orange-700 ring-2 ring-orange-500/40 dark:bg-orange-950/40 dark:text-orange-300',
    CRITICAL: 'bg-red-50 text-red-700 ring-2 ring-red-500/40 dark:bg-red-950/40 dark:text-red-300',
  };
  return map[p];
};

export function validateNewTaskForm(form: NewTaskForm): Partial<Record<keyof NewTaskForm, string>> {
  const errs: Partial<Record<keyof NewTaskForm, string>> = {};
  if (!form.title.trim()) errs.title = 'Task title is required';
  if (form.startDate && form.dueDate && form.startDate > form.dueDate) {
    errs.dueDate = 'Due date must be on or after the start date';
  }
  if (form.estimatedHours < 0) errs.estimatedHours = 'Cannot be negative';
  return errs;
}

/** Resolve department label for assignee disambiguation when names collide. */
export function resolveAssigneeDepartment(
  emp: User,
  departments: Department[] = []
): string {
  const fromEmployee = String(emp.employee?.department_name ?? '').trim();
  if (fromEmployee) return fromEmployee;
  const deptId = String(emp.departmentId ?? '').trim();
  if (deptId) {
    const hit = departments.find((d) => d.id === deptId);
    const name = String(hit?.name ?? '').trim();
    if (name) return name;
  }
  return 'No department';
}

type AssigneeSearchSelectProps = {
  id?: string;
  value: string;
  employees: User[];
  departments?: Department[];
  onChange: (assigneeId: string) => void;
  disabled?: boolean;
  className?: string;
  allowUnassigned?: boolean;
};

/** Searchable assignee picker — matches by name/department and shows both in the list. */
export const TaskAssigneeSearchSelect: React.FC<AssigneeSearchSelectProps> = ({
  id,
  value,
  employees,
  departments = [],
  onChange,
  disabled = false,
  className = modalInputClass,
  allowUnassigned = true,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const selected = useMemo(
    () => employees.find((e) => e.id === value) ?? null,
    [employees, value]
  );

  const selectedDept = selected ? resolveAssigneeDepartment(selected, departments) : '';

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      // Dropdown is portaled to document.body — must not treat option clicks as "outside".
      if (rootRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open || !inputRef.current) return;
    const place = () => {
      if (!inputRef.current) return;
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 240),
        zIndex: 9999,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return employees
      .map((emp) => ({
        emp,
        department: resolveAssigneeDepartment(emp, departments),
      }))
      .filter(({ emp, department }) => {
        const hay = `${emp.name} ${emp.email ?? ''} ${department}`.toLowerCase();
        return hay.includes(term);
      })
      .slice(0, 40);
  }, [employees, departments, query]);

  const pick = (assigneeId: string) => {
    onChange(assigneeId);
    setQuery('');
    setOpen(false);
  };

  const displayValue =
    open || query
      ? query
      : selected
        ? `${selected.name} · ${selectedDept}`
        : '';

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
        <input
          ref={inputRef}
          id={id}
          type="text"
          disabled={disabled}
          autoComplete="off"
          placeholder={selected ? selected.name : 'Type a name or department to search…'}
          value={displayValue}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            if (selected && !query) setQuery('');
          }}
          className={`${className} pl-9 pr-9`}
          aria-expanded={open}
          aria-autocomplete="list"
          role="combobox"
        />
        {(query || (allowUnassigned && value)) && !disabled ? (
          <button
            type="button"
            aria-label={query ? 'Clear search' : 'Clear assignee'}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (query) {
                setQuery('');
                inputRef.current?.focus();
                return;
              }
              pick('');
              inputRef.current?.focus();
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {open && !disabled ? createPortal(
        <ul
          ref={dropdownRef}
          role="listbox"
          style={dropdownStyle}
          className="max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-900"
        >
          {allowUnassigned ? (
            <li>
              <button
                type="button"
                role="option"
                aria-selected={!value}
                className={`flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${
                  !value ? 'bg-primary-50/70 dark:bg-primary-950/30' : ''
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick('');
                }}
              >
                <span className="font-medium text-slate-700 dark:text-slate-200">— Unassigned —</span>
              </button>
            </li>
          ) : null}
          {!query.trim() ? (
            <li className="px-3 py-3 text-sm text-slate-400">
              Type at least 1 character to search
            </li>
          ) : matches.length === 0 ? (
            <li className="px-3 py-3 text-sm text-slate-400">No matching people</li>
          ) : (
            matches.map(({ emp, department }) => {
              const active = emp.id === value;
              return (
                <li key={emp.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 ${
                      active ? 'bg-primary-50/70 dark:bg-primary-950/30' : ''
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(emp.id);
                    }}
                  >
                    <span className="truncate text-sm font-medium text-slate-900 dark:text-white">
                      {emp.name}
                    </span>
                    <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {department}
                      {emp.position ? ` · ${emp.position}` : ''}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>,
        document.body
      ) : null}
    </div>
  );
};

type AddProps = {
  isOpen: boolean;
  project?: Project;
  employees: User[];
  departments?: Department[];
  currentUser?: User;
  isSubmitting: boolean;
  form: NewTaskForm;
  onChange: (f: NewTaskForm) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export const AddTaskModal: React.FC<AddProps> = ({
  isOpen,
  project,
  employees,
  departments = [],
  currentUser,
  isSubmitting,
  form,
  onChange,
  onClose,
  onSubmit,
}) => {
  const [errs, setErrs] = useState<Partial<Record<keyof NewTaskForm, string>>>({});

  const set = (patch: Partial<NewTaskForm>) => onChange({ ...form, ...patch });

  const assignee = employees.find((e) => e.id === form.assigneeId);
  const assigneeName = assignee?.name;
  const assigneeDept = assignee ? resolveAssigneeDepartment(assignee, departments) : '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrs = validateNewTaskForm(form);
    setErrs(nextErrs);
    if (Object.keys(nextErrs).length === 0) onSubmit();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!isSubmitting) onClose();
      }}
      title="New task"
      description={
        project
          ? `Add a task to ${project.title}. Only the title is required.`
          : 'Add a task to this project. Only the title is required.'
      }
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {project ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 dark:bg-primary-950/50 dark:text-primary-300">
              {project.title}
            </span>
            {currentUser ? (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Created by {currentUser.name}
              </span>
            ) : null}
          </div>
        ) : null}

        <ModalFormSection
          title="Task details"
          icon={ClipboardList}
          description="What needs to be done and any helpful context."
        >
          <ModalField label="Title" htmlFor="task-title" required>
            <input
              id="task-title"
              required
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="e.g. Prepare community welcome pack"
              className={`${modalInputClass} ${errs.title ? 'border-red-300 focus:border-red-400 focus:ring-red-200' : ''}`}
            />
            {errs.title ? (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errs.title}</p>
            ) : null}
          </ModalField>
          <ModalField
            label="Description"
            htmlFor="task-desc"
            hint="Optional. Add goals, notes, or useful links."
          >
            <textarea
              id="task-desc"
              rows={3}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="What needs to be done?"
              className={`${modalInputClass} resize-none`}
            />
          </ModalField>
        </ModalFormSection>

        <ModalFormSection
          title="Assignment"
          icon={UserCircle}
          description="Who owns the work and its starting status."
        >
          <ModalFieldGrid columns={2}>
            <ModalField
              label="Assignee"
              htmlFor="task-assignee"
              hint="Search by name or department. Optional."
            >
              <TaskAssigneeSearchSelect
                id="task-assignee"
                value={form.assigneeId}
                employees={employees}
                departments={departments}
                onChange={(assigneeId) => set({ assigneeId })}
              />
            </ModalField>
            <ModalField label="Status" htmlFor="task-status">
              <select
                id="task-status"
                value={form.status}
                onChange={(e) => set({ status: e.target.value as TaskStatus })}
                className={modalInputClass}
              >
                {Object.values(TaskStatus).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </ModalField>
          </ModalFieldGrid>
          {assigneeName ? (
            <p className="text-xs text-slate-600 dark:text-slate-400 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-3 py-2">
              <strong className="font-semibold">{assigneeName}</strong>
              {assigneeDept ? (
                <span className="text-slate-500"> ({assigneeDept})</span>
              ) : null}{' '}
              will be notified when the task is created.
            </p>
          ) : null}
        </ModalFormSection>

        <ModalFormSection title="Priority" icon={Flag} description="How urgent is this work?">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => set({ priority: p })}
                className={`rounded-xl px-3 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors ${priorityChipClass(p, form.priority === p)}`}
              >
                {p}
              </button>
            ))}
          </div>
        </ModalFormSection>

        <ModalFormSection title="Schedule" icon={Calendar} description="When work starts, when it is due, and optional effort.">
          <ModalFieldGrid columns={2}>
            <ModalField label="Start date" htmlFor="task-start">
              <DatePickerInput
                id="task-start"
                value={form.startDate}
                max={form.dueDate || undefined}
                onChange={(e) => {
                  const next = orderInclusiveStartEnd(
                    e.target.value,
                    form.dueDate,
                    'startDate'
                  );
                  set({ startDate: next.startDate, dueDate: next.endDate });
                }}
                className={`${modalInputClass} hcms-modal-date-input`}
              />
            </ModalField>
            <ModalField
              label="Due date"
              htmlFor="task-due"
              hint="Optional. Set when this should be finished."
            >
              <DatePickerInput
                id="task-due"
                min={form.startDate || undefined}
                value={form.dueDate}
                onChange={(e) => {
                  const next = orderInclusiveStartEnd(
                    form.startDate,
                    e.target.value,
                    'endDate'
                  );
                  set({ startDate: next.startDate, dueDate: next.endDate });
                }}
                className={`${modalInputClass} hcms-modal-date-input ${errs.dueDate ? 'border-red-300 focus:border-red-400 focus:ring-red-200' : ''}`}
              />
              {errs.dueDate ? (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errs.dueDate}</p>
              ) : null}
            </ModalField>
          </ModalFieldGrid>
          <ModalField
            label="Estimated hours"
            htmlFor="task-hours"
            hint="Optional estimate of effort in hours."
            className="sm:max-w-xs"
          >
            <NumericField
              id="task-hours"
              kind="decimal"
              filterOptions={{ maxDecimals: 2 }}
              value={form.estimatedHours}
              onValueChange={(v) =>
                set({ estimatedHours: Math.max(0, Number(v) || 0) })
              }
              className={modalInputClass}
            />
          </ModalField>
        </ModalFormSection>

        <div className="hcms-modal-actions hcms-modal-actions--between">
          <Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            className="bg-primary-600 hover:bg-primary-700"
            isLoading={isSubmitting}
          >
            Create task
          </Button>
        </div>
      </form>
    </Modal>
  );
};

type EditProps = {
  isOpen: boolean;
  task: Task | null;
  project?: Project;
  employees: User[];
  departments?: Department[];
  isSubmitting: boolean;
  canEditInfo: boolean;
  /** Edit start / due dates (tasks.edit.dates or tasks.edit.info). */
  canEditDates?: boolean;
  canProgress: boolean;
  canAssign: boolean;
  title: string;
  onClose: () => void;
  onChange: (task: Task) => void;
  onSubmit: () => void;
};

/** Normalize stored date strings to YYYY-MM-DD for date inputs. */
function toDateInputValue(value?: string | null): string {
  if (!value) return '';
  const s = String(value).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : '';
}

export const EditTaskModal: React.FC<EditProps> = ({
  isOpen,
  task,
  project,
  employees,
  departments = [],
  isSubmitting,
  canEditInfo,
  canEditDates = false,
  canProgress,
  canAssign,
  title,
  onClose,
  onChange,
  onSubmit,
}) => {
  const [dateError, setDateError] = useState<string | null>(null);

  useEffect(() => {
    setDateError(null);
  }, [task?.id, isOpen]);

  if (!task) return null;
  const progressEnabled = canProgress;
  const datesEnabled = canEditDates || canEditInfo;
  const assignee = employees.find((e) => e.id === task.assigneeId);
  const assigneeDept = assignee ? resolveAssigneeDepartment(assignee, departments) : '';
  const progressBand = TASK_STATUS_PROGRESS[task.status] ?? TASK_STATUS_PROGRESS[TaskStatus.TODO];
  const progressValue = clampProgress(Number(task.progress) || 0, 0, 100);
  const startValue = toDateInputValue(task.startDate);
  const dueValue = toDateInputValue(task.dueDate);

  const onProgress = (raw: number) => {
    const val = clampProgress(raw, 0, 100);
    onChange({
      ...task,
      progress: val,
      status: statusForProgress(val, task.status),
    });
  };

  const onWorkflowState = (status: TaskStatus) => {
    onChange({
      ...task,
      status,
      progress: progressForStatus(status, task.progress),
    });
  };

  const onStartDate = (value: string) => {
    setDateError(null);
    const due = toDateInputValue(task.dueDate);
    const next = orderInclusiveStartEnd(value, due, 'startDate');
    onChange({
      ...task,
      startDate: next.startDate || '',
      dueDate: next.endDate || task.dueDate || '',
    });
  };

  const onDueDate = (value: string) => {
    setDateError(null);
    const start = toDateInputValue(task.startDate);
    const next = orderInclusiveStartEnd(start, value, 'endDate');
    onChange({
      ...task,
      startDate: next.startDate || task.startDate || '',
      dueDate: next.endDate || '',
    });
  };

  const handleSave = () => {
    const start = toDateInputValue(task.startDate);
    const due = toDateInputValue(task.dueDate);
    if (start && due && start > due) {
      setDateError('Due date must be on or after the start date');
      return;
    }
    setDateError(null);
    onSubmit();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!isSubmitting) onClose();
      }}
      title={title}
      description="Review progress, status, assignment, and key task details."
      size="lg"
    >
      <div className="space-y-5">
        <div className="flex justify-between items-start gap-3">
          <div>
            <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-600">
              {project?.title}
            </span>
            <h4 className="text-xl font-black uppercase mt-2 dark:text-white">{task.title}</h4>
          </div>
          <span
            className={`px-2 py-1 rounded-full text-xs font-semibold ${
              task.priority === 'CRITICAL'
                ? 'bg-red-50 text-red-600'
                : task.priority === 'HIGH'
                  ? 'bg-orange-50 text-orange-600'
                  : task.priority === 'LOW'
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-amber-50 text-amber-600'
            }`}
          >
            {task.priority ?? 'MEDIUM'}
          </span>
        </div>

        <EditDescription task={task} canEditInfo={canEditInfo} onChange={onChange} />

        <div className="rounded-[2rem] bg-slate-900 text-white p-6 hover:scale-[1.01] transition-transform">
          <div className="flex items-end justify-between gap-3">
            <p className="text-4xl font-black tabular-nums">{progressValue}%</p>
            <p className="text-[11px] text-slate-400 text-right leading-snug">
              {STATUS_LABELS[task.status]}
              <span className="block tabular-nums">
                {progressBand.min === progressBand.max
                  ? `${progressBand.min}%`
                  : `${progressBand.min}% – ${progressBand.max}%`}
              </span>
            </p>
          </div>

          <div className="relative mt-5 h-8 flex items-center select-none">
            {/* Track */}
            <div className="absolute inset-x-0 h-2.5 rounded-full bg-slate-700/90 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary-400 to-emerald-400 transition-[width] duration-200 ease-out"
                style={{ width: `${progressValue}%` }}
              />
            </div>
            {/* Thumb */}
            <div
              className="pointer-events-none absolute top-1/2 z-[1] h-5 w-5 rounded-full border-2 border-white bg-primary-400 shadow-md transition-[left] duration-200 ease-out"
              style={{
                left: `${progressValue}%`,
                transform:
                  progressValue <= 0
                    ? 'translate(0, -50%)'
                    : progressValue >= 100
                      ? 'translate(-100%, -50%)'
                      : 'translate(-50%, -50%)',
              }}
              aria-hidden
            />
            <input
              type="range"
              min={0}
              max={100}
              step={PROGRESS_STEP}
              disabled={!progressEnabled}
              value={progressValue}
              onChange={(e) => onProgress(Number(e.target.value))}
              className="absolute inset-0 z-[2] h-full w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-60 [&::-webkit-slider-runnable-track]:h-2.5 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-transparent [&::-webkit-slider-thumb]:bg-transparent [&::-moz-range-track]:h-2.5 [&::-moz-range-track]:bg-transparent [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressValue}
              aria-label="Task progress"
            />
          </div>

          <div className="flex justify-between text-xs text-slate-400 mt-2">
            <span>Not started</span>
            <span>In progress</span>
            <span className="text-emerald-400">Done</span>
          </div>
          <div className="mt-4">
            <label className="text-xs text-slate-400" htmlFor="edit-task-workflow-state">
              Status
            </label>
            <select
              id="edit-task-workflow-state"
              disabled={!progressEnabled}
              value={task.status}
              onChange={(e) => onWorkflowState(e.target.value as TaskStatus)}
              className="mt-1 w-full bg-slate-800 border-slate-700 rounded-lg px-3 py-2"
            >
              {Object.values(TaskStatus).map((s) => {
                const band = TASK_STATUS_PROGRESS[s];
                const rangeLabel =
                  band.min === band.max ? `${band.min}%` : `${band.min}–${band.max}%`;
                return (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]} ({rangeLabel})
                  </option>
                );
              })}
            </select>
          </div>
          <div className="flex items-center gap-2 mt-4">
            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-sm font-bold">
              {(assignee?.name ?? '?').charAt(0)}
            </div>
            <div className="min-w-0">
              <p className="text-sm truncate">{assignee?.name ?? 'Unassigned'}</p>
              {assigneeDept ? (
                <p className="text-[11px] text-slate-400 truncate">{assigneeDept}</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <label className="text-slate-500 block mb-1" htmlFor="edit-task-start">
              Start
            </label>
            {datesEnabled ? (
              <DatePickerInput
                id="edit-task-start"
                value={startValue}
                max={dueValue || undefined}
                onChange={(e) => onStartDate(e.target.value)}
                className={`${modalInputClass} hcms-modal-date-input`}
              />
            ) : (
              <p className="font-medium dark:text-white">{formatLongDate(task.startDate)}</p>
            )}
          </div>
          <div>
            <label className="text-slate-500 block mb-1" htmlFor="edit-task-due">
              Due
            </label>
            {datesEnabled ? (
              <div className="relative">
                {isTaskOverdue(task) ? (
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-rose-500 z-10" />
                ) : null}
                <DatePickerInput
                  id="edit-task-due"
                  min={startValue || undefined}
                  value={dueValue}
                  onChange={(e) => onDueDate(e.target.value)}
                  className={`${modalInputClass} hcms-modal-date-input ${
                    isTaskOverdue(task) ? 'pl-6' : ''
                  } ${dateError ? 'border-red-300 focus:border-red-400 focus:ring-red-200' : ''}`}
                />
              </div>
            ) : (
              <p className="font-medium dark:text-white flex items-center gap-1">
                {isTaskOverdue(task) && <span className="w-2 h-2 rounded-full bg-rose-500" />}
                {formatLongDate(task.dueDate)}
              </p>
            )}
            {dateError ? (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">{dateError}</p>
            ) : null}
          </div>
          <div>
            <label className="text-slate-500 block mb-1" htmlFor="edit-task-hours">
              Est. hours
            </label>
            {canEditInfo ? (
              <NumericField
                id="edit-task-hours"
                kind="decimal"
                value={task.estimatedHours ?? 0}
                onValueChange={(v) =>
                  onChange({
                    ...task,
                    estimatedHours: Math.max(0, Number(v) || 0),
                  })
                }
                className={modalInputClass}
              />
            ) : (
              <p className="font-medium dark:text-white">{task.estimatedHours ?? 0} hrs</p>
            )}
          </div>
        </div>

        {canAssign && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t pt-4 dark:border-slate-700">
            <div>
              <label className="text-sm font-medium" htmlFor="edit-task-assignee">
                Reassign
              </label>
              <div className="mt-1">
                <TaskAssigneeSearchSelect
                  id="edit-task-assignee"
                  value={task.assigneeId}
                  employees={employees}
                  departments={departments}
                  onChange={(assigneeId) => onChange({ ...task, assigneeId })}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Priority</label>
              <PriorityRow task={task} onChange={onChange} />
            </div>
          </div>
        )}

        <div className="hcms-modal-actions hcms-modal-actions--end gap-3">
          <Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isSubmitting}
            className="bg-blue-600 hover:bg-blue-700"
            onClick={handleSave}
          >
            {isSubmitting ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const EditDescription: React.FC<{
  task: Task;
  canEditInfo: boolean;
  onChange: (t: Task) => void;
}> = ({ task, canEditInfo, onChange }) => (
  <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
    <label className="text-sm font-medium text-slate-600 dark:text-slate-400">Description</label>
    <textarea
      rows={3}
      disabled={!canEditInfo}
      value={task.description}
      onChange={(e) => onChange({ ...task, description: e.target.value })}
      className={`mt-2 w-full rounded-lg border px-3 py-2 dark:text-white ${
        canEditInfo
          ? 'dark:bg-slate-800 dark:border-slate-600'
          : 'bg-slate-50/50 text-slate-500 cursor-not-allowed dark:bg-slate-800/50'
      }`}
    />
  </div>
);

const PriorityRow: React.FC<{ task: Task; onChange: (t: Task) => void }> = ({
  task,
  onChange,
}) => (
  <div className="hcms-modal-grid-4 mt-2">
    {PRIORITIES.map((p) => (
      <button
        key={p}
        type="button"
        onClick={() => onChange({ ...task, priority: p })}
        className={`py-2 rounded-lg text-sm font-bold ${priorityChipClass(p, task.priority === p)}`}
      >
        {p.charAt(0)}
      </button>
    ))}
  </div>
);
