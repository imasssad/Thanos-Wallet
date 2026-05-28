/**
 * WalletConnect v2 (Reown) wallet-side client.
 *
 * Initialises once per browser session, then exposes:
 *   - pair(uri)            — start a new pairing from a wc:... URI
 *   - approveSession({...})— accept an incoming session proposal
 *   - rejectSession(id)    — reject an incoming proposal
 *   - respond({...})       — answer a session_request (sign or sendTx)
 *   - on(event, cb)        — subscribe to lifecycle events
 *
 * The actual signing is delegated to apps/web/lib/signer.ts so this module
 * doesn't need to know how keys are derived.
 *
 * Project ID lives in NEXT_PUBLIC_REOWN_PROJECT_ID (set in .env.example).
 */

import type { WalletKitTypes } from '@reown/walletkit';
import type { SessionTypes, ProposalTypes } from '@walletconnect/types';

const MAKALU_CHAIN_ID = 700777;
const MAKALU_EIP155 = `eip155:${MAKALU_CHAIN_ID}`;

/* Every EVM chain the wallet can sign on. Kept in sync with
   apps/web/lib/evm-chains.ts; we keep the IDs inline here so this
   module has no React/Next dependency. */
const SUPPORTED_EVM_CHAIN_IDS: number[] = [
  MAKALU_CHAIN_ID,
  1, 56, 137, 8453, 42161, 59144, 10, 43114,
];
const SUPPORTED_EVM_NAMESPACE_CHAINS = SUPPORTED_EVM_CHAIN_IDS.map(id => `eip155:${id}`);

const SUPPORTED_METHODS = [
  'eth_sendTransaction',
  'eth_signTransaction',
  'eth_sign',
  'personal_sign',
  'eth_signTypedData_v4',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
];
const SUPPORTED_EVENTS = ['chainChanged', 'accountsChanged'];

/* Module-level singleton — re-initialising on every navigation is wasteful
   and would tear down active sessions. The Promise is shared so multiple
   callers during boot await the same init. */
let kitPromise: Promise<import('@reown/walletkit').IWalletKit> | null = null;

async function getProjectId(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = (typeof process !== 'undefined' && (process as any).env) || {};
  const id = env.NEXT_PUBLIC_REOWN_PROJECT_ID || env.REOWN_PROJECT_ID || env.WALLETCONNECT_PROJECT_ID;
  if (!id) throw new Error('NEXT_PUBLIC_REOWN_PROJECT_ID is not set');
  return id;
}

export async function getWalletKit(): Promise<import('@reown/walletkit').IWalletKit> {
  if (kitPromise) return kitPromise;
  kitPromise = (async () => {
    const { Core } = await import('@walletconnect/core');
    const { WalletKit } = await import('@reown/walletkit');
    const projectId = await getProjectId();
    const core = new Core({ projectId });
    return WalletKit.init({
      core,
      metadata: {
        name:        'Thanos Wallet',
        description: 'Lithosphere-first multi-chain wallet',
        url:         (typeof window !== 'undefined' && window.location?.origin) || 'https://thanos.fi',
        icons:       ['/images/Thanos_Logo.png'],
      },
    });
  })();
  return kitPromise;
}

/* ─── Pairing ─────────────────────────────────────────────────────────── */

/** Start a new pairing from a wc:1?... URI (typically copied or QR-scanned). */
export async function pair(uri: string): Promise<void> {
  const kit = await getWalletKit();
  await kit.pair({ uri: uri.trim() });
}

/* ─── Session proposal handling ───────────────────────────────────────── */

export interface SessionProposalSummary {
  id:       number;
  origin:   string;            // dApp URL
  name:     string;            // dApp display name
  iconUrl:  string | null;
  /** Convenience: namespaces the dApp wants. */
  required: ProposalTypes.RequiredNamespace;
}

/** Build the namespaces object for an approval. Covers Makalu plus
 *  every public EVM chain the wallet's signer knows how to sign on. */
export function buildApprovalNamespaces(evmAddress: string): SessionTypes.Namespaces {
  return {
    eip155: {
      chains:   SUPPORTED_EVM_NAMESPACE_CHAINS,
      methods:  SUPPORTED_METHODS,
      events:   SUPPORTED_EVENTS,
      accounts: SUPPORTED_EVM_NAMESPACE_CHAINS.map(c => `${c}:${evmAddress}`),
    },
  };
}

export async function approveSession(id: number, evmAddress: string): Promise<void> {
  const kit = await getWalletKit();
  await kit.approveSession({
    id,
    namespaces: buildApprovalNamespaces(evmAddress),
  });
}

export async function rejectSession(id: number, reason = 'User rejected the session'): Promise<void> {
  const kit = await getWalletKit();
  await kit.rejectSession({
    id,
    reason: { code: 5000, message: reason },
  });
}

/* ─── Active sessions ─────────────────────────────────────────────────── */

export async function getActiveSessions() {
  const kit = await getWalletKit();
  return kit.getActiveSessions();
}

/**
 * Count active sessions WITHOUT booting the kit. Returns null if
 * WalletConnect hasn't been initialised this session (so callers like the
 * dashboard don't open a relay socket just to render a badge).
 */
export async function getActiveSessionCountIfReady(): Promise<number | null> {
  if (!kitPromise) return null;
  try {
    const kit = await kitPromise;
    return Object.keys(kit.getActiveSessions()).length;
  } catch {
    return null;
  }
}

export async function disconnectSession(topic: string): Promise<void> {
  const kit = await getWalletKit();
  await kit.disconnectSession({
    topic,
    reason: { code: 6000, message: 'User disconnected' },
  });
}

/* ─── Request responses ───────────────────────────────────────────────── */

/** Respond to a session_request event. Caller resolves `result` from the
 *  signer (e.g. tx hash for eth_sendTransaction, raw signature for
 *  personal_sign). */
export async function respondRequest(args: {
  topic:  string;
  id:     number;
  result: unknown;
}): Promise<void> {
  const kit = await getWalletKit();
  await kit.respondSessionRequest({
    topic: args.topic,
    response: { id: args.id, jsonrpc: '2.0', result: args.result },
  });
}

export async function respondError(args: {
  topic:   string;
  id:      number;
  code:    number;
  message: string;
}): Promise<void> {
  const kit = await getWalletKit();
  await kit.respondSessionRequest({
    topic: args.topic,
    response: { id: args.id, jsonrpc: '2.0', error: { code: args.code, message: args.message } },
  });
}

/* ─── Session-event emit ─────────────────────────────────────────────── */

/** Push a `chainChanged` event into an active session so the dApp's
 *  injected provider re-reads chain state.  EIP-1193 spec — the data is
 *  the hex chainId string. */
export async function emitChainChanged(topic: string, chainId: number): Promise<void> {
  const kit = await getWalletKit();
  await kit.emitSessionEvent({
    topic,
    event: { name: 'chainChanged', data: `0x${chainId.toString(16)}` },
    chainId: `eip155:${chainId}`,
  });
}

/* ─── Event subscriptions ─────────────────────────────────────────────── */

type ProposalListener = (proposal: WalletKitTypes.SessionProposal) => void;
type RequestListener  = (request:  WalletKitTypes.SessionRequest)  => void;
type SessionLifecycleListener = (event: { topic: string }) => void;

export async function onSessionProposal(fn: ProposalListener) {
  const kit = await getWalletKit();
  kit.on('session_proposal', fn);
  return () => kit.off('session_proposal', fn);
}

export async function onSessionRequest(fn: RequestListener) {
  const kit = await getWalletKit();
  kit.on('session_request', fn);
  return () => kit.off('session_request', fn);
}

/**
 * Fired whenever an active session is removed — for any reason:
 *   - User pressed Disconnect on the wallet side (we called `disconnectSession`).
 *   - dApp called disconnect from its end.
 *   - Session TTL expired (WalletKit garbage-collects stale sessions).
 *   - Relay-level cleanup.
 *
 * WalletKit v1.5 unifies all of these into `session_delete` rather than
 * exposing separate `session_update` / `session_expire` events (those
 * names exist in lower-level libs but not in WalletKit's public surface
 * — see WalletKitTypes.Event). UI code should drop the topic from the
 * connected-apps list and surface a toast if the user didn't initiate.
 */
export async function onSessionDelete(fn: SessionLifecycleListener) {
  const kit = await getWalletKit();
  const handler = (event: { topic: string }) => fn({ topic: event.topic });
  kit.on('session_delete', handler);
  return () => kit.off('session_delete', handler);
}

/**
 * Fired when a pending session proposal expires before the user accepts
 * or rejects it. The proposal id passed here matches the id from
 * `onSessionProposal`; UI code should drop any approval modal it was
 * about to render.
 */
export async function onProposalExpire(fn: (event: { id: number }) => void) {
  const kit = await getWalletKit();
  const handler = (event: { id: number }) => fn({ id: event.id });
  kit.on('proposal_expire', handler);
  return () => kit.off('proposal_expire', handler);
}

/**
 * Fired when a pending session request (e.g. an unsigned tx) expires
 * before the user approves or rejects it. The id matches the request
 * from `onSessionRequest`; UI code should close any signing modal that
 * referenced it and surface "this request expired — try again".
 */
export async function onSessionRequestExpire(fn: (event: { id: number }) => void) {
  const kit = await getWalletKit();
  const handler = (event: { id: number }) => fn({ id: event.id });
  kit.on('session_request_expire', handler);
  return () => kit.off('session_request_expire', handler);
}
