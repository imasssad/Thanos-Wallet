/**
 * LAX card proxy — Thanos backend ↔ LAX / Zypto partner API.
 *
 * WHY THIS IS SERVER-SIDE: the LAX API key is a SECRET. The wallet apps (mobile,
 * web, extension, desktop) are public + client-side, so a key embedded there is
 * extractable and abusable. Every LAX call is therefore proxied HERE, with
 * LAX_API_KEY read from the environment and never sent to the client. The apps
 * call these endpoints; this router forwards to LAX with the key attached.
 *
 * STATUS: SCAFFOLD. The concrete LAX endpoints + auth-header format are pending
 * their API docs, so laxFetch() and the per-route bodies below are marked
 * TODO(lax-docs). Until LAX_API_BASE is configured the routes degrade safely:
 *   • POST /lax/account → hands back the hosted registration URL (lax.money) so
 *     the app's SafePal-style "Create Account → Next" still opens the web flow —
 *     the pre-integration behaviour, but now through the proper server seam.
 *   • the rest return 503 "LAX not configured yet".
 *
 * ENV (set on the VPS `.env`, gitignored — NEVER commit the value):
 *   LAX_API_KEY   — partner secret (rotate the one shared in chat)
 *   LAX_API_BASE  — e.g. https://api.lax.money   (from the LAX docs)
 */
import { Router } from 'express';

const LAX_API_KEY  = process.env.LAX_API_KEY  ?? '';
const LAX_API_BASE = process.env.LAX_API_BASE ?? '';
const LAX_PUBLIC_REGISTER = 'https://lax.money';

export const laxRouter = Router();

/** True once both the key and base URL are configured — i.e. the real API is
 *  wired. Until then we serve the safe external-registration fallback. */
const configured = (): boolean => Boolean(LAX_API_KEY && LAX_API_BASE);

interface FetchOpts { method?: string; body?: string; headers?: Record<string, string> }

/** Proxy helper — attaches the secret key to a LAX API call. The exact auth
 *  header is a placeholder until the LAX docs land (x-api-key vs Bearer …). */
async function laxFetch(path: string, opts: FetchOpts = {}): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${LAX_API_BASE}${path}`, {
    method:  opts.method ?? 'GET',
    body:    opts.body,
    headers: {
      'content-type': 'application/json',
      // TODO(lax-docs): confirm the auth header name/scheme from LAX.
      'x-api-key': LAX_API_KEY,
      ...(opts.headers ?? {}),
    },
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* non-JSON upstream */ }
  return { status: res.status, json };
}

/* POST /lax/account — create account / start registration.
   Body: { address?: string, referralCode?: string }.
   Pre-API: returns the hosted registration URL (with ref/address prefill) so the
   SafePal-style "Next" opens the LAX web flow. Post-API: proxies to LAX and
   returns whatever the native/KYC flow needs (session URL, SDK token, …). */
laxRouter.post('/account', async (req, res) => {
  const { address, referralCode } = (req.body ?? {}) as { address?: string; referralCode?: string };
  if (!configured()) {
    const url = new URL(LAX_PUBLIC_REGISTER);
    if (referralCode) url.searchParams.set('ref', referralCode);
    if (address)      url.searchParams.set('address', address);
    return res.json({ mode: 'external', registrationUrl: url.toString() });
  }
  try {
    // TODO(lax-docs): real create-account endpoint + response mapping.
    const { status, json } = await laxFetch('/account', { method: 'POST', body: JSON.stringify({ address, referralCode }) });
    return res.status(status).json(json);
  } catch {
    return res.status(502).json({ error: 'LAX upstream unreachable' });
  }
});

/* Account/KYC status, card details, top-up — shapes pending the LAX docs. They
   return 503 until configured so the client can show an honest "coming soon". */
laxRouter.get('/account', async (_req, res) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  return res.status(501).json({ error: 'not implemented (pending LAX docs)' }); // TODO(lax-docs)
});
laxRouter.get('/card', async (_req, res) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  return res.status(501).json({ error: 'not implemented (pending LAX docs)' }); // TODO(lax-docs)
});
laxRouter.post('/card/topup', async (_req, res) => {
  if (!configured()) return res.status(503).json({ error: 'LAX not configured yet' });
  return res.status(501).json({ error: 'not implemented (pending LAX docs)' }); // TODO(lax-docs)
});
