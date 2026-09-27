import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  startIdleLock, idleExpired, readAutoLockMinutes, writeAutoLockMinutes,
  AUTO_LOCK_PREF_KEY, LAST_ACTIVITY_KEY, DEFAULT_AUTO_LOCK_MINUTES,
} from '../security/auto-lock';

function memStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    map: m,
  };
}

/** A window/document stand-in whose clock the test controls. */
function harness(minutes = 5) {
  let t = 1_000_000;
  const target = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as string });
  const session = memStore();
  const onLock = vi.fn();
  const stop = startIdleLock({
    minutes: () => minutes, onLock, target, doc, session, now: () => t, checkEveryMs: 1_000,
  });
  return {
    onLock, stop, session, doc,
    advance: (ms: number) => { t += ms; },
    input: (type = 'pointerdown') => target.dispatchEvent(new Event(type)),
    tick: () => vi.advanceTimersByTime(1_000),
    setMinutes: (m: number) => { minutes = m; },
  };
}

afterEach(() => { vi.useRealTimers(); });

describe('auto-lock preference', () => {
  it('defaults when unset or invalid, and round-trips valid choices', () => {
    expect(readAutoLockMinutes(memStore())).toBe(DEFAULT_AUTO_LOCK_MINUTES);
    expect(readAutoLockMinutes(memStore({ [AUTO_LOCK_PREF_KEY]: '7' }))).toBe(DEFAULT_AUTO_LOCK_MINUTES);
    expect(readAutoLockMinutes(null)).toBe(DEFAULT_AUTO_LOCK_MINUTES);
    const s = memStore();
    writeAutoLockMinutes(s, 0);
    expect(readAutoLockMinutes(s)).toBe(0);
    writeAutoLockMinutes(s, 60);
    expect(readAutoLockMinutes(s)).toBe(60);
  });
});

describe('idleExpired', () => {
  it('compares the stored last activity with the timeout, failing closed', () => {
    const now = 10_000_000;
    expect(idleExpired(memStore({ [LAST_ACTIVITY_KEY]: String(now - 4 * 60_000) }), 5, now)).toBe(false);
    expect(idleExpired(memStore({ [LAST_ACTIVITY_KEY]: String(now - 6 * 60_000) }), 5, now)).toBe(true);
    expect(idleExpired(memStore(), 5, now)).toBe(true);                      // no timestamp
    expect(idleExpired(memStore({ [LAST_ACTIVITY_KEY]: 'x' }), 5, now)).toBe(true);
    expect(idleExpired(memStore(), 0, now)).toBe(false);                     // never
  });
});

describe('startIdleLock', () => {
  it('locks once the timeout passes without input, and not before', () => {
    vi.useFakeTimers();
    const h = harness(5);
    h.advance(4 * 60_000); h.tick();
    expect(h.onLock).not.toHaveBeenCalled();
    h.advance(61_000); h.tick();
    expect(h.onLock).toHaveBeenCalledTimes(1);
    h.advance(10 * 60_000); h.tick();
    expect(h.onLock).toHaveBeenCalledTimes(1); // stopped itself
  });

  it('input resets the clock and is recorded for reload checks', () => {
    vi.useFakeTimers();
    const h = harness(5);
    h.advance(4 * 60_000); h.input('keydown'); h.tick();
    h.advance(4 * 60_000); h.tick();
    expect(h.onLock).not.toHaveBeenCalled();
    expect(Number(h.session.map.get(LAST_ACTIVITY_KEY))).toBe(1_000_000 + 4 * 60_000);
  });

  it('input after the timeout already passed locks instead of resetting (sleep / throttled timers)', () => {
    vi.useFakeTimers();
    const h = harness(5);
    h.advance(2 * 60 * 60_000); // no interval tick ran while "asleep"
    h.input('pointermove');
    expect(h.onLock).toHaveBeenCalledTimes(1);
  });

  it('checks when the page becomes visible again', () => {
    vi.useFakeTimers();
    const h = harness(5);
    h.doc.visibilityState = 'hidden';
    h.advance(30 * 60_000);
    h.doc.visibilityState = 'visible';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    expect(h.onLock).toHaveBeenCalledTimes(1);
  });

  it('never locks with 0 minutes, and picks up a changed setting', () => {
    vi.useFakeTimers();
    const h = harness(0);
    h.advance(24 * 60 * 60_000); h.tick();
    expect(h.onLock).not.toHaveBeenCalled();
    h.setMinutes(1); h.tick();
    expect(h.onLock).toHaveBeenCalledTimes(1);
  });

  it('stop() detaches everything', () => {
    vi.useFakeTimers();
    const h = harness(1);
    h.stop();
    h.advance(10 * 60_000); h.tick(); h.input();
    expect(h.onLock).not.toHaveBeenCalled();
  });
});
