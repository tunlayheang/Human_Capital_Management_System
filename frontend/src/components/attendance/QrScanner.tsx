import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Upload, Camera } from 'lucide-react';
import { Button } from '../ui/Button';
import { AppOverlay } from '../ui/AppOverlay';
import { overlayPanelClass } from '../../utils/overlayPanel';

interface QrScannerProps {
  onScan: (payload: string) => void;
  onClose: () => void;
}

export const QrScanner: React.FC<QrScannerProps> = ({ onScan, onClose }) => {
  const onScanRef = useRef(onScan);
  const handledRef = useRef(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileScannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [mode, setMode] = useState<'camera' | 'upload'>('camera');

  onScanRef.current = onScan;

  useEffect(() => {
    if (mode !== 'camera') return;
    const elementId = 'hcms-qr-reader';
    let cancelled = false;
    handledRef.current = false;

    const startScanner = async (camera: { facingMode: string } | string) => {
      const scanner = new Html5Qrcode(elementId);
      scannerRef.current = scanner;
      await scanner.start(
        camera,
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decoded) => {
          if (handledRef.current || cancelled) return;
          handledRef.current = true;
          onScanRef.current(decoded);
          scanner.stop().catch(() => {});
        },
        () => {}
      );
    };

    (async () => {
      try {
        await startScanner({ facingMode: 'environment' });
      } catch {
        try {
          if (!cancelled) await startScanner('user');
        } catch (err: unknown) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : 'Camera access denied. Use upload instead.');
          }
          return;
        }
      } finally {
        if (!cancelled) setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      if (scanner) {
        scanner.stop().catch(() => {});
        scanner.clear();
        scannerRef.current = null;
      }
    };
  }, [mode]);

  const scanFile = async (file: File) => {
    setError(null);
    try {
      if (!fileScannerRef.current) {
        fileScannerRef.current = new Html5Qrcode('hcms-qr-file-reader');
      }
      const result = await fileScannerRef.current.scanFile(file, false);
      if (handledRef.current) return;
      handledRef.current = true;
      onScanRef.current(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not read QR from image');
    }
  };

  return (
    <AppOverlay open onClose={onClose} zIndexClass="z-[70]" className="bg-slate-900/80" align="top">
      <div
        className={overlayPanelClass('md', 'bg-white dark:bg-slate-800 rounded-2xl shadow-modal overflow-hidden')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hcms-modal-header">
          <h3 className="font-semibold text-slate-900 dark:text-white">Office attendance QR</h3>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="hcms-modal-body !px-4 !py-4">
          <div className="flex gap-2 mb-4 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg">
            <button
              type="button"
              onClick={() => setMode('camera')}
              className={`flex-1 flex items-center justify-center gap-1 py-2 text-sm font-semibold rounded-md ${mode === 'camera' ? 'bg-white dark:bg-slate-700 shadow text-primary-600' : 'text-slate-500'}`}
            >
              <Camera className="w-4 h-4" /> Camera
            </button>
            <button
              type="button"
              onClick={() => setMode('upload')}
              className={`flex-1 flex items-center justify-center gap-1 py-2 text-sm font-semibold rounded-md ${mode === 'upload' ? 'bg-white dark:bg-slate-700 shadow text-primary-600' : 'text-slate-500'}`}
            >
              <Upload className="w-4 h-4" /> Upload
            </button>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400 text-center py-2">{error}</p>}

          {mode === 'camera' ? (
            <>
              {starting && !error && (
                <p className="text-sm text-slate-500 text-center mb-3">Starting camera…</p>
              )}
              <div id="hcms-qr-reader" className="w-full rounded-xl overflow-hidden min-h-[240px]" />
            </>
          ) : (
            <label className="flex flex-col items-center justify-center gap-3 py-12 border-2 border-dashed border-slate-200 dark:border-slate-600 rounded-xl cursor-pointer hover:border-primary-400">
              <Upload className="w-10 h-10 text-slate-400" />
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Upload QR image (PNG/JPG)</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) scanFile(f);
                  e.target.value = '';
                }}
              />
            </label>
          )}
          <div id="hcms-qr-file-reader" className="hidden" />
          <Button variant="outline" className="w-full mt-4" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </AppOverlay>
  );
};
