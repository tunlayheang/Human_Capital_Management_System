import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ActiveStatusControl } from '../../components/ui/ActiveStatusControl';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import type { AllowanceRule, AllowanceTemplate, AllowanceType } from '../../types';
import { isRecordActive, resolveAmountFromRule } from './allowanceRuleUtils';
import { ListSearchFilterBar } from '../../components/ui/page';
import { FilterMenuSelect, PageFilterMenu } from '../../components/ui/PageFilterMenu';
import { countActiveFilters } from '../../utils/filterActiveCount';
import { promptActiveStatusChange } from '../../utils/activeStatusChange';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';

/** Allowance package templates — assigned explicitly on the employee Pay step. */
const inputClass =
  'rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm w-full';

export type TemplateItemDraft = {
  id?: string;
  allowance_type_id: string;
  allowance_rule_id?: string;
  amount: number;
};

type TemplateDraft = {
  id?: string;
  template_name: string;
  active: boolean;
  /** Original active flag when editing — used to detect status changes that need an effective date. */
  initialActive?: boolean;
  items: TemplateItemDraft[];
};

const SELECT_TYPE_VALUE = '';

function emptyTemplateItem(): TemplateItemDraft {
  return {
    allowance_type_id: SELECT_TYPE_VALUE,
    allowance_rule_id: '',
    amount: 0,
  };
}

function normalizeTemplate(row: AllowanceTemplate): AllowanceTemplate {
  return {
    ...row,
    active: isRecordActive(row.active),
    items: (row.items ?? []).map((it) => ({
      ...it,
      amount: Number(it.amount) || 0,
    })),
  };
}

function templateToDraft(
  tpl: AllowanceTemplate | null,
  types: AllowanceType[],
  rules: AllowanceRule[]
): TemplateDraft {
  if (!tpl) {
    return {
      template_name: '',
      active: true,
      initialActive: true,
      items: [emptyTemplateItem()],
    };
  }
  return {
    id: tpl.id,
    template_name: tpl.template_name,
    active: tpl.active,
    initialActive: tpl.active,
    items:
      tpl.items?.length
        ? tpl.items.map((it) => {
            const resolved = resolveAmountFromRule(
              it.allowance_type_id,
              it.allowance_rule_id ?? '',
              rules
            );
            return {
              id: it.id,
              allowance_type_id: it.allowance_type_id,
              allowance_rule_id: resolved.ruleId,
              amount: resolved.amount,
            };
          })
        : [buildItemForType(types[0]?.id ?? '', rules)],
  };
}

function buildItemForType(typeId: string, rules: AllowanceRule[]): TemplateItemDraft {
  const resolved = resolveAmountFromRule(typeId, '', rules);
  return {
    allowance_type_id: typeId,
    allowance_rule_id: resolved.ruleId,
    amount: resolved.amount,
  };
}

function syncDraftItemsFromRules(
  items: TemplateItemDraft[],
  rules: AllowanceRule[]
): TemplateItemDraft[] {
  return items
    .filter((it) => Boolean(it.allowance_type_id))
    .map((it) => {
      const resolved = resolveAmountFromRule(
        it.allowance_type_id,
        it.allowance_rule_id,
        rules
      );
      return {
        ...it,
        allowance_rule_id: resolved.ruleId,
        amount: resolved.amount,
      };
    });
}

type Props = {
  canEdit: boolean;
  types: AllowanceType[];
  rules: AllowanceRule[];
  templates: AllowanceTemplate[];
  onTemplatesChange: () => void | Promise<void>;
};

export const AllowanceTemplatesTab: React.FC<Props> = ({
  canEdit,
  types,
  rules,
  templates,
  onTemplatesChange,
}) => {
  const { showToast } = useToast();
  const { confirm, confirmEffectiveDate, ConfirmDialogHost } = useConfirmDialog();
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [draftBaseline, setDraftBaseline] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const templateFilterActiveCount = useMemo(
    () => countActiveFilters([{ value: statusFilter, defaultValue: '' }]),
    [statusFilter]
  );

  const normalizedTemplates = useMemo(
    () => templates.map(normalizeTemplate),
    [templates]
  );

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return normalizedTemplates.filter((tpl) => {
      if (statusFilter === 'active' && !tpl.active) return false;
      if (statusFilter === 'inactive' && tpl.active) return false;
      if (!q) return true;
      return tpl.template_name.toLowerCase().includes(q);
    });
  }, [normalizedTemplates, search, statusFilter]);

  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? id;
  const ruleName = (id: string) => rules.find((r) => r.id === id)?.rule_name ?? '—';

  const previewTotal = (items: TemplateItemDraft[]) =>
    syncDraftItemsFromRules(items, rules).reduce((s, it) => s + it.amount, 0);

  const openCreate = () => {
    const next = templateToDraft(null, types, rules);
    setDraft(next);
    setDraftBaseline(JSON.stringify(next));
    setModalOpen(true);
  };

  const openEdit = (tpl: AllowanceTemplate) => {
    const next = templateToDraft(normalizeTemplate(tpl), types, rules);
    setDraft(next);
    setDraftBaseline(JSON.stringify(next));
    setModalOpen(true);
  };

  const isFormDirty =
    modalOpen && draft != null && draftBaseline != null && JSON.stringify(draft) !== draftBaseline;
  const { confirmDiscardIfDirty } = useUnsavedChangesGuard({
    isDirty: isFormDirty,
    confirm,
  });

  const closeModal = async () => {
    if (!(await confirmDiscardIfDirty())) return;
    setModalOpen(false);
    setDraft(null);
    setDraftBaseline(null);
  };

  const forceCloseModal = () => {
    setModalOpen(false);
    setDraft(null);
    setDraftBaseline(null);
  };

  const saveTemplate = async () => {
    if (!draft) return;
    const statusChanged = draft.initialActive !== draft.active;
    let effectiveFrom: string | undefined;
    if (statusChanged) {
      effectiveFrom =
        (await promptActiveStatusChange(confirmEffectiveDate, {
          entityLabel: 'template',
          entityName: draft.template_name || 'this template',
          nextActive: draft.active,
        })) ?? undefined;
      if (!effectiveFrom) return;
    }
    setSaving(true);
    try {
      const itemsToSave = syncDraftItemsFromRules(draft.items, rules);
      if (itemsToSave.length === 0) {
        showToast('Select an allowance type for each row before saving', 'error');
        setSaving(false);
        return;
      }
      const typeIds = itemsToSave.map((it) => it.allowance_type_id);
      if (new Set(typeIds).size !== typeIds.length) {
        showToast(
          'Each allowance type can only appear once in a template. Remove the duplicate type.',
          'error'
        );
        setSaving(false);
        return;
      }
      await Api.payroll.saveAllowanceTemplate({
        id: draft.id,
        template_name: draft.template_name,
        department_id: null,
        role_id: null,
        active: draft.active,
        items: itemsToSave.map((it) => ({
          id: it.id,
          allowance_type_id: it.allowance_type_id,
          allowance_rule_id: it.allowance_rule_id || null,
          amount: it.amount,
        })),
        ...(effectiveFrom ? { effective_from: effectiveFrom } : {}),
      } as Partial<AllowanceTemplate> & { effective_from?: string });
      showToast(draft.id ? 'Template updated' : 'Template created', 'success');
      forceCloseModal();
      await onTemplatesChange();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to save template', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleTemplateActive = async (tpl: AllowanceTemplate) => {
    const next = !isRecordActive(tpl.active);
    const effectiveFrom = await promptActiveStatusChange(confirmEffectiveDate, {
      entityLabel: 'template',
      entityName: tpl.template_name,
      nextActive: next,
    });
    if (!effectiveFrom) return;
    setTogglingId(tpl.id);
    try {
      await Api.payroll.saveAllowanceTemplate({
        ...tpl,
        department_id: null,
        role_id: null,
        active: next,
        items: tpl.items ?? [],
        ...(effectiveFrom ? { effective_from: effectiveFrom } : {}),
      } as Partial<AllowanceTemplate> & { effective_from?: string });
      showToast(next ? 'Template activated' : 'Template deactivated', 'success');
      await onTemplatesChange();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to update template', 'error');
    } finally {
      setTogglingId(null);
    }
  };

  const deleteTemplate = async (id: string) => {
    const ok = await confirm({
      title: 'Delete template permanently?',
      description:
        'This permanently deletes the template. It cannot be restored. Employees assigned to this package will be unlinked.',
      variant: 'danger',
      confirmLabel: 'Delete forever',
    });
    if (!ok) return;
    setDeletingId(id);
    try {
      await Api.payroll.deleteAllowanceTemplate(id);
      showToast('Template deleted permanently', 'success');
      await onTemplatesChange();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to delete template', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const updateItem = (index: number, patch: Partial<TemplateItemDraft>) => {
    if (!draft) return;
    const items = [...draft.items];
    const current = items[index];
    if (patch.allowance_type_id !== undefined) {
      if (!patch.allowance_type_id) {
        items[index] = emptyTemplateItem();
      } else {
        items[index] = buildItemForType(patch.allowance_type_id, rules);
      }
    } else if (patch.allowance_rule_id != null) {
      const resolved = resolveAmountFromRule(
        current.allowance_type_id,
        patch.allowance_rule_id,
        rules
      );
      items[index] = {
        ...current,
        allowance_rule_id: resolved.ruleId,
        amount: resolved.amount,
      };
    } else {
      items[index] = { ...current, ...patch };
    }
    setDraft({ ...draft, items });
  };

  const addItemRow = () => {
    if (!draft) return;
    setDraft({
      ...draft,
      items: [...draft.items, emptyTemplateItem()],
    });
  };

  const typesForRow = (rowIndex: number, currentTypeId: string) => {
    const usedElsewhere = new Set(
      draft?.items
        .map((i, idx) => (idx === rowIndex ? '' : i.allowance_type_id))
        .filter(Boolean) ?? []
    );
    return types.filter((t) => t.id === currentTypeId || !usedElsewhere.has(t.id));
  };

  const removeItemRow = (index: number) => {
    if (!draft || draft.items.length <= 1) return;
    setDraft({ ...draft, items: draft.items.filter((_, i) => i !== index) });
  };

  const rulesForType = (typeId: string) =>
    rules.filter((r) => r.allowance_type_id === typeId && isRecordActive(r.active));

  return (
    <div className="space-y-4">
      <ConfirmDialogHost />

      <ListSearchFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search templates..."
        filter={
          <PageFilterMenu
            activeCount={templateFilterActiveCount}
            onClear={() => {
              setStatusFilter('');
            }}
          >
            <FilterMenuSelect
              label="Status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          </PageFilterMenu>
        }
        trailing={
          canEdit ? (
            <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={openCreate}>
              New template
            </Button>
          ) : undefined
        }
      />

      {normalizedTemplates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center space-y-3">
          <p className="text-sm text-slate-500">No templates yet.</p>
          {canEdit && (
            <Button size="sm" onClick={openCreate}>
              Create your first template
            </Button>
          )}
          <p className="text-xs text-slate-400">
            Restart the backend once to auto-seed “Standard employee” and “Manager” packages if
            rules already exist.
          </p>
        </div>
      ) : filteredTemplates.length === 0 ? (
        <p className="text-sm text-slate-500 italic py-6 text-center">
          No templates match your search or filters.
        </p>
      ) : (
        <div className="space-y-3">
          {filteredTemplates.map((tpl) => (
            <div
              key={tpl.id}
              className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/30"
            >
              <div className="flex flex-wrap justify-between gap-3 items-start">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">{tpl.template_name}</p>
                  <p className="text-xs text-slate-500 mt-2">
                    Preview total (fixed amounts):{' '}
                    <strong>${previewTotal(tpl.items ?? []).toFixed(2)}</strong> / month
                  </p>
                </div>
                <div className="flex gap-1.5 items-center shrink-0">
                  <ActiveStatusControl
                    active={isRecordActive(tpl.active)}
                    loading={togglingId === tpl.id}
                    disabled={!canEdit || togglingId === tpl.id || deletingId === tpl.id}
                    readOnly={!canEdit}
                    onRequestToggle={
                      canEdit ? () => void toggleTemplateActive(tpl) : undefined
                    }
                  />
                  {canEdit ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        iconOnly
                        title="Edit template"
                        aria-label="Edit template"
                        disabled={togglingId === tpl.id || deletingId === tpl.id}
                        onClick={() => openEdit(tpl)}
                        icon={<Pencil className="w-3.5 h-3.5" />}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        iconOnly
                        title="Delete template permanently"
                        aria-label="Delete template permanently"
                        disabled={togglingId === tpl.id || deletingId === tpl.id}
                        isLoading={deletingId === tpl.id}
                        onClick={() => void deleteTemplate(tpl.id)}
                        icon={<Trash2 className="w-3.5 h-3.5 text-red-500" />}
                      />
                    </>
                  ) : null}
                </div>
              </div>
              <ul className="mt-3 space-y-1 border-t border-slate-100 dark:border-slate-800 pt-3">
                {(tpl.items ?? []).map((it) => (
                  <li
                    key={it.id}
                    className="flex justify-between text-sm text-slate-600 dark:text-slate-400"
                  >
                    <span>{typeName(it.allowance_type_id)}</span>
                    <span className="font-mono text-xs">
                      $
                      {resolveAmountFromRule(
                        it.allowance_type_id,
                        it.allowance_rule_id ?? '',
                        rules
                      ).amount.toFixed(2)}
                      {it.allowance_rule_id ? ` · ${ruleName(it.allowance_rule_id)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={modalOpen && draft != null}
        onClose={() => void closeModal()}
        title={draft?.id ? 'Edit allowance template' : 'New allowance template'}
        size="lg"
        help="payroll.allowanceRules"
      >
        {draft && (
          <div className="space-y-4">
            <div className="space-y-3">
              <label className="text-sm flex flex-col gap-1">
                <span className="text-slate-500">Template name</span>
                <input
                  className={inputClass}
                  value={draft.template_name}
                  onChange={(e) => setDraft({ ...draft, template_name: e.target.value })}
                  placeholder="e.g. Operations team package"
                />
              </label>
              <ActiveStatusControl
                layout="field"
                size="md"
                active={draft.active}
                onChange={(next) => setDraft({ ...draft, active: next })}
                description="Changing status requires an effective date when you save. Inactive templates cannot be assigned. Assign this package on the employee Pay step — it is not applied automatically."
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    Allowances in this package
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Rule: one allowance type per template — types already used are hidden from
                    other rows.
                  </p>
                </div>
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={addItemRow}>
                    Add allowance
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {draft.items.map((it, idx) => (
                  <div
                    key={`${it.allowance_type_id}-${idx}`}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800"
                  >
                    <label className="sm:col-span-4 text-xs flex flex-col gap-1">
                      Type
                      <select
                        className={inputClass}
                        value={it.allowance_type_id}
                        onChange={(e) =>
                          updateItem(idx, { allowance_type_id: e.target.value })
                        }
                      >
                        <option value={SELECT_TYPE_VALUE}>Select type</option>
                        {typesForRow(idx, it.allowance_type_id).map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="sm:col-span-5 text-xs flex flex-col gap-1">
                      Rule (from Rule Builder)
                      <select
                        className={inputClass}
                        value={it.allowance_rule_id}
                        disabled={!it.allowance_type_id}
                        onChange={(e) =>
                          updateItem(idx, { allowance_rule_id: e.target.value })
                        }
                      >
                        {!it.allowance_type_id ? (
                          <option value="" disabled hidden>Select type first</option>
                        ) : rulesForType(it.allowance_type_id).length === 0 ? (
                          <option value="">No active rules for this type</option>
                        ) : (
                          rulesForType(it.allowance_type_id).map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.rule_name}
                            </option>
                          ))
                        )}
                      </select>
                    </label>
                    <div className="sm:col-span-2 text-xs flex flex-col gap-1">
                      <span className="text-slate-500">Amount (USD)</span>
                      <div
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 px-3 py-2 text-sm font-mono text-slate-800 dark:text-slate-200 min-h-[2.5rem] flex items-center"
                        title="From selected rule — edit amount in Rule Builder"
                      >
                        {!it.allowance_type_id ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <>
                            $
                            {resolveAmountFromRule(
                              it.allowance_type_id,
                              it.allowance_rule_id,
                              rules
                            ).amount.toFixed(2)}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="sm:col-span-1 flex items-end">
                      <button
                        type="button"
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-30"
                        disabled={draft.items.length <= 1}
                        onClick={() => removeItemRow(idx)}
                        title="Remove row"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 px-3 py-2 text-sm">
              <span className="text-slate-500">Package preview (sum of fixed amounts): </span>
              <strong className="text-slate-900 dark:text-white">
                ${previewTotal(draft.items).toFixed(2)} / month
              </strong>
              <p className="text-xs text-slate-500 mt-1">
                Amounts are read from Rule Builder. Attendance/seniority rules may pay
                differently at payroll time based on employee data.
              </p>
            </div>

            <div className="hcms-modal-actions hcms-modal-actions--end gap-2">
              <Button variant="outline" onClick={() => void closeModal()} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={() => void saveTemplate()} disabled={saving || !canEdit}>
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                    Saving…
                  </>
                ) : (
                  'Save template'
                )}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
