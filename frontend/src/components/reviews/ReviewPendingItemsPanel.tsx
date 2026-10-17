import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../ui/Card';
import { useLanguage } from '../../context/LanguageContext';
import type { RequiredActionItem } from '../../hooks/useRequiredActions';
import { reviewItemNavigatePath } from '../../utils/reviewNavigation';
import { ReviewPendingItemCard } from './ReviewPendingItemCard';
import { LoadingState } from '../common/LoadingState';

type Props = {
  items: RequiredActionItem[];
  loading?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
};

export const ReviewPendingItemsPanel: React.FC<Props> = ({
  items,
  loading,
  emptyTitle,
  emptyBody,
}) => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  return (
    <Card className="border-amber-200/80 dark:border-amber-900/50 bg-amber-50/20 dark:bg-amber-950/10">
      {loading ? (
        <LoadingState variant="panel" layout="list" rows={3} label={t('common.retrievingData')} />
      ) : items.length === 0 ? (
        <div className="py-8 text-center space-y-1">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {emptyTitle || t('reviews.queueEmptyTitle') || 'Nothing assigned to you'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {emptyBody || t('reviews.queueEmptyBody') || 'You have no pending evaluations in this queue.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id}>
              <ReviewPendingItemCard
                item={item}
                onClick={() => navigate(reviewItemNavigatePath(item))}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

export default ReviewPendingItemsPanel;
