import type { OvertimeRequestConfig, OvertimeType, OvertimeTypeRules } from '../types';

export function defaultOvertimeTypeRules(partial?: Partial<OvertimeTypeRules>): OvertimeTypeRules {
  return {
    minHours: 0.25,
    maxHoursPerDay: 12,
    minAdvanceDays: 0,
    requireStartEndTime: false,
    requireClockInOut: false,
    ...partial,
  };
}

export function defaultOvertimeRequestConfig(): OvertimeRequestConfig {
  return {
    globalMaxHoursPerMonth: 80,
    types: [
      {
        id: 'ot-type-0',
        name: 'Regular overtime',
        description: 'Straight-time overtime at base hourly rate (100%).',
        rateTier: 'regular_100',
        isActive: true,
        rules: defaultOvertimeTypeRules({ maxHoursPerDay: 8 }),
      },
      {
        id: 'ot-type-1',
        name: 'Weekday overtime',
        description: 'Extra hours on a normal working day (150%).',
        rateTier: 'daytime_150',
        isActive: true,
        rules: defaultOvertimeTypeRules({ maxHoursPerDay: 8 }),
      },
      {
        id: 'ot-type-2',
        name: 'Rest day / public holiday',
        description: 'Work on roster day off or public holiday (200%).',
        rateTier: 'rest_holiday_200',
        isActive: true,
        rules: defaultOvertimeTypeRules(),
      },
      {
        id: 'ot-type-3',
        name: 'Night shift overtime',
        description: 'Overtime between 22:00 and 06:00 (200%).',
        rateTier: 'night_200',
        isActive: true,
        rules: defaultOvertimeTypeRules({ requireClockInOut: true }),
      },
    ],
  };
}

export function activeOvertimeTypes(config: OvertimeRequestConfig): OvertimeType[] {
  return config.types.filter((t) => t.isActive);
}

export function findOvertimeType(config: OvertimeRequestConfig, id: string): OvertimeType | undefined {
  return config.types.find((t) => t.id === id);
}

export function findRestDayOvertimeType(config: OvertimeRequestConfig): OvertimeType | undefined {
  return (
    config.types.find((t) => t.isActive && t.rateTier === 'rest_holiday_200') ??
    config.types.find((t) => t.isActive)
  );
}
