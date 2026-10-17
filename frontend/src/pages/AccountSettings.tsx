import React, { useEffect, useState } from 'react';
import { Activity, Shield } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { AccountSecurityPanel } from '../components/security/AccountSecurityPanel';
import { PersonalAuditLogPanel } from '../components/security/PersonalAuditLogPanel';
import { PinSettingsGate } from '../components/security/PinSettingsGate';
import { PageShell, PageHeader, UnderlineTabs } from '../components/ui/page';

type SettingsTab = 'security' | 'activity';

const AccountSettings: React.FC = () => {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    tabFromUrl === 'activity' ? 'activity' : 'security'
  );

  useEffect(() => {
    const next = tabFromUrl === 'activity' ? 'activity' : 'security';
    setActiveTab(next);
  }, [tabFromUrl]);

  const tabs: Array<{ id: SettingsTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'security', label: t('accountSettings.tabs.security'), icon: Shield },
    { id: 'activity', label: t('accountSettings.tabs.activity'), icon: Activity },
  ];

  const subtitle =
    activeTab === 'activity'
      ? t('accountSettings.subtitleActivity')
      : t('accountSettings.subtitle') || t('profile.securityDesc');

  return (
    <PinSettingsGate sectionLabel="Settings">
      <PageShell className="w-full min-w-0 pb-16">
        <PageHeader
          title={t('accountSettings.title') || 'Settings'}
          subtitle={subtitle}
          iconComponent={Shield}
        />

        <UnderlineTabs
          value={activeTab}
          onChange={(id) => {
            setActiveTab(id);
            setSearchParams(id === 'security' ? {} : { tab: id }, { replace: true });
          }}
          tabs={tabs}
          ariaLabel={t('accountSettings.title') || 'Settings'}
          className="max-w-md"
        />

        <div role="tabpanel">
          {activeTab === 'security' ? <AccountSecurityPanel /> : <PersonalAuditLogPanel />}
        </div>
      </PageShell>
    </PinSettingsGate>
  );
};

export default AccountSettings;
