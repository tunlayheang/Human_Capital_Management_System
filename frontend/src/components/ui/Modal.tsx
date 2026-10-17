import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { AppOverlay, type AppOverlayAlign } from './AppOverlay';
import type { RulesConfigHelpContent, RulesConfigHelpId } from '../../content/rulesConfigHelpContent';
import { RulesConfigHelp } from './RulesConfigHelp';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full' | 'wide';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  /** Prefer over description for instructional copy behind (!) — one or more help panels. */
  help?:
    | RulesConfigHelpId
    | RulesConfigHelpContent
    | Array<RulesConfigHelpId | RulesConfigHelpContent>;
  children: React.ReactNode;
  /** Pinned below scrollable body — use for primary/cancel actions on long forms. */
  footer?: React.ReactNode;
  size?: ModalSize;
  hideHeader?: boolean;
  contentClassName?: string;
  /** Optional dialog shell class override for complex responsive layouts. */
  dialogClassName?: string;
  /** Vertical placement in the overlay (default: centered). */
  align?: AppOverlayAlign;
  /** Keep close disabled while async action is running. */
  disableClose?: boolean;
  /** Overlay stacking (default z-[210]). Use a higher value for nested dialogs. */
  zIndexClass?: string;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  help,
  children,
  footer,
  size = 'lg',
  hideHeader = false,
  contentClassName = '',
  dialogClassName = '',
  align = 'center',
  disableClose = false,
  zIndexClass = 'z-[210]',
}) => {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen || disableClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, disableClose]);

  useEffect(() => {
    if (!isOpen) return;
    const root = dialogRef.current;
    if (!root) return;
    const firstFocusable = root.querySelector<HTMLElement>(
      'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const root = dialogRef.current;
    if (!root) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKeyDown);
    return () => root.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  const showDescription = Boolean(description) && !help;

  return (
    <AppOverlay
      open={isOpen}
      onClose={disableClose ? undefined : onClose}
      zIndexClass={zIndexClass}
      backdrop="dim"
      align={align}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={showDescription ? descId : undefined}
        className={`hcms-modal-dialog hcms-modal-dialog--${size} flex min-h-0 flex-col overflow-hidden ${dialogClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        {!hideHeader && (
          <div className="hcms-modal-header">
            <div className="min-w-0 pr-2 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                {title ? (
                  <h3 id={titleId} className="min-w-0">
                    {title}
                  </h3>
                ) : null}
                {showDescription ? <p id={descId}>{description}</p> : null}
              </div>
              {help ? (
                <div className="flex items-center gap-1 shrink-0 mt-0.5">
                  {(Array.isArray(help) ? help : [help]).map((item, index) => (
                    <RulesConfigHelp
                      key={typeof item === 'string' ? item : `help-${index}`}
                      help={item}
                    />
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={disableClose}
              className="hcms-modal-close"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className={`hcms-modal-body ${hideHeader ? 'flex flex-col' : ''} ${contentClassName}`}>
          {children}
        </div>
        {footer ? <div className="hcms-modal-footer">{footer}</div> : null}
      </div>
    </AppOverlay>
  );
};
