import React, { useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';

type Props = {
  title: string;
  summary?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

/** Progressive disclosure for instructional banners — saves vertical space on manage screens. */
export const CollapsibleHintPanel: React.FC<Props> = ({
  title,
  summary,
  children,
  defaultOpen = false,
  className = '',
}) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className={`rounded-xl border border-border bg-muted/40 overflow-hidden ${className}`.trim()}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/60 transition-colors"
        aria-expanded={open}
      >
        <Info className="w-4 h-4 text-primary shrink-0" aria-hidden />
        <span className="flex-1 min-w-0 text-sm font-medium text-foreground truncate">{title}</span>
        {summary && !open ? (
          <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[40%]">
            {summary}
          </span>
        ) : null}
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="px-3 pb-3 pt-0 text-sm text-muted-foreground space-y-2 border-t border-border/60">
          {children}
        </div>
      ) : null}
    </div>
  );
};
