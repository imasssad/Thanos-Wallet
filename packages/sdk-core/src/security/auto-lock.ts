/**
 * Inactivity auto-lock for the browser-based clients (web, desktop renderer).
 *
 * "Lock after N minutes of inactivity": pointer, key, wheel and touch input
 * count as activity. Idle time is measured from timestamps rather than one
 * long setTimeout, so a throttled background tab or a laptop that slept with
 * the wallet open still locks on time:
 *   - a check runs every few seconds and again when the page becomes visible;
 *   - input that arrives after the timeout has already passed locks instead of
 *     resetting the clock (the first mouse move after waking the machine must
 *     not keep the wallet open).
 *
 * The last-activity time is also written to sessionStorage, beside the cached
 * vault key it guards: a reload after the timeout must not quietly reopen the
 * vault from that key, so the unlock-on-load path asks idleExpired() first.
 */

/** localStorage: the chosen timeout in minutes ("0" = never). */
export const AUTO_LOCK_PREF_KEY = 'thanos.autolock_minutes';
/** sessionStorage: epoch ms of the last input while unlocked. */
export const LAST_ACTIVITY_KEY = 'thanos.last_activity';
export const DEFAULT_AUTO_LOCK_MINUTES = 15;
export const AUTO_LOCK_CHOICES: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 1, label: '1 minute' },
  { minutes: 5, label: '5 minutes' },
  { minutes: 15, label: '15 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 0, label: 'Never (not recommended)' },
];
/** What "Never" means, for the settings row while it's selected. */
export const AUTO_LOCK_OFF_NOTE =
  'The wallet stays unlocked until you lock it yourself or close the app, so anyone who can ' +
  'use this device can see your balances and approve transactions.';
/** What to confirm before a user turns auto-lock off. */
export const AUTO_LOCK_NEVER_WARNING = `Turn off auto-lock? ${AUTO_LOCK_OFF_NOTE}`;

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;

/** The saved timeout, or the default if nothing valid is saved. */
export function readAutoLockMinutes(store: Reader | null | undefined): number {
  try {
    const raw = store?.getItem(AUTO_LOCK_PREF_KEY);
    if (raw == null) return DEFAULT_AUTO_LOCK_MINUTES;
    const n = Number(raw);
    return AUTO_LOCK_CHOICES.some((c) => c.minutes === n) ? n : DEFAULT_AUTO_LOCK_MINUTES;
  } catch {
    return DEFAULT_AUTO_LOCK_MINUTES;
  }
}

export function writeAutoLockMinutes(store: Writer | null | undefined, minutes: number): void {
  try { store?.setItem(AUTO_LOCK_PREF_KEY, String(minutes)); } catch { /* storage unavailable */ }
}

/** True when the unlocked session has been idle past the timeout, judged by
 *  the last-activity time in `session`. A missing or unreadable timestamp
 *  counts as expired (fail closed); `minutes` 0 never expires. */
export function idleExpired(session: Reader | null | undefined, minutes: number, now: number = Date.now()): boolean {
  if (!minutes) return false;
  let t = NaN;
  try {
    const raw = session?.getItem(LAST_ACTIVITY_KEY);
    t = raw == null ? NaN : Number(raw);
  } catch { /* unreadable → expired */ }
  return !Number.isFinite(t) || now - t > minutes * 60_000;
}

type Listenable = {
  addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions | boolean): void;
  removeEventListener(type: string, listener: () => void, options?: EventListenerOptions | boolean): void;
};

export interface IdleLockOptions {
  /** Current timeout in minutes (0 = never). Read at every check, so a changed
   *  setting applies without restarting. */
  minutes: () => number;
  /** Called once when the timeout passes; the watcher stops itself first. */
  onLock: () => void;
  /** Where input is observed — `window`. */
  target: Listenable;
  /** For `visibilitychange` — `document`. */
  doc?: Listenable & { visibilityState?: string };
  /** Where the last-activity time is kept — `sessionStorage`. */
  session?: Pick<Storage, 'setItem'> | null;
  now?: () => number;
  checkEveryMs?: number;
}

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
const PERSIST_EVERY_MS = 5_000;

/** Start watching for inactivity. Returns a stop function. */
export function startIdleLock(o: IdleLockOptions): () => void {
  const now = o.now ?? Date.now;
  let last = now();
  let lastWrite = -Infinity;
  let stopped = false;

  const persist = (t: number) => {
    if (t - lastWrite < PERSIST_EVERY_MS) return;
    lastWrite = t;
    try { o.session?.setItem(LAST_ACTIVITY_KEY, String(t)); } catch { /* storage unavailable */ }
  };
  const expired = (t: number) => {
    const m = o.minutes();
    return m > 0 && t - last > m * 60_000;
  };
  const lockNow = () => { stop(); o.onLock(); };

  const onActivity = () => {
    if (stopped) return;
    const t = now();
    if (expired(t)) { lockNow(); return; }
    last = t;
    persist(t);
  };
  const check = () => {
    if (!stopped && expired(now())) lockNow();
  };
  const onVisibility = () => {
    if (o.doc?.visibilityState === undefined || o.doc.visibilityState === 'visible') check();
  };

  for (const ev of ACTIVITY_EVENTS) o.target.addEventListener(ev, onActivity, { capture: true, passive: true });
  o.doc?.addEventListener('visibilitychange', onVisibility);
  const timer = setInterval(check, o.checkEveryMs ?? 5_000);
  persist(last);

  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    for (const ev of ACTIVITY_EVENTS) o.target.removeEventListener(ev, onActivity, { capture: true });
    o.doc?.removeEventListener('visibilitychange', onVisibility);
  }
  return stop;
}
