import React from 'react';
import { X, Download } from 'lucide-react';
import { AppOverlay } from '../ui/AppOverlay';

type Props = {
  url: string;
  alt?: string;
  onClose: () => void;
  overlayHostRef?: React.RefObject<HTMLElement | null>;
};

export const ChatImageLightbox: React.FC<Props> = ({
  url,
  alt = '',
  onClose,
  overlayHostRef,
}) => {
  return (
    <AppOverlay
      open
      onClose={onClose}
      zIndexClass={overlayHostRef ? 'z-[60]' : 'z-[300]'}
      hostRef={overlayHostRef}
      backdrop="none"
      align="top"
      className="!p-0 bg-black/90 backdrop-blur-sm"
      lockScroll={!overlayHostRef}
    >
    <div
      className="relative flex flex-col w-full h-full min-h-0"
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      onClick={onClose}
    >
      <div className="flex items-center justify-end gap-2 p-3 safe-area-top shrink-0">
        <a
          href={url}
          download
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
          aria-label="Download"
        >
          <Download className="w-5 h-5" />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div
        className="flex-1 flex items-center justify-center min-h-0 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={url}
          alt={alt}
          className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
        />
      </div>
    </div>
    </AppOverlay>
  );
};
