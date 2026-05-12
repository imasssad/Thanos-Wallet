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

const SUPPORTED_METHODS = [
  'eth_sendTransaction',
  'eth_signTransaction',
  'eth_sign',
  'personal_sign',
  'eth_signTypedData_v4',
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
        url:         (typeof window !== 'undefined' && window.location?.origin) || 'https://devapp.thanos.fi',
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

/** Build the namespaces object for an approval. Covers EIP-155 (Makalu only
 *  in this MVP — multi-chain support is a follow-up). */
export function buildApprovalNamespaces(evmAddress: string): SessionTypes.Namespaces {
  return {
    eip155: {
      chains:   [MAKALU_EIP155],
      methods:  SUPPORTED_METHODS,
      events:   SUPPORTED_EVENTS,
      accounts: [`${MAKALU_EIP155}:${evmAddress}`],
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

/* ─── Event subscriptions ─────────────────────────────────────────────── */

type ProposalListener = (proposal: WalletKitTypes.SessionProposal) => void;
type RequestListener  = (request:  WalletKitTypes.SessionRequest)  => void;

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
