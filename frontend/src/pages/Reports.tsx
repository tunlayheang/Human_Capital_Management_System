import React from 'react';
import { ReportsAnalyticsView } from '../components/reports/ReportsAnalyticsView';

type ReportsProps = {
  /** When rendered inside ReportsModule, omit duplicate page chrome. */
  embedded?: boolean;
};

export const Reports: React.FC<ReportsProps> = ({ embedded: _embedded = false }) => {
  return <ReportsAnalyticsView />;
};
