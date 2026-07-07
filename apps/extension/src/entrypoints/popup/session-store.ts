/**
 * Session-key persistence for the popup — survives popup close.
 *
 * THE BUG THIS FIXES: the popup cached the derived AES key in `sessionStorage`,
 * which is destroyed every time the popup closes. So on every reopen the key was
 * gone and the user was re-prompted for their password — "session expires too
 * quickly". This persists the key in `chrome.storage.session` (kept until the
 * BROWSER closes) with an expiry based on the user's chosen duration. 'never'
 * mirrors to `chrome.storage.local` so it survives a browser restart.
 *
 * SECURITY: while unlocked, the raw AES key lives in extension storage — that is
 * the point of "stay unlocked". Default is 1h in storage.session (RAM-backed,
 * never written to disk, cleared on browser close). 'never' writes to
 * storage.local (disk) and is an explicit user opt-in.
 *
 * Uses a SLIDING window: each successful use renews the expiry, so an active
 * user stays unlocked and an idle one locks after the chosen duration.
 */

export type SessionDuration = '15m' | '1h' | '4h' | 'until-close' | 'never';

export const SESSION_DURATION_OPTIONS: Array<{ value: SessionDuration; label: string }> = [
  { value: '15m',         label: '15 minutes' },
  { value: '1h',          label: '1 hour' },
  { value: '4h',          label: '4 hours' },
  { value: 'until-close', label: 'Until browser closes' },
  { value: 'never',       label: 'Never (stay unlocked)' },
];

const DEFAULT_DURATION: SessionDuration = '1h';

const DUR_MS: Record<'15m' | '1h' | '4h', number> = {
  '15m': 15 * 60_000,
  '1h':  60 * 60_000,
  '4h':  4 * 60 * 60_000,
};

const PREF_KEY    = 'thanos.session_duration';    // storage.local — the chosen pref
const KEY_SESSION = 'thanos.session_key_v2';      // storage.session — { keyHex, expiresAt }
const KEY_LOCAL   = 'thanos.session_key_persist'; // storage.local  — only for 'never'

interface KeyRecord { keyHex: string; expiresAt: number | null } // null = no expiry

function toHex(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, '0');
  return out;
}
function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function isDuration(v: unknown): v is SessionDuration {
  return v === '15m' || v === '1h' || v === '4h' || v === 'until-close' || v === 'never';
}

export async function getSessionDuration(): Promise<SessionDuration> {
  try {
    const r = await browser.storage.local.get(PREF_KEY);
    const v = (r as Record<string, unknown>)[PREF_KEY];
    return isDuration(v) ? v : DEFAULT_DURATION;
  } catch { return DEFAULT_DURATION; }
}

export async function setSessionDuration(d: SessionDuration): Promise<void> {
  try { await browser.storage.local.set({ [PREF_KEY]: d }); } catch { /* best-effort */ }
}

/** Persist the derived key according to the current duration pref. */
export async function persistSessionKey(key: Uint8Array): Promise<void> {
  const dur = await getSessionDuration();
  const keyHex = toHex(key);
  try {
    if (dur === 'never') {
      await browser.storage.local.set({ [KEY_LOCAL]: { keyHex, expiresAt: null } satisfies KeyRecord });
      await browser.storage.session.remove(KEY_SESSION).catch(() => {});
    } else {
      const expiresAt = dur === 'until-close' ? null : Date.now() + DUR_MS[dur];
      await browser.storage.session.set({ [KEY_SESSION]: { keyHex, expiresAt } satisfies KeyRecord });
      await browser.storage.local.remove(KEY_LOCAL).catch(() => {});
    }
  } catch { /* best-effort — worst case the user re-enters the password */ }
}

/** Load the persisted key if present and unexpired. Renews the sliding window. */
export async function loadPersistedSessionKey(): Promise<Uint8Array | null> {
  try {
    let rec: KeyRecord | undefined;
    const s = await browser.storage.session.get(KEY_SESSION);
    rec = (s as Record<string, unknown>)[KEY_SESSION] as KeyRecord | undefined;
    if (!rec) {
      const l = await browser.storage.local.get(KEY_LOCAL);
      rec = (l as Record<string, unknown>)[KEY_LOCAL] as KeyRecord | undefined;
    }
    if (!rec?.keyHex) return null;

    if (rec.expiresAt != null && Date.now() > rec.expiresAt) {
      await clearPersistedSessionKey();
      return null;
    }
    const key = fromHex(rec.keyHex);

    // Sliding renewal for the timed durations (leave 'until-close'/'never' as-is).
    if (rec.expiresAt != null) {
      const dur = await getSessionDuration();
      if (dur === '15m' || dur === '1h' || dur === '4h') {
        await browser.storage.session
          .set({ [KEY_SESSION]: { keyHex: rec.keyHex, expiresAt: Date.now() + DUR_MS[dur] } satisfies KeyRecord })
          .catch(() => {});
      }
    }
    return key;
  } catch { return null; }
}

export async function clearPersistedSessionKey(): Promise<void> {
  try { await browser.storage.session.remove(KEY_SESSION); } catch { /* ignore */ }
  try { await browser.storage.local.remove(KEY_LOCAL); } catch { /* ignore */ }
}
