import React, { useState } from 'react';
import { Shield, CheckCircle2, Users, ArrowRight, Layers } from 'lucide-react';
import { Button } from '../ui/Button';
import { getSystemRole, SYSTEM_ROLES, type SystemRoleId } from './permissionRoles';

interface RoleManagementProps {
  onOpenMatrix?: (roleId: SystemRoleId) => void;
}

const RoleManagement: React.FC<RoleManagementProps> = ({ onOpenMatrix }) => {
  const [selectedRole, setSelectedRole] = useState(() => getSystemRole('admin'));

  const assignmentScope =
    selectedRole.id === 'admin'
      ? 'Implicitly assigned to system owners.'
      : `Standard assignment for ${selectedRole.displayName.toLowerCase()} staff.`;

  const securityPosture =
    selectedRole.level === 1
      ? 'Unrestricted organizational data access.'
      : 'Scoped access based on role hierarchy.';

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 surface-card px-4 py-3 sm:px-5">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Review built-in roles, then configure permission defaults in the matrix.
        </p>
        {onOpenMatrix && (
          <Button
            size="sm"
            variant="outline"
            icon={<Layers className="w-4 h-4" />}
            onClick={() => onOpenMatrix(selectedRole.id)}
          >
            Matrix — {selectedRole.shortLabel}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6">
        <div className="lg:col-span-4 xl:col-span-3 space-y-2 lg:sticky lg:top-0 lg:self-start lg:z-20">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 px-1">
            System roles
          </h2>

          <div className="space-y-1.5" role="listbox" aria-label="System roles">
            {SYSTEM_ROLES.map((role) => {
              const isSelected = selectedRole.id === role.id;
              return (
                <button
                  key={role.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => setSelectedRole(role)}
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg border text-left transition-colors ${
                    isSelected
                      ? 'border-primary-500/60 bg-primary-50/50 dark:bg-primary-900/20'
                      : 'border-transparent bg-white dark:bg-slate-800 hover:border-slate-200 dark:hover:border-slate-600'
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums ${
                      isSelected
                        ? 'bg-primary-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    L{role.level}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm font-medium truncate ${
                        isSelected ? 'text-primary-700 dark:text-primary-300' : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {role.displayName}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{role.levelLabel}</p>
                  </div>
                  {isSelected && (
                    <CheckCircle2 className="w-4 h-4 text-primary-600 dark:text-primary-400 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-8 xl:col-span-9 surface-card p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-slate-100 dark:border-slate-700 pb-6">
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{selectedRole.levelLabel}</p>
              <h3 className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white tracking-tight mt-1">
                {selectedRole.displayName}
              </h3>
            </div>
            {onOpenMatrix && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                icon={<ArrowRight className="w-4 h-4" />}
                onClick={() => onOpenMatrix(selectedRole.id)}
              >
                Edit permissions
              </Button>
            )}
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
              Description
            </h4>
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{selectedRole.description}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
              <div className="flex items-center gap-2 mb-2 text-slate-700 dark:text-slate-300">
                <Users className="w-4 h-4 text-slate-500" />
                <span className="text-xs font-semibold uppercase tracking-wide">Assignment</span>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{assignmentScope}</p>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
              <div className="flex items-center gap-2 mb-2 text-slate-700 dark:text-slate-300">
                <Shield className="w-4 h-4 text-slate-500" />
                <span className="text-xs font-semibold uppercase tracking-wide">Access level</span>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{securityPosture}</p>
            </div>
          </div>

          <p className="text-sm text-slate-600 dark:text-slate-400 border-l-2 border-primary-500 pl-3">
            Role definitions are fixed. Use the <strong className="font-medium text-slate-800 dark:text-slate-200">Permission Matrix</strong>{' '}
            tab to set grants and denials for <strong className="font-medium text-slate-800 dark:text-slate-200">{selectedRole.shortLabel}</strong>.
          </p>
        </div>
      </div>
    </div>
  );
};

export default RoleManagement;
