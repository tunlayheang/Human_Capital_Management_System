import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw,
  MapPin,
  AlertCircle,
  Printer,
  Download,
  QrCode,
  Shield,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Api } from '../../services/api';
import { OfficeLocation, Role } from '../../types';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { QR_LOGO_SRC } from './BrandedAttendanceQr';
import { AttendanceQrLiveDisplay } from './AttendanceQrLiveDisplay';
import { buildAttendanceScanUrl } from '../../utils/attendanceQr';
import {
  buildAttendanceQrPrintHtml,
  downloadQrPosterFromPrintLayout,
  openAttendanceQrPrintWindow,
  resolveQrPosterAssets,
  type QrPrintPosterOptions,
} from '../../utils/qrPosterExport';
import { RulesConfigHelp } from '../ui/RulesConfigHelp';

const DEFAULT_QR_TTL_SEC = 60;

function waitForQrPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 120);
      });
    });
  });
}

type GeneratedQr = {
  scanUrl: string;
  officeName: string;
  ttlSeconds: number;
};

export const QrGenerator: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { hasRole } = useAuth();
  const { t } = useLanguage();
  const canExportPoster = hasRole([Role.ADMIN, Role.HR]);

  const [offices, setOffices] = useState<OfficeLocation[]>([]);
  const [officeId, setOfficeId] = useState('');
  const [payload, setPayload] = useState('');
  const [officeName, setOfficeName] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingOffices, setLoadingOffices] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingImage, setSavingImage] = useState(false);
  const liveDisplayRef = useRef<HTMLDivElement>(null);

  const displayOfficeName =
    officeName || offices.find((o) => o.id === officeId)?.name || t('attendance.officeLocation');

  const posterCopy = useMemo(
    () => ({
      subtitle: t('attendance.qr.subtitle'),
      instructionTitle: t('attendance.qr.instructionTitle'),
      steps: [
        t('attendance.qr.step1'),
        t('attendance.qr.step2'),
        t('attendance.qr.step3'),
      ] as [string, string, string],
      footnote: t('attendance.qr.footnote'),
      brandLine: t('attendance.qr.brandLine'),
    }),
    [t]
  );

  const loadOffices = useCallback(async () => {
    setLoadingOffices(true);
    setLoadError(null);
    try {
      const list = await Api.attendance.getOffices();
      const arr = Array.isArray(list) ? list : [];
      setOffices(arr);
      if (arr.length > 0) {
        setOfficeId((prev) => (prev && arr.some((o) => o.id === prev) ? prev : arr[0].id));
      } else {
        setOfficeId('');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not load office zones';
      setLoadError(msg);
      setOffices([]);
    } finally {
      setLoadingOffices(false);
    }
  }, []);

  useEffect(() => {
    loadOffices();
  }, [loadOffices]);

  const refreshQrCode = useCallback(
    async (options?: { silent?: boolean }): Promise<GeneratedQr | null> => {
      if (!officeId) return null;
      if (!options?.silent) setLoading(true);
      try {
        const data = await Api.attendance.generateQr(officeId);
        if (!data?.token) {
          throw new Error('Server did not return a QR token');
        }
        const scanUrl =
          typeof data.checkInUrl === 'string' && data.checkInUrl.trim()
            ? data.checkInUrl.trim()
            : buildAttendanceScanUrl(data.token);
        const ttlSeconds = data.ttlSeconds ?? DEFAULT_QR_TTL_SEC;
        const generated: GeneratedQr = {
          scanUrl,
          officeName: data.officeName || offices.find((o) => o.id === officeId)?.name || '',
          ttlSeconds,
        };
        setPayload(scanUrl);
        setOfficeName(generated.officeName);
        return generated;
      } catch (e: unknown) {
        setPayload('');
        if (!options?.silent) {
          showToast(e instanceof Error ? e.message : 'Failed to generate QR', 'error');
        }
        return null;
      } finally {
        if (!options?.silent) setLoading(false);
      }
    },
    [officeId, offices, showToast]
  );

  useEffect(() => {
    if (!officeId || loadingOffices) return;
    void refreshQrCode();
  }, [officeId, loadingOffices, refreshQrCode]);

  const buildExportOptionsFromDom = useCallback(
    (fresh: GeneratedQr): QrPrintPosterOptions | null => {
      const svg = liveDisplayRef.current?.querySelector('.qr-live-qr-wrap svg');
      if (!svg) return null;
      const qrSvgHtml = new XMLSerializer().serializeToString(svg);
      return {
        officeName: fresh.officeName || displayOfficeName,
        qrSvgHtml,
        logoUrl: `${window.location.origin}${QR_LOGO_SRC}`,
        ttlSeconds: fresh.ttlSeconds,
        subtitle: posterCopy.subtitle,
        instructionTitle: posterCopy.instructionTitle,
        steps: [...posterCopy.steps],
        footnote: t('attendance.qr.exportFreshNote', { seconds: fresh.ttlSeconds }),
        brandLine: posterCopy.brandLine,
      };
    },
    [displayOfficeName, posterCopy, t]
  );

  const prepareFreshExport = useCallback(async (): Promise<{
    opts: QrPrintPosterOptions;
    fresh: GeneratedQr;
  } | null> => {
    const fresh = await refreshQrCode({ silent: true });
    if (!fresh) return null;
    await waitForQrPaint();
    const opts = buildExportOptionsFromDom(fresh);
    if (!opts) return null;
    return { opts, fresh };
  }, [refreshQrCode, buildExportOptionsFromDom]);

  const handleSavePhoto = useCallback(async () => {
    if (!canExportPoster || !officeId) return;
    setSavingImage(true);
    try {
      const prepared = await prepareFreshExport();
      if (!prepared) {
        showToast(t('attendance.qr.notReady'), 'error');
        return;
      }
      await downloadQrPosterFromPrintLayout(prepared.opts, prepared.fresh.officeName);
      showToast(t('attendance.qr.saveSuccess', { seconds: prepared.fresh.ttlSeconds }), 'success');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('attendance.qr.saveFailed');
      showToast(message, 'error');
    } finally {
      setSavingImage(false);
    }
  }, [canExportPoster, officeId, prepareFreshExport, showToast, t]);

  const handlePrint = useCallback(async () => {
    if (!canExportPoster || !officeId) return;
    setSavingImage(true);
    try {
      const prepared = await prepareFreshExport();
      if (!prepared) {
        showToast(t('attendance.qr.notReady'), 'error');
        return;
      }
      const resolved = await resolveQrPosterAssets(prepared.opts);
      openAttendanceQrPrintWindow(buildAttendanceQrPrintHtml(resolved));
      showToast(t('attendance.qr.exportFreshNote', { seconds: prepared.fresh.ttlSeconds }), 'info');
    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'POPUP_BLOCKED') {
        showToast(t('attendance.qr.printBlocked'), 'error');
        return;
      }
      showToast(t('attendance.qr.notReady'), 'error');
    } finally {
      setSavingImage(false);
    }
  }, [canExportPoster, officeId, prepareFreshExport, showToast, t]);

  if (loadingOffices) {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <div className="w-full max-w-sm aspect-[3/4] rounded-3xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
        <p className="text-sm text-slate-500">{t('attendance.qr.loadingOffices')}</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center max-w-md mx-auto">
        <AlertCircle className="w-10 h-10 text-amber-500" />
        <p className="text-sm text-slate-600 dark:text-slate-400">{loadError}</p>
        <Button onClick={loadOffices} variant="outline" className="gap-2">
          <RefreshCw className="w-4 h-4" /> {t('attendance.qr.retry')}
        </Button>
      </div>
    );
  }

  if (offices.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center max-w-md mx-auto">
        <MapPin className="w-10 h-10 text-primary-500" />
        <p className="text-sm text-slate-600 dark:text-slate-400">{t('attendance.qr.noOffices')}</p>
        <div className="flex flex-wrap gap-2 justify-center">
          <Button onClick={loadOffices} variant="outline" className="gap-2">
            <RefreshCw className="w-4 h-4" /> {t('attendance.qr.createDefault')}
          </Button>
          <Button onClick={() => navigate('/settings?tab=office')} className="gap-2">
            <MapPin className="w-4 h-4" /> {t('attendance.qr.openZones')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,280px)_1fr] gap-8 xl:gap-10 items-start">
      <aside className="space-y-5 xl:sticky xl:top-24">
        <div className="flex items-start gap-3 relative pr-10">
          <RulesConfigHelp help="attendance.qr" className="absolute top-0 right-0 z-10" />
          <div className="p-2.5 rounded-xl bg-primary-500/15 text-primary-600 dark:text-primary-400 shrink-0">
            <QrCode className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {t('attendance.qr.pageTitle')}
            </h3>
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 mb-2 block">
            {t('attendance.qr.officeLabel')}
          </label>
          <div className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/60 px-4 py-3 text-sm font-medium text-slate-900 dark:text-white shadow-sm">
            {displayOfficeName}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            onClick={() => void refreshQrCode()}
            isLoading={loading}
            variant="outline"
            className="w-full gap-2 justify-center"
            disabled={!officeId}
          >
            <RefreshCw className="w-4 h-4" /> {t('attendance.qr.refreshNow')}
          </Button>

          {canExportPoster ? (
            <>
              <Button
                onClick={() => void handleSavePhoto()}
                isLoading={savingImage}
                className="w-full gap-2 justify-center bg-primary-600 hover:bg-primary-700 text-white shadow-lg shadow-primary-600/25"
                disabled={!officeId || savingImage}
              >
                <Download className="w-4 h-4" /> {t('attendance.qr.savePhoto')}
              </Button>
              <Button
                onClick={() => void handlePrint()}
                variant="outline"
                className="w-full gap-2 justify-center"
                disabled={!officeId || savingImage}
                isLoading={savingImage}
              >
                <Printer className="w-4 h-4" /> {t('attendance.qr.printPoster')}
              </Button>
            </>
          ) : (
            <p className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 px-3 py-2.5">
              <Shield className="w-4 h-4 shrink-0 text-slate-400 mt-0.5" />
              {t('attendance.qr.exportOnlyHrAdmin')}
            </p>
          )}
        </div>
      </aside>

      <div className="flex flex-col items-center justify-center min-h-[20rem] rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white/50 dark:bg-slate-900/30 p-6 sm:p-10">
        {payload ? (
          <AttendanceQrLiveDisplay
            ref={liveDisplayRef}
            officeName={displayOfficeName}
            qrValue={payload}
            subtitle={posterCopy.subtitle}
          />
        ) : (
          <div className="w-[240px] h-[240px] rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse flex flex-col items-center justify-center gap-3 ring-1 ring-slate-200 dark:ring-slate-700">
            <QrCode className="w-10 h-10 text-slate-300 dark:text-slate-600" />
            <p className="text-sm text-slate-500 px-4 text-center max-w-[16rem]">
              {loading ? t('attendance.qr.generating') : t('attendance.qr.tapRefresh')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
