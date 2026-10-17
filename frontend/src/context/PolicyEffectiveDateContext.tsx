import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { defaultPolicyEffectiveDate } from '../utils/policyEffectiveDate';

export type PolicyEditorMeta = {
  currentEffectiveFrom?: string | null;
  scheduledEffectiveFrom?: string | null;
  lastUpdatedAt?: string | null;
};

type EditorEntry = PolicyEditorMeta & { id: string };

type PolicyEffectiveDateContextValue = {
  effectiveFrom: string;
  setEffectiveFrom: (value: string) => void;
  registerEditor: (id: string, meta?: PolicyEditorMeta) => void;
  unregisterEditor: (id: string) => void;
  activeEditor: EditorEntry | null;
  requireEffectiveFrom: () => string;
};

const PolicyEffectiveDateContext = createContext<PolicyEffectiveDateContextValue | null>(null);

export const PolicyEffectiveDateProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [effectiveFrom, setEffectiveFrom] = useState(defaultPolicyEffectiveDate);
  const [editors, setEditors] = useState<EditorEntry[]>([]);

  const registerEditor = useCallback((id: string, meta: PolicyEditorMeta = {}) => {
    setEditors((prev) => {
      const without = prev.filter((e) => e.id !== id);
      return [...without, { id, ...meta }];
    });
  }, []);

  const unregisterEditor = useCallback((id: string) => {
    setEditors((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const activeEditor = editors.length ? editors[editors.length - 1]! : null;

  const requireEffectiveFrom = useCallback(() => {
    const d = String(effectiveFrom ?? '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      throw new Error(
        'Effective date is required. Policy changes are scheduled — they do not apply instantly.'
      );
    }
    return d;
  }, [effectiveFrom]);

  const value = useMemo(
    () => ({
      effectiveFrom,
      setEffectiveFrom,
      registerEditor,
      unregisterEditor,
      activeEditor,
      requireEffectiveFrom,
    }),
    [effectiveFrom, registerEditor, unregisterEditor, activeEditor, requireEffectiveFrom]
  );

  return (
    <PolicyEffectiveDateContext.Provider value={value}>{children}</PolicyEffectiveDateContext.Provider>
  );
};

export function usePolicyEffectiveDateContext(): PolicyEffectiveDateContextValue {
  const ctx = useContext(PolicyEffectiveDateContext);
  if (!ctx) {
    throw new Error('usePolicyEffectiveDateContext must be used within PolicyEffectiveDateProvider');
  }
  return ctx;
}

/** Register this section while `active` (edit mode) and read shared effective date for saves. */
export function usePolicyEffectiveDateEditor(
  active: boolean,
  editorId: string,
  meta?: PolicyEditorMeta
): Pick<PolicyEffectiveDateContextValue, 'effectiveFrom' | 'requireEffectiveFrom'> {
  const ctx = usePolicyEffectiveDateContext();
  const { registerEditor, unregisterEditor, effectiveFrom, requireEffectiveFrom } = ctx;

  useEffect(() => {
    if (!active) return;
    registerEditor(editorId, meta);
    return () => unregisterEditor(editorId);
  }, [
    active,
    editorId,
    meta?.currentEffectiveFrom,
    meta?.scheduledEffectiveFrom,
    meta?.lastUpdatedAt,
    registerEditor,
    unregisterEditor,
  ]);

  return { effectiveFrom, requireEffectiveFrom };
}
