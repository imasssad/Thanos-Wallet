/**
 * Quantt (QUANTTS API 0.4.0) native client — wallet-signature auth + the
 * `/v1/mobile` BFF surface, shared by every Thanos client.
 *
 * AUTH is the Thanos-specific EIP-712 flow (shapes verified against the live
 * API on 2026-08-11):
 *   POST /v1/auth/wallet/typed-challenge { address } → EIP-712 typed data
 *   wallet signs it (eth_signTypedData_v4 / signer.signTypedData)
 *   POST /v1/auth/wallet/typed-verify   { address, signature } → session tokens
 * The challenge is self-contained — domain `Quantts.ai`, chainId 700777 (Makalu),
 * a `SignIn` struct carrying its own `nonce` (bytes32) + `validUntil` — so the
 * separate `/v1/auth/wallet/nonce` call is NOT needed for the typed flow.
 *
 * Keys never leave the wallet: Quantt only ever sees a signature. The caller
 * injects `signTypedData` (each client's existing signer) and an optional
 * session store, so this module stays platform-agnostic.
 *
 * NOTE ON DATA METHODS: the OpenAPI documents these paths + request bodies but
 * leaves the RESPONSES untyped ("Default Response"), and every data endpoint
 * requires a bearer. Responses are therefore returned loosely (`unknown`) and
 * should be pinned to concrete interfaces once observed against a real signed-in
 * session. The logged-out teaser (`/v1/partner/*`) additionally needs a
 * `partnerKey` issued by the Quantt team.
 */

export interface Eip712TypedData {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface QuanttUser {
  id: string;
  email?: string;
  role?: string;
  name?: string;
}

export interface QuanttSession {
  accessToken: string;
  refreshToken?: string;
  /** epoch seconds when the access token expires, if the server tells us */
  expiresAt?: number;
  user?: QuanttUser;
}

/** `/v1/mobile/overview` → `dashboard.portfolio` (shapes observed 2026-08-14). */
export interface QuanttPortfolio {
  equity: number;
  pnl24h: number;
  pnl7d: number;
  pnl30d: number;
  sharpe30d?: number;
  maxDrawdown30d?: number;
  activeAgents: number;
  performanceHistory?: number[];
}

/** One trading agent from `/v1/mobile/overview` → `dashboard.agents[]`. */
export interface QuanttAgent {
  id: string;
  name: string;
  chain?: string;
  status?: string;
  exposureUsd?: number;
  pnlPercent30d?: number;
  confidence?: number;
  strategy?: string;
}

export interface QuanttOverview {
  dashboard: {
    portfolio: QuanttPortfolio;
    agents: QuanttAgent[];
  };
}

/** Sign an EIP-712 payload with the wallet key and return a 0x… signature.
 *  Each client supplies its own: mobile/web/desktop via the internal signer's
 *  `signTypedData`, the extension via its `eth_signTypedData_v4` path. */
export type SignTypedDataFn = (typedData: Eip712TypedData) => Promise<string>;

/** Persist the session per platform (expo-secure-store, chrome.storage.session,
 *  keytar, httpOnly cookie, …). Omit for an in-memory-only session. */
export interface QuanttSessionStore {
  get(): Promise<QuanttSession | null> | QuanttSession | null;
  set(session: QuanttSession | null): Promise<void> | void;
}

export interface QuanttClientOptions {
  /** Defaults to the production API. */
  baseUrl?: string;
  store?: QuanttSessionStore;
  /** Partner key for logged-out `/v1/partner/*` reads (X-Partner-Key). */
  partnerKey?: string;
  /** Override fetch (tests / non-DOM runtimes). */
  fetchImpl?: typeof fetch;
}

export class QuanttError extends Error {
  constructor(public status: number, public detail: string, public path: string) {
    super(`Quantt ${path} → ${status}${detail ? `: ${detail}` : ''}`);
    this.name = 'QuanttError';
  }
}

const DEFAULT_BASE = 'https://api.quantts.ai';

export class QuanttClient {
  private readonly base: string;
  private readonly store?: QuanttSessionStore;
  private readonly partnerKey?: string;
  private readonly f: typeof fetch;
  private mem: QuanttSession | null = null;

  constructor(opts: QuanttClientOptions = {}) {
    this.base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
    this.store = opts.store;
    this.partnerKey = opts.partnerKey;
    this.f = opts.fetchImpl ?? fetch;
  }

  /* ── session ──────────────────────────────────────────────────────── */

  async session(): Promise<QuanttSession | null> {
    if (this.mem) return this.mem;
    this.mem = this.store ? await this.store.get() : null;
    return this.mem;
  }

  async isSignedIn(): Promise<boolean> {
    return Boolean(await this.session());
  }

  private async setSession(session: QuanttSession | null): Promise<void> {
    this.mem = session;
    if (this.store) await this.store.set(session);
  }

  /* ── auth (wallet EIP-712) ────────────────────────────────────────── */

  /** Step 1: fetch the EIP-712 challenge for `address` (unauthenticated). */
  async challenge(address: string): Promise<Eip712TypedData> {
    const res = await this.f(`${this.base}/v1/auth/wallet/typed-challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    if (!res.ok) throw new QuanttError(res.status, await safeText(res), 'typed-challenge');
    return (await res.json()) as Eip712TypedData;
  }

  /** Full sign-in: challenge → sign → verify → store + return the session. */
  async signIn(address: string, sign: SignTypedDataFn): Promise<QuanttSession> {
    const typed = await this.challenge(address);
    const signature = await sign(typed);
    const res = await this.f(`${this.base}/v1/auth/wallet/typed-verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address, signature }),
    });
    if (!res.ok) throw new QuanttError(res.status, await safeText(res), 'typed-verify');
    const session = normalizeSession(await res.json());
    await this.setSession(session);
    return session;
  }

  /** Exchange the refresh token for a fresh session; clears on failure. */
  async refresh(): Promise<QuanttSession | null> {
    const cur = await this.session();
    if (!cur?.refreshToken) return null;
    const res = await this.f(`${this.base}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: cur.refreshToken }),
    });
    if (!res.ok) {
      await this.setSession(null);
      return null;
    }
    const session = normalizeSession(await res.json(), cur);
    await this.setSession(session);
    return session;
  }

  /** Best-effort server logout, then clear the local session. */
  async signOut(): Promise<void> {
    const cur = await this.session();
    if (cur?.accessToken) {
      try {
        await this.f(`${this.base}/v1/auth/logout`, { method: 'POST', headers: this.authHeaders(cur) });
      } catch {
        /* ignore — local clear below is what matters */
      }
    }
    await this.setSession(null);
  }

  /* ── authed requests (auto-refresh once on 401) ───────────────────── */

  private authHeaders(s: QuanttSession): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (s.accessToken) h.authorization = `Bearer ${s.accessToken}`;
    if (this.partnerKey) h['X-Partner-Key'] = this.partnerKey;
    return h;
  }

  private async authed<T = unknown>(path: string, init: RequestInit = {}, allowRetry = true): Promise<T> {
    const s = await this.session();
    if (!s) throw new QuanttError(401, 'not signed in', path);
    const res = await this.f(`${this.base}${path}`, {
      ...init,
      headers: { ...this.authHeaders(s), ...(init.headers as Record<string, string> | undefined) },
    });
    if (res.status === 401 && allowRetry) {
      const refreshed = await this.refresh();
      if (refreshed) return this.authed<T>(path, init, false);
    }
    if (!res.ok) throw new QuanttError(res.status, await safeText(res), path);
    return (await res.json()) as T;
  }

  /* ── /v1/mobile BFF (response shapes provisional — see file header) ── */

  /** Home overview: portfolio summary + agents list for the connected panel. */
  getOverview(): Promise<QuanttOverview> { return this.authed<QuanttOverview>('/v1/mobile/overview'); }
  getAgent(id: string): Promise<unknown> { return this.authed(`/v1/mobile/agents/${encodeURIComponent(id)}`); }
  createAgent(body: unknown): Promise<unknown> {
    return this.authed('/v1/mobile/agents', { method: 'POST', body: JSON.stringify(body) });
  }
  setAgentState(id: string, state: string): Promise<unknown> {
    return this.authed(`/v1/mobile/agents/${encodeURIComponent(id)}/state`, { method: 'POST', body: JSON.stringify({ state }) });
  }
  listAlerts(): Promise<unknown> { return this.authed('/v1/mobile/alerts'); }
  ackAlert(id: string): Promise<unknown> {
    return this.authed(`/v1/mobile/alerts/${encodeURIComponent(id)}/ack`, { method: 'POST' });
  }
  getWallet(): Promise<unknown> { return this.authed('/v1/mobile/wallet'); }
  getBilling(): Promise<unknown> { return this.authed('/v1/mobile/billing'); }
  /** Chat with the trading copilot. */
  copilot(body: unknown): Promise<unknown> {
    return this.authed('/v1/mobile/copilot', { method: 'POST', body: JSON.stringify(body) });
  }
  /** Agent-initiated payment from the Thanos balance (wallet confirms first). */
  walletPay(body: unknown): Promise<unknown> {
    return this.authed('/v1/mobile/wallet/pay', { method: 'POST', body: JSON.stringify(body) });
  }
}

/** For ethers `signer.signTypedData(domain, types, message)`: the `types` map
 *  without the `EIP712Domain` entry (ethers derives that from `domain`). The
 *  extension's `eth_signTypedData_v4` path wants the raw typed data instead. */
export function typesForEthers(typed: Eip712TypedData): Record<string, Array<{ name: string; type: string }>> {
  const out: Record<string, Array<{ name: string; type: string }>> = {};
  for (const k of Object.keys(typed.types)) {
    if (k !== 'EIP712Domain') out[k] = typed.types[k];
  }
  return out;
}

/* ── helpers ────────────────────────────────────────────────────────── */

async function safeText(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 300); } catch { return ''; }
}

/** The typed-verify / refresh responses are undocumented, so accept the common
 *  token field spellings defensively and fail loudly if none are present. */
function normalizeSession(raw: unknown, prev?: QuanttSession): QuanttSession {
  const o: Record<string, unknown> = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  const nested = (o.session && typeof o.session === 'object') ? (o.session as Record<string, unknown>) : {};
  const pickStr = (...keys: string[]): string | undefined => {
    for (const src of [o, nested]) {
      for (const k of keys) {
        const v = src[k];
        if (typeof v === 'string' && v) return v;
      }
    }
    return undefined;
  };
  const accessToken = pickStr('accessToken', 'access_token', 'token', 'access', 'jwt') ?? prev?.accessToken;
  const refreshToken = pickStr('refreshToken', 'refresh_token', 'refresh') ?? prev?.refreshToken;
  if (!accessToken) {
    throw new QuanttError(500, `no access token in response: ${JSON.stringify(o).slice(0, 160)}`, 'typed-verify');
  }
  const expiresInRaw = (o.expiresIn ?? o.expires_in ?? nested.expiresIn) as unknown;
  const expiresAtRaw = (o.expiresAt ?? o.expires_at ?? nested.expiresAt) as unknown;
  let expiresAt = typeof expiresAtRaw === 'number' ? expiresAtRaw : undefined;
  if (expiresAt == null && typeof expiresInRaw === 'number') {
    expiresAt = Math.floor(Date.now() / 1000) + expiresInRaw;
  }
  const user = (o.user && typeof o.user === 'object') ? (o.user as QuanttUser) : prev?.user;
  return { accessToken, refreshToken, expiresAt, user };
}
