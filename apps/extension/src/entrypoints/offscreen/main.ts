/**
 * Persistent WalletConnect host — runs inside an MV3 offscreen document
 * so the relay WebSocket stays alive even when the popup closes and the
 * background service worker idles out.
 *
 * Lifecycle:
 *   - The background service worker creates this document on install /
 *     startup (chrome.offscreen.createDocument). Chrome keeps the
 *     document alive as long as the manifest's offscreen reasons hold.
 *   - WalletKit boots on first message and stays resident; sessions
 *     resume from disk (kit persistence handles that internally).
 *
 * Message bridge (chrome.runtime):
 *   ← popup → background → here:
 *       wc.pair         { uri }                   →  { ok }
 *       wc.approve      { id, evmAddress }        →  { ok }
 *       wc.reject       { id }                    →  { ok }
 *       wc.disconnect   { topic }                 →  { ok }
 *       wc.list                                   →  { ok, sessions }
 *       wc.get-proposal                           →  { ok, proposal | null }
 *   → emitted back as broadcasts:
 *       wc.event.proposal { id, name, url }
 *       wc.event.session_delete
 *
 * Missed events while the popup was closed are stashed in
 * browser.storage.session so the popup can hydrate them on open.
 */
import { Core } from '@walletconnect/core';
import { WalletKit, type IWalletKit } from '@reown/walletkit';
import type { SessionTypes } from '@walletconnect/types';

const MAKALU = 700777;
// SAFETY: advertise ONLY the chains the signing path actually honours.
// Every request handler in this client broadcasts via the MAKALU
// provider regardless of the namespace the dApp asked on - advertising
// mainnet/Polygon/etc. let a dApp think it was getting an eip155:1 tx
// while the wallet broadcast on 700777 (chain-mismatch hazard, flagged
// by the 2026-06 security audit). Re-add ids here ONLY together with
// per-chain provider routing in the request handler.
const SUPPORTED_EVM = [MAKALU];
const NS_CHAINS = SUPPORTED_EVM.map((c) => `eip155:${c}`);
const METHODS = [
  'eth_sendTransaction', 'eth_signTransaction', 'eth_sign',
  'personal_sign', 'eth_signTypedData_v4',
  'wallet_switchEthereumChain', 'wallet_addEthereumChain',
];
const EVENTS = ['chainChanged', 'accountsChanged'];

interface PendingProposal { id: number; name: string; url: string }
interface PendingRequest {
  id:     number;
  topic:  string;
  method: string;
  params: unknown[];
  name:   string;
}
let kit: IWalletKit | null = null;
let kitPromise: Promise<IWalletKit> | null = null;
let pendingProposal: PendingProposal | null = null;
let pendingRequest:  PendingRequest  | null = null;

function broadcast(msg: object): void {
  // Fire-and-forget; if no listener is alive (popup closed) chrome just
  // logs "could not establish connection" — that's expected.
  browser.runtime.sendMessage(msg).catch(() => { /* no listeners */ });
}

async function getKit(): Promise<IWalletKit> {
  if (kit) return kit;
  if (kitPromise) return kitPromise;
  kitPromise = (async () => {
    const projectId =
      (typeof process !== 'undefined' && process.env?.WXT_REOWN_PROJECT_ID) ||
      '6d05d9a84112ca2f7c1bb77a76a18c81';
    const core = new Core({ projectId });
    const k = await WalletKit.init({
      core,
      metadata: {
        name:        'Thanos Wallet',
        description: 'Lithosphere-first wallet — persistent WalletConnect',
        url:         'https://thanos.fi',
        icons:       ['https://thanos.fi/images/Thanos_Logo.png'],
      },
    });
    k.on('session_proposal', (p) => {
      const proposal: PendingProposal = {
        id:   p.id,
        name: p.params.proposer.metadata?.name ?? 'dApp',
        url:  p.params.proposer.metadata?.url  ?? '',
      };
      pendingProposal = proposal;
      // Stash so a popup that opens AFTER the proposal arrives can see it.
      browser.storage.session.set({ wc_pending_proposal: proposal }).catch(() => {});
      broadcast({ type: 'wc.event.proposal', ...proposal });
    });
    k.on('session_delete', () => {
      broadcast({ type: 'wc.event.session_delete' });
    });
    k.on('session_request', (event) => {
      const session = k.getActiveSessions()[event.topic];
      const req: PendingRequest = {
        id:     event.id,
        topic:  event.topic,
        method: event.params.request.method,
        params: (event.params.request.params as unknown[]) ?? [],
        name:   session?.peer?.metadata?.name ?? 'dApp',
      };
      pendingRequest = req;
      // Stash so a popup that opens AFTER the request arrives can sign.
      browser.storage.session.set({ wc_pending_request: req }).catch(() => {});
      // Badge the toolbar so the user notices when the popup is closed.
      try {
        browser.action.setBadgeText({ text: '1' }).catch(() => {});
        browser.action.setBadgeBackgroundColor({ color: '#3b7af7' }).catch(() => {});
      } catch { /* MV2-style fallback */ }
      broadcast({ type: 'wc.event.request', ...req });
    });
    kit = k;
    return k;
  })();
  return kitPromise;
}

function clearPendingRequestBadge(): void {
  pendingRequest = null;
  browser.storage.session.remove('wc_pending_request').catch(() => {});
  try { browser.action.setBadgeText({ text: '' }).catch(() => {}); } catch { /* ignore */ }
}

function projectSession(s: SessionTypes.Struct) {
  return {
    topic: s.topic,
    name:  s.peer?.metadata?.name ?? 'Unknown dApp',
    url:   s.peer?.metadata?.url  ?? '',
  };
}

/* ───────────── Isolated signer ─────────────────────────────────────────
 * The popup posts `{seed, ...params}` over the message bridge; we build
 * an ethers wallet here, sign, and return the result. The derived
 * private key never lives in the popup process — it's instantiated,
 * used, and immediately released inside this offscreen document.
 *
 * Threat-model improvement: the popup's JS heap can still be inspected
 * (the seed is briefly serialized into postMessage). What changes is
 * that the *signing operation itself* — the cryptographic primitive
 * + the derived key — happens in a sibling document that the popup
 * can't observe via React DevTools or any same-context introspection.
 *
 * Methods:
 *   sign.evm-tx              { seed, hdPath, tx }      → { hash } (broadcasts)
 *   sign.evm-sign-tx         { seed, hdPath, tx }      → { signed } (raw, no broadcast)
 *   sign.evm-personal        { seed, hdPath, message } → { signature }
 *   sign.evm-typed-data      { seed, hdPath, payload } → { signature }
 *   sign.evm-erc20-transfer  { seed, hdPath, tokenAddress, to, amount } → { hash }
 */
async function handleSignMessage(msg: { type: string; [k: string]: unknown }): Promise<unknown> {
  const { Mnemonic, HDNodeWallet, Contract } = await import('ethers');
  const sdk = await import('@thanos/sdk-core');
  type TransactionRequest = import('ethers').TransactionRequest;
  type TypedDataDomain    = import('ethers').TypedDataDomain;
  type TypedDataField     = import('ethers').TypedDataField;

  const seed    = String(msg.seed ?? '');
  const hdPath  = String(msg.hdPath ?? "m/44'/60'/0'/0/0");
  if (!seed) throw new Error('seed required');

  const mnemonic = Mnemonic.fromPhrase(seed);
  const wallet   = HDNodeWallet.fromMnemonic(mnemonic, hdPath);

  try {
    switch (msg.type) {
      case 'sign.evm-tx': {
        const tx = msg.tx as TransactionRequest;
        const provider = sdk.getMakaluProvider();
        const connected = wallet.connect(provider);
        const sent = await connected.sendTransaction(tx);
        return { ok: true, hash: sent.hash };
      }
      case 'sign.evm-sign-tx': {
        const tx = msg.tx as TransactionRequest;
        const signed = await wallet.signTransaction(tx);
        return { ok: true, signed };
      }
      case 'sign.evm-personal': {
        const message = msg.message as string | Uint8Array;
        const signature = await wallet.signMessage(message);
        return { ok: true, signature };
      }
      case 'sign.evm-typed-data': {
        const payload = msg.payload as {
          domain: TypedDataDomain;
          types:  Record<string, Array<TypedDataField>>;
          value:  Record<string, unknown>;
        };
        // Drop the auto-injected EIP712Domain from `types` — ethers v6
        // throws if it's there.
        const cleaned = { ...payload.types };
        delete (cleaned as { EIP712Domain?: unknown }).EIP712Domain;
        const signature = await wallet.signTypedData(payload.domain, cleaned, payload.value);
        return { ok: true, signature };
      }
      case 'sign.evm-erc20-transfer': {
        const tokenAddress = String(msg.tokenAddress ?? '');
        const to           = String(msg.to ?? '');
        const amount       = String(msg.amount ?? '0');
        const provider = sdk.getMakaluProvider();
        const connected = wallet.connect(provider);
        const abi = ['function transfer(address to, uint256 amount) returns (bool)'];
        const c = new Contract(tokenAddress, abi, connected);
        const sent = await c.transfer(to, BigInt(amount));
        return { ok: true, hash: sent.hash };
      }
      default:
        throw new Error(`unknown signer command: ${msg.type}`);
    }
  } finally {
    // No explicit secret-wipe primitive in JS, but releasing the
    // reference lets V8 collect it on the next GC pass.
    // The seed string itself is owned by the caller and lives in
    // the postMessage clone — not much we can do about that.
  }
}

browser.runtime.onMessage.addListener(((raw: unknown, _sender: unknown, sendResponse: (v: unknown) => void) => {
  const msg = raw as { type?: string; __target?: string; [k: string]: unknown };
  // Only the background forwards us tagged messages; ignore the popup's
  // original broadcast (background will proxy it tagged).
  if (msg?.__target !== 'offscreen') return false;
  if (!msg?.type) return false;

  // Signing fast-path — no kit needed, no relay round-trip.
  if (msg.type.startsWith('sign.')) {
    (async () => {
      try {
        const result = await handleSignMessage(msg as { type: string });
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: (e as Error)?.message || 'sign failed' });
      }
    })();
    return true;
  }

  if (!msg.type.startsWith('wc.')) return false;

  (async () => {
    try {
      const k = await getKit();
      switch (msg.type) {
        case 'wc.pair':
          await k.pair({ uri: String(msg.uri ?? '') });
          sendResponse({ ok: true });
          break;
        case 'wc.approve': {
          const evm = String(msg.evmAddress ?? '');
          if (!evm) throw new Error('evmAddress required');
          const accounts = NS_CHAINS.map((c) => `${c}:${evm}`);
          await k.approveSession({
            id: Number(msg.id),
            namespaces: { eip155: { chains: NS_CHAINS, methods: METHODS, events: EVENTS, accounts } },
          });
          pendingProposal = null;
          browser.storage.session.remove('wc_pending_proposal').catch(() => {});
          sendResponse({ ok: true });
          break;
        }
        case 'wc.reject':
          await k.rejectSession({ id: Number(msg.id), reason: { code: 5000, message: 'User rejected' } });
          pendingProposal = null;
          browser.storage.session.remove('wc_pending_proposal').catch(() => {});
          sendResponse({ ok: true });
          break;
        case 'wc.disconnect':
          await k.disconnectSession({ topic: String(msg.topic ?? ''), reason: { code: 6000, message: 'User disconnected' } });
          sendResponse({ ok: true });
          break;
        case 'wc.list':
          sendResponse({ ok: true, sessions: Object.values(k.getActiveSessions()).map(projectSession) });
          break;
        case 'wc.get-proposal':
          sendResponse({ ok: true, proposal: pendingProposal });
          break;
        case 'wc.get-request':
          sendResponse({ ok: true, request: pendingRequest });
          break;
        case 'wc.respond': {
          // The popup signed the request (or chose to reject); relay
          // the result back to the dApp via the kit.
          const topic = String(msg.topic ?? '');
          const id    = Number(msg.id);
          const result = (msg as { result?: unknown }).result;
          const error  = (msg as { error?: { code: number; message: string } }).error;
          await k.respondSessionRequest({
            topic,
            response: error
              ? { id, jsonrpc: '2.0', error }
              : { id, jsonrpc: '2.0', result },
          });
          clearPendingRequestBadge();
          sendResponse({ ok: true });
          break;
        }
        case 'wc.ping':
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: `unknown wc command: ${msg.type}` });
      }
    } catch (e) {
      sendResponse({ ok: false, error: (e as Error)?.message || 'wc command failed' });
    }
  })();
  return true; // we'll respond asynchronously
}) as Parameters<typeof browser.runtime.onMessage.addListener>[0]);

// Boot the kit immediately so any sessions persisted by WalletKit's
// internal storage resume + the relay reconnects without waiting for
// the first popup interaction.
void getKit().catch(() => { /* surfaced on next user action */ });
