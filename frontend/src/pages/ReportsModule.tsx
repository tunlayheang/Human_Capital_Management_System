import React, { Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { BarChart3, FileSpreadsheet } from 'lucide-react';
import { PageLoader } from '../components/common/PageLoader';
import { PageShell, PageHeader } from '../components/ui/page';
import { useLanguage } from '../context/LanguageContext';
import { Reports } from './Reports';
import { ReportsCatalogView } from '../components/reports/ReportsCatalogView';

export const ReportsModule: React.FC = () => {
  const location = useLocation();
  const { t } = useLanguage();
  const isCatalog = location.pathname.includes('/catalog');

  const title = isCatalog
    ? t('reports.module.catalogTitle')
    : t('reports.module.analyticsTitle');
  const subtitle = isCatalog
    ? t('reports.module.catalogSubtitle')
    : t('reports.module.analyticsSubtitle');
  const icon = isCatalog ? (
    <FileSpreadsheet className="w-6 h-6" />
  ) : (
    <BarChart3 className="w-6 h-6" />
  );

  return (
    <PageShell>
      <PageHeader title={title} subtitle={subtitle} icon={icon} />

      <Suspense fallback={<PageLoader layout={isCatalog ? 'table' : 'dashboard'} />}>
        <Routes>
          <Route index element={<Reports embedded />} />
          <Route path="catalog" element={<ReportsCatalogView />} />
          {/* Report history UI removed — APIs/data retained for payroll & reports runners. */}
          <Route
            path="historical-records"
            element={<Navigate to="/reports" replace />}
          />
          <Route path="*" element={<Navigate to="/reports" replace />} />
        </Routes>
      </Suspense>
    </PageShell>
  );
};

export default ReportsModule;
