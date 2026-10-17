/** Cambodia business timezone — aligns schedulers with payroll / attendance. */
export const BUSINESS_TIMEZONE = 'Asia/Phnom_Penh';

/** YYYY-MM-DD in business timezone. */
export function businessDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE }).format(date);
}

function phnomPenhHms(date = new Date()): { hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hour: pick('hour'), minute: pick('minute'), second: pick('second') };
}

/** Milliseconds until the next 00:00 in Phnom Penh. */
export function msUntilNextBusinessMidnight(from = new Date()): number {
  const { hour, minute, second } = phnomPenhHms(from);
  const elapsedMs = ((hour * 60 + minute) * 60 + second) * 1000;
  const remaining = 24 * 60 * 60 * 1000 - elapsedMs;
  return remaining > 0 ? remaining : 24 * 60 * 60 * 1000;
}

export type DailyJobHandle = {
  runNow: () => Promise<void>;
  stop: () => void;
};

/**
 * Register a job that runs daily at 00:00 (Asia/Phnom_Penh).
 * Also runs once immediately on registration (startup catch-up).
 */
export function scheduleDailyAtBusinessMidnight(
  name: string,
  job: () => Promise<void>
): DailyJobHandle {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const run = async () => {
    try {
      await job();
    } catch (err) {
      console.warn(
        `[scheduler:${name}] Job failed:`,
        err instanceof Error ? err.message : err
      );
    }
  };

  const scheduleNext = () => {
    if (stopped) return;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      void run().finally(() => {
        if (!stopped) {
          interval = setInterval(() => void run(), 24 * 60 * 60 * 1000);
        }
      });
    }, msUntilNextBusinessMidnight());
  };

  void run();
  scheduleNext();

  return {
    runNow: run,
    stop: () => {
      stopped = true;
      if (timeout) clearTimeout(timeout);
      if (interval) clearInterval(interval);
    },
  };
}
