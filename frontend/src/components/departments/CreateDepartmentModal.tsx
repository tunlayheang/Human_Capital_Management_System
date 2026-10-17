import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Api } from '../../services/api';
import { Department, User } from '../../types';
import { useToast } from '../../context/ToastContext';
import {
  buildDepartmentPayload,
  DepartmentUnitForm,
  EMPTY_DEPARTMENT_UNIT_FORM,
  type DepartmentUnitFormValues,
} from './DepartmentUnitForm';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** Existing departments — used for manager eligibility checks. */
  departments: Department[];
  onCreated: (department: Department) => void;
};

export const CreateDepartmentModal: React.FC<Props> = ({
  isOpen,
  onClose,
  departments,
  onCreated,
}) => {
  const { showToast } = useToast();
  const [form, setForm] = useState<DepartmentUnitFormValues>(EMPTY_DEPARTMENT_UNIT_FORM);
  const [users, setUsers] = useState<User[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setForm(EMPTY_DEPARTMENT_UNIT_FORM);
    let cancelled = false;
    setLoadingUsers(true);
    void (async () => {
      try {
        const data = await Api.users.getAll();
        if (!cancelled) setUsers(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) showToast('Failed to load manager accounts', 'error');
      } finally {
        if (!cancelled) setLoadingUsers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, showToast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      showToast('Department name is required', 'error');
      return;
    }
    if (!form.nameKh.trim()) {
      showToast('Department name (Khmer) is required', 'error');
      return;
    }
    setSaving(true);
    try {
      const created = (await Api.departments.create(buildDepartmentPayload(form))) as Department;
      showToast('Department created', 'success');
      onCreated(created);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create department', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title="Create department"
      description="Add a business unit. You can assign a department head now or later."
      disableClose={saving}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="create-department-quick-form" isLoading={saving}>
            Create department
          </Button>
        </>
      }
    >
      <form id="create-department-quick-form" onSubmit={handleSubmit} className="space-y-4">
        {loadingUsers ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading managers…</p>
        ) : null}
        <DepartmentUnitForm
          values={form}
          onChange={setForm}
          departments={departments}
          users={users}
          variant="modal"
        />
      </form>
    </Modal>
  );
};
