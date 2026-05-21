/**
 * Push-notification storage + delivery.
 *
 * Devices register an Expo push token against their wallet address
 * (POST /push/register). When the indexer detects incoming activity for
 * an address it calls POST /push/notify (internal, secret-gated), which
 * fans out to that address's tokens via the Expo Push API.
 *
 * Remote DELIVERY also requires the project's APNs key (iOS) + FCM
 * credentials (Android) configured in Expo/EAS — without them Expo
 * accepts the request but the OS won't deliver. Storage + send wiring is
 * complete regardless.
 */
import { query } from './db.js';
import { log } from './log.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Create the push_tokens table if it doesn't exist (idempotent — runs on
 *  boot since schema.sql only loads on a fresh Postgres volume). */
export async function ensurePushSchema(): Promise<void> {
  await query(`
    create table if not exists push_tokens (
      token      text primary key,
      address    text not null,
      platform   text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
  await query(`create index if not exists push_tokens_address_idx on push_tokens (lower(address));`);
}

/** True for a plausible Expo push token. */
export function isExpoToken(t: unknown): t is string {
  return typeof t === 'string' && /^Expo(nent)?PushToken\[.+\]$/.test(t);
}

export async function registerToken(token: string, address: string, platform?: string): Promise<void> {
  await query(
    `insert into push_tokens (token, address, platform)
       values ($1, $2, $3)
     on conflict (token) do update set address = excluded.address, platform = excluded.platform, updated_at = now()`,
    [token, address.toLowerCase(), platform ?? null],
  );
}

export async function removeToken(token: string): Promise<void> {
  await query(`delete from push_tokens where token = $1`, [token]);
}

export async function tokensForAddress(address: string): Promise<string[]> {
  const rows = await query<{ token: string }>(
    `select token from push_tokens where lower(address) = lower($1)`,
    [address],
  );
  return rows.map((r) => r.token);
}

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Send one message to many tokens via the Expo Push API. Expo dedupes
 *  and routes to APNs/FCM. Invalid tokens (DeviceNotRegistered) are
 *  pruned so the table stays clean. */
export async function sendToTokens(tokens: string[], msg: PushMessage): Promise<void> {
  if (!tokens.length) return;
  const messages = tokens.map((to) => ({ to, sound: 'default', ...msg }));
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    const json = (await res.json().catch(() => null)) as
      | { data?: Array<{ status: string; details?: { error?: string } }> }
      | null;
    // Prune tokens Expo reports as unregistered.
    const data = json?.data ?? [];
    await Promise.all(
      data.map((r, i) =>
        r?.details?.error === 'DeviceNotRegistered' ? removeToken(tokens[i]) : Promise.resolve(),
      ),
    );
  } catch (e) {
    log.warn({ err: (e as Error).message }, 'expo push send failed');
  }
}

/** Convenience: notify every device registered to an address. */
export async function notifyAddress(address: string, msg: PushMessage): Promise<number> {
  const tokens = await tokensForAddress(address);
  await sendToTokens(tokens, msg);
  return tokens.length;
}
