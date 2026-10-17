import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { redirectFromLegacyFinalPay } from '../../offboarding/offboardingRoutes';

/** Preserves bookmarks to /payroll/final-settlement and /payment. */
export const LegacyFinalPayRedirect: React.FC = () => {
  const location = useLocation();
  return <Navigate to={redirectFromLegacyFinalPay(location.pathname, location.search)} replace />;
};

export default LegacyFinalPayRedirect;
