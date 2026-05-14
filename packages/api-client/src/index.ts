/**
 * @thanos/api-client
 *
 * Platform-agnostic client for the Thanos backend (services/api).
 * Used by all four clients (web, desktop, mobile, extension) so the auth
 * surface stays consistent and refresh-token rotation is implemented once.
 *
 * Usage:
 *   const api = new ThanosApiClient({
 *     baseUrl: '/api',
 *     platform: 'web',
 *     storage: webStorageAdapter, // or asyncStorageAdapter
 *   });
 *   await api.register({ email, password });
 *   await api.login({ email, password });
 *   const me = await api.me();
 *   await api.logout();
 */

/* ─── Storage adapter ─────────────────────────────────────────────────────
   Async-only API so the same code path works for localStorage (sync but
   wrappable) and React Native AsyncStorage (genuinely async). */
export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Wraps window.localStorage. For web / desktop / extension. */
export function createWebStorageAdapter(prefix = 'thanos.api.'): StorageAdapter {
  return {
    async get(key)   { return globalThis.localStorage?.getItem(prefix + key) ?? null; },
    async set(key, v){ globalThis.localStorage?.setItem(prefix + key, v); },
    async remove(key){ globalThis.localStorage?.removeItem(prefix + key); },
  };
}

/** Build an adapter from any AsyncStorage-shaped object (RN). */
export function createAsyncStorageAdapter(
  asyncStorage: { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; removeItem(k: string): Promise<void> },
  prefix = 'thanos.api.'
): StorageAdapter {
  return {
    async get(key)    { return asyncStorage.getItem(prefix + key); },
    async set(key, v) { return asyncStorage.setItem(prefix + key, v); },
    async remove(key) { return asyncStorage.removeItem(prefix + key); },
  };
}

/** In-memory adapter — fallback for SSR / tests. */
export function createMemoryStorageAdapter(): StorageAdapter {
  const m = new Map<string, string>();
  return {
    async get(key)    { return m.get(key) ?? null; },
    async set(key, v) { m.set(key, v); },
    async remove(key) { m.delete(key); },
  };
}

/* ─── Types matching services/api/src/routes/auth.ts ─────────────────── */
export type Platform = 'web' | 'desktop' | 'mobile' | 'extension';

export interface AuthUser {
  id:           string;
  email:        string;
  displayName:  string | null;
}

export interface AuthTokens {
  accessToken:  string;
  refreshToken: string;
}

export interface AuthSuccess extends AuthTokens {
  user: AuthUser;
}

export interface SessionInfo {
  id:          string;
  ip_address:  string | null;
  user_agent:  string | null;
  platform:    string | null;
  created_at:  string;
  expires_at:  string;
}

export class ApiError extends Error {
  status: number;
  body:   unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API error ${status}`);
    this.status = status;
    this.body   = body;
  }
}

/* ─── Address book (matches services/api/src/routes/contacts.ts) ───── */
export type ContactAddressType = 'evm' | 'litho' | 'bitcoin' | 'solana' | 'cosmos';

export interface ContactDto {
  id:           string;
  name:         string;
  address:      string;
  addressType:  ContactAddressType | null;
  chainId:      number | null;
  notes:        string | null;
  isFavourite:  boolean;
  createdAt:    string;
  updatedAt:    string;
}

export interface ContactCreate {
  name:         string;
  address:      string;
  addressType?: ContactAddressType;
  chainId?:     number;
  notes?:       string;
  isFavourite?: boolean;
}

export interface ContactPatch {
  name?:        string;
  notes?:       string | null;
  isFavourite?: boolean;
}

/* ─── DNNS (matches services/api/src/routes/dnns.ts) ───────────────── */
export interface DnnsRecord {
  name:       string;
  chainId:    number;
  address:    string | null;
  bech32?:    string | null;
  resolver?:  string | null;
  avatarUrl?: string | null;
  bio?:       string | null;
  cachedAt:   string;
  source:     'cache' | 'chain';
}

/* ─── Client config ─────────────────────────────────────────────────── */
export interface ThanosApiClientOptions {
  /** Base URL for the backend, e.g. '/api' or 'https://devapp.thanos.fi/api' */
  baseUrl:  string;
  /** x-platform header value sent with every request */
  platform: Platform;
  /** Storage for access + refresh tokens */
  storage:  StorageAdapter;
  /** Optional fetch override (testing / non-browser env) */
  fetch?:   typeof fetch;
}

const ACCESS_KEY  = 'access';
const REFRESH_KEY = 'refresh';

/* ─── Client ───────────────────────────────────────────────────────── */
export class ThanosApiClient {
  private baseUrl:  string;
  private platform: Platform;
  private storage:  StorageAdapter;
  private _fetch:   typeof fetch;

  /** Promise of an in-flight refresh, deduped across concurrent 401s. */
  private refreshing: Promise<string | null> | null = null;

  constructor(opts: ThanosApiClientOptions) {
    this.baseUrl  = opts.baseUrl.replace(/\/$/, '');
    this.platform = opts.platform;
    this.storage  = opts.storage;
    this._fetch   = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /* Public auth surface ------------------------------------------------ */

  async register(input: { email: string; password: string; displayName?: string }): Promise<AuthSuccess> {
    const data = await this.req<AuthSuccess>('POST', '/auth/register', input, /* auth */ false);
    await this.persistTokens(data);
    return data;
  }

  async login(input: { email: string; password: string }): Promise<AuthSuccess> {
    const data = await this.req<AuthSuccess>('POST', '/auth/login', input, false);
    await this.persistTokens(data);
    return data;
  }

  async logout(): Promise<void> {
    try {
      await this.req<{ ok: true }>('POST', '/auth/logout', {}, /* auth */ true);
    } catch (e) {
      // Even if the server rejects, clear local tokens.
    }
    await this.clearTokens();
  }

  async me(): Promise<AuthUser & { mfa_enabled: boolean; created_at: string }> {
    return this.req('GET', '/auth/me', undefined, true);
  }

  async sessions(): Promise<{ sessions: SessionInfo[] }> {
    return this.req('GET', '/auth/sessions', undefined, true);
  }

  async revokeSession(sessionId: string): Promise<{ ok: true }> {
    return this.req('DELETE', `/auth/sessions/${encodeURIComponent(sessionId)}`, undefined, true);
  }

  /* ─── Address book (cloud-synced contacts) ───────────────────────
     Wraps services/api/src/routes/contacts.ts. All four endpoints
     require an auth'd session; the local-only fallback in
     apps/web/lib/address-book.ts handles signed-out users. */

  async listContacts(): Promise<{ items: ContactDto[] }> {
    return this.req('GET', '/contacts', undefined, true);
  }

  async createContact(input: ContactCreate): Promise<{ item: ContactDto }> {
    return this.req('POST', '/contacts', input, true);
  }

  async updateContact(id: string, patch: ContactPatch): Promise<{ item: ContactDto }> {
    return this.req('PUT', `/contacts/${encodeURIComponent(id)}`, patch, true);
  }

  async deleteContact(id: string): Promise<void> {
    await this.req('DELETE', `/contacts/${encodeURIComponent(id)}`, undefined, true);
  }

  /* ─── DNNS resolver ──────────────────────────────────────────────
     Public endpoints (no auth). Cached on the server side. */

  async resolveDnnsName(name: string, chainId?: number): Promise<{ record: DnnsRecord | null }> {
    const q = new URLSearchParams({ name });
    if (chainId) q.set('chainId', String(chainId));
    return this.req('GET', `/dnns/resolve?${q.toString()}`, undefined, false);
  }

  async lookupDnnsAddress(address: string, chainId?: number): Promise<{ record: DnnsRecord | null }> {
    const q = new URLSearchParams({ address });
    if (chainId) q.set('chainId', String(chainId));
    return this.req('GET', `/dnns/lookup?${q.toString()}`, undefined, false);
  }

  /** Convenience — true if we have stored tokens. Doesn't validate them. */
  async isAuthenticated(): Promise<boolean> {
    return (await this.storage.get(ACCESS_KEY)) !== null;
  }

  /* Internal ----------------------------------------------------------- */

  private async req<T>(
    method: string,
    path: string,
    body: unknown,
    auth: boolean,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-platform':   this.platform,
    };
    if (auth) {
      const access = await this.storage.get(ACCESS_KEY);
      if (access) headers['authorization'] = `Bearer ${access}`;
    }

    const res = await this._fetch(this.baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // Auto-refresh on 401 if we're an authed call and have a refresh token
    if (res.status === 401 && auth) {
      const newAccess = await this.tryRefresh();
      if (newAccess) {
        headers['authorization'] = `Bearer ${newAccess}`;
        const retry = await this._fetch(this.baseUrl + path, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return this.parseResponse<T>(retry);
      }
    }

    return this.parseResponse<T>(res);
  }

  private async parseResponse<T>(res: Response): Promise<T> {
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) throw new ApiError(res.status, json, (json as { error?: string })?.error);
    return json as T;
  }

  /** Deduped refresh — concurrent callers wait for one in-flight refresh. */
  private async tryRefresh(): Promise<string | null> {
    if (this.refreshing) return this.refreshing;

    this.refreshing = (async () => {
      try {
        const refresh = await this.storage.get(REFRESH_KEY);
        if (!refresh) return null;

        const res = await this._fetch(this.baseUrl + '/auth/refresh', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-platform': this.platform },
          body: JSON.stringify({ refreshToken: refresh }),
        });
        if (!res.ok) {
          await this.clearTokens();
          return null;
        }
        const data = await res.json() as AuthTokens;
        await this.persistTokens(data);
        return data.accessToken;
      } finally {
        this.refreshing = null;
      }
    })();

    return this.refreshing;
  }

  private async persistTokens(t: AuthTokens) {
    await this.storage.set(ACCESS_KEY,  t.accessToken);
    await this.storage.set(REFRESH_KEY, t.refreshToken);
  }

  private async clearTokens() {
    await this.storage.remove(ACCESS_KEY);
    await this.storage.remove(REFRESH_KEY);
  }
}
