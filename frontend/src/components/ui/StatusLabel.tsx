import React from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Clock,
  Lock,
  LoaderCircle,
  Send,
  TrendingUp,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  formatStatusCodeLabel,
  resolveStatusSemantic,
  statusIconClassNames,
  statusTagClassNames,
  type StatusContext,
  type StatusSemantic,
} from '../../constants/statusPalette';

const STATUS_ICONS: Record<StatusSemantic, LucideIcon> = {
  pending: AlertTriangle,
  inProgress: TrendingUp,
  submitted: Send,
  inReview: LoaderCircle,
  success: BadgeCheck,
  failed: XCircle,
  expired: Clock,
};

export type StatusLabelProps = {
  status: string;
  label?: string;
  context?: StatusContext;
  semantic?: StatusSemantic;
  className?: string;
  size?: 'sm' | 'md';
  title?: string;
};

export const StatusLabel: React.FC<StatusLabelProps> = ({
  status,
  label,
  context = 'generic',
  semantic,
  className,
  size = 'md',
  title,
}) => {
  const resolved = semantic ?? resolveStatusSemantic(status, context);
  const code = String(status ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  const Icon = code === 'LOCKED' ? Lock : STATUS_ICONS[resolved];
  const display = label?.trim() || formatStatusCodeLabel(status);
  const iconTone = statusIconClassNames(resolved);

  return (
    <span
      className={cn(statusTagClassNames(resolved), `hcms-status-tag--${size}`, className)}
      title={title ?? display}
    >
      <Icon
        className={cn('hcms-status-tag__icon', iconTone, size === 'sm' ? 'hcms-status-tag__icon--sm' : 'hcms-status-tag__icon--md')}
        aria-hidden
      />
      <span className="hcms-status-tag__text">{display}</span>
    </span>
  );
};

export default StatusLabel;
