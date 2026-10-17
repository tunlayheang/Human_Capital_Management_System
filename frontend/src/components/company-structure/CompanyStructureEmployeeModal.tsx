import React, { useEffect, useState } from 'react';
import { Loader2, MessageCircle, User } from 'lucide-react';
import { ContentSkeleton } from '../common/ContentSkeleton';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Api } from '../../services/api';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import { useToast } from '../../context/ToastContext';
import type { User as PortalUser } from '../../types';
import type { CompanyStructureMember } from '../../types/companyStructure';
import { resolveEmployeeRecordDisplayName } from '../../utils/personDisplayName';
import { normalizeEmployeeDisplayId } from '../../utils';
import {
  resolveDepartmentRowName,
  resolveLocalizedLabel,
  resolvePositionRowTitle,
} from '../../utils/localizedEntityLabel';
import type { Language } from '../../i18n/types';
import { formatAccessRoleLabel } from '../../utils/accessRole';

type EmployeeBrief = {
  name: string;
  employeeId: string;
  portalUserId?: string | null;
  role: string;
  position: string;
  phone: string;
  email: string;
  department: string;
  avatarUrl: string | null;
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center gap-4 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <span className="text-sm text-slate-500 dark:text-slate-400 shrink-0">{label}</span>
      <span className="text-sm font-semibold text-slate-900 dark:text-white text-right truncate">
        {value || '—'}
      </span>
    </div>
  );
}

function mapEmployeeBrief(
  raw: Record<string, unknown>,
  fallback: CompanyStructureMember,
  language: Language
): EmployeeBrief {
  const name =
    resolveEmployeeRecordDisplayName(
      {
        first_name: raw.first_name as string | null | undefined,
        last_name: raw.last_name as string | null | undefined,
        first_name_kh: raw.first_name_kh as string | null | undefined,
        last_name_kh: raw.last_name_kh as string | null | undefined,
      },
      language
    ) || resolveLocalizedLabel(fallback.name, fallback.nameKh, language);
  const dept = raw.department as Record<string, unknown> | undefined;
  const pos = raw.position as Record<string, unknown> | undefined;
  const positionTitle =
    resolvePositionRowTitle(
      {
        title:
          String(raw.job_position ?? '').trim() ||
          String(pos?.title ?? '').trim() ||
          fallback.positionTitle,
        titleKh:
          String(pos?.title_kh ?? pos?.titleKh ?? '').trim() || fallback.positionTitleKh,
      },
      language
    ) || '—';
  const portalUserId = String(raw.portalUserId ?? '').trim() || null;
  const employeeId =
    normalizeEmployeeDisplayId(raw.employee_id) ||
    normalizeEmployeeDisplayId(fallback.employeeCode) ||
    String(raw.employee_id ?? fallback.employeeCode);
  return {
    name,
    employeeId,
    role: formatAccessRoleLabel(raw.role ?? raw.accessRole) || '—',
    position: positionTitle,
    phone: String(raw.phone ?? '').trim(),
    email: String(raw.email ?? '').trim(),
    department: resolveDepartmentRowName(
      {
        name: dept?.name as string | undefined,
        nameKh: (dept?.name_kh ?? dept?.nameKh) as string | undefined,
      },
      language
    ),
    avatarUrl: raw.avatar_url ? String(raw.avatar_url) : fallback.avatarUrl,
    portalUserId,
  };
}

function fallbackBrief(member: CompanyStructureMember, language: Language): EmployeeBrief {
  return {
    name: resolveLocalizedLabel(member.name, member.nameKh, language),
    employeeId: normalizeEmployeeDisplayId(member.employeeCode) || member.employeeCode,
    role: '—',
    position: resolveLocalizedLabel(member.positionTitle, member.positionTitleKh, language),
    phone: '',
    email: '',
    department: '',
    avatarUrl: member.avatarUrl,
    portalUserId: null,
  };
}

type Props = {
  member: CompanyStructureMember;
  onClose: () => void;
};

export const CompanyStructureEmployeeModal: React.FC<Props> = ({ member, onClose }) => {
  const { t, language } = useLanguage();
  const { user: currentUser } = useAuth();
  const { openChatWith } = useChat();
  const { showToast } = useToast();
  const [brief, setBrief] = useState<EmployeeBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingChat, setOpeningChat] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);

  const canChat =
    !!brief?.portalUserId &&
    brief.portalUserId !== currentUser?.id &&
    !openingChat;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setAvatarBroken(false);
    Api.employees
      .getById(member.id)
      .then((data) => {
        if (cancelled) return;
        if (data && typeof data === 'object') {
          setBrief(mapEmployeeBrief(data as Record<string, unknown>, member, language));
        } else {
          setBrief(fallbackBrief(member, language));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBrief(fallbackBrief(member, language));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [member, language]);

  const handleOpenChat = async () => {
    if (!brief?.portalUserId || brief.portalUserId === currentUser?.id) {
      showToast(
        t('companyStructure.chatUnavailable') || 'This employee cannot be messaged in chat.',
        'error'
      );
      return;
    }
    setOpeningChat(true);
    try {
      const profile = (await Api.chat.getContactProfile(brief.portalUserId)) as PortalUser;
      onClose();
      openChatWith(profile);
    } catch {
      showToast(t('companyStructure.chatFailed') || 'Could not open chat.', 'error');
    } finally {
      setOpeningChat(false);
    }
  };

  const avatarSrc = resolveMediaUrl(brief?.avatarUrl);

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="sm"
      hideHeader
      contentClassName="p-0"
      zIndexClass="z-[220]"
    >
      <div className="px-6 pt-8 pb-6">
        {loading ? (
          <ContentSkeleton
            layout="form"
            rows={1}
            label={t('companyStructure.profileLoading') || 'Loading…'}
          />
        ) : brief ? (
          <>
            <div className="flex flex-col items-center text-center">
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-500 to-purple-600 p-[3px] shadow-md">
                  <div className="w-full h-full rounded-full bg-white dark:bg-slate-900 flex items-center justify-center overflow-hidden">
                    {avatarSrc && !avatarBroken ? (
                      <img
                        src={avatarSrc}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={() => setAvatarBroken(true)}
                      />
                    ) : (
                      <User className="w-8 h-8 text-primary-500" />
                    )}
                  </div>
                </div>
                {canChat && (
                  <button
                    type="button"
                    onClick={() => void handleOpenChat()}
                    disabled={openingChat}
                    className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors disabled:opacity-60"
                    title={t('companyStructure.openChat') || 'Message'}
                    aria-label={t('companyStructure.openChat') || 'Message'}
                  >
                    {openingChat ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <MessageCircle className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
              <h2 className="mt-4 text-lg font-bold text-slate-900 dark:text-white">{brief.name}</h2>
              {brief.portalUserId && brief.portalUserId === currentUser?.id ? (
                <p className="text-xs text-slate-500 mt-1">
                  {t('companyStructure.chatSelf') || 'This is your profile'}
                </p>
              ) : !brief.portalUserId ? (
                <p className="text-xs text-slate-500 mt-1">
                  {t('companyStructure.chatNoPortal') || 'No portal account for chat'}
                </p>
              ) : null}
            </div>
            <div className="mt-6">
              <InfoRow label={t('companyStructure.fieldId') || 'ID'} value={brief.employeeId} />
              <InfoRow label={t('companyStructure.fieldRole') || 'Role'} value={brief.role} />
              <InfoRow label={t('companyStructure.fieldPosition') || 'Position'} value={brief.position} />
              <InfoRow label={t('companyStructure.fieldPhone') || 'Phone'} value={brief.phone} />
              <InfoRow label={t('companyStructure.fieldEmail') || 'Email'} value={brief.email} />
              <InfoRow
                label={t('companyStructure.fieldDepartment') || 'Department'}
                value={brief.department}
              />
            </div>
            {canChat && (
              <Button
                type="button"
                className="w-full mt-5"
                onClick={() => void handleOpenChat()}
                isLoading={openingChat}
              >
                <MessageCircle className="w-4 h-4 mr-2" />
                {t('companyStructure.openChat') || 'Message'}
              </Button>
            )}
          </>
        ) : null}
      </div>
    </Modal>
  );
};
