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
 */
import * as SecureStore from 'expo-secure-store';
import { HDNodeWallet } from 'ethers';

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

export type SignTypedDataFn = (typedData: Eip712TypedData) => Promise<string>;

interface SessionStore {
  get(): Promise<QuanttSession | null> | QuanttSession | null;
  set(session: QuanttSession | null): Promise<void> | void;
}

type FetchInit = { method?: string; body?: string; headers?: Record<string, string> };

export class QuanttError extends Error {
  constructor(public status: number, public detail: string, public path: string) {
    super(`Quantt ${path} → ${status}${detail ? `: ${detail}` : ''}`);
    this.name = 'QuanttError';
  }
}

const DEFAULT_BASE = 'https://api.quantts.ai';

export class QuanttClient {
  private readonly base: string;
  private readonly store?: SessionStore;
  private mem: QuanttSession | null = null;

  constructor(opts: { baseUrl?: string; store?: SessionStore } = {}) {
    this.base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
    this.store = opts.store;
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    if (!res.ok) throw new QuanttError(res.status, await safeText(res), 'typed-challenge');
    return (await res.json()) as Eip712TypedData;
  }

  async signIn(address: string, sign: SignTypedDataFn): Promise<QuanttSession> {
    const typed = await this.challenge(address);
    const signature = await sign(typed);
    const res = await fetch(`${this.base}/v1/auth/wallet/typed-verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address, signature }),
    });
    if (!res.ok) throw new QuanttError(res.status, await safeText(res), 'typed-verify');
    const session = normalizeSession(await res.json());
    await this.setSession(session);
    return session;
  }

  async refresh(): Promise<QuanttSession | null> {
    const cur = await this.session();
    if (!cur?.refreshToken) return null;
    const res = await fetch(`${this.base}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: cur.refreshToken }),
    });
    if (!res.ok) { await this.setSession(null); return null; }
    const session = normalizeSession(await res.json(), cur);
    await this.setSession(session);
    return session;
  }

  async signOut(): Promise<void> {
    const cur = await this.session();
    if (cur?.accessToken) {
      try { await fetch(`${this.base}/v1/auth/logout`, { method: 'POST', headers: this.authHeaders(cur) }); }
      catch { /* ignore — local clear below is what matters */ }
    }
    await this.setSession(null);
  }

  private authHeaders(s: QuanttSession): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (s.accessToken) h.authorization = `Bearer ${s.accessToken}`;
    return h;
  }

  private async authed<T = unknown>(path: string, init: FetchInit = {}, allowRetry = true): Promise<T> {
    const s = await this.session();
    if (!s) throw new QuanttError(401, 'not signed in', path);
    const res = await fetch(`${this.base}${path}`, {
      method: init.method ?? 'GET',
      body: init.body,
      headers: { ...this.authHeaders(s), ...(init.headers ?? {}) },
    });
    if (res.status === 401 && allowRetry) {
      const refreshed = await this.refresh();
      if (refreshed) return this.authed<T>(path, init, false);
    }
    if (!res.ok) throw new QuanttError(res.status, await safeText(res), path);
    return (await res.json()) as T;
  }

  getOverview(): Promise<QuanttOverview> { return this.authed<QuanttOverview>('/v1/mobile/overview'); }
  getAgent(id: string): Promise<unknown> { return this.authed(`/v1/mobile/agents/${encodeURIComponent(id)}`); }
  setAgentState(id: string, state: string): Promise<unknown> {
    return this.authed(`/v1/mobile/agents/${encodeURIComponent(id)}/state`, { method: 'POST', body: JSON.stringify({ state }) });
  }
  listAlerts(): Promise<unknown> { return this.authed('/v1/mobile/alerts'); }
  copilot(body: unknown): Promise<unknown> { return this.authed('/v1/mobile/copilot', { method: 'POST', body: JSON.stringify(body) }); }
}

async function safeText(res: { text(): Promise<string> }): Promise<string> {
  try { return (await res.text()).slice(0, 300); } catch { return ''; }
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
  if (!accessToken) {
    throw new QuanttError(500, `no access token in response: ${JSON.stringify(o).slice(0, 160)}`, 'typed-verify');
  }
  const user = (o.user && typeof o.user === 'object') ? (o.user as QuanttUser) : prev?.user;
  return { accessToken, refreshToken, user };
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
  return quantt.signIn(wallet.address, sign);
}
