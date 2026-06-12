/**
 * WalletConnect v2 (Reown WalletKit) — mobile wallet-side client.
 *
 * Mirrors apps/web/lib/walletconnect.ts. The crypto / URL / Buffer
 * polyfills it depends on are loaded in index.js BEFORE this module is
 * ever imported (react-native-get-random-values, url-polyfill,
 * @walletconnect/react-native-compat) — do not import this from a path
 * that bypasses index.js.
 *
 * Project ID resolves from EXPO_PUBLIC_REOWN_PROJECT_ID, falling back
 * to the contracted Thanos project id.
 *
 * Public surface:
 *   - getWalletKit()          — lazy singleton init
 *   - pair(uri)               — start pairing from a wc:… URI
 *   - approveSession / reject — answer a session proposal
 *   - getActiveSessions       — list connected dApps
 *   - disconnectSession       — end a session
 *   - respondRequest / respondError — answer a session_request
 *   - onSessionProposal / onSessionRequest — event subscriptions
 */
import type { IWalletKit, WalletKitTypes } from '@reown/walletkit';
import type { SessionTypes } from '@walletconnect/types';

const MAKALU_CHAIN_ID = 700777;

/* EVM chains the mobile wallet signs on — Makalu + the public chains. */
// SAFETY: advertise ONLY the chains the signing path actually honours.
// Every request handler in this client broadcasts via the MAKALU
// provider regardless of the namespace the dApp asked on - advertising
// mainnet/Polygon/etc. let a dApp think it was getting an eip155:1 tx
// while the wallet broadcast on 700777 (chain-mismatch hazard, flagged
// by the 2026-06 security audit). Re-add ids here ONLY together with
// per-chain provider routing in the request handler.
const SUPPORTED_EVM_CHAIN_IDS = [MAKALU_CHAIN_ID];
const NAMESPACE_CHAINS = SUPPORTED_EVM_CHAIN_IDS.map(id => `eip155:${id}`);

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

const FALLBACK_PROJECT_ID = '6d05d9a84112ca2f7c1bb77a76a18c81';

function getProjectId(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = (typeof process !== 'undefined' && (process as any).env) || {};
  return env.EXPO_PUBLIC_REOWN_PROJECT_ID || env.REOWN_PROJECT_ID || FALLBACK_PROJECT_ID;
}

/* Module-level singleton — re-initialising tears down live sessions. */
let kitPromise: Promise<IWalletKit> | null = null;

export async function getWalletKit(): Promise<IWalletKit> {
  if (kitPromise) return kitPromise;
  kitPromise = (async () => {
    const { Core } = await import('@walletconnect/core');
    const { WalletKit } = await import('@reown/walletkit');
    const core = new Core({ projectId: getProjectId() });
    return WalletKit.init({
      core,
      metadata: {
        name:        'Thanos Wallet',
        description: 'Lithosphere-first multi-chain wallet',
        url:         'https://thanos.fi',
        icons:       ['https://thanos.fi/images/Thanos_Logo.png'],
        redirect:    { native: 'thanoswallet://', universal: 'https://thanos.fi' },
      },
    });
  })();
  return kitPromise;
}

/* ─── Pairing ─────────────────────────────────────────────────────── */

export async function pair(uri: string): Promise<void> {
  const kit = await getWalletKit();
  await kit.pair({ uri: uri.trim() });
}

/* ─── Session proposal handling ───────────────────────────────────── */

/** Namespaces granted on approval — Makalu + every supported EVM chain. */
export function buildApprovalNamespaces(evmAddress: string): SessionTypes.Namespaces {
  return {
    eip155: {
      chains:   NAMESPACE_CHAINS,
      methods:  SUPPORTED_METHODS,
      events:   SUPPORTED_EVENTS,
      accounts: NAMESPACE_CHAINS.map(c => `${c}:${evmAddress}`),
    },
  };
}

export async function approveSession(id: number, evmAddress: string): Promise<void> {
  const kit = await getWalletKit();
  await kit.approveSession({ id, namespaces: buildApprovalNamespaces(evmAddress) });
}

export async function rejectSession(id: number, reason = 'User rejected the session'): Promise<void> {
  const kit = await getWalletKit();
  await kit.rejectSession({ id, reason: { code: 5000, message: reason } });
}

/* ─── Active sessions ─────────────────────────────────────────────── */

export async function getActiveSessions(): Promise<Record<string, SessionTypes.Struct>> {
  const kit = await getWalletKit();
  return kit.getActiveSessions();
}

export async function disconnectSession(topic: string): Promise<void> {
  const kit = await getWalletKit();
  await kit.disconnectSession({ topic, reason: { code: 6000, message: 'User disconnected' } });
}

/* ─── Request responses ───────────────────────────────────────────── */

export async function respondRequest(args: { topic: string; id: number; result: unknown }): Promise<void> {
  const kit = await getWalletKit();
  await kit.respondSessionRequest({
    topic: args.topic,
    response: { id: args.id, jsonrpc: '2.0', result: args.result },
  });
}

export async function respondError(args: {
  topic: string; id: number; code: number; message: string;
}): Promise<void> {
  const kit = await getWalletKit();
  await kit.respondSessionRequest({
    topic: args.topic,
    response: { id: args.id, jsonrpc: '2.0', error: { code: args.code, message: args.message } },
  });
}

/* ─── Event subscriptions ─────────────────────────────────────────── */

export async function onSessionProposal(
  fn: (p: WalletKitTypes.SessionProposal) => void,
): Promise<() => void> {
  const kit = await getWalletKit();
  kit.on('session_proposal', fn);
  return () => kit.off('session_proposal', fn);
}

export async function onSessionRequest(
  fn: (r: WalletKitTypes.SessionRequest) => void,
): Promise<() => void> {
  const kit = await getWalletKit();
  kit.on('session_request', fn);
  return () => kit.off('session_request', fn);
}

export const WC_SUPPORTED_CHAIN_IDS = SUPPORTED_EVM_CHAIN_IDS;
