import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Api } from '../../services/api';
import { Position, Role } from '../../types';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { POSITION_ACCESS_ROLE_OPTIONS } from '../../constants/positionCatalog';
import { usePositionLevels } from '../../hooks/usePositionLevels';
import { WizardKhmerSubsection } from '../employee-wizard/wizardKhmerSection';

const inputClass =
  'w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-900 text-base text-slate-900 dark:text-white';

type Draft = {
  title: string;
  titleKh: string;
  level: string;
  accessRole: Role;
  salaryMin: string;
  salaryMax: string;
};

const EMPTY_DRAFT: Draft = {
  title: '',
  titleKh: '',
  level: '',
  accessRole: Role.EMPLOYEE,
  salaryMin: '',
  salaryMax: '',
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  departmentId: string;
  departmentName?: string;
  onCreated: (position: Position) => void;
};

function parseSalaryField(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const CreatePositionModal: React.FC<Props> = ({
  isOpen,
  onClose,
  departmentId,
  departmentName,
  onCreated,
}) => {
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { options: positionLevelOptions } = usePositionLevels();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) setDraft(EMPTY_DRAFT);
  }, [isOpen]);

  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!departmentId.trim()) {
      showToast('Select a department first', 'error');
      return;
    }
    const title = draft.title.trim();
    const titleKh = draft.titleKh.trim();
    if (!title) {
      showToast('Position name is required', 'error');
      return;
    }
    if (!titleKh) {
      showToast('Position name (Khmer) is required', 'error');
      return;
    }
    if (!draft.level) {
      showToast('Please select a level', 'error');
      return;
    }
    const salaryMin = parseSalaryField(draft.salaryMin);
    const salaryMax = parseSalaryField(draft.salaryMax);
    if (salaryMin == null || salaryMax == null) {
      showToast('Enter a valid minimum and maximum salary', 'error');
      return;
    }
    if (salaryMax < salaryMin) {
      showToast('Maximum salary must be greater than or equal to minimum', 'error');
      return;
    }
    if (salaryMin <= 0 || salaryMax <= 0) {
      showToast('Salary range values must be greater than zero', 'error');
      return;
    }

    setSaving(true);
    try {
      const created = (await Api.positions.create({
        title,
        titleKh,
        level: draft.level,
        accessRole: draft.accessRole || Role.EMPLOYEE,
        departmentId,
        salaryMin,
        salaryMax,
      })) as Position;
      showToast('Position created', 'success');
      onCreated(created);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create position', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title="Create position"
      description={
        departmentName
          ? `Define the job title, level, salary range, and default portal role for ${departmentName}.`
          : 'Define the job title, level, salary range, and default portal access role.'
      }
      disableClose={saving}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="create-position-quick-form" isLoading={saving}>
            Create position
          </Button>
        </>
      }
    >
      <form id="create-position-quick-form" onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-semibold mb-2" htmlFor="quick-pos-title">
            Position
            <span className="text-red-500 ml-0.5">*</span>
          </label>
          <input
            id="quick-pos-title"
            required
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="e.g. Software Engineer"
            className={inputClass}
          />
        </div>

        <WizardKhmerSubsection
          titleKey="departments.khmer.sectionTitle"
          descriptionKey="departments.khmer.sectionDescription"
        >
          <div>
            <label className="block text-sm font-semibold mb-2" htmlFor="quick-pos-title-kh">
              {t('departments.khmer.positionTitle')}
              <span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              id="quick-pos-title-kh"
              required
              value={draft.titleKh}
              onChange={(e) => set({ titleKh: e.target.value })}
              placeholder="ឧ. វិស្វករកម្មវិធី"
              className={`${inputClass} font-khmer`}
            />
          </div>
        </WizardKhmerSubsection>

        <div>
          <label className="block text-sm font-semibold mb-2" htmlFor="quick-pos-level">
            Level
            <span className="text-red-500 ml-0.5">*</span>
          </label>
          <select
            id="quick-pos-level"
            required
            value={draft.level}
            onChange={(e) => set({ level: e.target.value })}
            className={inputClass}
          >
            <option value="" disabled hidden>
              Select level
            </option>
            {positionLevelOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2" htmlFor="quick-pos-role">
            Role
            <span className="text-red-500 ml-0.5">*</span>
          </label>
          <select
            id="quick-pos-role"
            required
            value={draft.accessRole}
            onChange={(e) => set({ accessRole: e.target.value as Role })}
            className={inputClass}
          >
            {POSITION_ACCESS_ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-500 mt-1">
            Default portal access when employees are assigned this position.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold mb-2" htmlFor="quick-pos-salary-min">
              Minimum salary (USD)
              <span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              id="quick-pos-salary-min"
              type="number"
              required
              min={0}
              step="1"
              value={draft.salaryMin}
              onChange={(e) => set({ salaryMin: e.target.value })}
              placeholder="e.g. 400"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-2" htmlFor="quick-pos-salary-max">
              Maximum salary (USD)
              <span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              id="quick-pos-salary-max"
              type="number"
              required
              min={0}
              step="1"
              value={draft.salaryMax}
              onChange={(e) => set({ salaryMax: e.target.value })}
              placeholder="e.g. 600"
              className={inputClass}
            />
          </div>
        </div>
        <p className="text-xs text-slate-500 -mt-2">
          Onboarding base salary must fall within this range for employees assigned to this position.
        </p>
      </form>
    </Modal>
  );
};
