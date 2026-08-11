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
