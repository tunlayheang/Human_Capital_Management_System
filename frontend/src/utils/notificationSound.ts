const MUTE_KEY_PREFIX = 'hcms_notification_sound_muted:';

type ToneKind = 'notification' | 'chat';

let sharedCtx: AudioContext | null = null;
let unlockBound = false;
/** Set only inside a trusted user-gesture handler — never create AudioContext before this. */
let gestureUnlocked = false;

function getAudioContextCtor(): (typeof AudioContext) | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  );
}

function getOrCreateAudioContext(): AudioContext | null {
  if (!gestureUnlocked) return null;
  if (sharedCtx) return sharedCtx;
  const Ctx = getAudioContextCtor();
  if (!Ctx) return null;
  try {
    sharedCtx = new Ctx();
  } catch {
    return null;
  }
  return sharedCtx;
}

/**
 * Resume (or prepare) notification audio. Safe anytime — never constructs
 * AudioContext until a trusted user gesture has occurred.
 */
export function unlockNotificationAudio(): void {
  if (sharedCtx?.state === 'suspended') {
    void sharedCtx.resume().catch(() => {});
    return;
  }
  bindAudioUnlockOnce();
}

function onTrustedGesture(event: Event): void {
  if (!event.isTrusted) return;
  gestureUnlocked = true;
  const ctx = getOrCreateAudioContext();
  if (ctx?.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }
  window.removeEventListener('pointerdown', onTrustedGesture);
  window.removeEventListener('keydown', onTrustedGesture);
  window.removeEventListener('touchstart', onTrustedGesture);
  unlockBound = false;
}

function bindAudioUnlockOnce(): void {
  if (gestureUnlocked || unlockBound || typeof window === 'undefined') return;
  unlockBound = true;
  window.addEventListener('pointerdown', onTrustedGesture, { once: true, passive: true });
  window.addEventListener('keydown', onTrustedGesture, { once: true });
  window.addEventListener('touchstart', onTrustedGesture, { once: true, passive: true });
}

function playTone(kind: ToneKind): void {
  try {
    if (!gestureUnlocked) {
      bindAudioUnlockOnce();
      return;
    }
    const ctx = getOrCreateAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
      return;
    }

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    if (kind === 'notification') {
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

      const o1 = ctx.createOscillator();
      o1.type = 'sine';
      o1.frequency.setValueAtTime(880, now);
      o1.connect(gain);
      o1.start(now);
      o1.stop(now + 0.18);

      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.setValueAtTime(1175, now + 0.16);
      o2.connect(gain);
      o2.start(now + 0.16);
      o2.stop(now + 0.5);
      return;
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1046, now);
    o.frequency.exponentialRampToValueAtTime(784, now + 0.22);
    o.connect(gain);
    o.start(now);
    o.stop(now + 0.35);
  } catch {
    /* autoplay policy or unsupported */
  }
}

/** Portal / bell notifications */
export function playPortalNotificationSound(): void {
  playTone('notification');
}

/** Incoming chat message */
export function playChatNotificationSound(): void {
  playTone('chat');
}

export function readNotificationSoundMuted(userId: string | undefined): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(MUTE_KEY_PREFIX + userId) === '1';
  } catch {
    return false;
  }
}

export function writeNotificationSoundMuted(userId: string | undefined, muted: boolean): void {
  if (!userId) return;
  try {
    localStorage.setItem(MUTE_KEY_PREFIX + userId, muted ? '1' : '0');
  } catch {
    /* ignore */
  }
}
