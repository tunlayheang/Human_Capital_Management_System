import React from 'react';
import type { PayrollEmployeeProfile } from '../../pages/payroll/payrollEmployeeDisplay';
import type { User } from '../../types';
import {
  userAvatarUrl,
  userDisplayEmployeeCode,
  userDisplayName,
  userDisplayPosition,
  userNameParts,
  type EnrichedUserLike,
} from '../../utils/userProfile';
import { joinPersonNameParts, isBlankPersonName, resolveEmployeeRecordDisplayName } from '../../utils/personDisplayName';
import { useLanguage } from '../../context/LanguageContext';
import type { Language } from '../../i18n/types';
import { EmployeeAvatar } from './EmployeeAvatar';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import { normalizeEmployeeDisplayId } from '../../utils';
import { tableTdCompactClass } from '../../constants/designSystem';

export type EmployeeListIdentityData = {
  employeeId: string;
  firstName: string;
  lastName: string;
  firstNameKh?: string;
  lastNameKh?: string;
  displayName: string;
  displayNameKh?: string;
  email?: string;
  phone?: string;
  avatarUrl?: string | null;
  /** Secondary line under contact info — e.g. position or department. */
  subtitle?: string;
  subtitleKh?: string;
};

export function employeeDisplaySubtitle(
  data: Pick<EmployeeListIdentityData, 'subtitle' | 'subtitleKh'>,
  language: Language = 'en'
): string | undefined {
  const en = String(data.subtitle ?? '').trim();
  const kh = String(data.subtitleKh ?? '').trim();
  if (language === 'km') return kh || en || undefined;
  return en || kh || undefined;
}

export function employeeDisplayName(
  data: Pick<
    EmployeeListIdentityData,
    'firstName' | 'lastName' | 'firstNameKh' | 'lastNameKh' | 'displayName' | 'displayNameKh'
  >,
  language: Language = 'en'
): string {
  if (language === 'km') {
    const kh =
      joinPersonNameParts(data.firstNameKh, data.lastNameKh) ||
      String(data.displayNameKh ?? '').trim();
    if (!isBlankPersonName(kh)) return kh;
  }
  const fromParts = joinPersonNameParts(data.firstName, data.lastName);
  if (!isBlankPersonName(fromParts)) return fromParts;
  const display = String(data.displayName ?? '').trim();
  if (!isBlankPersonName(display)) return display;
  return '—';
}

export function employeeListIdentityFromUser(
  user: (EnrichedUserLike & User) | null | undefined
): EmployeeListIdentityData {
  if (!user) {
    return {
      employeeId: '—',
      firstName: '',
      lastName: '',
      displayName: 'Unknown',
    };
  }
  const emp = (user as User & { employee?: Record<string, unknown> | null }).employee;
  const { firstName, lastName } = userNameParts(user);
  const displayName = String(emp?.full_name ?? '').trim() || userDisplayName(user, 'en');
  const subtitleEn = userDisplayPosition(user, 'en');
  const subtitleKh = userDisplayPosition(user, 'km');
  const code = userDisplayEmployeeCode(user);
  return {
    employeeId: code === '—' ? '—' : normalizeEmployeeDisplayId(code) || '—',
    firstName: String(emp?.first_name ?? firstName),
    lastName: String(emp?.last_name ?? lastName),
    firstNameKh: String(emp?.first_name_kh ?? ''),
    lastNameKh: String(emp?.last_name_kh ?? ''),
    displayName,
    displayNameKh: String(emp?.full_name_kh ?? '').trim() || undefined,
    email: String(emp?.email ?? user.email ?? '').trim() || undefined,
    phone: String(emp?.phone ?? user.phone ?? '').trim() || undefined,
    avatarUrl: userAvatarUrl(user),
    subtitle: subtitleEn !== '—' ? subtitleEn : undefined,
    subtitleKh: subtitleKh !== '—' ? subtitleKh : undefined,
  };
}

export function employeeListIdentityFromEmployeeRow(row: {
  employee_id: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  first_name_kh?: string | null;
  last_name_kh?: string | null;
  full_name_kh?: string | null;
  email?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
  position?: { title?: string | null; title_kh?: string | null; titleKh?: string | null } | null;
  job_position?: string | null;
  position_title?: string | null;
  position_title_kh?: string | null;
}): EmployeeListIdentityData {
  let firstName = String(row.first_name ?? '').trim();
  let lastName = String(row.last_name ?? '').trim();
  const firstNameKh = String(row.first_name_kh ?? '').trim();
  const lastNameKh = String(row.last_name_kh ?? '').trim();
  if (!firstName && !lastName) {
    // full_name is Khmer order (Last First)
    const parts = String(row.full_name ?? '').trim().split(/\s+/).filter(Boolean);
    lastName = parts[0] ?? '';
    firstName = parts.slice(1).join(' ');
  }
  const subtitle =
    String(row.position?.title ?? row.job_position ?? row.position_title ?? '').trim() ||
    undefined;
  const subtitleKh =
    String(
      row.position?.titleKh ??
        row.position?.title_kh ??
        row.position_title_kh ??
        ''
    ).trim() || undefined;
  const rawId = String(row.employee_id ?? '').trim();
  return {
    employeeId: rawId ? normalizeEmployeeDisplayId(rawId) || '—' : '—',
    firstName,
    lastName,
    firstNameKh: firstNameKh || undefined,
    lastNameKh: lastNameKh || undefined,
    displayName: resolveEmployeeRecordDisplayName(row, 'en'),
    displayNameKh:
      resolveEmployeeRecordDisplayName(row, 'km') !== resolveEmployeeRecordDisplayName(row, 'en')
        ? resolveEmployeeRecordDisplayName(row, 'km')
        : undefined,
    email: String(row.email ?? '').trim() || undefined,
    phone: String(row.phone ?? '').trim() || undefined,
    avatarUrl: resolveMediaUrl(row.avatar_url) ?? null,
    subtitle,
    subtitleKh,
  };
}

export function employeeListIdentityFromPayrollProfile(
  profile: PayrollEmployeeProfile
): EmployeeListIdentityData {
  const rawId = String(profile.employeeId ?? '').trim();
  return {
    employeeId: rawId && rawId !== '—' ? normalizeEmployeeDisplayId(rawId) || '—' : rawId || '—',
    firstName: profile.firstName,
    lastName: profile.lastName,
    firstNameKh: profile.firstNameKh,
    lastNameKh: profile.lastNameKh,
    displayName: profile.displayName,
    email: profile.email || undefined,
    phone: profile.phone || undefined,
    avatarUrl: profile.avatarUrl ?? null,
    subtitle: profile.positionTitle !== '—' ? profile.positionTitle : undefined,
  };
}

/** Build identity from loose row fields (historical records, settlements, etc.). */
export function employeeListIdentityFromParts(input: {
  employeeId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  subtitle?: string | null;
  avatarUrl?: string | null;
}): EmployeeListIdentityData {
  const rawName = String(input.name ?? '').trim();
  const name = isBlankPersonName(rawName) ? '' : rawName;
  // Display names use Khmer order (Last First)
  const parts = name.split(/\s+/).filter((p) => !isBlankPersonName(p));
  const rawId = String(input.employeeId ?? '').trim();
  return {
    employeeId: rawId && rawId !== '—' ? normalizeEmployeeDisplayId(rawId) || '—' : rawId || '—',
    lastName: parts[0] ?? '',
    firstName: parts.slice(1).join(' '),
    displayName: name || '—',
    email: String(input.email ?? '').trim() || undefined,
    phone: String(input.phone ?? '').trim() || undefined,
    avatarUrl: input.avatarUrl ?? null,
    subtitle: String(input.subtitle ?? '').trim() || undefined,
  };
}

export function employeeListIdentityFromProbationRow(row: {
  employeeId?: string;
  name: string;
  email?: string;
  phone?: string;
  position?: string;
}): EmployeeListIdentityData {
  return employeeListIdentityFromParts({
    employeeId: row.employeeId ?? '—',
    name: row.name,
    email: row.email,
    phone: row.phone,
    subtitle: row.position,
  });
}

export function employeeListIdentityFromMovementRow(row: {
  employeeId: string;
  employeeName: string;
  employeeEmail?: string | null;
  employeePhone?: string | null;
  employeeAvatarUrl?: string | null;
}): EmployeeListIdentityData {
  return employeeListIdentityFromParts({
    employeeId: row.employeeId,
    name: row.employeeName,
    email: row.employeeEmail,
    phone: row.employeePhone,
    avatarUrl: row.employeeAvatarUrl ?? null,
  });
}

export function employeeListIdentityFromAppraisalRow(row: {
  employeeCode?: string | null;
  employeeName?: string;
  employeeEmail?: string | null;
  employeePhone?: string | null;
  user_id?: string;
}): EmployeeListIdentityData {
  return employeeListIdentityFromParts({
    employeeId: row.employeeCode ?? row.user_id ?? '—',
    name: row.employeeName ?? row.user_id ?? '—',
    email: row.employeeEmail,
    phone: row.employeePhone,
  });
}

export function employeeListIdentityFromAuditActor(
  actor: {
    name?: string;
    email?: string | null;
    phone?: string | null;
    employeeCode?: string | null;
    id?: string;
  } | null | undefined,
  performedByFallback?: string
): EmployeeListIdentityData {
  if (!actor) {
    const fallback = String(performedByFallback ?? '').trim();
    return employeeListIdentityFromParts({
      employeeId: '—',
      name: fallback || 'System',
    });
  }
  return employeeListIdentityFromParts({
    employeeId: actor.employeeCode ?? '—',
    name: actor.name ?? performedByFallback ?? '—',
    email: actor.email,
    phone: actor.phone,
  });
}

const contactLineClass =
  'text-[10px] sm:text-xs leading-tight sm:leading-snug text-slate-500 dark:text-slate-400 truncate';

type SharedProps = {
  data: EmployeeListIdentityData;
  avatarClassName?: string;
  /** Extra content beside the name (badges, icons). */
  nameExtra?: React.ReactNode;
  /** Extra content on the subtitle line. */
  subtitleExtra?: React.ReactNode;
  showEmail?: boolean;
  showPhone?: boolean;
  showSubtitle?: boolean;
  hideAvatar?: boolean;
  /**
   * On narrow phones, hide email/phone under the name to keep list rows short.
   * Contact lines reappear from the `sm` breakpoint up.
   */
  compactOnMobile?: boolean;
  /**
   * On narrow phones, show only the avatar/initials (name + subtitle from `sm` up).
   * Useful for dense sticky tables (e.g. payroll register).
   */
  avatarOnlyOnMobile?: boolean;
};

function ContactLines({
  data,
  showEmail = true,
  showPhone = true,
  compactOnMobile = true,
}: Pick<SharedProps, 'data' | 'showEmail' | 'showPhone' | 'compactOnMobile'>) {
  const email = showEmail ? data.email?.trim() : '';
  const phone = showPhone ? data.phone?.trim() : '';
  if (!email && !phone) return null;
  return (
    <div className={compactOnMobile ? 'hidden sm:block space-y-0.5' : 'space-y-0.5'}>
      {email ? (
        <div className={contactLineClass} title={email}>
          {email}
        </div>
      ) : showEmail ? (
        <div className={contactLineClass}>No email</div>
      ) : null}
      {phone ? (
        <div className={contactLineClass} title={phone}>
          {phone}
        </div>
      ) : showPhone ? (
        <div className={contactLineClass}>No phone</div>
      ) : null}
    </div>
  );
}

/** Avatar + stacked name, email, phone, and job title — standard employee column layout. */
function StackedIdentityContent({
  data,
  name,
  subtitle,
  nameExtra,
  subtitleExtra,
  showEmail = true,
  showPhone = true,
  showSubtitle = true,
  compactOnMobile = true,
}: {
  data: EmployeeListIdentityData;
  name: string;
  subtitle?: string;
  nameExtra?: React.ReactNode;
  subtitleExtra?: React.ReactNode;
  showEmail?: boolean;
  showPhone?: boolean;
  showSubtitle?: boolean;
  compactOnMobile?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1 space-y-0.5">
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 min-w-0">
        <span className="text-xs sm:text-sm font-medium leading-snug text-slate-900 dark:text-white truncate">
          {name}
        </span>
        {nameExtra}
      </div>
      <ContactLines
        data={data}
        showEmail={showEmail}
        showPhone={showPhone}
        compactOnMobile={compactOnMobile}
      />
      {showSubtitle && (subtitle || subtitleExtra) ? (
        <div className={`${contactLineClass} flex items-center gap-1 min-w-0`}>
          {subtitle ? (
            <span className="truncate min-w-0" title={subtitle}>
              {subtitle}
            </span>
          ) : null}
          {subtitleExtra}
        </div>
      ) : null}
    </div>
  );
}

/** Stacked block — mobile cards and compact layouts. Employee ID is shown first when present. */
export function EmployeeListIdentityBlock({
  data,
  avatarClassName = 'h-9 w-9 sm:h-10 sm:w-10 md:h-11 md:w-11 shrink-0',
  nameExtra,
  subtitleExtra,
  showEmail = true,
  showPhone = true,
  showSubtitle = true,
  hideAvatar = false,
  compactOnMobile = true,
  className = '',
}: SharedProps & { className?: string }) {
  const { language } = useLanguage();
  const name = employeeDisplayName(data, language);
  const subtitle = employeeDisplaySubtitle(data, language);
  return (
    <div className={`min-w-0 ${className}`.trim()}>
      {data.employeeId && data.employeeId !== '—' ? (
        <div
          className="text-[10px] sm:text-xs font-mono font-medium text-slate-600 dark:text-slate-300 truncate mb-1 sm:mb-1.5"
          title={data.employeeId}
        >
          {data.employeeId}
        </div>
      ) : null}
      <div className="flex items-start gap-2.5 sm:gap-3 min-w-0">
        {!hideAvatar ? (
          <EmployeeAvatar
            avatarUrl={data.avatarUrl}
            firstName={data.firstName}
            lastName={data.lastName}
            className={avatarClassName}
            alt={name}
          />
        ) : null}
        <StackedIdentityContent
          data={data}
          name={name}
          subtitle={subtitle}
          showEmail={showEmail}
          showPhone={showPhone}
          showSubtitle={showSubtitle}
          compactOnMobile={compactOnMobile}
          nameExtra={nameExtra}
          subtitleExtra={subtitleExtra}
        />
      </div>
    </div>
  );
}

export function EmployeeListIdentityIdCell({
  data,
  className = `${tableTdCompactClass} whitespace-nowrap font-mono font-medium text-slate-800 dark:text-slate-200`,
}: {
  data: EmployeeListIdentityData;
  className?: string;
}) {
  return (
    <td className={className}>
      <span className="block truncate text-[11px] sm:text-sm" title={data.employeeId}>
        {data.employeeId}
      </span>
    </td>
  );
}

export function EmployeeListIdentityCell({
  data,
  avatarClassName = 'h-8 w-8 sm:h-9 sm:w-9 md:h-10 md:w-10 shrink-0',
  nameExtra,
  subtitleExtra,
  showEmail = true,
  showPhone = true,
  showSubtitle = true,
  hideAvatar = false,
  compactOnMobile = true,
  avatarOnlyOnMobile = false,
  className = `${tableTdCompactClass} min-w-0`,
}: SharedProps & { className?: string }) {
  const { language } = useLanguage();
  const name = employeeDisplayName(data, language);
  const subtitle = employeeDisplaySubtitle(data, language);
  return (
    <td className={className} title={avatarOnlyOnMobile ? name : undefined}>
      <div
        className={
          avatarOnlyOnMobile
            ? 'flex items-center justify-center sm:items-start sm:justify-start gap-0 sm:gap-3 min-w-0'
            : 'flex items-start gap-2 sm:gap-3 min-w-0'
        }
      >
        {!hideAvatar ? (
          <EmployeeAvatar
            avatarUrl={data.avatarUrl}
            firstName={data.firstName}
            lastName={data.lastName}
            className={avatarClassName}
            alt={name}
          />
        ) : null}
        <div className={avatarOnlyOnMobile ? 'hidden sm:contents' : undefined}>
          <StackedIdentityContent
            data={data}
            name={name}
            subtitle={subtitle}
            showEmail={showEmail}
            showPhone={showPhone}
            showSubtitle={showSubtitle}
            compactOnMobile={compactOnMobile}
            nameExtra={nameExtra}
            subtitleExtra={subtitleExtra}
          />
        </div>
      </div>
    </td>
  );
}

export function EmployeeListIdentityCells(
  props: SharedProps & {
    idCellClassName?: string;
    identityCellClassName?: string;
    isTotal?: boolean;
    totalLabel?: string;
  }
) {
  const {
    idCellClassName,
    identityCellClassName,
    isTotal,
    totalLabel = 'TOTALS',
    ...identityProps
  } = props;
  if (isTotal) {
    return (
      <>
        <td className={idCellClassName ?? tableTdCompactClass} />
        <td className={identityCellClassName ?? tableTdCompactClass}>
          <span className="font-semibold text-slate-900 dark:text-white">{totalLabel}</span>
        </td>
      </>
    );
  }
  return (
    <>
      <EmployeeListIdentityIdCell data={props.data} className={idCellClassName} />
      <EmployeeListIdentityCell {...identityProps} className={identityCellClassName} />
    </>
  );
}
