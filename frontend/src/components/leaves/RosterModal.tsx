import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Badge } from '../ui/Badge';
import { LeaveType } from '../../types';
import { MonthlyFixedRoster } from '../../types/roster';
import { CleanRosterBuilder } from './CleanRosterBuilder';
import { monthName } from '../../utils/leaveCalendar';
import { exportRoster, rosterToGridData } from '../../utils/rosterExport';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';
import { ExportFormatMenu } from '../ui/ExportFormatMenu';
import { useToast } from '../../context/ToastContext';
import { Calendar, Plus, Edit2, Trash2 } from 'lucide-react';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';

type Mode = 'manage' | 'create' | 'edit';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  fixedRosters: MonthlyFixedRoster[];
  rosterEmployees: Array<{ id: string; name: string; department?: string }>;
  leaveTypes: LeaveType[];
  onSave: (roster: MonthlyFixedRoster, isEdit: boolean) => void | Promise<boolean>;
  onDelete: (id: string) => void;
};

export const RosterModal: React.FC<Props> = ({
  isOpen,
  onClose,
  fixedRosters,
  rosterEmployees,
  leaveTypes,
  onSave,
  onDelete,
}) => {
  const { showToast } = useToast();
  const [currentMode, setCurrentMode] = useState<Mode>('manage');
  const [selectedRoster, setSelectedRoster] = useState<MonthlyFixedRoster | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleClose = () => {
    if (currentMode !== 'manage') {
      setCurrentMode('manage');
      setSelectedRoster(null);
      return;
    }
    onClose();
    setCurrentMode('manage');
    setSelectedRoster(null);
    setDeleteConfirmId(null);
  };

  const title =
    currentMode === 'manage'
      ? 'Manage Fixed Rosters'
      : currentMode === 'create'
        ? 'Create New Roster'
        : 'Edit Roster';

  const isRosterEditor = currentMode === 'create' || currentMode === 'edit';
  const size = currentMode === 'manage' ? 'lg' : 'full';
  const contentClassName = currentMode === 'manage' ? '' : '!p-0 !overflow-hidden flex flex-col min-h-0';
  /** Use overlay-host width (not 100vw) so the paint palette is not covered by the app sidebar. */
  const dialogClassName = isRosterEditor
    ? 'hcms-modal-dialog--roster-editor'
    : '';

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      size={size}
      hideHeader={isRosterEditor}
      align={isRosterEditor ? 'top' : 'center'}
      contentClassName={contentClassName}
      dialogClassName={dialogClassName}
    >
      {currentMode === 'manage' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button
              className="bg-primary-600 hover:bg-primary-700 text-white"
              onClick={() => {
                setSelectedRoster(null);
                setCurrentMode('create');
              }}
            >
              <Plus className="w-4 h-4 mr-1" /> Create New Roster
            </Button>
          </div>
          {fixedRosters.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="w-12 h-12 mx-auto text-slate-300 mb-3" />
              <p className="font-medium">No fixed rosters found.</p>
              <p className="text-sm text-slate-500">Create your first roster to get started.</p>
            </div>
          ) : (
            <ul className="space-y-4">
              {fixedRosters.map((r) => {
                const types = r.entries.reduce<Record<string, number>>((acc, e) => {
                  acc[e.leaveType] = (acc[e.leaveType] || 0) + 1;
                  return acc;
                }, {});
                return (
                  <li key={r.id} className="border rounded-xl p-4 relative">
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <div className="flex items-center gap-2 text-lg font-medium">
                          <span>{r.name}</span>
                          <Badge className="bg-primary-100 text-primary-800 border-primary-200">
                            {monthName(r.month)} {r.year}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-500 mt-1">
                          {r.entries.length} entries · Created {formatDateOnlyDisplay(r.createdAt)}
                          {r.updatedAt !== r.createdAt &&
                            ` · Updated ${formatDateOnlyDisplay(r.updatedAt)}`}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {Object.entries(types).map(([t, n]) => (
                            <Badge key={t} variant="neutral" className="text-xs">
                              {t}: {n}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <ExportFormatMenu
                          formats={['csv', 'xlsx']}
                          onExport={async (format: ExportFileExt) => {
                            const grid = rosterToGridData(r, rosterEmployees, leaveTypes);
                            const ok = await exportRoster(format, r, grid, rosterEmployees, leaveTypes);
                            if (format === 'pdf' && !ok) {
                              showToast('Please allow popups to export PDF', 'warning');
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="p-2 text-slate-500 hover:text-blue-600"
                          onClick={() => {
                            setSelectedRoster(r);
                            setCurrentMode('edit');
                          }}
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          className="p-2 text-slate-500 hover:text-red-600"
                          onClick={() => setDeleteConfirmId(r.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {isRosterEditor && (
        <div className="flex min-h-0 flex-1 flex-col h-[min(78dvh,calc(100dvh-6rem))]">
        <CleanRosterBuilder
          employees={rosterEmployees}
          leaveTypes={leaveTypes}
          initialRoster={currentMode === 'edit' ? selectedRoster : null}
          onCancel={() => {
            setCurrentMode('manage');
            setSelectedRoster(null);
          }}
          onSave={async ({ month, year, name, entries }) => {
            const now = new Date().toISOString();
            const roster: MonthlyFixedRoster = {
              id: selectedRoster?.id ?? '',
              month,
              year,
              name,
              entries,
              createdAt: selectedRoster?.createdAt || now,
              updatedAt: now,
            };
            const ok = await onSave(roster, currentMode === 'edit');
            if (!ok) return false;
            setCurrentMode('manage');
            setSelectedRoster(null);
            return true;
          }}
        />
        </div>
      )}
    </Modal>
    <ConfirmDialog
      open={Boolean(deleteConfirmId)}
      onClose={() => setDeleteConfirmId(null)}
      title="Delete roster"
      description="This removes the fixed roster from planning. Existing leave records are not changed."
      variant="danger"
      confirmLabel="Delete roster"
      onConfirm={() => {
        if (!deleteConfirmId) return;
        onDelete(deleteConfirmId);
        setDeleteConfirmId(null);
      }}
    />
    </>
  );
};
