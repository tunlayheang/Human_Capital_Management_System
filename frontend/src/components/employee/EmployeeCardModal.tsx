import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  FileText,
  Loader2,
  Plus,
  Printer,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';
import html2canvas from 'html2canvas';
import JSZip from 'jszip';
import { QRCodeSVG } from 'qrcode.react';
import { Api } from '../../services/api';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import { todayYmdInCompanyTz } from '../../utils/companyCalendar';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';
import { buildStaffVerifyUrl } from '../../utils/staffVerifyQr';
import { joinPersonNameParts } from '../../utils/personDisplayName';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { StatusLabel } from '../ui/StatusLabel';
import '../../pages/employeeCard.css';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const EMPLOYEE_CARD_PRINT_HOST_CLASS = 'employee-card-print-host';
const EMPLOYEE_CARD_PRINTING_BODY_CLASS = 'employee-card-printing';

function removeEmployeeCardPrintHost(): void {
  document.body.classList.remove(EMPLOYEE_CARD_PRINTING_BODY_CLASS);
  document.querySelector(`.${EMPLOYEE_CARD_PRINT_HOST_CLASS}`)?.remove();
}

async function waitForImage(img: HTMLImageElement): Promise<void> {
  if (img.complete && img.naturalWidth > 0) return;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load print image'));
  });
}

async function waitForNextPaint(): Promise<void> {
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

const CARD_W = 320;
const CARD_H = 520;

const CARD_CAPTURE_OPTIONS = {
  scale: 3,
  useCORS: true,
  allowTaint: false,
  logging: false,
  foreignObjectRendering: false,
  imageTimeout: 15000,
} as const;

async function waitForCloneImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (!img.getAttribute('src')) {
            resolve();
            return;
          }
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
        })
    )
  );
}

function syncAvatarState(live: HTMLElement, clone: HTMLElement): void {
  const liveImg = live.querySelector('.avatar-img') as HTMLImageElement | null;
  const cloneImg = clone.querySelector('.avatar-img') as HTMLImageElement | null;
  const livePh = live.querySelector('.avatar-placeholder') as HTMLElement | null;
  const clonePh = clone.querySelector('.avatar-placeholder') as HTMLElement | null;

  if (liveImg && cloneImg) {
    const src = liveImg.currentSrc || liveImg.src;
    if (src) cloneImg.src = src;
    if (liveImg.hasAttribute('hidden')) cloneImg.setAttribute('hidden', '');
    else cloneImg.removeAttribute('hidden');
  }
  if (livePh && clonePh) {
    if (livePh.hasAttribute('hidden')) clonePh.setAttribute('hidden', '');
    else clonePh.removeAttribute('hidden');
  }
}

function prepareExportClone(clone: HTMLElement, side: 'front' | 'back'): void {
  clone.className = `card-face ${side === 'front' ? 'card-front' : 'card-back'} employee-card-export-face`;
  Object.assign(clone.style, {
    position: 'relative',
    inset: 'auto',
    left: '0',
    top: '0',
    right: 'auto',
    bottom: 'auto',
    width: `${CARD_W}px`,
    height: `${CARD_H}px`,
    margin: '0',
    transform: 'none',
    boxShadow: 'none',
    overflow: 'hidden',
    opacity: '1',
    visibility: 'visible',
    display: 'block',
    borderRadius: '22px',
    background: side === 'front' ? '#ddedf7' : '#c8dff0',
  });
  clone.style.backfaceVisibility = 'visible';
  clone.style.setProperty('-webkit-backface-visibility', 'visible');

  clone.querySelectorAll<HTMLElement>('*').forEach((node) => {
    node.style.backdropFilter = 'none';
    node.style.setProperty('-webkit-backdrop-filter', 'none');
    node.style.animation = 'none';
    node.style.transition = 'none';
    node.style.transform = 'none';
  });

  clone.querySelectorAll<HTMLElement>('.back-contacts, .emp-id-pill').forEach((node) => {
    node.style.background = '#ffffff';
  });

  const ring = clone.querySelector('.avatar-ring') as HTMLElement | null;
  if (ring) {
    ring.style.background = '#f0a500';
  }

  // Force full-width centered stacks so export cannot shrink-to-left
  const frontBody = clone.querySelector('.front-body') as HTMLElement | null;
  if (frontBody) {
    Object.assign(frontBody.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      left: '0',
      right: '0',
    });
  }
  const frontStack = clone.querySelector('.front-stack') as HTMLElement | null;
  if (frontStack) {
    Object.assign(frontStack.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: '100%',
    });
  }
  const backMain = clone.querySelector('.back-main') as HTMLElement | null;
  if (backMain) {
    Object.assign(backMain.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      left: '20px',
      right: '20px',
      width: '280px',
      boxSizing: 'border-box',
    });
  }
  const backStack = clone.querySelector('.back-stack') as HTMLElement | null;
  if (backStack) {
    Object.assign(backStack.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: '100%',
      gap: '14px',
    });
  }
  const backFooter = clone.querySelector('.back-footer') as HTMLElement | null;
  if (backFooter) {
    Object.assign(backFooter.style, {
      position: 'absolute',
      right: '16px',
      bottom: '36px',
    });
  }

  clone.querySelectorAll<HTMLElement>(
    '.contact-val, .contact-label, .expire-val, .expire-label, .back-qr-empid, .emp-id-text, .name-en, .name-kh, .title-badge, .logo-text, .logo-sub, .back-logo, .back-sub'
  ).forEach((node) => {
    node.style.overflow = 'visible';
    node.style.lineHeight = '1.35';
  });
}

/**
 * Capture a flat off-DOM clone — never the live 3D-flipped card face.
 * html2canvas cannot reliably snapshot preserve-3d / backface-hidden elements.
 */
async function captureCardFace(el: HTMLElement, side: 'front' | 'back'): Promise<HTMLCanvasElement> {
  const host = document.createElement('div');
  host.setAttribute('data-employee-card-export-host', 'true');
  host.style.cssText = [
    'position:fixed',
    'left:-10000px',
    'top:0',
    `width:${CARD_W}px`,
    `height:${CARD_H}px`,
    'overflow:hidden',
    'pointer-events:none',
    'z-index:2147483646',
    'opacity:1',
    'background:transparent',
  ].join(';');

  const shell = document.createElement('div');
  shell.className = 'employee-card-root';
  shell.style.cssText = `width:${CARD_W}px;height:${CARD_H}px;position:relative;`;

  const clone = el.cloneNode(true) as HTMLElement;
  syncAvatarState(el, clone);
  prepareExportClone(clone, side);

  shell.appendChild(clone);
  host.appendChild(shell);
  document.body.appendChild(host);

  try {
    await waitForCloneImages(clone);
    await waitForNextPaint();
    return await html2canvas(clone, {
      ...CARD_CAPTURE_OPTIONS,
      backgroundColor: side === 'front' ? '#ddedf7' : '#c8dff0',
    });
  } finally {
    host.remove();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not create PNG blob'));
    }, 'image/png');
  });
}

async function downloadCardFacesZip(
  front: HTMLCanvasElement,
  back: HTMLCanvasElement,
  suffix: string
): Promise<void> {
  const zip = new JSZip();
  zip.file(`ROC_Card_Front_${suffix}.png`, await canvasToBlob(front));
  zip.file(`ROC_Card_Back_${suffix}.png`, await canvasToBlob(back));
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = `ROC_Card_${suffix}.zip`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function todayUtcDateOnly(): string {
  return todayYmdInCompanyTz();
}

function cardExpireYmd(card: Record<string, unknown>): string {
  const raw = String(card.expire_date ?? '').trim();
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

/** Active issued cards whose expire date is still today or later (company calendar). */
function findActiveUnexpiredCards(
  cards: Record<string, unknown>[],
  todayYmd: string = todayYmdInCompanyTz()
): Record<string, unknown>[] {
  return cards.filter((card) => {
    const status = String(card.status ?? '').trim().toLowerCase();
    if (status !== 'active') return false;
    const exp = cardExpireYmd(card);
    if (!exp) return true;
    return exp >= todayYmd;
  });
}

function addOneCalendarYearToDateOnlyStr(yyyyMmDd: string): string {
  const parts = yyyyMmDd.split('-').map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return yyyyMmDd;
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCFullYear(dt.getUTCFullYear() + 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function formatDefaultExpiryPreview(): string {
  return formatDateOnlyDisplay(addOneCalendarYearToDateOnlyStr(todayUtcDateOnly()));
}

function mapEmployeeRecord(data: Record<string, unknown>) {
  const first = String(data.first_name ?? '').trim();
  const last = String(data.last_name ?? '').trim();
  // Family name first (matches app-wide Khmer-style display order).
  const nameEn =
    joinPersonNameParts(first, last).toUpperCase() ||
    String(data.name_en ?? '').trim().toUpperCase() ||
    '—';

  const pos = data.position as { title?: string } | undefined;
  const title =
    (data.position_title as string)?.trim() ||
    pos?.title?.trim() ||
    (data.position_id != null ? String(data.position_id) : '—');

  const phone = String(data.phone ?? '').trim() || '—';
  const telegram =
    String(
      (data.telegram_number as string) ??
        (data.contact_telegram as string) ??
        (data.telegram_username as string) ??
        ''
    ).trim() || '—';

  const nameKh =
    joinPersonNameParts(
      data.first_name_kh as string | null | undefined,
      data.last_name_kh as string | null | undefined
    ) || String((data.name_kh as string) ?? '').trim();
  const avatarResolved = resolveMediaUrl(data.avatar_url as string | null | undefined);

  return {
    employee_id: String(data.employee_id ?? '—'),
    name_en: nameEn,
    name_kh: nameKh,
    position_title: title,
    avatar_url: avatarResolved || '',
    contact_phone: phone,
    contact_telegram: telegram,
    expires_display: formatDefaultExpiryPreview(),
  };
}

function mapIssuedCardRecord(card: Record<string, unknown>) {
  const avatarResolved = resolveMediaUrl(card.avatar_url as string | null | undefined);
  const phone = String(card.contact_phone ?? '').trim() || '—';
  const telegram = String(card.contact_telegram ?? '').trim() || '—';

  return {
    employee_id: String(card.display_employee_id ?? card.employee_id ?? '—'),
    name_en: String(card.name_en ?? '—'),
    name_kh: String(card.name_kh ?? '').trim(),
    position_title: String(card.position_title ?? '—'),
    avatar_url: avatarResolved || '',
    contact_phone: phone,
    contact_telegram: telegram,
    expires_display: formatDateOnlyDisplay(String(card.expire_date ?? '')),
    issued_meta: {
      id: String(card.id ?? ''),
      issue_date: String(card.issue_date ?? ''),
      expire_date: String(card.expire_date ?? ''),
      status: String(card.status ?? ''),
      join_date_snapshot: card.join_date_snapshot != null ? String(card.join_date_snapshot) : '',
    },
  };
}

export type EmployeeCardModalProps = {
  isOpen: boolean;
  onClose: () => void;
  employeeId: string | null;
  initialCardId?: string | null;
};

export const EmployeeCardModal: React.FC<EmployeeCardModalProps> = ({
  isOpen,
  onClose,
  employeeId,
  initialCardId = null,
}) => {
  const fieldUid = useId().replace(/:/g, '');
  const sourceSelectId = `card-source-select-${fieldUid}`;

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [issuedCards, setIssuedCards] = useState<Record<string, unknown>[]>([]);
  const [issuingBusy, setIssuingBusy] = useState(false);
  const [issuedBanner, setIssuedBanner] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [exportPngBusy, setExportPngBusy] = useState(false);
  const [issueConfirmOpen, setIssueConfirmOpen] = useState(false);

  const isIssuedView = Boolean(selectedCardId);
  const flippedRef = useRef(flipped);
  useEffect(() => {
    flippedRef.current = flipped;
  }, [flipped]);

  const cardFrontRef = useRef<HTMLDivElement>(null);
  const cardBackRef = useRef<HTMLDivElement>(null);
  const previewFrontRef = useRef<HTMLCanvasElement>(null);
  const previewBackRef = useRef<HTMLCanvasElement>(null);
  const previewOverlayRef = useRef<HTMLDivElement>(null);
  const previewBitmapsRef = useRef<{
    front: HTMLCanvasElement;
    back: HTMLCanvasElement;
  } | null>(null);

  const [empIdText, setEmpIdText] = useState('—');
  const [nameKh, setNameKh] = useState('');
  const [nameEn, setNameEn] = useState('—');
  const [titleBadge, setTitleBadge] = useState('—');
  const [contactPhone, setContactPhone] = useState('—');
  const [contactTelegram, setContactTelegram] = useState('—');
  const [expireVal, setExpireVal] = useState('—');
  const [avatarHidden, setAvatarHidden] = useState(true);
  const [placeholderHidden, setPlaceholderHidden] = useState(false);
  const [avatarSrc, setAvatarSrc] = useState('');

  const resetTransientState = useCallback(() => {
    setFlipped(false);
    setPreviewOpen(false);
    previewBitmapsRef.current = null;
    setIssueConfirmOpen(false);
    setExportPngBusy(false);
    setLoadError(null);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      resetTransientState();
      removeEmployeeCardPrintHost();
      return;
    }
    setSelectedCardId(initialCardId ?? null);
    resetTransientState();
  }, [isOpen, employeeId, initialCardId, resetTransientState]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && previewOpen) setPreviewOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, previewOpen]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isOpen || !employeeId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError(null);
      setIssuedBanner(null);
      try {
        const listPromise = Api.employees.listIssuedCards(employeeId).catch(() => [] as unknown[]);
        const mainPromise = selectedCardId
          ? Api.employees.getIssuedCard(employeeId, selectedCardId)
          : Api.employees.getById(employeeId);

        const [rawList, rawMain] = await Promise.all([listPromise, mainPromise]);

        const list: Record<string, unknown>[] = Array.isArray(rawList)
          ? (rawList as Record<string, unknown>[])
          : [];
        if (!cancelled) setIssuedCards(list);

        if (selectedCardId) {
          const rawCard = rawMain;
          if (cancelled) return;
          if (!rawCard || typeof rawCard !== 'object') {
            setLoadError('Issued card not found.');
            setLoading(false);
            return;
          }
          const m = mapIssuedCardRecord(rawCard as Record<string, unknown>);
          const meta = m.issued_meta;
          setIssuedBanner(
            `Issued snapshot · ${formatDateOnlyDisplay(meta.issue_date)} → ${formatDateOnlyDisplay(meta.expire_date)} · ${meta.status}`
          );
          setEmpIdText(m.employee_id);
          setNameKh(m.name_kh);
          setNameEn(m.name_en);
          setTitleBadge(m.position_title);
          setContactPhone(m.contact_phone);
          setContactTelegram(m.contact_telegram);
          setExpireVal(m.expires_display);
          if (m.avatar_url) {
            setAvatarSrc(resolveMediaUrl(m.avatar_url) || '');
            setAvatarHidden(true);
            setPlaceholderHidden(false);
          } else {
            setAvatarSrc('');
            setAvatarHidden(true);
            setPlaceholderHidden(false);
          }
        } else {
          const raw = rawMain;
          if (cancelled) return;
          if (!raw || typeof raw !== 'object') {
            setLoadError('Employee not found.');
            setLoading(false);
            return;
          }
          setIssuedBanner(
            list.length > 0
              ? 'Preview only — data comes from the live employee record and is not saved until you issue a card.'
              : 'No card issued yet. Issue a card to save a snapshot and official expiry date.'
          );
          const m = mapEmployeeRecord(raw as Record<string, unknown>);
          setEmpIdText(m.employee_id);
          setNameKh(m.name_kh);
          setNameEn(m.name_en);
          setTitleBadge(m.position_title);
          setContactPhone(m.contact_phone);
          setContactTelegram(m.contact_telegram);
          setExpireVal(m.expires_display);
          if (m.avatar_url) {
            setAvatarSrc(resolveMediaUrl(m.avatar_url) || '');
            setAvatarHidden(true);
            setPlaceholderHidden(false);
          } else {
            setAvatarSrc('');
            setAvatarHidden(true);
            setPlaceholderHidden(false);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Could not load card data.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, employeeId, selectedCardId]);

  const onCardSourceChange = useCallback((next: string) => {
    setSelectedCardId(next || null);
    setFlipped(false);
  }, []);

  const issueNewCard = useCallback(async () => {
    if (!employeeId) return;
    setIssueConfirmOpen(false);
    setIssuingBusy(true);
    setLoadError(null);
    try {
      const created = await Api.employees.issueIssuedCard(employeeId, {
        replace_previous_active: true,
      });
      const id = created && typeof created === 'object' ? String((created as { id?: string }).id ?? '') : '';
      const rawList = await Api.employees.listIssuedCards(employeeId);
      if (Array.isArray(rawList)) setIssuedCards(rawList as Record<string, unknown>[]);
      if (id) setSelectedCardId(id);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not issue card.');
    } finally {
      setIssuingBusy(false);
    }
  }, [employeeId]);

  const activeUnexpiredCards = findActiveUnexpiredCards(issuedCards);
  const hasActiveUnexpired = activeUnexpiredCards.length > 0;
  const earliestActiveExpire = activeUnexpiredCards
    .map((c) => cardExpireYmd(c))
    .filter(Boolean)
    .sort()[0];
  const earliestActiveExpireLabel = earliestActiveExpire
    ? formatDateOnlyDisplay(earliestActiveExpire)
    : null;

  const goToLivePreview = useCallback(() => {
    setSelectedCardId(null);
    setFlipped(false);
  }, []);

  const flipHintText = flipped ? 'Show front' : 'Show back';
  const previewModeLabel = isIssuedView ? 'Issued card' : 'HR draft preview';
  const previewModeHint = isIssuedView
    ? 'Saved snapshot — print or export this version'
    : 'Live employee data — issue to save expiry';

  const flipCard = useCallback(() => {
    setFlipped((f) => !f);
  }, []);

  const captureFrontFace = useCallback(async () => {
    const el = cardFrontRef.current;
    if (!el) throw new Error('Missing front face');
    return captureCardFace(el, 'front');
  }, []);

  const captureBack = useCallback(async () => {
    const el = cardBackRef.current;
    if (!el) throw new Error('Missing back face');
    return captureCardFace(el, 'back');
  }, []);

  const drawCanvas = useCallback((canvasEl: HTMLCanvasElement | null, src: HTMLCanvasElement) => {
    if (!canvasEl) return;
    canvasEl.width = src.width;
    canvasEl.height = src.height;
    const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
    if (ctx) ctx.drawImage(src, 0, 0);
  }, []);

  const openPreview = useCallback(async () => {
    if (actionBusy) return;
    setActionBusy(true);
    setLoadError(null);
    try {
      if (flippedRef.current) {
        setFlipped(false);
        await delay(450);
      }
      await delay(80);
      const front = await captureFrontFace();
      const back = await captureBack();
      previewBitmapsRef.current = { front, back };
      setPreviewOpen(true);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not generate preview.');
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, captureBack, captureFrontFace]);

  const closePreview = useCallback(() => {
    setPreviewOpen(false);
    previewBitmapsRef.current = null;
  }, []);

  // Preview portals to document.body (above the inert page under the modal).
  useEffect(() => {
    if (!previewOpen || !previewBitmapsRef.current) return;
    const { front, back } = previewBitmapsRef.current;
    drawCanvas(previewFrontRef.current, front);
    drawCanvas(previewBackRef.current, back);
  }, [previewOpen, drawCanvas]);

  const settleCardForCapture = useCallback(async () => {
    setExportPngBusy(false);
    setFlipped(false);
    await delay(650);
    await delay(80);
  }, []);

  const exportCard = useCallback(async () => {
    if (actionBusy || exportPngBusy) return;
    setActionBusy(true);
    setExportPngBusy(true);
    setLoadError(null);
    try {
      await delay(900);

      await settleCardForCapture();
      const front = await captureFrontFace();
      const back = await captureBack();
      const base = employeeId ? String(employeeId).replace(/\W+/g, '_') : 'card';
      const suffix = selectedCardId
        ? `${base}_${String(selectedCardId).replace(/-/g, '').slice(0, 10)}`
        : base;

      setExportPngBusy(true);
      await downloadCardFacesZip(front, back, suffix);
      await delay(400);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not export card images.');
    } finally {
      setExportPngBusy(false);
      setFlipped(false);
      setActionBusy(false);
    }
  }, [
    actionBusy,
    captureBack,
    captureFrontFace,
    employeeId,
    exportPngBusy,
    selectedCardId,
    settleCardForCapture,
  ]);

  const printCard = useCallback(async () => {
    if (actionBusy) return;
    setActionBusy(true);
    setLoadError(null);
    removeEmployeeCardPrintHost();
    try {
      if (flippedRef.current) {
        setFlipped(false);
        await delay(450);
      }
      await delay(80);
      const front = await captureFrontFace();
      const back = await captureBack();

      const host = document.createElement('div');
      host.className = EMPLOYEE_CARD_PRINT_HOST_CLASS;
      host.setAttribute('aria-hidden', 'true');

      const imgFront = document.createElement('img');
      imgFront.alt = 'Employee ID card front';
      imgFront.src = front.toDataURL('image/png');

      const imgBack = document.createElement('img');
      imgBack.alt = 'Employee ID card back';
      imgBack.src = back.toDataURL('image/png');

      host.append(imgFront, imgBack);
      document.body.appendChild(host);
      document.body.classList.add(EMPLOYEE_CARD_PRINTING_BODY_CLASS);

      await Promise.all([waitForImage(imgFront), waitForImage(imgBack)]);
      await waitForNextPaint();

      const onAfterPrint = () => {
        removeEmployeeCardPrintHost();
        window.removeEventListener('afterprint', onAfterPrint);
      };
      window.addEventListener('afterprint', onAfterPrint);
      window.print();
    } catch (e) {
      removeEmployeeCardPrintHost();
      setLoadError(e instanceof Error ? e.message : 'Could not prepare print.');
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, captureBack, captureFrontFace]);

  const onPreviewOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === previewOverlayRef.current) closePreview();
    },
    [closePreview]
  );

  const handleClose = useCallback(() => {
    if (actionBusy || issuingBusy || previewOpen || issueConfirmOpen || exportPngBusy) return;
    onClose();
  }, [actionBusy, issuingBusy, previewOpen, issueConfirmOpen, exportPngBusy, onClose]);

  if (!isOpen || !employeeId) return null;

  const modalSubtitle = loading ? 'Loading employee record…' : `${nameEn} · ${empIdText}`;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title="Employee ID Card"
        description={modalSubtitle}
        size="wide"
        dialogClassName="employee-card-modal-dialog"
        contentClassName="employee-card-modal-body"
        disableClose={actionBusy || issuingBusy || previewOpen || issueConfirmOpen || exportPngBusy}
      >
        {loadError && (
          <div
            className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
            role="alert"
          >
            {loadError}
          </div>
        )}

        {loading && !loadError && (
          <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-slate-200/90 bg-white dark:border-slate-700 dark:bg-slate-900/50">
            <div className="flex flex-col items-center gap-3 text-slate-500">
              <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
              <p className="text-sm font-medium">Loading card data…</p>
            </div>
          </div>
        )}

        {!loading && !loadError && (
          <div className="employee-card-page-grid employee-card-modal-grid print:block">
            <aside className="employee-card-panel print:hidden">
              <div className="employee-card-panel-head">
                <div className="space-y-1">
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">ID card workflow</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Review, issue a snapshot, then print or export.
                  </p>
                </div>
                {isIssuedView ? (
                  <StatusLabel status="active" label="Issued" semantic="success" size="sm" />
                ) : (
                  <StatusLabel status="draft" label="Draft" semantic="inProgress" size="sm" />
                )}
              </div>

              <div className="employee-card-workflow-step">
                <span className="employee-card-workflow-step__num">1</span>
                <div className="employee-card-workflow-step__body">
                  <label htmlFor={sourceSelectId} className="employee-card-workflow-step__title">
                    Card source
                  </label>
                  <select
                    id={sourceSelectId}
                    className="employee-card-select w-full"
                    value={selectedCardId ?? ''}
                    onChange={(e) => onCardSourceChange(e.target.value)}
                  >
                    <option value="">Live HR record (draft preview)</option>
                    {issuedCards.map((row) => {
                      const id = String(row.id ?? '');
                      const issuedRaw = String(row.issue_date ?? '');
                      const issued = formatDateOnlyDisplay(issuedRaw);
                      const st = String(row.status ?? '');
                      return (
                        <option key={id} value={id}>
                          Issued {issued} · {st}
                        </option>
                      );
                    })}
                  </select>
                  {issuedBanner && (
                    <p
                      className={
                        isIssuedView
                          ? 'employee-card-context employee-card-context--issued'
                          : 'employee-card-context employee-card-context--draft'
                      }
                    >
                      {issuedBanner}
                    </p>
                  )}
                </div>
              </div>

              <div className="employee-card-workflow-step">
                <span className="employee-card-workflow-step__num">2</span>
                <div className="employee-card-workflow-step__body space-y-2">
                  <p className="employee-card-workflow-step__title">Issue snapshot</p>
                  {isIssuedView ? (
                    <>
                      <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                        You are viewing a saved card. To issue a new one, the system snapshots today&apos;s live HR
                        record — not this archived version.
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={goToLivePreview}
                        >
                          <Sparkles className="w-4 h-4 mr-2" />
                          View live HR
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="flex-1"
                          disabled={issuingBusy || !employeeId}
                          onClick={() => setIssueConfirmOpen(true)}
                        >
                          {issuingBusy ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Plus className="w-4 h-4 mr-2" />
                          )}
                          Issue from HR
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                        Saves name, photo, position, and contacts with a one-year expiry date.
                      </p>
                      <Button
                        type="button"
                        className="w-full"
                        disabled={issuingBusy || !employeeId}
                        onClick={() => setIssueConfirmOpen(true)}
                      >
                        {issuingBusy ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <ShieldCheck className="w-4 h-4 mr-2" />
                        )}
                        {issuingBusy ? 'Issuing…' : 'Issue card'}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div className="employee-card-workflow-step">
                <span className="employee-card-workflow-step__num">3</span>
                <div className="employee-card-workflow-step__body">
                  <p className="employee-card-workflow-step__title">Print &amp; export</p>
                  <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    PNG downloads a ZIP with separate front and back images.
                  </p>
                  <div className="employee-card-output-actions">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="employee-card-output-btn"
                      disabled={actionBusy}
                      onClick={() => void openPreview()}
                    >
                      {actionBusy && !exportPngBusy ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FileText className="w-4 h-4" />
                      )}
                      Preview
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="employee-card-output-btn"
                      disabled={actionBusy}
                      onClick={() => void printCard()}
                    >
                      {actionBusy && !exportPngBusy ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Printer className="w-4 h-4" />
                      )}
                      Print
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="employee-card-output-btn"
                      disabled={actionBusy}
                      onClick={() => void exportCard()}
                    >
                      {exportPngBusy ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      PNG
                    </Button>
                  </div>
                </div>
              </div>

              <dl className="employee-card-meta">
                <div>
                  <dt>Display ID</dt>
                  <dd>{empIdText}</dd>
                </div>
                <div>
                  <dt>Position</dt>
                  <dd>{titleBadge}</dd>
                </div>
                <div>
                  <dt>{isIssuedView ? 'Expires' : 'Expiry (preview)'}</dt>
                  <dd>{expireVal}</dd>
                </div>
              </dl>
            </aside>

            <section className="employee-card-stage employee-card-stage--modal print:hidden">
              <div className="employee-card-stage-header print:hidden">
                <div className="employee-card-stage-title">
                  <span className="employee-card-stage-label">{previewModeLabel}</span>
                  <span className="employee-card-stage-hint">{previewModeHint}</span>
                </div>
                <button
                  type="button"
                  className="employee-card-flip-chip"
                  onClick={flipCard}
                  disabled={exportPngBusy}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {exportPngBusy ? 'Exporting…' : flipHintText}
                </button>
              </div>

              <div className="employee-card-root">
                <div className="scene">
                  <div className={`card-wrap${flipped ? ' flipped' : ''}${exportPngBusy ? ' export-flipping' : ''}`}>
                    <div ref={cardFrontRef} className="card-face card-front">
                      <div className="wave-top">
                        <svg viewBox="0 0 320 160" preserveAspectRatio="none">
                          <path
                            d="M0,0 L320,0 L320,100 Q260,140 160,110 Q80,85 0,130 Z"
                            fill="#b8d4e8"
                            opacity=".6"
                          />
                          <path
                            d="M0,0 L320,0 L320,80 Q220,120 120,95 Q50,78 0,105 Z"
                            fill="#a8c8e0"
                            opacity=".5"
                          />
                        </svg>
                      </div>
                      <div className="logo-area">
                        <div className="logo-text">ROC</div>
                        <div className="logo-sub">Labour &amp; Human Resource Consulting</div>
                      </div>
                      <div className="front-body">
                        <div className="front-stack">
                          <div className="avatar-ring">
                            <div className="avatar-inner">
                              <img
                                className="avatar-img"
                                src={avatarSrc || undefined}
                                alt={nameEn}
                                hidden={avatarHidden}
                                crossOrigin="anonymous"
                                referrerPolicy="no-referrer"
                                onLoad={() => {
                                  setAvatarHidden(false);
                                  setPlaceholderHidden(true);
                                }}
                                onError={() => {
                                  setAvatarHidden(true);
                                  setPlaceholderHidden(false);
                                }}
                              />
                              <div className="avatar-placeholder" hidden={placeholderHidden} aria-hidden>
                                <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                                  <circle cx="32" cy="24" r="12" fill="#6b5b95" />
                                  <path
                                    d="M8 58c0-13.255 10.745-24 24-24s24 10.745 24 24"
                                    fill="#6b5b95"
                                  />
                                </svg>
                              </div>
                            </div>
                          </div>
                          <div className="emp-id-pill">
                            <div className="emp-id-dot" />
                            <span className="emp-id-text">{empIdText}</span>
                          </div>
                          <div className="name-kh">{nameKh}</div>
                          <div className="name-en">{nameEn}</div>
                          <div className="title-badge">{titleBadge}</div>
                        </div>
                      </div>
                      <div className="wave-bottom">
                        <svg viewBox="0 0 320 110" preserveAspectRatio="none">
                          <path
                            d="M0,50 Q80,10 160,40 Q240,70 320,30 L320,110 L0,110 Z"
                            fill="#0078C1"
                            opacity=".5"
                          />
                          <path
                            d="M0,65 Q80,25 160,55 Q240,85 320,50 L320,110 L0,110 Z"
                            fill="#0fa8c8"
                          />
                        </svg>
                      </div>
                    </div>

                    <div ref={cardBackRef} className="card-face card-back">
                      <div className="back-header">
                        <div className="back-logo">ROC</div>
                        <div className="back-sub">Labour &amp; Human Resource Consulting</div>
                      </div>

                      <div className="back-main">
                        <div className="back-stack">
                          <div className="back-qr-block">
                            <div className="back-qr-frame">
                              {empIdText && empIdText !== '—' ? (
                                <QRCodeSVG
                                  value={buildStaffVerifyUrl(empIdText)}
                                  size={136}
                                  level="H"
                                  includeMargin
                                  bgColor="#ffffff"
                                  fgColor="#0f2a38"
                                />
                              ) : (
                                <div className="back-qr-placeholder">No ID</div>
                              )}
                            </div>
                            <div className="back-qr-empid">{empIdText}</div>
                          </div>

                          <div className="back-contacts">
                            <div className="contact-row">
                              <div className="contact-icon phone">
                                <svg viewBox="0 0 24 24">
                                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.87 9.81a19.79 19.79 0 01-3.07-8.68A2 2 0 012.8 1h3a2 2 0 012 1.72c.13 1 .37 1.97.72 2.9a2 2 0 01-.45 2.11L6.91 8.9a16 16 0 006.19 6.19l1.17-1.16a2 2 0 012.11-.45c.93.35 1.9.59 2.9.72A2 2 0 0122 16.92z" />
                                </svg>
                              </div>
                              <div className="contact-text">
                                <span className="contact-label">Phone</span>
                                <span className="contact-val">{contactPhone}</span>
                              </div>
                            </div>
                            <div className="contact-row">
                              <div className="contact-icon tele">
                                <svg viewBox="0 0 24 24">
                                  <path d="M22 2L11 13" />
                                  <path d="M22 2L15 22 11 13 2 9l20-7z" />
                                </svg>
                              </div>
                              <div className="contact-text">
                                <span className="contact-label">Telegram</span>
                                <span className="contact-val">{contactTelegram}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="back-footer">
                        <div className="expire-badge">
                          <div className="expire-label">Expires</div>
                          <div className="expire-val">{expireVal}</div>
                        </div>
                      </div>

                      <div className="back-wave" aria-hidden>
                        <svg viewBox="0 0 320 100" preserveAspectRatio="none">
                          <path
                            d="M0,40 Q80,10 160,35 Q240,60 320,28 L320,100 L0,100 Z"
                            fill="#0078C1"
                            opacity=".4"
                          />
                          <path
                            d="M0,55 Q80,25 160,50 Q240,75 320,45 L320,100 L0,100 Z"
                            fill="#0fa8c8"
                          />
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </Modal>

      {previewOpen &&
        createPortal(
          <div
            ref={previewOverlayRef}
            className="employee-card-preview-overlay active"
            onClick={onPreviewOverlayClick}
            role="dialog"
            aria-modal="true"
            aria-labelledby="employee-card-preview-title"
          >
            <div
              className="employee-card-preview-box"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="employee-card-preview-title">Card Preview</h2>
              <div className="preview-canvases">
                <div>
                  <p className="preview-label">FRONT</p>
                  <canvas ref={previewFrontRef} />
                </div>
                <div>
                  <p className="preview-label">BACK</p>
                  <canvas ref={previewBackRef} />
                </div>
              </div>
              <button
                type="button"
                className="employee-card-preview-close"
                onClick={closePreview}
              >
                Close
              </button>
            </div>
          </div>,
          document.body
        )}

      <ConfirmDialog
        open={issueConfirmOpen}
        onClose={() => setIssueConfirmOpen(false)}
        title={
          hasActiveUnexpired
            ? 'Issue a new card while one is still valid?'
            : 'Issue employee ID card?'
        }
        description={
          hasActiveUnexpired
            ? 'A previous ID card is still active and has not expired yet. Issuing a new snapshot will mark that card as replaced and save today’s live HR record with a new one-year expiry.'
            : 'This saves a snapshot of the employee’s current HR record (name, photo, position, and contacts) with an expiry date one year from today. The live employee record is not changed.'
        }
        variant={hasActiveUnexpired ? 'danger' : 'success'}
        confirmLabel={hasActiveUnexpired ? 'Issue anyway' : 'Issue card'}
        confirmIcon={
          hasActiveUnexpired ? (
            <AlertTriangle className="w-4 h-4" />
          ) : (
            <ShieldCheck className="w-4 h-4" />
          )
        }
        loading={issuingBusy}
        onConfirm={() => issueNewCard()}
        extraContent={
          hasActiveUnexpired ? (
            <div
              className="mb-1 rounded-xl border border-amber-300/80 bg-amber-50 px-3.5 py-3 text-left dark:border-amber-700/60 dark:bg-amber-950/40"
              role="alert"
            >
              <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">
                Previous card is not expired yet
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-900/90 dark:text-amber-200/90">
                {activeUnexpiredCards.length === 1
                  ? earliestActiveExpireLabel
                    ? `The current active card remains valid until ${earliestActiveExpireLabel}.`
                    : 'There is already an active card on file.'
                  : earliestActiveExpireLabel
                    ? `${activeUnexpiredCards.length} active cards are still valid (earliest expiry ${earliestActiveExpireLabel}).`
                    : `${activeUnexpiredCards.length} active cards are still on file.`}{' '}
                Continue only if you intend to replace {activeUnexpiredCards.length === 1 ? 'it' : 'them'}.
              </p>
            </div>
          ) : null
        }
      />
    </>
  );
};
