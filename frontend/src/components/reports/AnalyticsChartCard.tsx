import React from 'react';
import { Card } from '../ui/Card';
import { ExportFormatMenu } from '../ui/ExportFormatMenu';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';

type Props = {
  title: string;
  canExport: boolean;
  onExport: (format: ExportFileExt) => void | Promise<void>;
  children: React.ReactNode;
};

export const AnalyticsChartCard: React.FC<Props> = ({
  title,
  canExport,
  onExport,
  children,
}) => (
  <Card
    title={title}
    action={
      <ExportFormatMenu
        disabled={!canExport}
        onExport={onExport}
        formats={['csv', 'xlsx']}
      />
    }
  >
    {children}
  </Card>
);

export default AnalyticsChartCard;
