import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { AuthenticatedProviders } from '../../context/AuthenticatedProviders';
import { Layout } from '../Layout/Layout';
import { AuthBootSplash } from './AuthBootSplash';

/**
 * Blank full-screen Lottie while auth hydrates, then the app chrome.
 * Keeps AuthBootSplash off in-layout content (sidebar already visible).
 */
export const AuthenticatedShell: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <AuthBootSplash />;
  }

  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}`;
    const loginTo =
      returnTo && returnTo !== '/login'
        ? `/login?redirect=${encodeURIComponent(returnTo)}`
        : '/login';
    return <Navigate to={loginTo} replace />;
  }

  return (
    <AuthenticatedProviders>
      <Layout />
    </AuthenticatedProviders>
  );
};
