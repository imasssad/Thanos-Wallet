/**
 * Quantt (QUANTTS API 0.4.0) client — mobile twin of
 * packages/sdk-core/src/quantt/client.ts.
 *
 * Detached copy for the same reason as lib/tx-details.ts / lib/fx.ts: EAS builds
 * can't resolve the workspace @thanos/sdk-core dep, so the mobile app carries a
 * local mirror. Keep in sync with the sdk-core version.
 *
 * AUTH: the Thanos EIP-712 wallet login (challenge → sign → verify → session),
 * shapes verified against the live API 2026-08-14. The session is persisted in
 * expo-secure-store. Keys never leave the wallet — Quantt only sees a signature.
 *
 * NO SANDBOX, one production environment (confirmed by Quantt 2026-09-09).
 *
 * RATE LIMIT (confirmed by Quantt 2026-09-09): one global limit, 120
 * requests/minute per IP, across every route including the SSE streams.
 * Not currently enforced client-side — a 429 isn't a bug to retry through
 * blindly, back off.
 */
import * as SecureStore from 'expo-secure-store';
import { fetch as expoFetch } from 'expo/fetch';
import { HDNodeWallet } from 'ethers';
import { assertQuanttChallenge } from './quantt-challenge';
import { validateAgentUpdate } from './quantt-agent-config';
import { SseParser } from './quantt-sse';

export interface Eip712TypedData {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface QuanttUser { id: string; email?: string; role?: string; name?: string }

export interface QuanttSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  user?: QuanttUser;
}

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
  dashboard: { portfolio: QuanttPortfolio; agents: QuanttAgent[] };
}

/* ── Real, spec-verified request types (pinned against QUANTTS API 0.4.0's
   OpenAPI schema at https://api.quantts.ai/docs/json, fetched 2026-09-02) ── */
export type QuanttStrategy =
  | 'buy_hold' | 'macd' | 'kdj_rsi' | 'zmr' | 'sma' | 'custom' | 'momentum'
  | 'mean_reversion' | 'arbitrage' | 'trend_following' | 'hedging'
  | 'fundamental' | 'technical';
export type QuanttChain = 'arbitrum' | 'base' | 'lithosphere' | 'bnb';
/** 'magma' = MagmaDEX (same MagmaDEX the MultX adapter integration plan
 *  covers). 'kamet' = the Kamet-native DEX. */
export type QuanttDexPreference = 'kamet' | 'magma';
export type QuanttQuoteAsset = 'USDC' | 'USDT' | 'LAX';
export type QuanttTimeframe = '5m' | '15m' | '1h' | '4h' | '1d';
/** What POST /v1/agents/{id}/state actually accepts. */
export type QuanttRuntimeState = 'active' | 'paused' | 'idle';

export interface CreateAgentInput {
  name: string;
  strategy: QuanttStrategy;
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

export interface BindWithdrawalAddressInput {
  address: string;   // 0x…40
  signature: string; // 0x… over the EIP-712 challenge from the /challenge endpoint
}

export type SignTypedDataFn = (typedData: Eip712TypedData) => Promise<string>;

/** GET /v1/kill-switch — the global trading-halt state. Neither the route
 *  nor its response is in the committed 0.4.0 spec snapshot: the shape is the
 *  admin POST body ({armed, reason}) plus who / when, unconfirmed against
 *  production. */
export interface QuanttKillSwitch {
  armed: boolean;
  reason: string | null;
  armedBy: string | null;
  armedAt: string | null;
}

/** One event from an agent's decision stream: `decision` or `risk_rejected`.
 *  `data` is the parsed JSON payload, or the raw string if it isn't JSON. */
export interface QuanttStreamEvent {
  type: string;
  data: unknown;
}
export type QuanttStreamStatus = 'connecting' | 'live' | 'retrying' | 'stopped';
export interface QuanttStreamHandlers {
  onEvent: (event: QuanttStreamEvent) => void;
  /** Connection state for a "Live" indicator; `detail` explains 'stopped'. */
  onStatus?: (status: QuanttStreamStatus, detail?: string) => void;
}

/** The fetch used for the SSE streams. React Native's global fetch never
 *  exposes a readable body; expo/fetch streams it. */
type StreamFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

interface SessionStore {
  get(): Promise<QuanttSession | null> | QuanttSession | null;
  set(session: QuanttSession | null): Promise<void> | void;
}

type FetchInit = { method?: string; body?: string; headers?: Record<string, string> };

/** Upstream gateways (Cloudflare/nginx) answer 502/503/504 with an HTML page;
 *  never dump that markup into the UI. */
function friendlyQuanttMessage(status: number, detail: string, path: string): string {
  const html = /^\s*<(!doctype|html|!--)/i.test(detail);
  if (html || status === 502 || status === 503 || status === 504) {
    return `Quantts is temporarily unavailable (HTTP ${status}). Please try again in a few minutes.`;
  }
  return `Quantt ${path} → ${status}${detail ? `: ${detail}` : ''}`;
}

export class QuanttError extends Error {
  constructor(public status: number, public detail: string, public path: string) {
    super(friendlyQuanttMessage(status, detail, path));
    this.name = 'QuanttError';
  }
}

const DEFAULT_BASE = 'https://api.quantts.ai';

export class QuanttClient {
  private readonly base: string;
  private readonly store?: SessionStore;
  private readonly streamFetch: StreamFetch;
  private mem: QuanttSession | null = null;

  constructor(opts: { baseUrl?: string; store?: SessionStore; streamFetch?: StreamFetch } = {}) {
    this.base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
    this.store = opts.store;
    // Called as a plain function, never as a method of this client: on web
    // expo/fetch IS window.fetch, which throws "Illegal invocation" when
    // `this` isn't the window.
    const sf = opts.streamFetch ?? (expoFetch as unknown as StreamFetch);
    this.streamFetch = (url, init) => sf(url, init);
  }

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

  async challenge(address: string): Promise<Eip712TypedData> {
    const res = await fetch(`${this.base}/v1/auth/wallet/typed-challenge`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    if (!res.ok) throw new QuanttError(res.status, await safeText(res), 'typed-challenge');
    // Refuse anything that isn't a genuine SignIn challenge before it can
    // reach the signer (see lib/quantt-challenge.ts).
    return assertQuanttChallenge(await safeJson<unknown>(res, 'typed-challenge'), { kind: 'sign-in', address });
  }

  async signIn(address: string, sign: SignTypedDataFn): Promise<QuanttSession> {
    const typed = await this.challenge(address);
    const signature = await sign(typed);
    const res = await fetch(`${this.base}/v1/auth/wallet/typed-verify`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address, signature }),
    });
    if (!res.ok) throw new QuanttError(res.status, await safeText(res), 'typed-verify');
    const session = normalizeSession(await safeJson(res, 'typed-verify'));
    await this.setSession(session);
    return session;
  }

  async refresh(): Promise<QuanttSession | null> {
    const cur = await this.session();
    if (!cur?.refreshToken) return null;
    const res = await fetch(`${this.base}/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: cur.refreshToken }),
    });
    if (!res.ok) { await this.setSession(null); return null; }
    // refresh() never throws by contract — a malformed 200 body gets the
    // same treatment as a failed refresh rather than an uncaught error.
    let session: QuanttSession;
    try {
      session = normalizeSession(await res.json(), cur);
    } catch {
      await this.setSession(null);
      return null;
    }
    await this.setSession(session);
    return session;
  }

  /** Forget the session locally FIRST, then tell Quantt (best effort) — a
   *  slow or failing logout call must never leave the tokens behind (this
   *  runs when the wallet locks or is wiped). Mirrors sdk-core. */
  async signOut(): Promise<void> {
    const cur = await this.session();
    await this.setSession(null);
    if (cur?.accessToken) {
      try { await fetch(`${this.base}/v1/auth/logout`, { method: 'POST', credentials: 'omit', headers: this.authHeaders(cur) }); }
      catch { /* ignore — the local copy is already gone */ }
    }
  }

  /** content-type only when there's a body: Quantts' Fastify server rejects
   *  'application/json' with an empty body (FST_ERR_CTP_EMPTY_JSON_BODY) —
   *  which broke the body-less deposit-confirm, delete-agent and logout calls. */
  private authHeaders(s: QuanttSession, withBody = false): Record<string, string> {
    const h: Record<string, string> = withBody ? { 'content-type': 'application/json' } : {};
    if (s.accessToken) h.authorization = `Bearer ${s.accessToken}`;
    return h;
  }

  private async authed<T = unknown>(path: string, init: FetchInit = {}, allowRetry = true): Promise<T> {
    const s = await this.session();
    if (!s) throw new QuanttError(401, 'not signed in', path);
    const res = await fetch(`${this.base}${path}`, {
      method: init.method ?? 'GET',
      credentials: 'omit',
      body: init.body,
      headers: { ...this.authHeaders(s, init.body != null), ...(init.headers ?? {}) },
    });
    if (res.status === 401 && allowRetry) {
      const refreshed = await this.refresh();
      if (refreshed) return this.authed<T>(path, init, false);
    }
    if (!res.ok) throw new QuanttError(res.status, await safeText(res), path);
    return safeJson<T>(res, path);
  }

  /** The signed-in user's own portfolio + agents. Hits GET
   *  /v1/dashboard/overview — the spec's documented per-user route.
   *  Switched here 2026-09-10 from the undocumented /v1/mobile/overview,
   *  which was returning a platform-wide / seeded-demo snapshot ("$17M,
   *  12 identical agents" for a fresh account) instead of real data.
   *  Response shape is unverified ("Default Response" in the spec), so
   *  normalizeOverview() is loose: fields under `dashboard` OR top-level,
   *  and null (→ card hides) if there's no `portfolio` with a numeric
   *  `equity`. An empty account (equity 0, agents []) still renders. */
  async getOverview(): Promise<QuanttOverview | null> {
    return normalizeOverview(await this.authed('/v1/dashboard/overview'));
  }

  /** GET /v1/dashboard — "Platform dashboard payload." NOT an overview
   *  equivalent. Spec (fetched 2026-09-09): proxies the decision engine's
   *  view, "derived from ENGINE WORKFLOW RUNS, not from the Agent table.
   *  The ids it returns are `workflow-<n>` and cannot be passed to
   *  /v1/agents/{id}" — every agent-scoped method here (getAgent,
   *  setAgentState, …) expects a real agent id, which an id from here
   *  isn't. Also 502s outright when the decision engine is unreachable,
   *  no fallback at this layer. getOverview() above (/v1/dashboard/overview)
   *  is the one to reach for instead. */
  getDashboard(): Promise<unknown> { return this.authed('/v1/dashboard'); }

  listAgents(): Promise<unknown> { return this.authed('/v1/agents'); }
  getAgent(id: string): Promise<unknown> { return this.authed(`/v1/agents/${encodeURIComponent(id)}`); }
  createAgent(body: CreateAgentInput): Promise<unknown> {
    return this.authed('/v1/agents', { method: 'POST', body: JSON.stringify(body) });
  }
  /** PATCH the agent's config. The body is checked against the documented
   *  update schema first (lib/quantt-agent-config.ts) — an invalid or empty
   *  update throws before anything is sent to production. */
  async updateAgent(id: string, body: UpdateAgentInput): Promise<unknown> {
    const problems = validateAgentUpdate(body);
    if (problems.length) throw new QuanttError(400, problems.join(' '), 'agents/update');
    if (Object.keys(body).length === 0) throw new QuanttError(400, 'nothing to update', 'agents/update');
    return this.authed(`/v1/agents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  }
  deleteAgent(id: string): Promise<unknown> {
    return this.authed(`/v1/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  /** Start / pause / stop — not the same enum as the agent's full status
   *  field on create/update, this endpoint only accepts these three. */
  setAgentState(id: string, status: QuanttRuntimeState): Promise<unknown> {
    return this.authed(`/v1/agents/${encodeURIComponent(id)}/state`, {
      method: 'POST', body: JSON.stringify({ status }),
    });
  }
  analyzeAgent(id: string): Promise<unknown> {
    return this.authed(`/v1/agents/${encodeURIComponent(id)}/analyze`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }
  getAgentTrades(id: string, limit?: number): Promise<unknown> {
    const qs = limit ? `?limit=${encodeURIComponent(String(limit))}` : '';
    return this.authed(`/v1/agents/${encodeURIComponent(id)}/trades${qs}`);
  }
  getAgentPositions(id: string): Promise<unknown> {
    return this.authed(`/v1/agents/${encodeURIComponent(id)}/positions`);
  }
  getAgentWallet(id: string): Promise<unknown> {
    return this.authed(`/v1/agents/${encodeURIComponent(id)}/wallet`);
  }
  getAgentDecisions(id: string, opts?: { cursor?: string; limit?: number }): Promise<unknown> {
    const qs = new URLSearchParams();
    if (opts?.cursor) qs.set('cursor', opts.cursor);
    if (opts?.limit)  qs.set('limit', String(opts.limit));
    const s = qs.toString();
    return this.authed(`/v1/agents/${encodeURIComponent(id)}/decisions${s ? `?${s}` : ''}`);
  }
  /** SSE URL for `decision` + `risk_rejected` events on this one agent.
   *  This class doesn't wrap streaming, it just builds the URL — see the
   *  auth note below, shared by all three stream endpoints. */
  agentDecisionsStreamUrl(id: string): string {
    return `${this.base}/v1/agents/${encodeURIComponent(id)}/decisions/stream`;
  }

  /** Live `decision` / `risk_rejected` events for one agent over the
   *  bearer-authenticated SSE stream (expo/fetch body reader). Returns an
   *  unsubscribe function. Refreshes once on a 401; reconnects after a drop
   *  with backoff (2 s → 60 s) and recycles a connection silent for 5
   *  minutes (the stream has no heartbeat); stops on 4xx other than
   *  408/429. Mirrors sdk-core's subscribeAgentDecisions. */
  subscribeAgentDecisions(id: string, handlers: QuanttStreamHandlers): () => void {
    const stop = new AbortController();
    const status = handlers.onStatus ?? (() => {});
    const IDLE_MS = 5 * 60_000;
    const run = async (): Promise<void> => {
      let delay = 2_000;
      let refreshed = false;
      while (!stop.signal.aborted) {
        status('connecting');
        const conn = new AbortController();
        const onStop = () => conn.abort();
        stop.signal.addEventListener('abort', onStop);
        let idle: ReturnType<typeof setTimeout> | undefined;
        const armIdle = () => { clearTimeout(idle); idle = setTimeout(() => conn.abort(), IDLE_MS); };
        try {
          const s = await this.session();
          if (!s) { status('stopped', 'not signed in'); return; }
          armIdle();
          const res = await this.streamFetch(this.agentDecisionsStreamUrl(id), {
            headers: { ...this.authHeaders(s), accept: 'text/event-stream' },
            signal: conn.signal,
          });
          if (res.status === 401 && !refreshed) {
            refreshed = true;
            if (await this.refresh()) continue;
            status('stopped', 'session expired — sign in again'); return;
          }
          if (!res.ok) {
            if (res.status < 500 && res.status !== 408 && res.status !== 429) {
              status('stopped', `HTTP ${res.status}`); return;
            }
            throw new QuanttError(res.status, await safeText(res), 'decisions/stream');
          }
          if (!res.body) { status('stopped', 'live updates are not supported here'); return; }
          refreshed = false;
          delay = 2_000;
          status('live');
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          const parser = new SseParser();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            armIdle();
            for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
              let data: unknown = ev.data;
              try { data = JSON.parse(ev.data); } catch { /* not JSON — hand over the raw text */ }
              handlers.onEvent({ type: ev.event, data });
            }
          }
        } catch {
          /* dropped / timed out / 5xx — reconnect below unless unsubscribed */
        } finally {
          clearTimeout(idle);
          stop.signal.removeEventListener('abort', onStop);
        }
        if (stop.signal.aborted) break;
        status('retrying');
        await new Promise<void>((resolve) => {
          const t = setTimeout(() => { stop.signal.removeEventListener('abort', wake); resolve(); }, delay);
          const wake = () => { clearTimeout(t); resolve(); };
          stop.signal.addEventListener('abort', wake);
        });
        delay = Math.min(delay * 2, 60_000);
      }
    };
    void run();
    return () => stop.abort();
  }
  /** SSE URL for the UNFILTERED platform activity bus — every event, not
   *  just this session's agents. Sends `event: snapshot` (10 most recent)
   *  on connect, then `event: telemetry` per event — live-only, no
   *  replay/backfill, and no heartbeat (a dead connection won't
   *  self-announce). */
  platformTelemetryStreamUrl(): string {
    return `${this.base}/v1/telemetry/stream`;
  }
  /** SSE URL for live ticks on the given symbols (comma-separated). Omit
   *  for the platform default set. */
  marketStreamUrl(symbols?: string[]): string {
    const qs = symbols?.length ? `?symbols=${encodeURIComponent(symbols.join(','))}` : '';
    return `${this.base}/v1/market/stream${qs}`;
  }
  /* All three streams above declare ONLY bearerAuth in the spec — no
     query-param/cookie alternative exists (confirmed 2026-09-09). Native
     EventSource can't send headers at all, so a fetch-based SSE reader is
     required (ReadableStream over an authed fetch(), or a polyfill), not
     `new EventSource(url)`. */

  /* Funding (Magma) — NO SANDBOX, these move real funds. Confirm the full
     flow with Quantt before wiring into any UI. */
  depositToAgent(id: string): Promise<unknown> {
    return this.authed(`/v1/agents/${encodeURIComponent(id)}/deposit`, { method: 'POST' });
  }
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
  async withdrawalAddressChallenge(address: string): Promise<Eip712TypedData> {
    const typed = await this.authed<unknown>('/v1/user/withdrawal-address/challenge', {
      method: 'POST', body: JSON.stringify({ address }),
    });
    return assertQuanttChallenge(typed, { kind: 'withdrawal-address', address });
  }
  /** Step 2 — bind the address once the challenge is signed. */
  bindWithdrawalAddress(body: BindWithdrawalAddressInput): Promise<unknown> {
    return this.authed('/v1/user/withdrawal-address', { method: 'POST', body: JSON.stringify(body) });
  }

  /** Current global trading-halt state, or null if the response doesn't
   *  carry a boolean `armed` (the UI then shows nothing). */
  async getKillSwitch(): Promise<QuanttKillSwitch | null> {
    return normalizeKillSwitch(await this.authed('/v1/kill-switch'));
  }
  getTelemetry(): Promise<unknown> { return this.authed('/v1/telemetry'); }
}

/** The banner sentence for an armed kill switch: the operator's reason
 *  (punctuated), then what it means for the user. */
export function killSwitchMessage(ks: Pick<QuanttKillSwitch, 'reason'>): string {
  const reason = ks.reason?.trim();
  const lead = reason
    ? `Quantts has halted all agent trading: ${reason}${/[.!?]$/.test(reason) ? '' : '.'}`
    : 'Quantts has halted all agent trading.';
  return `${lead} Agents can't be started until the halt is lifted.`;
}

/** GET /v1/kill-switch → QuanttKillSwitch, or null without a boolean `armed`. */
function normalizeKillSwitch(raw: unknown): QuanttKillSwitch | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.armed !== 'boolean') return null;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return { armed: o.armed, reason: str(o.reason), armedBy: str(o.armedBy), armedAt: str(o.armedAt) };
}

async function safeText(res: { text(): Promise<string> }): Promise<string> {
  try { return (await res.text()).slice(0, 300); } catch { return ''; }
}

/** res.json() throws an unstructured SyntaxError on a non-JSON body — a
 *  malformed response, an HTML error/maintenance page served with a 200,
 *  an empty body. Turns that into the same QuanttError every other failure
 *  path already throws, so callers only ever need to handle one error type.
 *  Mirrors packages/sdk-core/src/quantt/client.ts — keep in sync. */
async function safeJson<T>(res: { json(): Promise<unknown>; status: number }, path: string): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new QuanttError(res.status, 'response was not valid JSON', path);
  }
}

/** /v1/dashboard/overview's shape isn't in the spec. Pull portfolio +
 *  agents from under `dashboard` or the top level; return null (→ card
 *  hides) if there's no `portfolio` with a numeric `equity`. An empty
 *  account (equity 0, agents []) still passes. Mirrors sdk-core. */
function normalizeOverview(raw: unknown): QuanttOverview | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const scope = (r.dashboard && typeof r.dashboard === 'object')
    ? (r.dashboard as Record<string, unknown>)
    : r;
  const portfolio = scope.portfolio;
  if (!portfolio || typeof portfolio !== 'object'
      || typeof (portfolio as Record<string, unknown>).equity !== 'number') {
    return null;
  }
  const agents = Array.isArray(scope.agents) ? scope.agents : [];
  return { dashboard: { portfolio, agents } } as QuanttOverview;
}

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
  if (!accessToken && o.alreadyLinked === true) {
    throw new QuanttError(409, 'This wallet is already linked to a Quantts account, but Quantts returned no session. Please try Connect again; if it persists, contact Quantts support.', 'typed-verify');
  }
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

/* ── mobile wiring ──────────────────────────────────────────────────── */

const STORE_KEY = 'quantt_session';

const store: SessionStore = {
  async get(): Promise<QuanttSession | null> {
    try {
      const r = await SecureStore.getItemAsync(STORE_KEY);
      return r ? (JSON.parse(r) as QuanttSession) : null;
    } catch {
      return null;
    }
  },
  async set(s: QuanttSession | null): Promise<void> {
    try {
      if (s) await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(s));
      else await SecureStore.deleteItemAsync(STORE_KEY);
    } catch {
      /* ignore */
    }
  },
};

export const quantt = new QuanttClient({ store });

/** The wallet address the saved Quantt sign-in belongs to. The session stays
 *  in the keychain across app restarts and locks (client 2026-10-08: no
 *  reconnecting after every app close), so the app drops it when the active
 *  account is a different one. */
const OWNER_KEY = 'quantt_session_addr';
export async function quanttSessionOwner(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(OWNER_KEY); } catch { return null; }
}

/** Drop the Quantt session (stored copy first, then a best-effort server
 *  logout). Called when the wallet is wiped or the account changes. */
export async function forgetQuanttSession(): Promise<void> {
  try { await SecureStore.deleteItemAsync(OWNER_KEY); } catch { /* nothing stored */ }
  return quantt.signOut();
}

/** Sign in to Quantt with the unlocked wallet seed (inline EIP-712). */
export async function quanttSignIn(seed: string[], accountIdx: number): Promise<QuanttSession> {
  if (!seed?.length) throw new Error('Wallet is locked');
  const wallet = HDNodeWallet.fromPhrase(seed.join(' '), undefined, `m/44'/60'/0'/0/${accountIdx}`);
  const sign = (typed: Eip712TypedData): Promise<string> => {
    const { EIP712Domain: _omit, ...types } = typed.types as Record<string, unknown>;
    void _omit;
    return wallet.signTypedData(
      typed.domain,
      types as Record<string, Array<{ name: string; type: string }>>,
      typed.message,
    );
  };
  const session = await quantt.signIn(wallet.address, sign);
  try { await SecureStore.setItemAsync(OWNER_KEY, wallet.address); } catch { /* the session still works */ }
  return session;
}

/** Bind (or re-verify) the address withdrawals pay out to, signed inline
 *  with the unlocked wallet seed — same challenge → sign → submit shape as
 *  quanttSignIn above. Withdrawals only ever go to this verified address,
 *  never an arbitrary one passed at withdraw time. */
export async function quanttBindWithdrawalAddress(seed: string[], accountIdx: number, address: string): Promise<unknown> {
  if (!seed?.length) throw new Error('Wallet is locked');
  const wallet = HDNodeWallet.fromPhrase(seed.join(' '), undefined, `m/44'/60'/0'/0/${accountIdx}`);
  const typed = await quantt.withdrawalAddressChallenge(address);
  const { EIP712Domain: _omit, ...types } = typed.types as Record<string, unknown>;
  void _omit;
  const signature = await wallet.signTypedData(
    typed.domain,
    types as Record<string, Array<{ name: string; type: string }>>,
    typed.message,
  );
  return quantt.bindWithdrawalAddress({ address, signature });
}
