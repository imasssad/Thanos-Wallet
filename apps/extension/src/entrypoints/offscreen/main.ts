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
import { isExtensionSender, type MessageSenderLike } from '../../lib/message-sender';

// The signing path routes per-chain (sign.evm-tx needs the caller's chainId +
// rpcUrl and pins tx.chainId), so WalletConnect advertises the built-in
// switchable set: Lithosphere Mainnet + the 8 external EVM chains. Keep this
// in sync with lib/dapp-chains.ts DAPP_CHAINS (a literal here: the offscreen
// document doesn't load the storage-backed chain registry). Makalu is no
// longer built in (2026-09-29).
const SUPPORTED_EVM = [9005, 1, 56, 137, 8453, 42161, 59144, 10, 43114];
const NS_CHAINS = SUPPORTED_EVM.map((c) => `eip155:${c}`);
const METHODS = [
  'eth_sendTransaction', 'eth_signTransaction', 'eth_sign',
  'personal_sign', 'eth_signTypedData_v4',
  'wallet_switchEthereumChain', 'wallet_addEthereumChain',
];
const EVENTS = ['chainChanged', 'accountsChanged'];

/** WalletConnect's own Verify result (THN-03) — never the dApp's own
 *  self-declared metadata.url, which proves nothing about where the
 *  request actually came from. */
interface WcVerified { origin?: string; validation?: 'VALID' | 'INVALID' | 'UNKNOWN'; isScam?: boolean }
interface PendingProposal { id: number; name: string; url: string; verified?: WcVerified }
interface PendingRequest {
  id:     number;
  topic:  string;
  method: string;
  params: unknown[];
  name:   string;
  /** CAIP-2 chain the dApp sent the request on ("eip155:9005") — the popup
   *  reviews and signs it on exactly this chain. */
  chainId?: string;
  verified?: WcVerified;
}
let kit: IWalletKit | null = null;
let kitPromise: Promise<IWalletKit> | null = null;
let pendingProposal: PendingProposal | null = null;
let pendingRequest:  PendingRequest  | null = null;
/* Requests wait in line: the popup shows the head, and a new request never
   replaces the one the user is looking at (a dApp could otherwise swap it
   just before Approve). pendingRequest is always requestQueue[0]. */
let requestQueue: PendingRequest[] = [];

function setBadge(text: string): void {
  try {
    browser.action.setBadgeText({ text }).catch(() => {});
    if (text) browser.action.setBadgeBackgroundColor({ color: '#3b7af7' }).catch(() => {});
  } catch { /* MV2-style fallback */ }
}

/** Publish the head of the queue (or clear it) to storage, badge and popup. */
function showQueueHead(): void {
  const head = requestQueue[0] ?? null;
  pendingRequest = head;
  if (head) {
    // Stash so a popup that opens AFTER the request arrives can sign.
    browser.storage.session.set({ wc_pending_request: head }).catch(() => {});
    setBadge(String(requestQueue.length));
    broadcast({ type: 'wc.event.request', ...head });
  } else {
    browser.storage.session.remove('wc_pending_request').catch(() => {});
    setBadge('');
  }
}

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
      const verified = (p as unknown as { verifyContext?: { verified?: WcVerified } }).verifyContext?.verified;
      const proposal: PendingProposal = {
        id:   p.id,
        name: p.params.proposer.metadata?.name ?? 'dApp',
        // THN-03: prefer the WalletConnect-verified origin over the dApp's
        // own self-declared metadata.url.
        url:  verified?.origin || p.params.proposer.metadata?.url || '',
        verified,
      };
      pendingProposal = proposal;
      // Stash so a popup that opens AFTER the proposal arrives can see it.
      browser.storage.session.set({ wc_pending_proposal: proposal }).catch(() => {});
      broadcast({ type: 'wc.event.proposal', ...proposal });
    });
    k.on('session_delete', (event: { topic?: string }) => {
      // Requests from a session that's gone can't be answered any more.
      const before = requestQueue.length;
      requestQueue = requestQueue.filter((r) => r.topic !== event?.topic);
      if (requestQueue.length !== before) showQueueHead();
      broadcast({ type: 'wc.event.session_delete' });
    });
    k.on('session_request', (event) => {
      const session = k.getActiveSessions()[event.topic];
      const verified = (event as unknown as { verifyContext?: { verified?: WcVerified } }).verifyContext?.verified;
      const req: PendingRequest = {
        id:     event.id,
        topic:  event.topic,
        method: event.params.request.method,
        params: (event.params.request.params as unknown[]) ?? [],
        name:   session?.peer?.metadata?.name ?? 'dApp',
        chainId: typeof event.params.chainId === 'string' ? event.params.chainId : undefined,
        verified,
      };
      requestQueue.push(req);
      // Badge the toolbar so the user notices when the popup is closed; only
      // the head is shown — later requests wait their turn.
      if (requestQueue.length === 1) showQueueHead();
      else setBadge(String(requestQueue.length));
    });
    kit = k;
    return k;
  })();
  return kitPromise;
}


function projectSession(s: SessionTypes.Struct) {
  return {
    topic: s.topic,
    name:  s.peer?.metadata?.name ?? 'Unknown dApp',
    url:   s.peer?.metadata?.url  ?? '',
  };
}

/* ───────────── Isolated signer ─────────────────────────────────────────
 * Hardening-audit H-1 (extension, slice 3 of 4): this used to take
 * `{seed, hdPath, ...}` on every call — the popup held the seed in React
 * state (WalletSeedContext) for the whole unlocked session and posted it
 * fresh each time, which the audit calls out by name: "popup seed crosses
 * to the offscreen signer per call" — a copy, not a boundary, since the
 * seed still had to live somewhere the popup could read it from.
 *
 * Now the secret is pushed ONCE, at unlock (sign.init), and cached here —
 * in this offscreen document, which Chrome keeps alive independently of
 * the popup (unlike the popup, which is destroyed on every close). The
 * popup's own state never holds anything after that but the derived
 * address and the unlocked flag; signing calls carry no secret at all.
 * sign.lock drops the cache on wallet lock; sign.set-account-index tracks
 * an HD account switch so the next signature follows the account showing
 * in the popup, the same way web's signer worker does.
 *
 * Methods:
 *   sign.init                { source }                 → { address }
 *   sign.lock                                            → { ok }
 *   sign.set-account-index   { accountIndex }            → { address }
 *   sign.address                                         → { address }
 *   sign.evm-tx              { tx }                      → { hash } (broadcasts)
 *   sign.evm-personal        { message }                 → { signature }
 *   sign.evm-typed-data      { payload }                 → { signature }
 *   sign.evm-erc20-transfer  { tokenAddress, to, amount } → { hash }
 *
 * `source` is `{ kind: 'mnemonic', mnemonic } | { kind: 'privateKey', privateKey }`.
 */
type SignerSource = { kind: 'mnemonic'; mnemonic: string } | { kind: 'privateKey'; privateKey: string };
let cachedSource: SignerSource | null = null;
let cachedAccountIdx = 0;

/** Rebuilds the active account's wallet from the cached source on every
 *  call — nothing persists beyond this document's module scope, so there
 *  is no derived key sitting around between signatures either. */
async function cachedWallet(): Promise<import('ethers').HDNodeWallet | import('ethers').Wallet> {
  if (!cachedSource) throw new Error('signer_locked');
  const { Mnemonic, HDNodeWallet, Wallet } = await import('ethers');
  if (cachedSource.kind === 'privateKey') return new Wallet(cachedSource.privateKey);
  return HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(cachedSource.mnemonic), `m/44'/60'/0'/0/${cachedAccountIdx}`);
}

/** Provider for the chain a transfer was approved on — `chainId` and its
 *  `rpcUrl` must both come with the request; there is no default network. */
async function chainProvider(msg: { [k: string]: unknown }): Promise<import('ethers').JsonRpcProvider> {
  const chainId = typeof msg.chainId === 'number' && Number.isSafeInteger(msg.chainId) && msg.chainId > 0 ? msg.chainId : 0;
  // http(s), like the custom-network form (a local node is often http).
  const rpcUrl  = typeof msg.rpcUrl === 'string' && /^https?:\/\//i.test(msg.rpcUrl) ? msg.rpcUrl : '';
  if (!chainId || !rpcUrl) throw new Error('No network selected for this transaction');
  const { JsonRpcProvider } = await import('ethers');
  return new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
}

async function handleSignMessage(msg: { type: string; [k: string]: unknown }): Promise<unknown> {
  // sign.init / sign.lock / sign.set-account-index / sign.address manage the
  // cache itself and need no wallet built up front.
  if (msg.type === 'sign.init') {
    const source = msg.source as SignerSource;
    if (!source || (source.kind !== 'mnemonic' && source.kind !== 'privateKey')) throw new Error('source required');
    cachedSource = source;
    cachedAccountIdx = typeof msg.accountIndex === 'number' && msg.accountIndex >= 0 ? msg.accountIndex : 0;
    return { ok: true, address: (await cachedWallet()).address };
  }
  if (msg.type === 'sign.lock') {
    cachedSource = null;
    cachedAccountIdx = 0;
    return { ok: true };
  }
  if (msg.type === 'sign.set-account-index') {
    if (cachedSource?.kind === 'mnemonic') cachedAccountIdx = Math.max(0, Math.floor(Number(msg.accountIndex ?? 0)));
    return { ok: true, address: (await cachedWallet()).address };
  }
  if (msg.type === 'sign.address') {
    return { ok: true, address: (await cachedWallet()).address };
  }

  const { Contract, getBytes } = await import('ethers');
  type TransactionRequest = import('ethers').TransactionRequest;
  type TypedDataDomain    = import('ethers').TypedDataDomain;
  type TypedDataField     = import('ethers').TypedDataField;

  const wallet = await cachedWallet();

  try {
    switch (msg.type) {
      case 'sign.evm-tx': {
        const tx = { ...(msg.tx as TransactionRequest) };
        // Route through the RPC of the chain the user approved and PIN
        // tx.chainId, so the tx can only broadcast there. No chain → refuse:
        // a transfer must never fall back to some default network (a Mainnet
        // send once went out on Makalu that way).
        const provider = await chainProvider(msg);
        tx.chainId = Number(msg.chainId);
        const connected = wallet.connect(provider);
        const sent = await connected.sendTransaction(tx);
        return { ok: true, hash: sent.hash };
      }
      case 'sign.evm-personal': {
        // messageHex is a 0x hex string (survives sendMessage's JSON, unlike a
        // Uint8Array). Decode to raw bytes so EIP-191 prefixes the correct bytes.
        const bytes = getBytes(String(msg.messageHex ?? '0x'));
        const signature = await wallet.signMessage(bytes);
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
        const provider = await chainProvider(msg);
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
    // reference lets V8 collect it on the next GC pass. The long-lived
    // secret is cachedSource (wiped by sign.lock on wallet lock); `wallet`
    // itself only ever lives for this one call.
  }
}

browser.runtime.onMessage.addListener(((raw: unknown, sender: MessageSenderLike, sendResponse: (v: unknown) => void) => {
  const msg = raw as { type?: string; __target?: string; [k: string]: unknown };
  // A content script's sendMessage reaches this listener directly and can set
  // __target itself — only extension pages may sign or drive WalletConnect.
  if (!isExtensionSender(sender)) return false;
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
          // Answered: drop it and show the next one waiting, if any.
          requestQueue = requestQueue.filter((r) => !(r.id === id && r.topic === topic));
          showQueueHead();
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
