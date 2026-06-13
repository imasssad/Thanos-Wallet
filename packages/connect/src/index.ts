/**
 * thanos-connect — Sign-In With Thanos for third-party dApps.
 *
 * One small import, one method call, and the dApp gets:
 *   • EIP-6963 multi-wallet discovery + fallback to window.thanos
 *   • SIWE-style message construction with nonce + chain binding
 *   • personal_sign signature exchange
 *   • Optional backend round-trip for session issuance
 *
 * Zero dependencies on ethers / viem / wagmi — works anywhere there's
 * a `fetch` and a browser. Pull in a heavier stack only if the dApp
 * already uses one.
 *
 * Minimal browser usage:
 *
 *   import { ThanosConnect } from 'thanos-connect';
 *
 *   const thanos = new ThanosConnect({ appName: 'Ignite DEX' });
 *   const session = await thanos.signIn();
 *   // → { address, signature, message, sessionToken? }
 *
 * Server-side verification uses the same SIWE message format — see
 * docs/INTEGRATE-THANOS-AUTH.md for the backend snippet.
 */

/* ─── Types ─────────────────────────────────────────────────────────── */

export interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

export interface ThanosConnectConfig {
  /** Display name shown in the SIWE statement. Required so the user
   *  can confirm which app they're signing into. */
  appName: string;
  /** Canonical app URL — used in the SIWE message URI. Defaults to
   *  `window.location.origin`. */
  appUrl?: string;
  /** Default chain the dApp wants. Thanos defaults to Lithosphere Makalu
   *  (700777); pass `1` for Ethereum mainnet, `8453` for Base, etc. */
  chainId?: number;
  /** SIWE statement shown to the user when signing in. Defaults to
   *  `Sign in to ${appName} with your Thanos Wallet.` */
  statement?: string;
  /** Backend endpoint that issues a one-time nonce. Defaults to
   *  `/api/auth/nonce?address={address}`. Disable backend round-trip
   *  by passing `null` — in which case signIn() generates the nonce
   *  locally (suitable for dApps that verify on-chain or don't issue
   *  server sessions). */
  nonceEndpoint?: string | null;
  /** Backend endpoint that verifies the signature + issues a session.
   *  Defaults to `/api/auth/verify`. Set to `null` to skip — the
   *  caller verifies the signature client-side or sends to a different
   *  endpoint. */
  verifyEndpoint?: string | null;
  /** Custom fetch implementation — for dApps in non-browser contexts
   *  (RN, Node SSR, edge runtimes) that need an explicit fetch. */
  fetch?: typeof fetch;
  /** Override the EIP-6963 rdns of the wallet to look for. Defaults to
   *  `fi.thanos.wallet`; can be relaxed if you want any EIP-6963 wallet. */
  walletRdns?: string;
  /** Console-log discovery + flow details. Useful while integrating. */
  debug?: boolean;
}

export interface ThanosSession {
  /** The EVM address that signed the SIWE message. EIP-55 checksummed. */
  address: string;
  /** The exact SIWE message that was signed — preserve byte-for-byte
   *  when verifying server-side. */
  message: string;
  /** The signature returned by personal_sign — `0x` + 130 hex chars. */
  signature: string;
  /** The nonce embedded in the message — for server-side replay checks. */
  nonce: string;
  /** Chain id the user authenticated on. */
  chainId: number;
  /** Session token from the backend verify endpoint, if a backend
   *  round-trip happened. Null when the integration is client-only. */
  sessionToken: string | null;
  /** Whatever the verify endpoint returned beyond `sessionToken`. */
  raw?: unknown;
}

export interface DiscoveredWallet {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
}

export class ThanosUnavailable extends Error {
  constructor(message = 'Thanos Wallet is not installed or unavailable in this environment') {
    super(message);
    this.name = 'ThanosUnavailable';
  }
}

export class SignInRejected extends Error {
  constructor(message = 'User rejected the sign-in request') {
    super(message);
    this.name = 'SignInRejected';
  }
}

/* ─── Discovery ─────────────────────────────────────────────────────── */

const DEFAULT_WALLET_RDNS = 'fi.thanos.wallet';
const DISCOVERY_TIMEOUT_MS = 200;
const LITHOSPHERE_MAKALU_CHAIN_ID = 700777;

/**
 * Discover the Thanos provider via EIP-6963 with a window.thanos
 * fallback. Resolves to null when no Thanos wallet is reachable;
 * callers can then render an "Install Thanos" CTA.
 */
export function discoverThanos(
  options: { walletRdns?: string; timeoutMs?: number } = {},
): Promise<DiscoveredWallet | null> {
  const rdns = options.walletRdns ?? DEFAULT_WALLET_RDNS;
  const timeoutMs = options.timeoutMs ?? DISCOVERY_TIMEOUT_MS;

  if (typeof window === 'undefined') return Promise.resolve(null);

  return new Promise((resolve) => {
    let resolved = false;
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent).detail as DiscoveredWallet;
      if (!detail?.info || detail.info.rdns !== rdns) return;
      if (resolved) return;
      resolved = true;
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      resolve(detail);
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    setTimeout(() => {
      if (resolved) return;
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      const legacy = (window as unknown as { thanos?: EIP1193Provider }).thanos;
      if (legacy) {
        resolve({
          info: {
            uuid: 'window.thanos',
            name: 'Thanos Wallet',
            icon: '',
            rdns,
          },
          provider: legacy,
        });
      } else {
        resolve(null);
      }
    }, timeoutMs);
  });
}

/* ─── SIWE message construction ─────────────────────────────────────── */

/**
 * Build an EIP-4361 (SIWE) compatible message. Identical format to
 * what MetaMask + Rainbow + Coinbase Wallet produce, so existing
 * SIWE verifiers (siwe-js, ethers `verifyMessage`, viem) accept it.
 *
 * Exported so dApps that already build SIWE messages can use this for
 * consistent output across paths (browser, mobile, WalletConnect).
 */
export function buildSiweMessage(args: {
  domain:    string;
  address:   string;
  uri:       string;
  statement: string;
  chainId:   number;
  nonce:     string;
  issuedAt?: string;
  expirationTime?: string;
  version?:  string;
}): string {
  const version = args.version ?? '1';
  const issuedAt = args.issuedAt ?? new Date().toISOString();
  const lines = [
    `${args.domain} wants you to sign in with your Ethereum account:`,
    args.address,
    '',
    args.statement,
    '',
    `URI: ${args.uri}`,
    `Version: ${version}`,
    `Chain ID: ${args.chainId}`,
    `Nonce: ${args.nonce}`,
    `Issued At: ${issuedAt}`,
  ];
  if (args.expirationTime) lines.push(`Expiration Time: ${args.expirationTime}`);
  return lines.join('\n');
}

/**
 * Parse a SIWE message back into a structured object — for callers
 * that receive a message body and need the address / nonce / chainId
 * before delegating to a verifier.
 */
export function parseSiweMessage(message: string): {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt?: string;
  expirationTime?: string;
} | null {
  const lines = message.split('\n');
  if (lines.length < 7) return null;
  const m = lines[0].match(/^(.+) wants you to sign in with your Ethereum account:/);
  if (!m) return null;
  const domain = m[1];
  const address = lines[1];
  const statement = lines[3];
  const get = (prefix: string) =>
    lines.find((l) => l.startsWith(prefix))?.slice(prefix.length).trim() ?? '';
  return {
    domain,
    address,
    statement,
    uri:            get('URI:'),
    chainId:        Number(get('Chain ID:')),
    nonce:          get('Nonce:'),
    issuedAt:       get('Issued At:') || undefined,
    expirationTime: get('Expiration Time:') || undefined,
  };
}

/* Cryptographically-strong nonce — same envelope SIWE expects. */
function generateNonce(): string {
  // No weak-randomness fallback on purpose: a predictable SIWE nonce
  // enables replayed sign-ins, which is strictly worse than failing.
  // WebCrypto exists in every runtime this SDK supports (browsers,
  // Node 18+, workers); anything without it should not be doing auth.
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('thanos-connect: WebCrypto unavailable — cannot generate a secure SIWE nonce');
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ─── Main class ─────────────────────────────────────────────────────── */

export class ThanosConnect {
  private readonly cfg: Required<Omit<ThanosConnectConfig, 'fetch' | 'nonceEndpoint' | 'verifyEndpoint' | 'walletRdns' | 'debug' | 'statement' | 'appUrl' | 'chainId'>> & {
    fetch:           typeof fetch;
    nonceEndpoint:   string | null;
    verifyEndpoint:  string | null;
    walletRdns:      string;
    debug:           boolean;
    statement:       string;
    appUrl:          string;
    chainId:         number;
  };
  private provider: EIP1193Provider | null = null;
  private discoveredInfo: DiscoveredWallet['info'] | null = null;

  constructor(config: ThanosConnectConfig) {
    if (!config.appName) throw new Error('ThanosConnect: appName is required');
    const appUrl =
      config.appUrl ??
      (typeof window !== 'undefined' ? window.location.origin : 'https://localhost');
    this.cfg = {
      appName:        config.appName,
      appUrl,
      chainId:        config.chainId ?? LITHOSPHERE_MAKALU_CHAIN_ID,
      statement:      config.statement ?? `Sign in to ${config.appName} with your Thanos Wallet.`,
      nonceEndpoint:  config.nonceEndpoint === undefined ? '/api/auth/nonce' : config.nonceEndpoint,
      verifyEndpoint: config.verifyEndpoint === undefined ? '/api/auth/verify' : config.verifyEndpoint,
      fetch:          config.fetch ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : ((() => { throw new Error('fetch not available in this environment'); }) as typeof fetch)),
      walletRdns:     config.walletRdns ?? DEFAULT_WALLET_RDNS,
      debug:          config.debug ?? false,
    };
  }

  private log(...args: unknown[]) {
    if (this.cfg.debug) console.debug('[thanos-connect]', ...args);
  }

  /** Synchronous "is window.thanos present" check. Doesn't open a
   *  popup. Use for an initial render gate while you wait for the
   *  full async discovery to resolve. */
  isThanosInstalled(): boolean {
    if (typeof window === 'undefined') return false;
    return !!(window as unknown as { thanos?: unknown }).thanos;
  }

  /** Full EIP-6963 discovery — returns true when a Thanos-rdns wallet
   *  announces itself within the discovery window. */
  async isThanosAvailable(): Promise<boolean> {
    const found = await discoverThanos({ walletRdns: this.cfg.walletRdns });
    return !!found;
  }

  /** Resolve the EIP-1193 provider. Cached after the first successful
   *  discovery — every subsequent call returns the same handle. */
  async getProvider(): Promise<EIP1193Provider> {
    if (this.provider) return this.provider;
    const discovered = await discoverThanos({ walletRdns: this.cfg.walletRdns });
    if (!discovered) throw new ThanosUnavailable();
    this.provider = discovered.provider;
    this.discoveredInfo = discovered.info;
    this.log('discovered', discovered.info);
    return this.provider;
  }

  /** Get the wallet metadata announced via EIP-6963 (name, icon,
   *  rdns). Useful for "connected to: …" UI. Null when the discovery
   *  fell through to window.thanos (no metadata available). */
  getWalletInfo(): DiscoveredWallet['info'] | null {
    return this.discoveredInfo;
  }

  /**
   * Pull a nonce from the backend (or generate one locally when
   * `nonceEndpoint` is `null`).
   *
   * Backend contract:
   *   GET {nonceEndpoint}?address={addr}  →  text/plain nonce (alphanum)
   *
   * The endpoint should:
   *   • generate a fresh nonce
   *   • store it server-side keyed by (address, nonce) with a 5-10 min TTL
   *   • return it as the response body (no JSON wrapping)
   */
  async fetchNonce(address: string): Promise<string> {
    if (this.cfg.nonceEndpoint === null) {
      const nonce = generateNonce();
      this.log('fetchNonce: local nonce', nonce);
      return nonce;
    }
    const url = `${this.cfg.nonceEndpoint}${this.cfg.nonceEndpoint.includes('?') ? '&' : '?'}address=${encodeURIComponent(address)}`;
    this.log('fetchNonce: GET', url);
    const res = await this.cfg.fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error(`fetchNonce: ${res.status} ${res.statusText}`);
    const nonce = (await res.text()).trim();
    if (!nonce) throw new Error('fetchNonce: empty response');
    return nonce;
  }

  /**
   * Prompt the connected wallet to add + switch to Lithosphere Makalu
   * (EIP-3085 wallet_addEthereumChain, then EIP-3326 switch). Called
   * automatically by signIn() so every dApp using this SDK lands users
   * on the right network — generic wallets (MetaMask etc.) get the
   * add-network sheet; the Thanos wallet itself is already on Makalu
   * and treats both calls as no-ops. Failures are non-fatal: a user
   * declining the prompt can still sign in, the dApp just sees a
   * different chainId and should handle it.
   */
  async ensureMakaluNetwork(): Promise<boolean> {
    const provider = await this.getProvider();
    const chainIdHex = `0x${LITHOSPHERE_MAKALU_CHAIN_ID.toString(16)}`;
    try {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: chainIdHex,
          chainName: 'Lithosphere Makalu',
          rpcUrls: ['https://rpc.litho.ai'],
          blockExplorerUrls: ['https://makalu.litho.ai/'],
          nativeCurrency: { name: 'Lithosphere', symbol: 'LITHO', decimals: 18 },
        }],
      });
      // Some wallets add without switching — make the switch explicit.
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainIdHex }],
      });
      return true;
    } catch (err) {
      this.log('ensureMakaluNetwork declined/unsupported', err);
      return false;
    }
  }

  /**
   * Full sign-in flow.
   *
   *   1. Discover provider
   *   2. eth_requestAccounts (opens approval popup)
   *   3. Prompt to add + switch to Lithosphere Makalu (non-fatal)
   *   4. Fetch nonce from backend (or generate locally)
   *   5. Build SIWE message + sign via personal_sign
   *   6. POST {message, signature, address} to verify endpoint (if set)
   *   7. Return the session with the backend's response
   */
  async signIn(overrides: { statement?: string; chainId?: number } = {}): Promise<ThanosSession> {
    const provider = await this.getProvider();

    // Connect — opens the wallet popup the first time.
    let accounts: string[];
    try {
      accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
    } catch (err) {
      const e = err as { code?: number; message?: string };
      if (e.code === 4001 || /user rejected|denied/i.test(e.message ?? '')) {
        throw new SignInRejected();
      }
      throw err;
    }
    const address = accounts?.[0];
    if (!address) throw new Error('eth_requestAccounts returned no accounts');

    // Land the user on Makalu before signing (client requirement
    // 2026-06-12: every auth surface prompts the network add). Declines
    // are tolerated — the SIWE message still records the real chainId.
    await this.ensureMakaluNetwork();

    // Build SIWE message.
    const chainId = overrides.chainId ?? this.cfg.chainId;
    const statement = overrides.statement ?? this.cfg.statement;
    const nonce = await this.fetchNonce(address);
    const domain = typeof window !== 'undefined' ? window.location.host : new URL(this.cfg.appUrl).host;
    const message = buildSiweMessage({
      domain,
      address,
      uri:       this.cfg.appUrl,
      statement,
      chainId,
      nonce,
      issuedAt:  new Date().toISOString(),
      expirationTime: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    // Sign.
    let signature: string;
    try {
      signature = (await provider.request({
        method: 'personal_sign',
        params: [message, address],
      })) as string;
    } catch (err) {
      const e = err as { code?: number; message?: string };
      if (e.code === 4001 || /user rejected|denied/i.test(e.message ?? '')) {
        throw new SignInRejected();
      }
      throw err;
    }
    this.log('signed', { address, chainId, nonce });

    // Backend verify — optional.
    let sessionToken: string | null = null;
    let raw: unknown = undefined;
    if (this.cfg.verifyEndpoint !== null) {
      this.log('verify: POST', this.cfg.verifyEndpoint);
      const res = await this.cfg.fetch(this.cfg.verifyEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, signature, address }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`verify: ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`);
      }
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('json')) {
        raw = await res.json();
        sessionToken = (raw as { sessionToken?: string } | null)?.sessionToken ?? null;
      } else {
        sessionToken = (await res.text()).trim();
      }
    }

    return { address, message, signature, nonce, chainId, sessionToken, raw };
  }

  /** Disconnect — drops the cached provider handle but does NOT
   *  revoke wallet-side permission (browsers don't let dApps do that
   *  programmatically; the user manages it from the extension). */
  disconnect(): void {
    this.provider = null;
    this.discoveredInfo = null;
  }

  /** Pass-through to provider.on for accountsChanged / chainChanged
   *  / disconnect. Returns an unsubscribe function. */
  async on(
    event: 'accountsChanged' | 'chainChanged' | 'disconnect' | 'connect',
    handler: (...args: unknown[]) => void,
  ): Promise<() => void> {
    const provider = await this.getProvider();
    provider.on?.(event, handler);
    return () => provider.removeListener?.(event, handler);
  }

  /** Sign typed data (EIP-712) — for dApps that need order signing,
   *  permit signatures, etc. on top of the SIWT auth flow. */
  async signTypedData(domain: object, types: object, value: object): Promise<string> {
    const provider = await this.getProvider();
    const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
    const address = accounts?.[0];
    if (!address) throw new ThanosUnavailable('Not connected — call signIn() first');
    return (await provider.request({
      method: 'eth_signTypedData_v4',
      params: [address, JSON.stringify({ domain, types, primaryType: Object.keys(types)[0], message: value })],
    })) as string;
  }
}

/* ─── Convenience function — for one-line auth ──────────────────────── */

let defaultInstance: ThanosConnect | null = null;

/** Convenience: a single global instance for dApps that only need
 *  one sign-in flow. `signInWithThanos({appName})` works without the
 *  caller managing class lifetime. */
export async function signInWithThanos(config: ThanosConnectConfig): Promise<ThanosSession> {
  if (!defaultInstance || defaultInstance['cfg'].appName !== config.appName) {
    defaultInstance = new ThanosConnect(config);
  }
  return defaultInstance.signIn();
}
