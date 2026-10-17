import React, { useState } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  MapPin,
  Users,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import { resolveLocalizedLabel } from '../../utils/localizedEntityLabel';
import { normalizeEmployeeDisplayId } from '../../utils';
import type {
  CompanyStructureDepartmentNode,
  CompanyStructureMember,
  CompanyStructureOfficeNode,
  CompanyStructurePayload,
  CompanyStructureTierGroup,
  StructureTier,
} from '../../types/companyStructure';
import { departmentEmployeeCount, officeEmployeeCount, tierEmployeeCount } from '../../utils/companyStructure';

const TIER_ORDER: StructureTier[] = ['manager', 'officer', 'staff'];

function MemberRow({
  member,
  selected,
  onSelect,
}: {
  member: CompanyStructureMember;
  selected: boolean;
  onSelect: (member: CompanyStructureMember) => void;
}) {
  const { language } = useLanguage();
  const displayName = resolveLocalizedLabel(member.name, member.nameKh, language);
  const displayPosition = resolveLocalizedLabel(
    member.positionTitle,
    member.positionTitleKh,
    language
  );
  const avatarSrc = resolveMediaUrl(member.avatarUrl);
  const [broken, setBroken] = useState(false);

  return (
    <button
      type="button"
      onClick={() => onSelect(member)}
      className={`flex items-center gap-3 w-full text-left px-3 py-2 rounded-lg transition-colors group ${
        selected
          ? 'bg-primary-50 dark:bg-primary-900/30 ring-1 ring-primary-200 dark:ring-primary-800'
          : 'hover:bg-slate-50 dark:hover:bg-slate-800/80'
      }`}
    >
      <div className="w-9 h-9 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center overflow-hidden shrink-0">
        {avatarSrc && !broken ? (
          <img
            src={avatarSrc}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="text-xs font-bold text-primary-700 dark:text-primary-300">
            {displayName.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate group-hover:text-primary-600 dark:group-hover:text-primary-400">
          {displayName}
        </p>
        <p className="text-xs text-slate-500 truncate">
          {displayPosition}
          {member.levelLabel ? ` · ${member.levelLabel}` : ''}
        </p>
      </div>
      <span className="text-[10px] font-mono text-slate-400 shrink-0">
        {normalizeEmployeeDisplayId(member.employeeCode) || member.employeeCode}
      </span>
    </button>
  );
}

function DepartmentMembers({
  tiers,
  selectedMemberId,
  onSelectMember,
}: {
  tiers: CompanyStructureTierGroup;
  selectedMemberId: string | null;
  onSelectMember: (member: CompanyStructureMember) => void;
}) {
  const members = TIER_ORDER.flatMap((tier) => tiers[tier]);
  if (members.length === 0) {
    return <p className="text-xs text-slate-400 italic ml-6 py-1">No employees assigned</p>;
  }
  return (
    <div className="ml-4 border-l-2 border-slate-200 dark:border-slate-700 pl-3 space-y-0.5 mt-1 pb-2">
      {members.map((m) => (
        <MemberRow
          key={m.id}
          member={m}
          selected={selectedMemberId === m.id}
          onSelect={onSelectMember}
        />
      ))}
    </div>
  );
}

function DepartmentNode({
  node,
  depth,
  selectedMemberId,
  onSelectMember,
}: {
  node: CompanyStructureDepartmentNode;
  depth: number;
  selectedMemberId: string | null;
  onSelectMember: (member: CompanyStructureMember) => void;
}) {
  const { language } = useLanguage();
  const [open, setOpen] = useState(depth < 2);
  const count = departmentEmployeeCount(node);
  const deptName = resolveLocalizedLabel(node.name, node.nameKh, language);

  return (
    <div className={depth > 0 ? 'ml-4 mt-2' : 'mt-3'}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-700 transition-colors"
      >
        {open ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
        <Building2 className="w-4 h-4 text-primary-600 shrink-0" />
        <span className="font-semibold text-slate-900 dark:text-white flex-1 truncate">{deptName}</span>
        <span className="text-xs text-slate-500 shrink-0">
          {count} {count === 1 ? 'person' : 'people'}
        </span>
      </button>
      {open && (
        <div className="mt-2">
          <DepartmentMembers
            tiers={node.tiers}
            selectedMemberId={selectedMemberId}
            onSelectMember={onSelectMember}
          />
          {node.children.map((child) => (
            <DepartmentNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedMemberId={selectedMemberId}
              onSelectMember={onSelectMember}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OfficeBlock({
  office,
  selectedMemberId,
  onSelectMember,
}: {
  office: CompanyStructureOfficeNode;
  selectedMemberId: string | null;
  onSelectMember: (member: CompanyStructureMember) => void;
}) {
  const [open, setOpen] = useState(true);
  const count = officeEmployeeCount(office);

  return (
    <section className="surface-card shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-3 w-full px-4 py-4 text-left bg-gradient-to-r from-primary-50 to-transparent dark:from-primary-900/20 border-b border-slate-100 dark:border-slate-800"
      >
        {open ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        <MapPin className="w-5 h-5 text-primary-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">{office.name}</h3>
          <p className="text-xs text-slate-500">
            {office.departments.length} dept{office.departments.length === 1 ? '' : 's'} · {count} employees
          </p>
        </div>
      </button>
      {open && (
        <div className="p-4 space-y-1">
          {office.departments.length === 0 ? (
            <p className="text-sm text-slate-500 italic px-2">No departments at this location.</p>
          ) : (
            office.departments.map((dept) => (
              <DepartmentNode
                key={dept.id}
                node={dept}
                depth={0}
                selectedMemberId={selectedMemberId}
                onSelectMember={onSelectMember}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

type Props = {
  data: CompanyStructurePayload;
  selectedMemberId: string | null;
  onSelectMember: (member: CompanyStructureMember) => void;
};

export const CompanyStructureTree: React.FC<Props> = ({ data, selectedMemberId, onSelectMember }) => {
  const { t } = useLanguage();

  const unassignedCount = tierEmployeeCount(data.unassigned);

  return (
    <div className="space-y-6">
      {data.offices.map((office) => (
        <OfficeBlock
          key={office.id}
          office={office}
          selectedMemberId={selectedMemberId}
          onSelectMember={onSelectMember}
        />
      ))}

      {unassignedCount > 0 && (
        <section className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/40 p-4">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
            <Users className="w-4 h-4" />
            {t('companyStructure.unassigned') || 'Not assigned to a department'}
            <span className="text-xs font-normal text-slate-400">({unassignedCount})</span>
          </h3>
          <DepartmentMembers
            tiers={data.unassigned}
            selectedMemberId={selectedMemberId}
            onSelectMember={onSelectMember}
          />
        </section>
      )}
    </div>
  );
};
