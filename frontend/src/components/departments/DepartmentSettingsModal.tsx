import React, { useEffect, useState } from 'react';
import { Ban, RotateCcw, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Api } from '../../services/api';
import type { Department, User } from '../../types';
import { useToast } from '../../context/ToastContext';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import {
  DepartmentUnitForm,
  DepartmentUnitFormValues,
  departmentValuesFromRecord,
} from './DepartmentUnitForm';

type Props = {
  isOpen: boolean;
  department: Department | null;
  departments: Department[];
  users: User[];
  onClose: () => void;
  onSaved: (updated: Department) => void;
  /**
   * After deactivate/reactivate: pass updated row.
   * After permanent delete: pass id only (no updated row).
   */
  onDeleted: (id: string, updated?: Department) => void;
};

function validateForm(values: DepartmentUnitFormValues): string | null {
  if (!values.name.trim()) return 'Department name is required';
  if (!values.nameKh.trim()) return 'Department name (Khmer) is required';
  return null;
}

export const DepartmentSettingsModal: React.FC<Props> = ({
  isOpen,
  department,
  departments,
  users,
  onClose,
  onSaved,
  onDeleted,
}) => {
  const { showToast } = useToast();
  const { confirm, ConfirmDialogHost } = useConfirmDialog();
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [form, setForm] = useState<DepartmentUnitFormValues>(
    department
      ? departmentValuesFromRecord(department)
      : departmentValuesFromRecord({
          id: '',
          name: '',
          headCount: 0,
        })
  );

  useEffect(() => {
    if (!department || !isOpen) return;
    setForm((prev) => ({
      ...departmentValuesFromRecord(department),
      purpose: prev.purpose || '',
    }));
  }, [department, isOpen]);

  const busy = saving || actionBusy;
  const isActive = department?.isActive !== false;
  const assignedStaff = Number(department?.headCount) || 0;
  const canDelete = assignedStaff === 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!department) return;
    const error = validateForm(form);
    if (error) {
      showToast(error, 'error');
      return;
    }
    setSaving(true);
    try {
      const managerId =
        form.managerId != null && String(form.managerId).trim() !== ''
          ? String(form.managerId).trim()
          : undefined;
      const code = form.code.trim().toUpperCase();
      const updated = (await Api.departments.update({
        ...department,
        name: form.name.trim(),
        nameKh: form.nameKh.trim(),
        ...(code ? { code } : { code: undefined }),
        managerId,
      })) as Department;
      showToast('Department updated successfully', 'success');
      onSaved(updated);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update department', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!department || !isActive) return;
    const ok = await confirm({
      title: `Deactivate ${department.name}?`,
      description:
        (assignedStaff > 0
          ? `${assignedStaff} employee(s) stay assigned for history and reporting. `
          : '') +
        'The department becomes Inactive and is removed from Onboarding and movement dropdowns, so no new staff can be placed here. You can reactivate it later.',
      variant: 'danger',
      confirmLabel: 'Deactivate',
    });
    if (!ok) return;

    setActionBusy(true);
    try {
      const result = (await Api.departments.deactivate(department.id)) as {
        department?: Department;
      };
      const updated: Department = {
        ...department,
        ...(result?.department || {}),
        isActive: false,
      };
      showToast(`${department.name} is now inactive`, 'success');
      onDeleted(department.id, updated);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to deactivate department', 'error');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!department) return;
    if (!canDelete) {
      showToast(
        `Cannot delete while ${assignedStaff} employee(s) are assigned. Deactivate instead, or move/offboard staff first.`,
        'error'
      );
      return;
    }
    const ok = await confirm({
      title: `Delete ${department.name}?`,
      description:
        'This permanently removes the department and its positions. Only empty departments can be deleted. This cannot be undone.',
      variant: 'danger',
      confirmLabel: 'Delete permanently',
    });
    if (!ok) return;

    setActionBusy(true);
    try {
      await Api.departments.delete(department.id);
      showToast(`Deleted ${department.name}`, 'success');
      onDeleted(department.id);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete department', 'error');
    } finally {
      setActionBusy(false);
    }
  };

  const handleReactivate = async () => {
    if (!department) return;
    const ok = await confirm({
      title: `Reactivate ${department.name}?`,
      description:
        'The department becomes Active again and can be selected for new employees and movements.',
      variant: 'success',
      confirmLabel: 'Reactivate',
    });
    if (!ok) return;

    setActionBusy(true);
    try {
      const updated = (await Api.departments.reactivate(department.id)) as Department;
      showToast(`${department.name} is active again`, 'success');
      onSaved(updated);
      onDeleted(department.id, updated);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to reactivate department', 'error');
    } finally {
      setActionBusy(false);
    }
  };

  if (!department) return null;

  return (
    <>
      <ConfirmDialogHost />
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        size="lg"
        title="Department settings"
        description={`Configure unit identity and leadership for ${department.name}.`}
        disableClose={busy}
        footer={
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 w-full">
            <div className="flex flex-wrap gap-2 justify-end sm:justify-start">
              {isActive ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  isLoading={actionBusy}
                  icon={<Ban className="w-4 h-4" />}
                  aria-label="Deactivate department"
                  title="Deactivate — hide from new assignments; keep existing staff"
                  className="border-amber-200 text-amber-800 hover:bg-amber-50 dark:border-amber-900/50 dark:text-amber-300 dark:hover:bg-amber-950/40"
                  onClick={() => void handleDeactivate()}
                >
                  Deactivate
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  isLoading={actionBusy}
                  icon={<RotateCcw className="w-4 h-4" />}
                  aria-label="Reactivate department"
                  title="Reactivate department"
                  onClick={() => void handleReactivate()}
                >
                  Reactivate
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={busy || !canDelete}
                iconOnly
                icon={<Trash2 className="w-4 h-4 text-red-600" />}
                aria-label={
                  canDelete
                    ? 'Delete department'
                    : 'Delete unavailable while employees are assigned'
                }
                title={
                  canDelete
                    ? 'Delete permanently (empty departments only)'
                    : `Cannot delete while ${assignedStaff} employee(s) are assigned — use Deactivate`
                }
                className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40 disabled:opacity-50"
                onClick={() => void handleDelete()}
              />
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="department-settings-form"
                isLoading={saving}
                disabled={actionBusy}
              >
                Save changes
              </Button>
            </div>
          </div>
        }
      >
        <form
          id="department-settings-form"
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-1"
        >
          {!isActive && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              This department is <strong>Inactive</strong>. It is hidden from Onboarding and
              placement dropdowns. Existing staff and historical records are unchanged.
            </div>
          )}
          {isActive && assignedStaff > 0 && (
            <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
              <strong>{assignedStaff}</strong> employee(s) are assigned. You can{' '}
              <strong>Deactivate</strong> to stop new placements, or move/offboard staff first to
              enable <strong>Delete</strong>.
            </div>
          )}
          <DepartmentUnitForm
            key={department.id}
            variant="modal"
            values={form}
            onChange={setForm}
            departments={departments}
            users={users}
            excludeDepartmentId={department.id}
          />
        </form>
      </Modal>
    </>
  );
};
