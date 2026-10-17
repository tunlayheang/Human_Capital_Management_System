import React from 'react';
import { NotificationProvider } from './NotificationContext';
import { ChatProvider } from './ChatContext';
import { MenuConfigProvider } from './MenuConfigContext';
import { PinLockProvider } from './PinLockContext';
import { CompanyStructureProvider } from './CompanyStructureContext';
import { PreferredCurrencyProvider } from './PreferredCurrencyContext';
import { PayrollExchangeRateProvider } from './PayrollExchangeRateContext';
import { CompanyCalendarProvider } from './CompanyCalendarContext';
import { SessionKeeper } from '../components/auth/SessionKeeper';
import { MustChangePasswordGate } from '../components/security/MustChangePasswordGate';

/** Chat + notifications + role menu + PIN lock for authenticated shell only. */
export const AuthenticatedProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MenuConfigProvider>
    <PinLockProvider>
      <PreferredCurrencyProvider>
        <PayrollExchangeRateProvider>
        <CompanyCalendarProvider>
        <SessionKeeper />
        <MustChangePasswordGate />
        <NotificationProvider>
          <ChatProvider>
            <CompanyStructureProvider>{children}</CompanyStructureProvider>
          </ChatProvider>
        </NotificationProvider>
        </CompanyCalendarProvider>
        </PayrollExchangeRateProvider>
      </PreferredCurrencyProvider>
    </PinLockProvider>
  </MenuConfigProvider>
);
