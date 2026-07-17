/**
 * dApp-browser provider preload — desktop.
 *
 * Injects window.ethereum + window.thanos (EIP-1193) into the SANDBOXED
 * in-app browser WebContentsView so a dApp — e.g. Quantt's "Sign in with
 * Thanos" — can talk to the wallet. The page NEVER sees the seed: every
 * request is forwarded over IPC to the main process (`dapp:rpc`), which shows
 * the approval dialog and relays signing to the wallet renderer (see
 * dapp-browser.ts + DappRequestHost.tsx). The seed never enters this view.
 *
 * contextIsolation is ON, so contextBridge.exposeInMainWorld places the
 * provider on the page's real `window`. RPC errors come back as a sentinel
 * object (not a thrown IPC error) so JSON-RPC codes like 4001 (user rejected)
 * survive the process boundary intact.
 *
 * NOTE on discovery: EIP-6963's announce event can't originate from a
 * contextIsolated preload (its `window` is a separate realm from the page), so
 * discovery here is via window.ethereum / window.thanos — the fallback path
 * Quantt's discoverThanosProvider already supports (docs/INTEGRATE-THANOS-AUTH.md).
 */
import { contextBridge, ipcRenderer } from 'electron';

const CHAIN_HEX = '0xab169'; // Makalu 700777

type Listener = (arg: unknown) => void;
const listeners: Record<string, Listener[]> = {};

// Events pushed from main (accountsChanged / chainChanged) → page listeners.
ipcRenderer.on('dapp:emit', (_e, payload: { event?: string; data?: unknown } | null) => {
  if (!payload || !payload.event) return;
  (listeners[payload.event] || []).slice().forEach((fn) => {
    try { fn(payload.data); } catch { /* a page listener threw — ignore */ }
  });
});

interface RpcSentinelError { __thanosError: true; code: number; message: string }
function isSentinelError(v: unknown): v is RpcSentinelError {
  return !!v && typeof v === 'object' && (v as RpcSentinelError).__thanosError === true;
}

const provider = {
  isThanos: true,
  isMetaMask: false,
  chainId: CHAIN_HEX,
  networkVersion: '700777',
  selectedAddress: null as string | null,

  request(args: { method: string; params?: unknown[] }): Promise<unknown> {
    if (!args || typeof args.method !== 'string') {
      return Promise.reject(new Error('Invalid request: expected { method }'));
    }
    return ipcRenderer
      .invoke('dapp:rpc', { method: args.method, params: args.params ?? [] })
      .then((res: unknown) => {
        if (isSentinelError(res)) {
          const err = new Error(res.message) as Error & { code?: number };
          err.code = res.code;
          throw err;
        }
        if ((args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') && Array.isArray(res) && res.length) {
          provider.selectedAddress = String(res[0]);
        }
        return res;
      });
  },

  on(event: string, handler: Listener): void {
    (listeners[event] = listeners[event] || []).push(handler);
  },
  removeListener(event: string, handler: Listener): void {
    listeners[event] = (listeners[event] || []).filter((f) => f !== handler);
  },
  enable(): Promise<unknown> {
    return provider.request({ method: 'eth_requestAccounts' });
  },
  // Legacy send/sendAsync shims — some older dApp libs still probe them.
  send(methodOrPayload: unknown, params?: unknown): Promise<unknown> {
    return typeof methodOrPayload === 'string'
      ? provider.request({ method: methodOrPayload, params: (params as unknown[]) ?? [] })
      : provider.request(methodOrPayload as { method: string; params?: unknown[] });
  },
  sendAsync(payload: { id?: number; method: string; params?: unknown[] }, cb: (err: unknown, res: unknown) => void): void {
    provider.request(payload).then(
      (result) => cb(null, { id: payload.id, jsonrpc: '2.0', result }),
      (error) => cb(error, null),
    );
  },
};

try {
  contextBridge.exposeInMainWorld('ethereum', provider);
  contextBridge.exposeInMainWorld('thanos', provider);
} catch { /* double-injected on reload — first one wins */ }
