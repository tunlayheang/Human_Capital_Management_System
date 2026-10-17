import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { ResponsiveRowActions } from '../ui/ResponsiveRowActions';
import { Badge } from '../ui/Badge';
import { ActiveStatusControl } from '../ui/ActiveStatusControl';
import { Modal } from '../ui/Modal';
import { LeaveType } from '../../types';
import {
  LEAVE_CATEGORY_DESCRIPTIONS,
  LEAVE_CATEGORY_LABELS,
  LEAVE_CATEGORY_VALUES,
  LEAVE_CATEGORY_ACCENT_TEXT,
  EVENT_TRIGGER_OPTIONS,
  type LeaveCategory,
  type LeaveTypeFormPayload,
  buildLeaveTypePayload,
  suggestLeaveCategoryFromName,
  validateLeaveTypeForm,
} from '../../utils/leaveTypeCategory';
import { Plus, Edit2, Trash2, Save, CalendarDays, Settings2 } from 'lucide-react';
import { LoadingState } from '../common/LoadingState';
import { useToast } from '../../context/ToastContext';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { SelectWithOther } from '../ui/SelectWithOther';
import { NumericField } from '../ui/NumericField';
import {
  ModalCheckboxRow,
  ModalField,
  ModalFieldGrid,
  ModalFormSection,
  modalInputClass,
} from '../ui/ModalForm';
import { RulesConfigHelp } from '../ui/RulesConfigHelp';
import { promptActiveStatusChange } from '../../utils/activeStatusChange';
import { WizardKhmerSubsection } from '../employee-wizard/wizardKhmerSection';
import { useLanguage } from '../../context/LanguageContext';
import {
  localizedLabelUsesKhmerFont,
  resolveLeaveTypeDescription,
  resolveLeaveTypeDisplayName,
} from '../../utils/localizedEntityLabel';
import { numberInputFromRaw, type NumberInputValue } from '../../utils/formInputFilters';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { cn } from '../../utils';
import {
  sortRowsByColumn,
  SortableTableHeader,
  useListColumnSort,
} from '../../utils/listColumnSort';

type LeaveTypeSortCol =
  | 'name'
  | 'category'
  | 'description'
  | 'daysAllowed'
  | 'carryForward'
  | 'paid'
  | 'status';

const leaveTypeThClass = 'px-6 py-3 text-xs uppercase text-slate-500';

type FormState = Omit<LeaveTypeFormPayload, 'daysAllowed' | 'maxCarryForward'> & {
  daysAllowed: NumberInputValue;
  maxCarryForward: NumberInputValue;
  status: 'active' | 'inactive';
};

type Props = {
  types: LeaveType[];
  loading?: boolean;
  /** Hide the panel title when the parent page already shows a tab header. */
  hideHeader?: boolean;
  onCreate: (data: Omit<LeaveType, 'id'>) => Promise<void>;
  onUpdate: (id: string, data: Omit<LeaveType, 'id'>) => Promise<void>;
  onDelete: (id: string, opts?: { effectiveFrom?: string }) => Promise<void>;
};

const inputClass =
  'w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 dark:bg-slate-900 focus:ring-2 focus:ring-primary-500';

const emptyForm = (): FormState => ({
  name: '',
  nameKh: '',
  description: '',
  descriptionKh: '',
  daysAllowed: 21,
  isPaid: true,
  leaveCategory: 'fixed_allocation',
  monthlyAccrualRate: 1.5,
  yearlyResetEnabled: true,
  maxCarryForward: 5,
  allowCarryForward: false,
  eventTriggerType: '',
  maxUsagePerEmployment: null,
  affectsPayroll: true,
  requiresDocument: false,
  requiresApproval: true,
  isActive: true,
  status: 'active',
});

function typeToForm(type: LeaveType): FormState {
  return {
    name: type.name,
    nameKh: type.nameKh || '',
    description: type.description || '',
    descriptionKh: type.descriptionKh || '',
    daysAllowed: type.daysAllowed,
    isPaid: type.isPaid,
    leaveCategory: type.leaveCategory ?? 'fixed_allocation',
    monthlyAccrualRate: type.monthlyAccrualRate ?? null,
    yearlyResetEnabled: type.yearlyResetEnabled ?? false,
    maxCarryForward: type.maxCarryForward ?? 0,
    allowCarryForward: type.allowCarryForward ?? false,
    eventTriggerType: type.eventTriggerType ?? '',
    maxUsagePerEmployment: type.maxUsagePerEmployment ?? null,
    affectsPayroll: type.affectsPayroll ?? !type.isPaid,
    requiresDocument: type.requiresDocument ?? false,
    requiresApproval: type.requiresApproval ?? true,
    isActive: type.isActive === true,
    status: type.isActive === true ? 'active' : 'inactive',
  };
}

export const LeaveTypeConfig: React.FC<Props> = ({
  types,
  loading,
  hideHeader = false,
  onCreate,
  onUpdate,
  onDelete,
}) => {
  const { showToast } = useToast();
  const { language } = useLanguage();
  const { confirm, confirmEffectiveDate, ConfirmDialogHost } = useConfirmDialog();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [formBaseline, setFormBaseline] = useState<string | null>(null);
  const [categoryManual, setCategoryManual] = useState(false);

  const isFormDirty =
    modalOpen && formBaseline != null && JSON.stringify(form) !== formBaseline;
  const { confirmDiscardIfDirty } = useUnsavedChangesGuard({
    isDirty: isFormDirty,
    confirm,
  });

  const { sortBy, sortOrder, toggleSort } = useListColumnSort<LeaveTypeSortCol>();

  const sortedTypes = useMemo(() => {
    const getSortValue = (type: LeaveType, col: LeaveTypeSortCol): string | number => {
      switch (col) {
        case 'name':
          return resolveLeaveTypeDisplayName(type, language);
        case 'category':
          return type.leaveCategory ? LEAVE_CATEGORY_LABELS[type.leaveCategory] : '';
        case 'description':
          return resolveLeaveTypeDescription(type, language) ?? '';
        case 'daysAllowed':
          if (type.leaveCategory === 'approval_based' || type.leaveCategory === 'event_based') {
            return -1;
          }
          return type.daysAllowed;
        case 'carryForward':
          return type.allowCarryForward ? 1 : 0;
        case 'paid':
          return type.isPaid ? 1 : 0;
        case 'status':
          return type.isActive === true ? 0 : 1;
        default:
          return '';
      }
    };
    const applyDefaultSort = (rows: LeaveType[]) =>
      rows.sort((a, b) => {
        const aActive = a.isActive === true ? 0 : 1;
        const bActive = b.isActive === true ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return String(a.name).localeCompare(String(b.name));
      });
    return sortRowsByColumn(types, sortBy, sortOrder, getSortValue, applyDefaultSort);
  }, [types, sortBy, sortOrder, language]);

  const category = form.leaveCategory;
  const showDefaultDays =
    category === 'accrual_based' ||
    category === 'join_date_based' ||
    category === 'fixed_allocation';
  const showAccrualFields =
    category === 'accrual_based' || category === 'join_date_based';
  const showCarryFields =
    category === 'accrual_based' ||
    category === 'join_date_based' ||
    category === 'fixed_allocation';
  const showEventFields = category === 'event_based';
  const showApprovalFields = category === 'approval_based';

  useEffect(() => {
    if (categoryManual || !form.name.trim()) return;
    const suggested = suggestLeaveCategoryFromName(form.name);
    if (suggested && suggested !== form.leaveCategory) {
      setForm((prev) => ({ ...prev, leaveCategory: suggested }));
    }
  }, [form.name, categoryManual, form.leaveCategory]);

  const openAdd = () => {
    const next = emptyForm();
    setEditing(null);
    setForm(next);
    setFormBaseline(JSON.stringify(next));
    setCategoryManual(false);
    setModalOpen(true);
  };

  const openEdit = (type: LeaveType) => {
    const next = typeToForm(type);
    setEditing(type);
    setForm(next);
    setFormBaseline(JSON.stringify(next));
    setCategoryManual(true);
    setModalOpen(true);
  };

  const requestCloseModal = async () => {
    if (!(await confirmDiscardIfDirty())) return;
    setModalOpen(false);
    setEditing(null);
    setFormBaseline(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextActive = form.status === 'active';
    const prevActive = editing ? editing.isActive === true : true;
    const statusChanged = prevActive !== nextActive;
    if (statusChanged) {
      const effectiveFrom = await promptActiveStatusChange(confirmEffectiveDate, {
        entityLabel: 'leave type',
        entityName: form.name || 'this leave type',
        nextActive,
      });
      if (!effectiveFrom) return;
    }
    if (
      (showDefaultDays && form.daysAllowed === '') ||
      (form.allowCarryForward && form.maxCarryForward === '')
    ) {
      showToast('Fill required numeric fields before saving', 'warning');
      return;
    }
    const payload = buildLeaveTypePayload({
      ...form,
      daysAllowed: form.daysAllowed === '' ? 0 : Number(form.daysAllowed),
      maxCarryForward: form.maxCarryForward === '' ? 0 : Number(form.maxCarryForward),
      isActive: nextActive,
    });
    const err = validateLeaveTypeForm(payload);
    if (err) {
      showToast(err, 'warning');
      return;
    }
    setSaving(true);
    try {
      const data = payload as Omit<LeaveType, 'id'>;
      if (editing) await onUpdate(editing.id, data);
      else await onCreate(data);
      setModalOpen(false);
      setEditing(null);
      setFormBaseline(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (type: LeaveType) => {
    const effectiveFrom = await confirmEffectiveDate({
      title: 'Delete Leave Type',
      description: `Permanently delete "${type.name}"? It will be removed from this list and will no longer appear when employees request leave. Existing leave requests of this type are kept for history.`,
      variant: 'danger',
      confirmLabel: 'Delete',
      effectiveDateLabel: 'Effective date',
    });
    if (!effectiveFrom) return;
    await onDelete(type.id, { effectiveFrom });
  };

  const handleToggleActive = async (type: LeaveType) => {
    const nextActive = type.isActive !== true;
    const effectiveFrom = await promptActiveStatusChange(confirmEffectiveDate, {
      entityLabel: 'leave type',
      entityName: type.name || 'this leave type',
      nextActive,
    });
    if (!effectiveFrom) return;
    setTogglingId(type.id);
    try {
      const payload = buildLeaveTypePayload({
        ...typeToForm(type),
        isActive: nextActive,
        status: nextActive ? 'active' : 'inactive',
      });
      await onUpdate(type.id, payload as Omit<LeaveType, 'id'>);
    } finally {
      setTogglingId(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl sm:rounded-2xl border bg-white dark:bg-slate-800 p-4 sm:p-6">
        <LoadingState variant="panel" layout="table" rows={5} />
      </div>
    );
  }

  return (
    <>
      <ConfirmDialogHost />
      <div className="relative surface-card shadow-sm overflow-hidden">
        <RulesConfigHelp help="leaves.leaveTypes" className="absolute top-3 right-3 z-10" />
        <div
          className={`flex flex-row flex-wrap items-center justify-between gap-2 px-3 py-2 pr-12 border-b border-slate-200 dark:border-slate-700 ${
            hideHeader ? 'sm:justify-end' : ''
          }`}
        >
          {!hideHeader && (
            <h3 className="text-lg font-bold text-slate-900 dark:text-white min-w-0">
              Leave Type Configuration
            </h3>
          )}
          <Button onClick={openAdd} className="w-auto shrink-0">
            <Plus className="w-4 h-4 mr-1" /> Add New Leave Type
          </Button>
        </div>

        {types.length === 0 ? (
          <p className="p-8 text-center text-slate-500">
            No leave types configured. Click &quot;Add New Leave Type&quot; to get started.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 dark:bg-slate-900/50">
                <tr>
                  <SortableTableHeader
                    label="Leave Type Name"
                    column="name"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={leaveTypeThClass}
                  />
                  <SortableTableHeader
                    label="Category"
                    column="category"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={leaveTypeThClass}
                  />
                  <SortableTableHeader
                    label="Description"
                    column="description"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={leaveTypeThClass}
                  />
                  <SortableTableHeader
                    label="Default Days/Year"
                    column="daysAllowed"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={leaveTypeThClass}
                  />
                  <SortableTableHeader
                    label="Carry Forward"
                    column="carryForward"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={leaveTypeThClass}
                  />
                  <SortableTableHeader
                    label="Paid/Unpaid"
                    column="paid"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={leaveTypeThClass}
                  />
                  <SortableTableHeader
                    label="Status"
                    column="status"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={leaveTypeThClass}
                  />
                  <th className={`${leaveTypeThClass} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {sortedTypes.map((type) => (
                  <tr key={type.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">
                      <span
                        className={cn(
                          'block',
                          localizedLabelUsesKhmerFont(type.name, type.nameKh, language) &&
                            'font-khmer'
                        )}
                      >
                        {resolveLeaveTypeDisplayName(type, language)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {type.leaveCategory ? (
                        <span
                          className={`text-xs font-semibold ${
                            LEAVE_CATEGORY_ACCENT_TEXT[type.leaveCategory]
                          }`}
                        >
                          {LEAVE_CATEGORY_LABELS[type.leaveCategory]}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400 max-w-xs truncate">
                      {resolveLeaveTypeDescription(type, language) ? (
                        <span
                          className={cn(
                            localizedLabelUsesKhmerFont(
                              type.description,
                              type.descriptionKh,
                              language
                            ) && 'font-khmer'
                          )}
                        >
                          {resolveLeaveTypeDescription(type, language)}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {type.leaveCategory === 'approval_based' || type.leaveCategory === 'event_based'
                        ? '—'
                        : `${type.daysAllowed} days`}
                    </td>
                    <td className="px-3 py-2">
                      {type.allowCarryForward ? (
                        <Badge className="border border-primary-200 bg-primary-50 text-primary-700">
                          Yes{typeof type.maxCarryForward === 'number' ? ` (${type.maxCarryForward})` : ''}
                        </Badge>
                      ) : (
                        <Badge className="border border-slate-200 bg-transparent text-slate-600">No</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {type.isPaid ? (
                        <Badge variant="success">Paid</Badge>
                      ) : (
                        <Badge variant="neutral">Unpaid</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <ActiveStatusControl
                        active={type.isActive === true}
                        loading={togglingId === type.id}
                        disabled={togglingId === type.id}
                        onRequestToggle={() => void handleToggleActive(type)}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <ResponsiveRowActions
                        menuLabel="Leave type actions"
                        actions={[
                          {
                            key: 'edit',
                            label: 'Edit leave type',
                            icon: <Edit2 className="w-4 h-4" />,
                            onClick: () => openEdit(type),
                          },
                          {
                            key: 'delete',
                            label: 'Delete leave type',
                            icon: <Trash2 className="w-4 h-4" />,
                            destructive: true,
                            onClick: () => void handleDelete(type),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => void requestCloseModal()}
        title={editing ? 'Edit Leave Type' : 'Add New Leave Type'}
        help="leaves.leaveTypes"
        size="lg"
        disableClose={saving}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <ModalFormSection title="Basic details" icon={CalendarDays}>
            <ModalField label="Leave type name" required>
              <input
                required
                placeholder="e.g. Annual leave, Sick leave"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={modalInputClass}
              />
            </ModalField>
            <ModalField label="Description" hint="Optional summary for administrators.">
              <textarea
                rows={3}
                className={`${modalInputClass} resize-none`}
                placeholder="When should employees use this leave type?"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </ModalField>
            <WizardKhmerSubsection className="mt-1">
              <ModalField label="Name (Khmer)" hint="Optional Khmer spelling for employees.">
                <input
                  placeholder="ឧ. ច្បាប់ប្រចាំឆ្នាំ"
                  value={form.nameKh ?? ''}
                  onChange={(e) => setForm({ ...form, nameKh: e.target.value })}
                  className={`${modalInputClass} font-khmer`}
                />
              </ModalField>
              <ModalField label="Description (Khmer)" hint="Optional.">
                <textarea
                  rows={3}
                  className={`${modalInputClass} font-khmer resize-none`}
                  placeholder="ពិពណ៌នាជាភាសាខ្មែរ…"
                  value={form.descriptionKh ?? ''}
                  onChange={(e) => setForm({ ...form, descriptionKh: e.target.value })}
                />
              </ModalField>
            </WizardKhmerSubsection>
            <ModalFieldGrid columns={showDefaultDays ? 2 : 1}>
              {showDefaultDays && (
                <ModalField
                  label="Days / year"
                  required={
                    category === 'fixed_allocation' ||
                    category === 'join_date_based' ||
                    category === 'accrual_based'
                  }
                >
                  <NumericField
                    kind="decimal"
                    filterOptions={{ maxDecimals: 1 }}
                    required={
                      category === 'fixed_allocation' ||
                      category === 'join_date_based' ||
                      category === 'accrual_based'
                    }
                    placeholder="18"
                    value={form.daysAllowed}
                    onValueChange={(v) =>
                      setForm({ ...form, daysAllowed: numberInputFromRaw(v) })
                    }
                    className={modalInputClass}
                  />
                </ModalField>
              )}
              <ModalField label="Category" required hint={LEAVE_CATEGORY_DESCRIPTIONS[category]}>
                <select
                  required
                  value={form.leaveCategory}
                  onChange={(e) => {
                    setCategoryManual(true);
                    setForm({ ...form, leaveCategory: e.target.value as LeaveCategory });
                  }}
                  className={modalInputClass}
                >
                  {LEAVE_CATEGORY_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {LEAVE_CATEGORY_LABELS[value]}
                    </option>
                  ))}
                </select>
              </ModalField>
            </ModalFieldGrid>
          </ModalFormSection>

          {showAccrualFields && (
            <ModalFormSection title="Accrual">
              <ModalField label="Monthly accrual rate" required hint="Days added per month after join month.">
                <NumericField
                  kind="decimal"
                  filterOptions={{ maxDecimals: 2 }}
                  required
                  placeholder="e.g. 1.5"
                  value={form.monthlyAccrualRate ?? ''}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      monthlyAccrualRate: v === '' ? null : Number(v),
                    })
                  }
                  className={modalInputClass}
                />
              </ModalField>
            </ModalFormSection>
          )}

          {showCarryFields && (
            <ModalFormSection title="Balance rules">
              <div className="space-y-2">
                <ModalCheckboxRow
                  checked={form.allowCarryForward}
                  onChange={(v) => setForm({ ...form, allowCarryForward: v })}
                  label="Allow carry forward"
                  description="Unused days can move to the next year."
                />
                {form.allowCarryForward && (
                  <ModalField label="Max carry forward days">
                    <NumericField
                      kind="integer"
                      value={form.maxCarryForward}
                      onValueChange={(v) =>
                        setForm({ ...form, maxCarryForward: numberInputFromRaw(v) })
                      }
                      className={modalInputClass}
                    />
                  </ModalField>
                )}
                <ModalCheckboxRow
                  checked={form.yearlyResetEnabled}
                  onChange={(v) => setForm({ ...form, yearlyResetEnabled: v })}
                  label="Yearly reset"
                  description="Balance resets at the start of each leave year."
                />
              </div>
            </ModalFormSection>
          )}

          {showEventFields && (
            <ModalFormSection title="Event-based leave">
              <ModalField label="Event trigger" required>
                <SelectWithOther
                  value={form.eventTriggerType}
                  onChange={(v) => setForm({ ...form, eventTriggerType: v })}
                  options={EVENT_TRIGGER_OPTIONS.map((opt) => ({
                    value: opt,
                    label: opt,
                  }))}
                  selectClassName={modalInputClass}
                  inputClassName={modalInputClass}
                  required
                  emptyOption={{ value: '', label: 'Select event…' }}
                  otherPlaceholder="e.g. Adoption, Religious observance…"
                  otherLabel="Specify event trigger"
                />
              </ModalField>
              <ModalField label="Max uses" hint="Optional cap per employment (days).">
                <NumericField
                  kind="integer"
                  placeholder="No limit"
                  value={form.maxUsagePerEmployment ?? ''}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      maxUsagePerEmployment: v === '' ? null : Number(v),
                    })
                  }
                  className={modalInputClass}
                />
              </ModalField>
              <ModalCheckboxRow
                checked={form.requiresDocument}
                onChange={(v) => setForm({ ...form, requiresDocument: v })}
                label="Supporting document required"
                description="Employee must upload proof with the request."
              />
            </ModalFormSection>
          )}

          {showApprovalFields && (
            <ModalFormSection title="Approval & payroll">
              <div className="space-y-2">
                <ModalCheckboxRow
                  checked={form.affectsPayroll}
                  onChange={(v) => setForm({ ...form, affectsPayroll: v })}
                  label="Affects payroll"
                  description="Counts as unpaid time with salary deduction."
                />
                <ModalCheckboxRow
                  checked={form.requiresApproval}
                  onChange={(v) => setForm({ ...form, requiresApproval: v })}
                  label="Requires approval"
                  description="Manager must approve before leave is granted."
                />
              </div>
            </ModalFormSection>
          )}

          <ModalFormSection title="Status" icon={Settings2}>
            <div className="space-y-3">
              <ActiveStatusControl
                layout="field"
                size="md"
                active={form.status === 'active'}
                onChange={(next) =>
                  setForm({
                    ...form,
                    status: next ? 'active' : 'inactive',
                    isActive: next,
                  })
                }
                description="Changing status requires an effective date when you save."
              />
              {!showApprovalFields && (
                <ModalCheckboxRow
                  checked={form.isPaid}
                  onChange={(v) => setForm({ ...form, isPaid: v })}
                  label="Paid leave"
                  description="Paid → counts toward payroll paid days. Unpaid → Unpaid leave in Attendance and may reduce pay."
                />
              )}
            </div>
          </ModalFormSection>

          <div className="hcms-modal-actions hcms-modal-actions--between">
            <Button type="button" variant="outline" onClick={() => void requestCloseModal()} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" isLoading={saving} className="w-full sm:w-auto">
              {editing ? (
                <>
                  <Save className="w-4 h-4 mr-1" /> Save changes
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-1" /> Add leave type
                </>
              )}
            </Button>
          </div>
        </form>
      </Modal>

    </>
  );
};
