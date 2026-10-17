import React, { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { Api } from '../../services/api';
import { usePersonalNotes } from '../../hooks/usePersonalHub';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import type { PersonalHubNote } from '../../types/personalHub';
import { PaBtnPrimary, PaHint, PaListRow, PaListShell, PaLoading } from './personalAnalyticsUi';

const PAPER_LINES =
  'bg-[length:100%_28px] [background-image:repeating-linear-gradient(transparent,transparent_27px,rgba(148,163,184,0.32)_27px,rgba(148,163,184,0.32)_28px)] dark:[background-image:repeating-linear-gradient(transparent,transparent_27px,rgba(71,85,105,0.45)_27px,rgba(71,85,105,0.45)_28px)]';

const LINE_HEIGHT = 28;
const VISIBLE_NOTES = 6;

function spiralHole(i: number) {
  return (
    <span
      key={i}
      className="block w-3 h-3 rounded-full border-2 border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 shadow-inner"
      aria-hidden
    />
  );
}

export function PersonalNotesNotebook({ isSelf }: { isSelf: boolean; compact?: boolean }) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { confirm, ConfirmDialogHost } = useConfirmDialog();
  const { notes, loading, reload } = usePersonalNotes();
  const [editing, setEditing] = useState<PersonalHubNote | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const openNew = () => {
    setEditing(null);
    setTitle('');
    setBody('');
  };

  const openEdit = (note: PersonalHubNote) => {
    setEditing(note);
    setTitle(note.title);
    setBody(note.body);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (editing) {
        await Api.personalHub.updateNote(editing.id, { title, body });
      } else {
        await Api.personalHub.createNote({ title, body });
      }
      showToast(t('personalAnalytics.hub.noteSaved'), 'success');
      openNew();
      await reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    const ok = await confirm({
      title: t('personalAnalytics.hub.deleteNoteTitle'),
      description: t('personalAnalytics.hub.deleteNoteConfirm'),
      variant: 'danger',
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    try {
      await Api.personalHub.deleteNote(id);
      if (editing?.id === id) openNew();
      await reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  };

  if (!isSelf) {
    return <PaHint>{t('personalAnalytics.hub.privateOnly')}</PaHint>;
  }

  if (loading) {
    return <PaLoading />;
  }

  const visibleNotes = notes.slice(0, VISIBLE_NOTES);

  return (
    <div className="space-y-2.5">
      <div className="relative rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900 shadow-sm">
        <div className="flex min-h-[240px]">
          <div
            className="w-10 shrink-0 flex flex-col items-center justify-center gap-3 py-5 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700"
            aria-hidden
          >
            {Array.from({ length: 8 }, (_, i) => spiralHole(i))}
          </div>

          <div className={`flex-1 relative min-w-0 bg-white dark:bg-slate-900 ${PAPER_LINES}`}>
            <div
              className="absolute top-0 bottom-0 left-14 w-px bg-red-300/70 dark:bg-red-400/45"
              aria-hidden
            />

            <div className="relative pl-16 pr-4 pt-4 pb-3 space-y-1">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[10px] uppercase tracking-[0.2em] font-medium text-slate-500 dark:text-slate-400">
                  {editing ? t('personalAnalytics.hub.editingNote') : t('personalAnalytics.hub.newPage')}
                </p>
                {editing ? (
                  <button
                    type="button"
                    onClick={openNew}
                    className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    aria-label={t('common.cancel')}
                  >
                    <X className="w-4 h-4" />
                  </button>
                ) : null}
              </div>

              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('personalAnalytics.hub.noteTitle')}
                className="w-full bg-transparent border-0 border-b border-dashed border-slate-300 dark:border-slate-600 pb-2 text-base font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none"
              />

              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t('personalAnalytics.hub.noteBody')}
                rows={5}
                className="w-full bg-transparent border-0 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none resize-none"
                style={{ lineHeight: `${LINE_HEIGHT}px` }}
              />

              <div className="flex items-center gap-3 pt-2">
                <PaBtnPrimary
                  onClick={() => void save()}
                  disabled={saving || !body.trim()}
                  className="inline-flex items-center gap-1.5 rounded-full"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {editing ? t('common.save') : t('personalAnalytics.hub.addNote')}
                </PaBtnPrimary>
              </div>
            </div>
          </div>
        </div>
      </div>

      {notes.length === 0 ? (
        <PaHint>{t('personalAnalytics.hub.noNotes')}</PaHint>
      ) : (
        <>
          <PaListShell compact maxHeight="sm">
            {visibleNotes.map((n) => (
              <PaListRow
                key={n.id}
                compact
                onClick={() => openEdit(n)}
                className={editing?.id === n.id ? 'ring-1 ring-primary-500/60' : ''}
              >
                <div className="flex justify-between gap-2 items-start">
                  <span className="font-semibold text-slate-900 dark:text-white truncate">
                    {n.title || t('personalAnalytics.hub.noteTitle')}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 p-0.5 text-slate-400 hover:text-red-500"
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(n.id);
                    }}
                    aria-label={t('common.delete')}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <p className="text-slate-500 mt-0.5 line-clamp-1 whitespace-pre-wrap">{n.body}</p>
              </PaListRow>
            ))}
          </PaListShell>
          {notes.length > VISIBLE_NOTES ? (
            <PaHint>
              {t('personalAnalytics.hub.notesMore', { count: String(notes.length - VISIBLE_NOTES) })}
            </PaHint>
          ) : null}
        </>
      )}
      <ConfirmDialogHost />
    </div>
  );
}
