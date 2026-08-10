/**
 * LAX card client (mobile) — talks to the Thanos backend LAX proxy, never to
 * LAX directly. The partner API key is a server-side secret (see
 * services/api/src/routes/lax.ts); the app only ever calls our own backend.
 *
 * SCAFFOLD: the backend degrades to the hosted registration URL (lax.money)
 * until the LAX API is wired, so createAccount() always returns something
 * openable. Falls back to lax.money if the backend is unreachable.
 */

const API_BASE = String(
  (typeof process !== 'undefined' && (process as { env?: Record<string, string> }).env?.EXPO_PUBLIC_API_URL) ||
    'https://thanos.fi/api',
);

const LAX_PUBLIC_REGISTER = 'https://lax.money';

export interface LaxAccountResult {
  /** 'external' = open registrationUrl in the browser; 'native'/'kyc' land with the API. */
  mode?: string;
  registrationUrl?: string;
}

/** Start LAX registration for this wallet. Returns a URL to open (external
 *  mode) until the native/KYC flow is wired via the partner API. */
export async function laxCreateAccount(params: { address?: string; referralCode?: string }): Promise<LaxAccountResult> {
  try {
    const res = await fetch(`${API_BASE}/lax/account`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`lax ${res.status}`);
    return (await res.json()) as LaxAccountResult;
  } catch {
    // Backend unreachable → open the public LAX site directly so "Next" never
    // dead-ends. Prefill the referral where the site supports it.
    const url = new URL(LAX_PUBLIC_REGISTER);
    if (params.referralCode) url.searchParams.set('ref', params.referralCode);
    return { mode: 'external', registrationUrl: url.toString() };
  }
}
