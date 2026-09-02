/**
 * Quantt (QUANTTS API 0.4.0) native client — wallet-signature auth + the
 * full `/v1/*` surface, shared by every Thanos client.
 *
 * AUTH is the Thanos-specific EIP-712 flow (shapes verified against the live
 * API on 2026-08-11):
 *   POST /v1/auth/wallet/typed-challenge { address } → EIP-712 typed data
 *   wallet signs it (eth_signTypedData_v4 / signer.signTypedData)
 *   POST /v1/auth/wallet/typed-verify   { address, signature } → session tokens
 * The challenge is self-contained — domain `Quantts.ai`, chainId 700777 (Makalu),
 * a `SignIn` struct carrying its own `nonce` (bytes32) + `validUntil` — so the
 * separate `/v1/auth/wallet/nonce` call is NOT needed for the typed flow.
 * Per Quantt (2026-09): the signed-in session (Bearer JWT, or the
 * `quantts_access` cookie for browser clients) is sufficient — there is no
 * separate app-level API key for authenticated user routes.
 *
 * Keys never leave the wallet: Quantt only ever sees a signature. The caller
 * injects `signTypedData` (each client's existing signer) and an optional
 * session store, so this module stays platform-agnostic.
 *
 * ENDPOINT SHAPES: pinned against the real OpenAPI spec at
 * https://api.quantts.ai/docs/json (QUANTTS API 0.4.0, fetched 2026-09-02 —
 * a prior version of this file had guessed at a `/v1/mobile/*` namespace
 * that doesn't exist in the spec; corrected here). Request bodies below
 * match the spec's documented schemas. RESPONSE bodies are still undocumented
 * in the spec itself ("Default Response" on every 200) — response types are
 * therefore only pinned where actually observed against a live session
 * (currently: getOverview's dashboard/agents shape, verified 2026-08-14);
 * everything else returns `unknown` until observed.
 *
 * NO SANDBOX: Quantt confirmed (2026-09) there is no hosted staging
 * environment with test accounts — every call here hits the single
 * production environment. Be extra deliberate before wiring up any
 * state-changing call (createAgent, setAgentState, deposit, withdraw,
 * the admin kill switch) to a UI — there's no safe environment to
 * rehearse against first.
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

/** `/v1/mobile/overview` (undocumented in the OpenAPI spec but live and
 *  verified — 401s rather than 404s unauthenticated) → `dashboard.portfolio`.
 *  Shapes observed 2026-08-14. `/v1/dashboard` (documented, also 401s
 *  unauthenticated) is presumably the same payload — not yet switched to
 *  since getOverview is already shipped and verified working on all 4
 *  clients; see getDashboard() below for the documented alternative. */
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

/* ── Real, spec-verified request types (packages/sdk-core — pinned against
   QUANTTS API 0.4.0's OpenAPI schemas) ─────────────────────────────────── */

export type QuanttStrategy =
  | 'buy_hold' | 'macd' | 'kdj_rsi' | 'zmr' | 'sma' | 'custom' | 'momentum'
  | 'mean_reversion' | 'arbitrage' | 'trend_following' | 'hedging'
  | 'fundamental' | 'technical';
export type QuanttChain = 'arbitrum' | 'base' | 'lithosphere' | 'bnb';
/** 'magma' = MagmaDEX (see INTERNAL_PARTNER_INTEGRATION_PLAN.md — same
 *  MagmaDEX the MultX adapter integration plan covers). 'kamet' = the
 *  Kamet-native DEX. */
export type QuanttDexPreference = 'kamet' | 'magma';
export type QuanttQuoteAsset = 'USDC' | 'USDT' | 'LAX';
export type QuanttTimeframe = '5m' | '15m' | '1h' | '4h' | '1d';
/** The full set the create/update schema documents. Note this is wider than
 *  the set POST /agents/{id}/state accepts (see QuanttRuntimeState). */
export type QuanttAgentStatus = QuanttRuntimeState;
/** What POST /v1/agents/{id}/state actually accepts. */
export type QuanttRuntimeState = 'active' | 'paused' | 'idle';

export interface CreateAgentInput {
  name: string;
  strategy: QuanttStrategy;
  /** Free-text strategy guidance for 'custom' (or to steer any strategy). */
  strategyPrompt?: string | null;
  chains: QuanttChain[];
  tokens: string[];
  dexPreference?: QuanttDexPreference; // default 'kamet'
  capitalUsd: number;
  maxPositionPct?: number;  // default 25
  stopLoss?: number;        // default 5
  takeProfit?: number;      // default 10
  maxDailyLoss?: number;    // default 3.5
  autopilot?: boolean;      // default true
  timeframe?: QuanttTimeframe; // default '1h'
  quoteAsset?: QuanttQuoteAsset; // default 'USDC'
}
export type UpdateAgentInput = Partial<CreateAgentInput>;

export interface WithdrawInput {
  amount: number;
  /** Required if the account has TOTP enabled. */
  totpCode?: string;
}

export interface KillSwitchInput {
  armed: boolean;
  reason: string;
}

export interface BindWithdrawalAddressInput {
  address: string;   // 0x…40
  signature: string; // 0x… over the EIP-712 challenge from the /challenge endpoint
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
    // Bind to globalThis — an unbound `fetch` reference invoked as `this.f(...)`
    // runs with `this` = the QuanttClient instance, and browsers reject that
    // ("Illegal invocation": fetch requires `this` to be a real Window/Worker).
    this.f = opts.fetchImpl ?? fetch.bind(globalThis);
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

  /** Unauthenticated, partner-keyed request for the `/v1/partner/*` teaser
   *  routes (X-Partner-Key header, per the spec's `partnerKey` security
   *  scheme) — no signed-in session required. */
  private async partnered<T = unknown>(path: string): Promise<T> {
    if (!this.partnerKey) throw new QuanttError(401, 'no partnerKey configured', path);
    const res = await this.f(`${this.base}${path}`, {
      headers: { 'X-Partner-Key': this.partnerKey },
    });
    if (!res.ok) throw new QuanttError(res.status, await safeText(res), path);
    return (await res.json()) as T;
  }

  /* ── dashboard / overview ─────────────────────────────────────────── */

  /** The verified-live, currently-shipped overview call (undocumented in
   *  the OpenAPI spec, but a real, working route — confirmed 2026-09-02 it
   *  401s rather than 404s unauthenticated). Kept as the primary method
   *  since all 4 clients already depend on this exact shape in production. */
  getOverview(): Promise<QuanttOverview> { return this.authed<QuanttOverview>('/v1/mobile/overview'); }

  /** The OpenAPI-documented equivalent ("Platform dashboard payload").
   *  Response shape not yet observed against a live session — likely the
   *  same as getOverview's, but don't assume without checking. Exists as
   *  an option if `/v1/mobile/overview` is ever deprecated. */
  getDashboard(): Promise<unknown> { return this.authed('/v1/dashboard'); }

  /* ── agents (GET /v1/agents documents this as "for the current user") ─ */

  listAgents(): Promise<unknown> { return this.authed('/v1/agents'); }
  getAgent(id: string): Promise<unknown> { return this.authed(`/v1/agents/${encodeURIComponent(id)}`); }
  createAgent(body: CreateAgentInput): Promise<unknown> {
    return this.authed('/v1/agents', { method: 'POST', body: JSON.stringify(body) });
  }
  updateAgent(id: string, body: UpdateAgentInput): Promise<unknown> {
    return this.authed(`/v1/agents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  }
  deleteAgent(id: string): Promise<unknown> {
    return this.authed(`/v1/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  /** Start / pause / stop. NOT the same enum as the agent's full status
   *  field on create/update — this endpoint only accepts these three. */
  setAgentState(id: string, status: QuanttRuntimeState): Promise<unknown> {
    return this.authed(`/v1/agents/${encodeURIComponent(id)}/state`, {
      method: 'POST', body: JSON.stringify({ status }),
    });
  }
  /** Manually trigger the AI decision pipeline for this agent (outside its
   *  normal schedule). */
  analyzeAgent(id: string): Promise<unknown> {
    return this.authed(`/v1/agents/${encodeURIComponent(id)}/analyze`, { method: 'POST' });
  }
  getAgentTrades(id: string, limit?: number): Promise<unknown> {
    const qs = limit ? `?limit=${encodeURIComponent(String(limit))}` : '';
    return this.authed(`/v1/agents/${encodeURIComponent(id)}/trades${qs}`);
  }
  getAgentPositions(id: string): Promise<unknown> {
    return this.authed(`/v1/agents/${encodeURIComponent(id)}/positions`);
  }
  /** Agent wallet address + on-chain and Magma-ledger balances. */
  getAgentWallet(id: string): Promise<unknown> {
    return this.authed(`/v1/agents/${encodeURIComponent(id)}/wallet`);
  }
  /** Cursor-paginated (cursor = an ISO date-time from the previous page). */
  getAgentDecisions(id: string, opts?: { cursor?: string; limit?: number }): Promise<unknown> {
    const qs = new URLSearchParams();
    if (opts?.cursor) qs.set('cursor', opts.cursor);
    if (opts?.limit)  qs.set('limit', String(opts.limit));
    const s = qs.toString();
    return this.authed(`/v1/agents/${encodeURIComponent(id)}/decisions${s ? `?${s}` : ''}`);
  }
  getAgentDecision(id: string, decisionId: string): Promise<unknown> {
    return this.authed(`/v1/agents/${encodeURIComponent(id)}/decisions/${encodeURIComponent(decisionId)}`);
  }
  /** SSE URL for `decision` + `risk_rejected` events — open with EventSource
   *  (browser) or an SSE client; this class doesn't wrap streaming, it just
   *  builds the authenticated-fetch-compatible URL. Bearer auth on an SSE
   *  GET typically needs a query-param or cookie fallback depending on the
   *  client's EventSource implementation — verify against a live session
   *  before wiring up. */
  agentDecisionsStreamUrl(id: string): string {
    return `${this.base}/v1/agents/${encodeURIComponent(id)}/decisions/stream`;
  }

  /* ── funding (Magma) ──────────────────────────────────────────────── */

  /** Execute the real on-chain deposit ("leg B") for a Magma-preference
   *  agent. No request body per the spec. NO SANDBOX — this moves real
   *  funds; confirm the flow end-to-end with the Quantt team before wiring
   *  into any UI. */
  depositToAgent(id: string): Promise<unknown> {
    return this.authed(`/v1/agents/${encodeURIComponent(id)}/deposit`, { method: 'POST' });
  }
  /** Withdraw USDC from Magma to the user's *verified* wallet address (see
   *  bindWithdrawalAddress below — withdrawals can't go to an arbitrary
   *  address). `totpCode` required if the account has TOTP enabled. */
  withdrawFromAgent(id: string, body: WithdrawInput): Promise<unknown> {
    return this.authed(`/v1/agents/${encodeURIComponent(id)}/withdraw`, {
      method: 'POST', body: JSON.stringify(body),
    });
  }
  getAgentWithdrawals(id: string): Promise<unknown> {
    return this.authed(`/v1/agents/${encodeURIComponent(id)}/withdrawals`);
  }
  resumeWithdrawal(id: string, attemptId: string): Promise<unknown> {
    return this.authed(
      `/v1/agents/${encodeURIComponent(id)}/withdrawals/${encodeURIComponent(attemptId)}/resume`,
      { method: 'POST' },
    );
  }

  /** The wallet address withdrawals currently pay out to (null if none bound). */
  getWithdrawalAddress(): Promise<unknown> { return this.authed('/v1/user/withdrawal-address'); }
  /** Step 1 of binding a withdrawal address — same EIP-712-challenge shape
   *  as wallet sign-in, reuse SignTypedDataFn. */
  withdrawalAddressChallenge(address: string): Promise<Eip712TypedData> {
    return this.authed<Eip712TypedData>('/v1/user/withdrawal-address/challenge', {
      method: 'POST', body: JSON.stringify({ address }),
    });
  }
  /** Step 2 — bind the address once the challenge is signed. */
  bindWithdrawalAddress(body: BindWithdrawalAddressInput): Promise<unknown> {
    return this.authed('/v1/user/withdrawal-address', { method: 'POST', body: JSON.stringify(body) });
  }

  /* ── kill switch ───────────────────────────────────────────────────── */

  /** Current global trading-halt state. */
  getKillSwitch(): Promise<unknown> { return this.authed('/v1/kill-switch'); }
  /** Arm/disarm the GLOBAL halt — admin-scoped on Quantt's side (this
   *  client doesn't enforce that; the API will 403 a non-admin session). */
  setKillSwitch(body: KillSwitchInput): Promise<unknown> {
    return this.authed('/v1/admin/kill-switch', { method: 'POST', body: JSON.stringify(body) });
  }

  /* ── telemetry ─────────────────────────────────────────────────────── */

  getTelemetry(): Promise<unknown> { return this.authed('/v1/telemetry'); }
  /** SSE URL — see the decisions-stream note above re: auth over SSE. */
  telemetryStreamUrl(): string { return `${this.base}/v1/telemetry/stream`; }

  /* ── market data ───────────────────────────────────────────────────── */

  getMarketSnapshot(): Promise<unknown>   { return this.authed('/v1/market/snapshot'); }
  getMarketOhlcv(): Promise<unknown>      { return this.authed('/v1/market/ohlcv'); }
  getMarketIndicators(): Promise<unknown> { return this.authed('/v1/market/indicators'); }
  getMarketNews(): Promise<unknown>       { return this.authed('/v1/market/news'); }
  getMarketSentiment(): Promise<unknown>  { return this.authed('/v1/market/sentiment'); }
  getMarketTop10(): Promise<unknown>      { return this.authed('/v1/market/top10'); }
  getMarketWatchlist(): Promise<unknown>  { return this.authed('/v1/market/watchlist'); }
  /** Register a DEX symbol with the market backend — body shape is an open
   *  object in the spec (`additionalProperties: true`, no fixed fields
   *  documented). */
  registerMarketSymbol(body: Record<string, unknown>): Promise<unknown> {
    return this.authed('/v1/market/symbols', { method: 'POST', body: JSON.stringify(body) });
  }
  /** SSE URL for a comma-separated symbol list's live ticks. */
  marketStreamUrl(symbols?: string[]): string {
    const qs = symbols?.length ? `?symbols=${encodeURIComponent(symbols.join(','))}` : '';
    return `${this.base}/v1/market/stream${qs}`;
  }

  /* ── partner (logged-out teaser, X-Partner-Key) ───────────────────── */

  partnerAgents(limit?: number): Promise<unknown> {
    const qs = limit ? `?limit=${encodeURIComponent(String(limit))}` : '';
    return this.partnered(`/v1/partner/agents${qs}`);
  }
  partnerAgent(id: string): Promise<unknown> {
    return this.partnered(`/v1/partner/agents/${encodeURIComponent(id)}`);
  }
  partnerAgentPositions(id: string): Promise<unknown> {
    return this.partnered(`/v1/partner/agents/${encodeURIComponent(id)}/positions`);
  }
  partnerDecisions(opts?: { cursor?: string; limit?: number; agentId?: string }): Promise<unknown> {
    const qs = new URLSearchParams();
    if (opts?.cursor)  qs.set('cursor', opts.cursor);
    if (opts?.limit)   qs.set('limit', String(opts.limit));
    if (opts?.agentId) qs.set('agent_id', opts.agentId);
    const s = qs.toString();
    return this.partnered(`/v1/partner/decisions${s ? `?${s}` : ''}`);
  }
  partnerDecision(id: string): Promise<unknown> {
    return this.partnered(`/v1/partner/decisions/${encodeURIComponent(id)}`);
  }
  partnerTrades(): Promise<unknown> { return this.partnered('/v1/partner/trades'); }
  partnerTrade(id: string): Promise<unknown> {
    return this.partnered(`/v1/partner/trades/${encodeURIComponent(id)}`);
  }
  partnerPositions(): Promise<unknown> { return this.partnered('/v1/partner/positions'); }
  partnerMarketSnapshot(): Promise<unknown> { return this.partnered('/v1/partner/market/snapshot'); }
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
