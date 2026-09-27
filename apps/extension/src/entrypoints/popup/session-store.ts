/**
 * Session-key persistence for the popup — survives popup close.
 *
 * THE BUG THIS FIXES: the popup cached the derived AES key in `sessionStorage`,
 * which is destroyed every time the popup closes. So on every reopen the key was
 * gone and the user was re-prompted for their password — "session expires too
 * quickly". This persists the key in `chrome.storage.session` (kept until the
 * BROWSER closes) with an expiry based on the user's chosen duration.
 *
 * SECURITY: while unlocked, the raw AES key lives in extension storage — that is
 * the point of "stay unlocked". It only ever goes to storage.session (RAM-backed,
 * never written to disk, cleared on browser close); default 1h. There is no
 * "Never" option any more: it copied the key to storage.local — on disk, right
 * beside the vault it decrypts — which removed encryption at rest. A copy left
 * by an older build is deleted on the next load, and a saved 'never' preference
 * reads as 'until-close'.
 *
 * Uses a SLIDING window: each successful use renews the expiry, so an active
 * user stays unlocked and an idle one locks after the chosen duration.
 */

export type SessionDuration = '15m' | '1h' | '4h' | 'until-close';

export const SESSION_DURATION_OPTIONS: Array<{ value: SessionDuration; label: string }> = [
  { value: '15m',         label: '15 minutes' },
  { value: '1h',          label: '1 hour' },
  { value: '4h',          label: '4 hours' },
  { value: 'until-close', label: 'Until browser closes' },
];

const DEFAULT_DURATION: SessionDuration = '1h';

const DUR_MS: Record<'15m' | '1h' | '4h', number> = {
  '15m': 15 * 60_000,
  '1h':  60 * 60_000,
  '4h':  4 * 60 * 60_000,
};

const PREF_KEY    = 'thanos.session_duration';    // storage.local — the chosen pref
const KEY_SESSION = 'thanos.session_key_v2';      // storage.session — { keyHex, expiresAt }
const KEY_LOCAL   = 'thanos.session_key_persist'; // storage.local — legacy 'never' copy, purged on sight

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
  return v === '15m' || v === '1h' || v === '4h' || v === 'until-close';
}

/** Delete the on-disk key copy older builds wrote for 'never'. */
async function purgeLegacyDiskKey(): Promise<void> {
  try { await browser.storage.local.remove(KEY_LOCAL); } catch { /* ignore */ }
}

export async function getSessionDuration(): Promise<SessionDuration> {
  try {
    const r = await browser.storage.local.get(PREF_KEY);
    const v = (r as Record<string, unknown>)[PREF_KEY];
    if (v === 'never') return 'until-close'; // retired option — nearest that stays off disk
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
  await purgeLegacyDiskKey();
  try {
    const expiresAt = dur === 'until-close' ? null : Date.now() + DUR_MS[dur];
    await browser.storage.session.set({ [KEY_SESSION]: { keyHex, expiresAt } satisfies KeyRecord });
  } catch { /* best-effort — worst case the user re-enters the password */ }
}

/** Load the persisted key if present and unexpired. Renews the sliding window.
 *  Never reads (and always deletes) an on-disk copy left by an older build. */
export async function loadPersistedSessionKey(): Promise<Uint8Array | null> {
  await purgeLegacyDiskKey();
  try {
    const s = await browser.storage.session.get(KEY_SESSION);
    const rec = (s as Record<string, unknown>)[KEY_SESSION] as KeyRecord | undefined;
    if (!rec?.keyHex) return null;

    if (rec.expiresAt != null && Date.now() > rec.expiresAt) {
      await clearPersistedSessionKey();
      return null;
    }
    const key = fromHex(rec.keyHex);

    // Sliding renewal for the timed durations (leave 'until-close' as-is).
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
  await purgeLegacyDiskKey();
}
