/**
 * window.thanos provider — injected into every page's MAIN world.
 *
 * EIP-1193 compliant. dApps that detect window.ethereum will pick this up;
 * we *don't* set window.ethereum by default (avoid stomping on MetaMask /
 * other wallets that the user might also have installed). Tooling that
 * wants Thanos explicitly reads window.thanos.
 *
 * Communication: postMessage with target='thanos-content' (this script)
 *                postMessage with target='thanos-page' (content -> us).
 *
 * Methods supported in this MVP slice:
 *   - eth_requestAccounts      (opens approval popup)
 *   - eth_accounts             (auto-reply from connected list)
 *   - eth_chainId              (Makalu = 0xab169 = 700777)
 *   - wallet_switchEthereumChain
 *
 * Signing methods (eth_sendTransaction / personal_sign / etc.) are wired
 * in the next slice once the unlocked-vault bridge is in place.
 */
import { normalizeSignParams } from '../lib/bytes-normalize';

export default defineUnlistedScript(() => {
  if ((window as any).thanos) return; // already injected

  type PromiseFns = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
  const pending = new Map<string, PromiseFns>();
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>();

  function emit(event: string, ...args: unknown[]) {
    listeners.get(event)?.forEach(fn => { try { fn(...args); } catch {} });
  }

  function sendRequest(method: string, params: unknown[] = []): Promise<unknown> {
    // Normalize bytes-like sign params to 0x hex HERE — this is the last
    // point where a dApp's Uint8Array is still real bytes. The next hop
    // (content script → background) serializes as JSON, which mangles a
    // Uint8Array into {0:…,1:…} and breaks signing downstream.
    const safeParams = normalizeSignParams(method, params);
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}.${Math.random().toString(36).slice(2)}`;
      pending.set(id, { resolve, reject });
      window.postMessage({ target: 'thanos-content', type: 'request', id, method, params: safeParams }, '*');
    });
  }

  // Listen for responses + push events from the content bridge.
  window.addEventListener('message', evt => {
    if (evt.source !== window) return;
    const msg = evt.data as { target?: string; type?: string; id?: string; result?: unknown; error?: { code: number; message: string; data?: unknown }; event?: string; args?: unknown[] } | null;
    if (!msg || msg.target !== 'thanos-page') return;

    if (msg.type === 'response' && msg.id) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code, data: msg.error.data }));
      else p.resolve(msg.result);
    } else if (msg.type === 'event' && msg.event) {
      emit(msg.event, ...(msg.args ?? []));
    }
  });

  const provider = {
    isThanos:           true,
    isMetaMask:         false, // explicitly false — we don't impersonate
    chainId:            '0xab169', // 700777 hex (default until we hear otherwise)
    networkVersion:     '700777',
    selectedAddress:    null as string | null,

    /** EIP-1193 request method. */
    request(args: { method: string; params?: unknown[] }) {
      if (!args || typeof args.method !== 'string') {
        return Promise.reject(new Error('Invalid request: missing method'));
      }
      return sendRequest(args.method, args.params ?? []);
    },

    on(event: string, handler: (...a: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
      return provider;
    },
    removeListener(event: string, handler: (...a: unknown[]) => void) {
      listeners.get(event)?.delete(handler);
      return provider;
    },
    /** Legacy method kept for compat with very old dApps. */
    enable() { return sendRequest('eth_requestAccounts'); },
  };

  // React to chain/account changes from the wallet.
  provider.on('chainChanged', (newChainId) => { provider.chainId = String(newChainId); });
  provider.on('accountsChanged', (accounts) => {
    const list = accounts as string[];
    provider.selectedAddress = list?.[0] ?? null;
  });

  Object.defineProperty(window, 'thanos', { value: provider, writable: false, configurable: false });

  // Sync the cached chainId to the wallet's ACTUAL active chain on load — the
  // wallet can now switch across EVM networks, so the 0xab169 default is only
  // a hint until this resolves. If it differs, EMIT chainChanged too: wagmi
  // and other libs cache the chain on connect from provider.chainId, so
  // without this a dApp reconnecting while the wallet is on (say) Ethereum
  // would keep thinking it's on Makalu.
  sendRequest('eth_chainId')
    .then((id) => {
      if (typeof id === 'string' && id && id !== provider.chainId) {
        provider.chainId = id;
        provider.networkVersion = String(parseInt(id, 16));
        emit('chainChanged', id);
      }
    })
    .catch(() => { /* not connected / background asleep — keep the default */ });

  // EIP-6963: announce the provider so dApps can discover it without stomping
  // on window.ethereum. The standard pattern for multi-wallet support.
  const info = {
    uuid:   crypto.randomUUID(),
    name:   'Thanos Wallet',
    icon:   'data:image/png;base64,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',
    rdns:   'fi.thanos.wallet',
  };
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: Object.freeze({ info, provider }),
  }));
  window.addEventListener('eip6963:requestProvider', () => {
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: Object.freeze({ info, provider }),
    }));
  });
});
