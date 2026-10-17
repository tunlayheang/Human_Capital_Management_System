import type { RoleId } from '../../services/permissionService';

export type SystemRoleId = RoleId;

export type SystemRoleMeta = {
  id: SystemRoleId;
  displayName: string;
  shortLabel: string;
  level: number;
  levelLabel: string;
  description: string;
  accent: string;
};

export const SYSTEM_ROLES: SystemRoleMeta[] = [
  {
    id: 'admin',
    displayName: 'Administrator',
    shortLabel: 'Admin',
    level: 1,
    levelLabel: 'Level 1',
    description:
      'Ultimate governance: users, settings, permission matrices, and organization-wide visibility.',
    accent: 'from-violet-600 to-indigo-600',
  },
  {
    id: 'hr',
    displayName: 'HR Manager',
    shortLabel: 'HR',
    level: 2,
    levelLabel: 'Level 2',
    description:
      'Workforce operations—payroll, employee lifecycle, and access governance.',
    accent: 'from-blue-600 to-cyan-600',
  },
  {
    id: 'manager',
    displayName: 'Department Manager',
    shortLabel: 'Manager',
    level: 3,
    levelLabel: 'Level 3',
    description:
      'Team oversight within a department: attendance, projects, and approvals for direct reports.',
    accent: 'from-primary-600 to-primary-800',
  },
  {
    id: 'employee',
    displayName: 'Staff',
    shortLabel: 'Staff',
    level: 4,
    levelLabel: 'Level 4',
    description:
      'Self-service: profile, attendance, leave, assigned tasks, and collaboration tools.',
    accent: 'from-slate-600 to-slate-700',
  },
];

export function getSystemRole(id: SystemRoleId): SystemRoleMeta {
  return SYSTEM_ROLES.find((r) => r.id === id) ?? SYSTEM_ROLES[0];
}
