import React, { useState } from 'react';
import { Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';
import { Button } from './Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './shadcn/dropdown-menu';
import { cn } from '@/lib/utils';
import { listToolbarGlyphClass } from './page/ListToolbarIconButton';

const FORMAT_OPTIONS: Array<{
  format: ExportFileExt;
  label: string;
  icon: React.ReactNode;
}> = [
  { format: 'pdf', label: 'PDF', icon: <FileText className="w-4 h-4" /> },
  { format: 'csv', label: 'CSV', icon: <FileText className="w-4 h-4" /> },
  { format: 'xlsx', label: 'Excel', icon: <FileSpreadsheet className="w-4 h-4" /> },
];

type Props = {
  onExport: (format: ExportFileExt) => void | Promise<void>;
  loading?: boolean;
  disabled?: boolean;
  /** Icon-only toolbar control (default) or labeled outline button. */
  variant?: 'icon' | 'button';
  buttonLabel?: string;
  className?: string;
  iconClassName?: string;
  formats?: ExportFileExt[];
};

export const ExportFormatMenu: React.FC<Props> = ({
  onExport,
  loading = false,
  disabled = false,
  variant = 'icon',
  buttonLabel,
  className,
  iconClassName,
  formats = ['pdf', 'csv', 'xlsx'],
}) => {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const isDisabled = disabled || loading || busy;
  const options = FORMAT_OPTIONS.filter((opt) => formats.includes(opt.format));
  const exportLabel = buttonLabel || t('common.export') || 'Export';

  const handleSelect = async (format: ExportFileExt) => {
    if (isDisabled) return;
    setBusy(true);
    try {
      await onExport(format);
    } finally {
      setBusy(false);
    }
  };

  const trigger =
    variant === 'button' ? (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isDisabled}
        className={className}
        icon={
          loading || busy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )
        }
      >
        {loading || busy ? 'Exporting…' : exportLabel}
      </Button>
    ) : (
      <button
        type="button"
        disabled={isDisabled}
        className={cn('hcms-list-filter-trigger hcms-list-toolbar-icon', className)}
        aria-label={exportLabel}
        title={exportLabel}
      >
        {loading || busy ? (
          <Loader2 className={cn(listToolbarGlyphClass, 'animate-spin', iconClassName)} />
        ) : (
          <Download className={cn(listToolbarGlyphClass, iconClassName)} />
        )}
      </button>
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={isDisabled}>
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[9rem]">
        {options.map((opt) => (
          <DropdownMenuItem
            key={opt.format}
            className="cursor-pointer"
            onClick={() => void handleSelect(opt.format)}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
