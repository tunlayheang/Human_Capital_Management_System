import React from 'react';
import { Edit2, Save, X } from 'lucide-react';
import { Button } from './Button';

type Props = {
  canEdit: boolean;
  isEditing: boolean;
  saving?: boolean;
  /** Keep Save visible but non-interactive (e.g. form incomplete). */
  saveDisabled?: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  /** Visual weight of the Edit button when idle (default outline). */
  editVariant?: 'primary' | 'outline';
};

/**
 * Card/section Edit · Cancel/Save controls.
 * Always intrinsic width (never stretches full-bleed on narrow headers).
 */
export const SectionEditToolbar: React.FC<Props> = ({
  canEdit,
  isEditing,
  saving = false,
  saveDisabled = false,
  onEdit,
  onCancel,
  onSave,
  editVariant = 'outline',
}) => {
  if (!canEdit) return null;

  if (!isEditing) {
    return (
      <Button
        variant={editVariant}
        size="sm"
        icon={<Edit2 className="w-3.5 h-3.5" />}
        onClick={onEdit}
        className="shrink-0 w-auto self-start"
      >
        Edit
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0 w-auto self-start">
      <Button
        variant="ghost"
        size="sm"
        icon={<X className="w-3.5 h-3.5" />}
        onClick={onCancel}
        disabled={saving}
        className="w-auto"
      >
        Cancel
      </Button>
      <Button
        size="sm"
        icon={<Save className="w-3.5 h-3.5" />}
        onClick={onSave}
        disabled={saving || saveDisabled}
        className="w-auto"
      >
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  );
};
