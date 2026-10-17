import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import {
  buildAuditTrailDetail,
  type AuditTrailDetail,
  type AuditTrailDetailInput,
} from '../../utils/auditTrailDisplay';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/shadcn/popover';
import { ListIconButton } from '../ui/ListIconButton';

type Props = {
  row: AuditTrailDetailInput;
};

const HOVER_CLOSE_MS = 220;

function DetailSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <div className="text-sm text-slate-800 dark:text-slate-200">{children}</div>
    </div>
  );
}

function FieldDiffTable({ lines }: { lines: AuditTrailDetail['lines'] }) {
  if (!lines.length) return null;
  return (
    <div className="mt-2 overflow-x-auto rounded-md border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900/60 max-h-[min(14rem,45vh)] overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-white dark:bg-slate-900/95">
          <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
            <th className="px-2.5 py-2 font-semibold">Field</th>
            <th className="px-2.5 py-2 font-semibold">Before</th>
            <th className="px-2.5 py-2 font-semibold">After</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr
              key={`${line.label}-${index}`}
              className="border-t border-slate-100 dark:border-slate-800 align-top"
            >
              <td className="px-2.5 py-2 font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">
                {line.label}
              </td>
              <td className="px-2.5 py-2 text-slate-600 dark:text-slate-400">{line.before}</td>
              <td className="px-2.5 py-2 text-slate-900 dark:text-slate-100 font-medium">
                {line.after}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditTrailDetailBody({ detail }: { detail: AuditTrailDetail }) {
  return (
    <div className="space-y-3">
      <DetailSection label="Detail">
        <p className="font-medium leading-snug">{detail.detail}</p>
        <FieldDiffTable lines={detail.lines} />
      </DetailSection>

      {detail.employeeId ? (
        <DetailSection label="Employee">
          <p className="font-medium">{detail.employeeId}</p>
        </DetailSection>
      ) : null}

      {detail.reason ? (
        <DetailSection label="Reason">
          <p className="font-medium leading-snug">{detail.reason}</p>
        </DetailSection>
      ) : null}

      <DetailSection label="Page / tab">
        <p className="font-medium">{detail.pageAndTab}</p>
      </DetailSection>

      <DetailSection label="Action by actor">
        <p className="font-medium">{detail.actorAction}</p>
        {detail.actorName ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Done by {detail.actorName}
          </p>
        ) : null}
      </DetailSection>
    </div>
  );
}

export function AuditTrailDetailPanel({ row }: Props) {
  const detail = useMemo(() => buildAuditTrailDetail(row), [row]);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovering = useRef(false);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const show = useCallback(() => {
    hovering.current = true;
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer]);

  const scheduleHide = useCallback(() => {
    hovering.current = false;
    clearCloseTimer();
    closeTimer.current = setTimeout(() => {
      if (!hovering.current) setOpen(false);
    }, HOVER_CLOSE_MS);
  }, [clearCloseTimer]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      // Keep hover as source of truth; ignore blur/outside dismiss while pointer is over.
      if (!next && hovering.current) return;
      if (!next) clearCloseTimer();
      setOpen(next);
    },
    [clearCloseTimer]
  );

  if (!detail.hasContent) {
    return <span className="text-xs text-slate-400">No extra details</span>;
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
      <PopoverTrigger asChild>
        <ListIconButton
          label="View details"
          // Avoid native browser tooltip fighting the hover panel.
          title=""
          icon={<FileText className="w-4 h-4" />}
          onPointerEnter={show}
          onPointerLeave={scheduleHide}
          aria-expanded={open}
          aria-haspopup="dialog"
        />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={16}
        avoidCollisions
        sticky="partial"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={show}
        onPointerLeave={scheduleHide}
        className="w-[min(28rem,calc(100vw-2rem))] p-3 z-[80] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 shadow-lg"
      >
        <AuditTrailDetailBody detail={detail} />
      </PopoverContent>
    </Popover>
  );
}

export default AuditTrailDetailPanel;
