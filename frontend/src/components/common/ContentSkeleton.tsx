import React from 'react';
import { useLanguage } from '../../context/LanguageContext';

export type ContentSkeletonLayout =
  | 'list'
  | 'table'
  | 'cards'
  | 'form'
  | 'dashboard'
  | 'queue'
  | 'chat';

export type ContentSkeletonProps = {
  layout?: ContentSkeletonLayout;
  /** Number of repeated rows / cards. Layout specific default when omitted. */
  rows?: number;
  /**
   * When true, prepend a fake search/filter toolbar (useful for full-page loads
   * that replace the list chrome). Nested list bodies should leave this false.
   */
  showChrome?: boolean;
  label?: React.ReactNode;
  className?: string;
};

const BLOCK = 'animate-pulse rounded-md bg-slate-200/80 dark:bg-slate-700/50';
const CARD =
  'rounded-xl border border-slate-200/80 dark:border-slate-700/60 bg-white/60 dark:bg-slate-900/40';

function Block({ className = '' }: { className?: string }) {
  return <div className={`${BLOCK} ${className}`} aria-hidden />;
}

function times(count: number): number[] {
  return Array.from({ length: Math.max(1, count) }, (_, i) => i);
}

function ListChrome() {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 px-1">
      <Block className="h-9 flex-1 min-w-0 sm:min-w-[10rem]" />
      <Block className="h-9 w-20 sm:w-24 shrink-0" />
      <Block className="h-9 w-9 shrink-0" />
    </div>
  );
}

/** Stacked identity rows — mirrors mobile list cards and desktop list panels. */
function ListRows({ rows }: { rows: number }) {
  return (
    <div className="divide-y divide-slate-200/70 dark:divide-slate-700/50">
      {times(rows).map((i) => (
        <div key={i} className="p-3 sm:p-3.5 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0">
              <Block className="h-8 w-8 sm:h-9 sm:w-9 md:h-10 md:w-10 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5 min-w-0">
                <Block className="h-3 sm:h-3.5 w-[40%] max-w-[10rem] sm:max-w-[14rem]" />
                <Block className="h-2.5 sm:h-3 w-[55%] max-w-[12rem] sm:max-w-[18rem] hidden sm:block" />
              </div>
            </div>
            <Block className="h-5 w-14 sm:w-20 shrink-0 rounded-full" />
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:hidden">
            {times(4).map((f) => (
              <div key={f} className="space-y-1">
                <Block className="h-2 w-10" />
                <Block className="h-3 w-16" />
              </div>
            ))}
          </div>
          <div className="hidden sm:flex items-center gap-3 pt-0.5">
            <Block className="h-3 w-24" />
            <Block className="h-3 w-20" />
            <Block className="h-3 w-28 hidden md:block" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ListSkeleton({ rows, showChrome }: { rows: number; showChrome: boolean }) {
  return (
    <div className="w-full">
      {showChrome ? <ListChrome /> : null}
      <ListRows rows={rows} />
    </div>
  );
}

/** Desktop table chrome; mobile falls back to stacked list rows. */
function TableSkeleton({ rows }: { rows: number }) {
  return (
    <>
      <div className="block lg:hidden">
        <ListRows rows={rows} />
      </div>
      <div className={`hidden lg:block ${CARD} overflow-hidden`}>
        <div className="flex items-center gap-3 xl:gap-4 border-b border-slate-200/80 dark:border-slate-700/60 px-3 xl:px-4 py-3">
          {times(5).map((i) => (
            <Block
              key={i}
              className={`h-3 ${i === 0 ? 'w-24 xl:w-32 shrink-0' : 'flex-1 min-w-0'}`}
            />
          ))}
        </div>
        <div className="divide-y divide-slate-200/70 dark:divide-slate-700/50">
          {times(rows).map((i) => (
            <div key={i} className="flex items-center gap-3 xl:gap-4 px-3 xl:px-4 py-3.5">
              {times(5).map((c) => (
                <Block
                  key={c}
                  className={`h-3.5 ${c === 0 ? 'w-24 xl:w-32 shrink-0' : 'flex-1 min-w-0'}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function CardsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
      {times(rows).map((i) => (
        <div key={i} className={`${CARD} p-3.5 sm:p-5 space-y-3`}>
          <div className="flex items-center gap-3">
            <Block className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2 min-w-0">
              <Block className="h-3.5 w-3/5 max-w-full" />
              <Block className="h-3 w-2/5 max-w-full" />
            </div>
          </div>
          <Block className="h-3 w-full" />
          <Block className="h-3 w-4/5" />
          <div className="flex gap-2 pt-1">
            <Block className="h-6 w-14 sm:w-16 rounded-full" />
            <Block className="h-6 w-16 sm:w-20 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function FormSkeletonLayout({ rows }: { rows: number }) {
  return (
    <div className="space-y-3 sm:space-y-4">
      {times(rows).map((section) => (
        <div key={section} className={`${CARD} p-3.5 sm:p-5 space-y-4`}>
          <div className="flex items-center gap-3">
            <Block className="h-8 w-8 rounded-lg shrink-0" />
            <Block className="h-4 w-32 sm:w-40 max-w-full" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            {times(4).map((field) => (
              <div key={field} className="space-y-2">
                <Block className="h-3 w-20 sm:w-24" />
                <Block className="h-10 w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DashboardSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3 sm:space-y-4">
      <div className={`${CARD} p-3.5 sm:p-5 space-y-3`}>
        <Block className="h-3 w-28 sm:w-32" />
        <Block className="h-5 sm:h-6 w-48 sm:w-56 max-w-full" />
        <Block className="h-3 w-56 sm:w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        {times(4).map((i) => (
          <div key={i} className={`${CARD} p-3 sm:p-4 space-y-2.5 sm:space-y-3`}>
            <Block className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg" />
            <Block className="h-3 w-16 sm:w-20" />
            <Block className="h-4 sm:h-5 w-12 sm:w-16" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
        {times(rows).map((i) => (
          <div key={i} className={`${CARD} p-3.5 sm:p-5 space-y-3`}>
            <Block className="h-4 w-32 sm:w-40 max-w-full" />
            <Block className="h-3 w-full" />
            <Block className="h-3 w-5/6" />
            <Block className="h-3 w-2/3" />
            <Block className="h-20 sm:h-24 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

function QueueSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {times(3).map((i) => (
          <Block key={i} className="h-7 w-20 sm:w-24 rounded-full" />
        ))}
      </div>
      <div className="space-y-2">
        {times(rows).map((i) => (
          <div key={i} className={`${CARD} p-3 sm:p-4 space-y-3`}>
            <div className="flex items-center justify-between gap-3">
              <Block className="h-3.5 w-2/5 max-w-[10rem] sm:max-w-[16rem]" />
              <Block className="h-6 w-16 sm:w-20 shrink-0 rounded-full" />
            </div>
            <Block className="h-3 w-3/5 max-w-[14rem] sm:max-w-[22rem]" />
            <div className="flex flex-wrap gap-2">
              <Block className="h-8 w-20 sm:w-24 rounded-lg" />
              <Block className="h-8 w-20 sm:w-24 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Message-thread bubbles. Conversation sidebars use the `list` layout instead. */
function ChatSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3 p-2">
      {times(rows).map((i) => {
        const mine = i % 2 !== 0;
        return (
          <div key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'} gap-2`}>
            {mine ? null : <Block className="h-7 w-7 sm:h-8 sm:w-8 rounded-full shrink-0" />}
            <Block
              className={`rounded-2xl ${mine ? 'h-10 sm:h-12 w-[45%] sm:w-2/5' : 'h-12 sm:h-14 w-[60%] sm:w-3/5'} max-w-[20rem]`}
            />
          </div>
        );
      })}
    </div>
  );
}

const DEFAULT_ROWS: Record<ContentSkeletonLayout, number> = {
  list: 5,
  table: 6,
  cards: 3,
  form: 2,
  dashboard: 2,
  queue: 3,
  chat: 4,
};

/**
 * Layout-aware loading placeholder. Mirrors the shape of the content being
 * fetched so the page keeps its structure instead of collapsing to a spinner.
 * Table layout uses stacked cards below `lg` and a table skeleton from `lg` up.
 */
export const ContentSkeleton: React.FC<ContentSkeletonProps> = ({
  layout = 'list',
  rows,
  showChrome = false,
  label,
  className = '',
}) => {
  const { t } = useLanguage();
  const count = rows ?? DEFAULT_ROWS[layout] ?? 4;
  const ariaLabel =
    typeof label === 'string' && label ? label : t('common.retrievingData');

  let body: React.ReactNode;
  switch (layout) {
    case 'table':
      body = <TableSkeleton rows={count} />;
      break;
    case 'cards':
      body = <CardsSkeleton rows={count} />;
      break;
    case 'form':
      body = <FormSkeletonLayout rows={count} />;
      break;
    case 'dashboard':
      body = <DashboardSkeleton rows={count} />;
      break;
    case 'queue':
      body = <QueueSkeleton rows={count} />;
      break;
    case 'chat':
      body = <ChatSkeleton rows={count} />;
      break;
    default:
      body = <ListSkeleton rows={count} showChrome={showChrome} />;
  }

  return (
    <div
      className={`w-full min-w-0 ${className}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={ariaLabel}
    >
      {body}
    </div>
  );
};

/** Skeleton rows rendered inside an existing table body. */
export const TableSkeletonRows: React.FC<{
  colSpan: number;
  rows?: number;
  label?: React.ReactNode;
}> = ({ colSpan, rows = 5, label }) => {
  const { t } = useLanguage();
  const ariaLabel =
    typeof label === 'string' && label ? label : t('common.retrievingData');
  return (
    <>
      {times(rows).map((i) => (
        <tr
          key={i}
          {...(i === 0
            ? { role: 'status', 'aria-busy': true, 'aria-label': ariaLabel }
            : { 'aria-hidden': true })}
        >
          <td colSpan={colSpan} className="px-2 py-2.5 sm:px-4 sm:py-3">
            <div className="flex items-center gap-2.5 sm:gap-4 min-w-0">
              <Block className="h-7 w-7 sm:h-8 sm:w-8 shrink-0 rounded-full" />
              <Block className="h-3.5 w-24 sm:w-32 shrink-0" />
              <Block className="h-3.5 flex-1 min-w-0" />
              <Block className="h-3.5 hidden md:block flex-1 min-w-0" />
              <Block className="h-5 sm:h-6 w-14 sm:w-20 shrink-0 rounded-full" />
            </div>
          </td>
        </tr>
      ))}
    </>
  );
};
