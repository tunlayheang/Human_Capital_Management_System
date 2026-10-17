export type ReportCategory =
  | 'workforce'
  | 'attendance'
  | 'leave_ot'
  | 'payroll'
  | 'hr_risk'
  | 'performance'
  | 'org_kpis'
  | 'forecasts';

export type ReportFilterType =
  | 'date'
  | 'month'
  | 'year'
  | 'text'
  | 'select'
  | 'department'
  | 'status';

export type ReportFilterOption = { value: string; label: string };

export type ReportFilterField = {
  key: string;
  label: string;
  type: ReportFilterType;
  required?: boolean;
  options?: ReportFilterOption[];
  placeholder?: string;
  defaultValue?: string;
};

export type ReportColumn = {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  format?: 'text' | 'number' | 'currency' | 'date' | 'percent';
  /** How to roll this column into the totals footer. Inferred from format when omitted. */
  aggregate?: 'sum' | 'avg' | 'count' | 'omit';
};

export type ReportDefinition = {
  id: string;
  title: string;
  description: string;
  category: ReportCategory;
  categoryLabel: string;
  filters: ReportFilterField[];
};

export type ReportRow = Record<string, string | number | boolean | null | undefined>;

export type ReportSummaryCard = {
  key?: string;
  label: string;
  value: string | number;
  format?: 'text' | 'number' | 'currency' | 'percent';
};

export type ReportSummary = {
  cards: ReportSummaryCard[];
  totalsRow: ReportRow | null;
};

export type ReportRunResult = {
  reportId: string;
  title: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  summary?: ReportSummary;
  meta: {
    generatedAt: string;
    rowCount: number;
    filtersApplied: Record<string, string>;
    note?: string;
  };
};

export type ReportRunContext = {
  actorUserId?: string;
};

export type ReportRunner = (
  filters: Record<string, string>,
  ctx: ReportRunContext
) => Promise<
  Omit<ReportRunResult, 'reportId' | 'title' | 'meta' | 'summary'> & {
    note?: string;
    summaryCards?: ReportSummaryCard[];
    /** When set, used as the table footer instead of auto column aggregates. */
    totalsRow?: ReportRow | null;
  }
>;
