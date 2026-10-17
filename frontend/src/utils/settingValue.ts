/** Unwrap JSON-encoded scalars from system_settings (e.g. `"Private"` → Private). */
export function unwrapStoredSettingValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('{') && trimmed.endsWith('}'))
    ) {
      try {
        return JSON.parse(trimmed);
      } catch {
        if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
          return trimmed.slice(1, -1);
        }
      }
    }
    return value;
  }
  return value;
}

export function displaySettingText(value: unknown, options?: { masked?: boolean }): string {
  const raw = unwrapStoredSettingValue(value);
  if (raw == null || raw === '') return '—';
  if (Array.isArray(raw)) {
    return raw.length > 0 ? raw.map(String).join(', ') : '—';
  }
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  const text = String(raw).trim();
  if (!text) return '—';
  if (options?.masked && text.length > 4) return `••••${text.slice(-4)}`;
  return text;
}
