/// <reference types="chrome" />
/**
 * Service worker — central dispatcher for EIP-1193 JSON-RPC requests
 * coming in from content scripts.
 *
 * State lives in chrome.storage.local (persistent across browser restarts):
 *   thanos.connections     { [origin]: { address, connectedAt } }
 *   thanos.active_address  current unlocked EVM address (or null)
 *   thanos.chain_id        currently selected chain (default Makalu 700777)
 *
 * Pending approval requests live in chrome.storage.session (cleared on
 * browser close) — the popup picks them up when it opens.
 */
import { dappChainByHex, toChainHex } from '../lib/dapp-chains';

interface Connection {
  address:     string;
  connectedAt: number;
}
type ConnectionMap = Record<string, Connection>;

interface PendingApproval {
  id:       string;
  origin:   string;
  method:   string;
  params:   unknown[];
  tabId?:   number;   // originating tab — for durable result delivery (see below)
  pageId?:  string;   // the page-side request id the content script correlates on
}

/* A direct EIP-1193 sign/tx request — for `window.ethereum.request`
 * paths (NOT WalletConnect, which has its own offscreen+popup flow).
 * The popup picks this up, shows an approval sheet, signs locally with
 * its in-memory seed, and posts the result back via thanos-rpc-result. */
interface PendingRpcRequest {
  id:      string;
  origin:  string;
  method:  string;
  params:  unknown[];
  address: string;   // expected `from` address (the origin's connected wallet)
  tabId?:  number;   // originating tab — for durable result delivery
  pageId?: string;   // the page-side request id the content script correlates on
}

/* In-memory resolver tables — the FAST path: when the SW survives the whole
   round-trip, these resolve the still-open thanos-rpc message channel.
   They are NOT the durable path. MV3 evicts an idle SW (~30s, hard cap
   ~5min), and a user reading a SIWE message routinely exceeds that. On
   eviction this Map is wiped, so the DURABLE path is a direct push to the
   originating tab (browser.tabs.sendMessage → content 'thanos-rpc-push'),
   keyed by the tabId/pageId persisted in storage.session — which survives
   SW restarts. Without this, an evicted SW dropped the approved signature
   and the polyfill resolved the dApp's request() to `undefined` (surfaced
   as {}): the personal_sign / SIWE bug. */
const pendingResolvers = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

/** Durable delivery: push a finished RPC result/ error straight to the tab
 *  that made the request, so a freshly-restarted SW is never in the path.
 *  content.ts correlates by pageId and resolves the page's provider.request(). */
function pushResultToTab(
  tabId: number | undefined,
  pageId: string | undefined,
  payload: { result: unknown } | { error: { code: number; message: string } },
): void {
  if (tabId == null || !pageId) return;
  browser.tabs.sendMessage(tabId, { type: 'thanos-rpc-push', pageId, ...payload }).catch(() => {
    /* tab closed/navigated — nothing to deliver to */
  });
}

// 700777 decimal = 0xab169. The previous value here ('0xab09f9' =
// 11,209,209) was a hex-conversion typo that made every dApp see a
// chain that doesn't exist — eth_chainId, net_version and
// wallet_switchEthereumChain were all answering for the wrong chain.
const MAKALU_CHAIN_ID_HEX = '0xab169'; // 700777

/* ─── WalletConnect offscreen lifecycle ────────────────────────────────
   The relay socket lives in a hidden offscreen document so it survives
   the popup closing + this service worker idling out. Chrome-only API —
   guarded so the build still loads on browsers that don't ship it. */
const OFFSCREEN_URL = 'offscreen.html';
async function ensureOffscreen(): Promise<void> {
  // `chrome.offscreen` is undefined on Firefox / Safari builds.
  const offscreen = (globalThis as { chrome?: { offscreen?: typeof chrome.offscreen } }).chrome?.offscreen;
  if (!offscreen) return;
  try {
    if (await offscreen.hasDocument()) return;
    await offscreen.createDocument({
      url:           OFFSCREEN_URL,
      // BLOBS keeps a document with active network resources alive — the
      // closest stable reason for "we need a long-lived WebSocket".
      reasons:       [chrome.offscreen.Reason.BLOBS],
      justification: 'Persistent WalletConnect relay socket across popup closes',
    });
  } catch {
    /* createDocument throws if one already exists (race); ignore. */
  }
}

function hostOf(origin: string): string {
  try { return new URL(origin).host; } catch { return origin; }
}

/** OS/browser notification for an incoming dApp request — fires from the
 *  service worker so the user is alerted even when the popup is closed.
 *  Best-effort: the API is absent on some builds / may be user-disabled. */
function notifyRequest(title: string, message: string): void {
  try {
    void browser.notifications?.create({
      type:    'basic',
      iconUrl: browser.runtime.getURL('/icons/icon128.png'),
      title,
      message,
    });
  } catch { /* notifications API unavailable */ }
}

async function getConnections(): Promise<ConnectionMap> {
  const { connections } = await browser.storage.local.get('connections');
  return (connections as ConnectionMap) ?? {};
}
async function setConnections(map: ConnectionMap): Promise<void> {
  await browser.storage.local.set({ connections: map });
}

async function getActiveAddress(): Promise<string | null> {
  const { active_address } = await browser.storage.local.get('active_address');
  return (active_address as string) || null;
}

async function getChainIdHex(): Promise<string> {
  const { chain_id_hex } = await browser.storage.local.get('chain_id_hex');
  const stored = chain_id_hex as string | undefined;
  // Migration: installs prior to the 0xab169 fix persisted the typo'd
  // chainId ('0xab09f9'). Treat it as unset so they pick up the correct
  // constant instead of overriding it forever from storage.
  if (!stored || stored.toLowerCase() === '0xab09f9') return MAKALU_CHAIN_ID_HEX;
  return stored;
}

/* ─── RPC dispatch ───────────────────────────────────────────────────── */

interface RpcMessage {
  type:   'thanos-rpc';
  method: string;
  params: unknown[];
  origin: string;
  pageId?: string;   // page-side request id (content script sets it for durable delivery)
}

async function handleRpc(req: RpcMessage, sender?: { tab?: { id?: number } }): Promise<unknown> {
  const { method, params, origin } = req;
  const tabId  = sender?.tab?.id;
  const pageId = req.pageId;

  switch (method) {
    /* ─ Read methods (no popup) ──────────────────────────────────── */

    case 'eth_chainId':
    case 'net_version': {
      const chain = await getChainIdHex();
      return method === 'eth_chainId' ? chain : String(parseInt(chain, 16));
    }

    case 'eth_accounts': {
      const conns = await getConnections();
      const conn = conns[origin];
      return conn ? [conn.address] : [];
    }

    /* ─ Connection request (popup approval) ──────────────────────── */

    case 'eth_requestAccounts': {
      const conns = await getConnections();
      const existing = conns[origin];
      if (existing) return [existing.address];

      // Need user approval. Stash a pending approval and open the popup.
      const id = `${Date.now()}.${Math.random().toString(36).slice(2)}`;
      await browser.storage.session.set({
        pending_approval: { id, origin, method, params, tabId, pageId } as PendingApproval,
      });
      notifyRequest('Connection request', `${hostOf(origin)} wants to connect to Thanos Wallet.`);
      try { await browser.action.openPopup(); }
      catch {
        // Some browsers (older Firefox) reject openPopup outside a user
        // gesture; the user can still click the toolbar icon manually.
      }

      return await new Promise<string[]>((resolve, reject) => {
        pendingResolvers.set(id, { resolve: resolve as never, reject });
      });
    }

    /* ─ Chain switching (EIP-3085/3326) ──────────────────────────── */

    /* wallet_addEthereumChain: a known chain = friendly no-op (per EIP-3085,
       null = success); an unknown chain = 4001. Adding does NOT change the
       active chain — the dApp follows with switch, which is the prompt. */
    case 'wallet_addEthereumChain': {
      const spec = params?.[0] as { chainId?: string } | undefined;
      if (!spec?.chainId) throw rpcError(-32602, 'Invalid params');
      if (!dappChainByHex(spec.chainId.toLowerCase())) {
        throw rpcError(4001, 'Unsupported network. Thanos supports Lithosphere Makalu plus Ethereum, BNB Chain, Polygon, Base, Arbitrum, Optimism, Avalanche and Linea.');
      }
      return null;
    }

    /* ─ Signing + network switch — popup approval, local sign ────── */

    case 'wallet_switchEthereumChain':
    case 'eth_sendTransaction':
    case 'personal_sign':
    case 'eth_signTypedData_v4':
    case 'eth_sign': {
      const conns = await getConnections();
      const conn = conns[origin];
      // Strict: only connected origins can ask for signatures / switches.
      // Otherwise a malicious page could enqueue prompts without ever asking
      // the user to connect first.
      if (!conn) throw rpcError(4100, 'Unauthorized — call eth_requestAccounts first');

      // Network switch: reject unknown chains up front (4902); if we're
      // already on the requested chain, succeed silently with no prompt.
      // Otherwise fall through to the approval flow (user chose auto-switch
      // WITH a prompt); the popup's executeWcRequest performs the switch.
      if (method === 'wallet_switchEthereumChain') {
        const target = ((params?.[0] as { chainId?: string })?.chainId ?? '').toLowerCase();
        const chain = dappChainByHex(target);
        if (!chain) throw rpcError(4902, 'Unrecognized chain. Thanos supports Lithosphere Makalu plus Ethereum, BNB Chain, Polygon, Base, Arbitrum, Optimism, Avalanche and Linea.');
        if ((await getChainIdHex()).toLowerCase() === toChainHex(chain.chainId)) return null;
      }

      // For sendTransaction, the `from` field (if set) must match the
      // connected address. dApps sometimes pre-populate this; if it's
      // mismatched, refuse rather than silently signing with the wrong key.
      if (method === 'eth_sendTransaction') {
        const tx = params?.[0] as { from?: string } | undefined;
        if (tx?.from && tx.from.toLowerCase() !== conn.address.toLowerCase()) {
          throw rpcError(4001, '`from` does not match the connected account');
        }
      }
      // For personal_sign / eth_sign the signer address is in params; same check.
      if (method === 'personal_sign' || method === 'eth_signTypedData_v4') {
        const signer = (method === 'personal_sign' ? params?.[1] : params?.[0]) as string | undefined;
        if (signer && signer.toLowerCase() !== conn.address.toLowerCase()) {
          throw rpcError(4001, 'Signer address does not match the connected account');
        }
      }

      const id = `${Date.now()}.${Math.random().toString(36).slice(2)}`;
      await browser.storage.session.set({
        pending_rpc_request: { id, origin, method, params, address: conn.address, tabId, pageId } as PendingRpcRequest,
      });
      notifyRequest(
        method === 'eth_sendTransaction' ? 'Transaction request'
          : method === 'wallet_switchEthereumChain' ? 'Network switch request'
          : 'Signature request',
        `${hostOf(origin)} is requesting your approval.`,
      );
      try { await browser.action.openPopup(); }
      catch { /* user may need to open the popup manually */ }

      return await new Promise<unknown>((resolve, reject) => {
        pendingResolvers.set(id, { resolve, reject });
      });
    }

    /* ─ Unknown ──────────────────────────────────────────────────── */

    default:
      throw rpcError(-32601, `Method not supported: ${method}`);
  }
}

function rpcError(code: number, message: string): Error & { code: number } {
  return Object.assign(new Error(message), { code });
}

/* Broadcast an EIP-1193 event to every tab that has the content script. */
async function broadcastEvent(event: string, ...args: unknown[]): Promise<void> {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (tab.id == null) continue;
    browser.tabs.sendMessage(tab.id, { type: 'thanos-event', event, args }).catch(() => {});
  }
}

/* ─── Wiring ────────────────────────────────────────────────────────── */

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    console.log('Thanos Wallet extension installed');
    void ensureOffscreen();
  });
  // Boot the offscreen kit eagerly so persisted sessions reconnect and
  // a session_proposal can land before the user opens the popup.
  void ensureOffscreen();

  browser.runtime.onMessage.addListener(((msg: unknown, sender: { tab?: { id?: number } }, sendResponse: (resp: unknown) => void) => {
    const m = msg as RpcMessage & { type?: string; approvalId?: string; approved?: boolean; address?: string };

    // 0a) A signing request fired in the offscreen kit — try to bring
    //    up the popup so the user sees the approval sheet immediately.
    //    Failures are fine: the toolbar badge + stashed request keep
    //    the user informed when they click the icon themselves.
    const evMsg = m as { type?: string };
    if (evMsg.type === 'wc.event.request') {
      try { void browser.action.openPopup().catch(() => {}); } catch { /* older browsers */ }
      return false;
    }

    // 0) WalletConnect commands — proxy from the popup to the offscreen
    //    document. Tagging the forwarded message with __target lets
    //    background ignore its own re-broadcast (otherwise we loop).
    const wcMsg = m as { type?: string; __target?: string };
    if (wcMsg.type?.startsWith('wc.') && !wcMsg.type.startsWith('wc.event.') && wcMsg.__target !== 'offscreen') {
      (async () => {
        try {
          await ensureOffscreen();
          const resp = await browser.runtime.sendMessage({ ...m, __target: 'offscreen' });
          sendResponse(resp);
        } catch (e) {
          sendResponse({ ok: false, error: (e as Error)?.message || 'offscreen unreachable' });
        }
      })();
      return true;
    }

    // 0b) Signing requests — same proxy pattern, but for `sign.*` ops that
    //     keep the actual ethers signing call out of the popup's JS context.
    //     The popup posts {seed, tx} → background → offscreen → signedTx.
    if (wcMsg.type?.startsWith('sign.') && wcMsg.__target !== 'offscreen') {
      (async () => {
        try {
          await ensureOffscreen();
          const resp = await browser.runtime.sendMessage({ ...m, __target: 'offscreen' });
          sendResponse(resp);
        } catch (e) {
          sendResponse({ ok: false, error: (e as Error)?.message || 'offscreen unreachable' });
        }
      })();
      return true;
    }

    // 1) Direct RPC from content script.
    //
    // RETURN the promise (the webextension-polyfill's async pattern) rather than
    // sendResponse(). The old `sendResponse(Promise.reject(err))` structured-
    // cloned a Promise → {} , so EVERY error (incl. a rejected personal_sign)
    // reached the dApp as an empty object instead of a real error. Returning the
    // promise sends the resolved value (the signature string) on success and
    // propagates rejections as genuine errors (content.ts turns them into an
    // EIP-1193 error, injected.ts rejects the dApp's request()).
    if (m?.type === 'thanos-rpc') {
      return handleRpc(m, sender);
    }

    // 2b) Popup posting back the signed result (or rejection) of a
    //     pending EIP-1193 sign/tx request.
    const sigMsg = m as { type?: string; requestId?: string; result?: unknown; error?: { code: number; message: string } };
    if (sigMsg.type === 'thanos-rpc-result' && sigMsg.requestId) {
      // FAST path: resolve the still-open thanos-rpc channel if the SW that
      // parked it is still alive.
      const pending = pendingResolvers.get(sigMsg.requestId);
      if (pending) {
        pendingResolvers.delete(sigMsg.requestId);
        if (sigMsg.error) pending.reject(rpcError(sigMsg.error.code, sigMsg.error.message));
        else              pending.resolve(sigMsg.result);
      }
      // DURABLE path (runs even on a freshly-restarted SW where `pending` is
      // gone): read the tab/page ids from storage.session and push the result
      // straight to the originating tab. This is what fixes the personal_sign
      // "{}" bug when the SW was evicted during the approval wait.
      (async () => {
        const stored = (await browser.storage.session.get('pending_rpc_request')) as { pending_rpc_request?: PendingRpcRequest };
        const p = stored.pending_rpc_request;
        if (p && p.id === sigMsg.requestId) {
          await browser.storage.session.remove('pending_rpc_request');
          pushResultToTab(p.tabId, p.pageId, sigMsg.error ? { error: sigMsg.error } : { result: sigMsg.result });
        }
      })();
      sendResponse({ ok: true });
      return false;
    }

    // 2) Popup posting back the user's approval / rejection.
    if (m?.type === 'thanos-approval-result' && m.approvalId) {
      const pending = pendingResolvers.get(m.approvalId);
      pendingResolvers.delete(m.approvalId);
      // Same fast + durable split as the sign path: resolve the in-memory
      // channel if alive, and ALSO push [address]/error to the originating
      // tab so a connect approval survives SW eviction too.
      (async () => {
        const stored = (await browser.storage.session.get('pending_approval')) as { pending_approval?: PendingApproval };
        const appr = stored.pending_approval;
        if (m.approved && m.address) {
          const origin = appr?.origin;
          if (origin) {
            const conns = await getConnections();
            conns[origin] = { address: m.address!, connectedAt: Date.now() };
            await setConnections(conns);
            await browser.storage.local.set({ active_address: m.address });
            broadcastEvent('accountsChanged', [m.address]);
          }
          await browser.storage.session.remove('pending_approval');
          pending?.resolve([m.address]);
          pushResultToTab(appr?.tabId, appr?.pageId, { result: [m.address] });
        } else {
          await browser.storage.session.remove('pending_approval');
          pending?.reject(rpcError(4001, 'User rejected the request'));
          pushResultToTab(appr?.tabId, appr?.pageId, { error: { code: 4001, message: 'User rejected the request' } });
        }
      })();
      sendResponse({ ok: true });
      return false;
    }

    // 3) Popup announcing the unlocked address so other tabs see it.
    if (m?.type === 'thanos-active-address' && typeof m.address === 'string') {
      browser.storage.local.set({ active_address: m.address });
      broadcastEvent('accountsChanged', [m.address]);
      sendResponse({ ok: true });
      return false;
    }
    if (m?.type === 'thanos-lock') {
      browser.storage.local.set({ active_address: null });
      broadcastEvent('accountsChanged', []);
      sendResponse({ ok: true });
      return false;
    }

    // Popup switched the active dApp chain (after the user approved a
    // wallet_switchEthereumChain prompt) — persist it and emit chainChanged
    // to every connected tab so dApps see the new network.
    const chainMsg = m as { type?: string; chainHex?: string };
    if (chainMsg.type === 'thanos-set-chain' && typeof chainMsg.chainHex === 'string' && dappChainByHex(chainMsg.chainHex)) {
      browser.storage.local.set({ chain_id_hex: chainMsg.chainHex.toLowerCase() });
      broadcastEvent('chainChanged', chainMsg.chainHex.toLowerCase());
      sendResponse({ ok: true });
      return false;
    }

    return false;
  }) as Parameters<typeof browser.runtime.onMessage.addListener>[0]);
});
