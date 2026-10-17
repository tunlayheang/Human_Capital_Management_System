import React, { RefObject } from 'react';
import { Camera, Mail, Phone, Shield } from 'lucide-react';

type ProfileHeroProps = {
  name: string;
  position?: string;
  /** Display label for access role (e.g. Staff, not EMPLOYEE). */
  role: string;
  employeeCode: string;
  departmentLabel: string;
  email: string;
  phone: string;
  avatarSrc: string;
  onAvatarError: () => void;
  canEditAvatar: boolean;
  onPhotoClick: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isEditing: boolean;
  canEditProfile: boolean;
  onToggleEdit: () => void;
  isEmployeeSelf: boolean;
  photoHint?: string;
  roleBadgeClass: string;
  labels: {
    uploadPhoto: string;
    changePhoto: string;
    editProfile: string;
    doneEditing: string;
    noPhone: string;
    department: string;
    email: string;
    phone: string;
    editingMode?: string;
  };
  /** Hide department summary cell (system admin accounts). */
  showDepartment?: boolean;
  statusLabel?: string;
};

export const ProfileHero: React.FC<ProfileHeroProps> = ({
  name,
  position,
  role,
  employeeCode,
  email,
  phone,
  avatarSrc,
  onAvatarError,
  canEditAvatar,
  onPhotoClick,
  fileInputRef,
  onFileChange,
  photoHint,
  labels,
  statusLabel = 'Active',
}) => (
  <article className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 via-slate-900 to-blue-950 text-white p-5 sm:p-6 shadow-sm">
    <div
      className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-500/20 via-transparent to-transparent pointer-events-none"
      aria-hidden
    />
    <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
      <button
        type="button"
        onClick={canEditAvatar ? onPhotoClick : undefined}
        disabled={!canEditAvatar}
        className={`group relative mx-auto sm:mx-0 shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
          canEditAvatar ? 'cursor-pointer' : 'cursor-default'
        }`}
        aria-label={canEditAvatar ? labels.uploadPhoto : undefined}
      >
        <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-full overflow-hidden bg-slate-700 ring-4 ring-white/20">
          <img
            src={avatarSrc}
            alt=""
            className="h-full w-full object-cover"
            loading="eager"
            decoding="async"
            onError={onAvatarError}
          />
        </div>
        {canEditAvatar ? (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-primary-500 text-white shadow-md ring-2 ring-slate-900 group-hover:bg-primary-600 transition-colors">
            <Camera className="h-3.5 w-3.5" aria-hidden />
          </span>
        ) : null}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        className="sr-only"
        onChange={onFileChange}
      />

      <div className="min-w-0 flex-1 text-center sm:text-left">
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-1.5">
          <span className="inline-flex items-center rounded-full bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/30 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
            {statusLabel}
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-blue-200 bg-white/10 px-2.5 py-0.5 rounded-full">
            <Shield className="w-3 h-3" aria-hidden />
            {role}
          </span>
        </div>
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight truncate">{name}</h2>
        {position ? (
          <p className="text-sm text-slate-300 truncate mt-0.5">{position}</p>
        ) : null}
        {employeeCode && employeeCode !== '—' ? (
          <p className="text-sm text-slate-300 font-mono mt-0.5">{employeeCode}</p>
        ) : null}
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-1 mt-2.5 text-sm text-slate-300">
          {email ? (
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <Mail className="w-3.5 h-3.5 shrink-0" aria-hidden />
              <span className="truncate">{email}</span>
            </span>
          ) : null}
          {phone ? (
            <span className="inline-flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 shrink-0" aria-hidden />
              {phone}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-slate-400">
              <Phone className="w-3.5 h-3.5 shrink-0" aria-hidden />
              {labels.noPhone}
            </span>
          )}
        </div>
        {photoHint ? (
          <p className="mt-3 text-xs text-slate-400 leading-relaxed">{photoHint}</p>
        ) : null}
      </div>
    </div>
  </article>
);
