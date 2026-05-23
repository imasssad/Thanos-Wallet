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
  // Used by the bg's resolver maps below — not persisted.
}

/* In-memory resolver tables. The background SW can stay alive long enough
   for these to round-trip in most flows; if it dies, the popup falls back
   to broadcasting the result via runtime.sendMessage. */
const pendingResolvers = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

const MAKALU_CHAIN_ID_HEX = '0xab09f9'; // 700777

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
  return (chain_id_hex as string) || MAKALU_CHAIN_ID_HEX;
}

/* ─── RPC dispatch ───────────────────────────────────────────────────── */

interface RpcMessage {
  type:   'thanos-rpc';
  method: string;
  params: unknown[];
  origin: string;
}

async function handleRpc(req: RpcMessage): Promise<unknown> {
  const { method, params, origin } = req;

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
        pending_approval: { id, origin, method, params } as PendingApproval,
      });
      try { await browser.action.openPopup(); }
      catch {
        // Some browsers (older Firefox) reject openPopup outside a user
        // gesture; the user can still click the toolbar icon manually.
      }

      return await new Promise<string[]>((resolve, reject) => {
        pendingResolvers.set(id, { resolve: resolve as never, reject });
      });
    }

    /* ─ Chain switching ──────────────────────────────────────────── */

    case 'wallet_switchEthereumChain': {
      const target = (params?.[0] as { chainId?: string })?.chainId;
      if (!target) throw rpcError(-32602, 'Invalid params');
      // Only Makalu supported today.
      if (target.toLowerCase() !== MAKALU_CHAIN_ID_HEX) {
        throw rpcError(4902, 'Unrecognized chain. Only Makalu (700777) is supported.');
      }
      await browser.storage.local.set({ chain_id_hex: MAKALU_CHAIN_ID_HEX });
      broadcastEvent('chainChanged', target);
      return null;
    }

    /* ─ Signing (deferred to slice 4) ────────────────────────────── */

    case 'eth_sendTransaction':
    case 'personal_sign':
    case 'eth_signTypedData_v4':
    case 'eth_sign':
      throw rpcError(4200, `${method} requires the next vault-bridge slice`);

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

  browser.runtime.onMessage.addListener(((msg: unknown, _sender: unknown, sendResponse: (resp: unknown) => void) => {
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

    // 1) Direct RPC from content script.
    if (m?.type === 'thanos-rpc') {
      handleRpc(m).then(
        (result) => sendResponse(result),
        (err)    => sendResponse(Promise.reject(err)),
      );
      // Returning true tells the runtime we'll respond asynchronously.
      return true;
    }

    // 2) Popup posting back the user's approval / rejection.
    if (m?.type === 'thanos-approval-result' && m.approvalId) {
      const pending = pendingResolvers.get(m.approvalId);
      if (pending) {
        pendingResolvers.delete(m.approvalId);
        if (m.approved && m.address) {
          // Persist the connection.
          (async () => {
            const conns = await getConnections();
            const stored = await browser.storage.session.get('pending_approval') as { pending_approval?: { origin?: string } };
            const origin = stored.pending_approval?.origin;
            if (origin) {
              conns[origin] = { address: m.address!, connectedAt: Date.now() };
              await setConnections(conns);
              await browser.storage.local.set({ active_address: m.address });
              broadcastEvent('accountsChanged', [m.address]);
            }
            await browser.storage.session.remove('pending_approval');
            pending.resolve([m.address]);
          })();
        } else {
          (async () => {
            await browser.storage.session.remove('pending_approval');
            pending.reject(rpcError(4001, 'User rejected the request'));
          })();
        }
      }
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

    return false;
  }) as Parameters<typeof browser.runtime.onMessage.addListener>[0]);
});
