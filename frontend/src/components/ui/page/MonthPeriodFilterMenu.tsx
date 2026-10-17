import React from 'react';
import { monthName } from '../../../utils/leaveCalendar';
import { FilterMenuField, PageFilterMenu } from '../PageFilterMenu';
import { MonthPeriodNavigator } from './MonthPeriodNavigator';

export type MonthPeriodFilterMenuProps = {
  month: number;
  year: number;
  onMonthChange: (month: number, year: number) => void;
  monthNavigationDisabled?: boolean;
  title?: string;
  activeCount?: number;
  onClear?: () => void;
  daysHint?: string;
  children?: React.ReactNode;
  /** When true, month control is omitted (use MonthPeriodNavigator outside instead). */
  hideMonthControl?: boolean;
};

export const MonthPeriodFilterMenu: React.FC<MonthPeriodFilterMenuProps> = ({
  month,
  year,
  onMonthChange,
  monthNavigationDisabled = false,
  title = 'Period',
  activeCount = 0,
  onClear,
  daysHint,
  children,
  hideMonthControl = false,
}) => {
  const periodLabel = `${monthName(month)} ${year}`;

  return (
    <PageFilterMenu
      title={title}
      periodSummary={hideMonthControl ? undefined : periodLabel}
      activeCount={activeCount}
      onClear={onClear}
    >
      {!hideMonthControl ? (
        <FilterMenuField
          label="Month"
          hint={
            monthNavigationDisabled
              ? daysHint ?? 'Period is locked for this roster.'
              : daysHint ?? 'Use arrows to change the calendar month.'
          }
        >
          <MonthPeriodNavigator
            month={month}
            year={year}
            onMonthChange={onMonthChange}
            disabled={monthNavigationDisabled}
            className="w-full [&>div:first-child]:w-full"
          />
        </FilterMenuField>
      ) : null}
      {children}
    </PageFilterMenu>
  );
};
