import { describe, expect, it } from 'vitest';
import {
  localDateKeyFromIso,
  localTimeFromIso,
  normalizeReminderTime,
  toAlertAtIso,
} from './personalHubAlerts';

describe('personalHubAlerts', () => {
  it('round-trips local date and time through ISO', () => {
    const iso = toAlertAtIso('2026-06-05', '09:30');
    expect(localDateKeyFromIso(iso)).toBe('2026-06-05');
    expect(localTimeFromIso(iso)).toBe('09:30');
  });

  it('normalizes shift time values', () => {
    expect(normalizeReminderTime('08:00:00')).toBe('08:00');
    expect(normalizeReminderTime('')).toBe('09:00');
    expect(normalizeReminderTime('25:99')).toBe('23:59');
  });
});
