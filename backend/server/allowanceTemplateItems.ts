export type AllowanceTemplateItemRow = {
  id: string;
  allowance_type_id: string;
  allowance_rule_id?: string | null;
  amount?: number;
};

export function parseAllowanceTemplateItems(source: unknown): AllowanceTemplateItemRow[] {
  if (!source) return [];
  let raw = source;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const row = entry as Record<string, unknown>;
      const typeId = String(row.allowance_type_id ?? '').trim();
      if (!typeId) return null;
      return {
        id: String(row.id ?? `ati-${typeId}`),
        allowance_type_id: typeId,
        allowance_rule_id: row.allowance_rule_id ? String(row.allowance_rule_id) : null,
        amount: row.amount != null ? Number(row.amount) : 0,
      };
    })
    .filter(Boolean) as AllowanceTemplateItemRow[];
}

export function attachItemsToTemplate<T extends Record<string, unknown>>(plain: T): T & { items: AllowanceTemplateItemRow[] } {
  const items = parseAllowanceTemplateItems(plain.items_json ?? plain.items);
  return { ...plain, items };
}
