/**
 * Content script — bridges window.thanos (page world) <-> background
 * service worker. Runs in the extension's ISOLATED world, so it has
 * browser.* APIs but can also postMessage to the page.
 *
 * Flow:
 *   page (injected.ts) --postMessage--> content (here) --runtime.sendMessage--> background
 *   background --tab.sendMessage--> content (here) --postMessage--> page
 */

import { normalizeSignParams } from '../lib/bytes-normalize';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  main() {
    // Step 1: inject window.thanos into the page's MAIN world. WXT bundles
    // unlisted scripts (injected.ts) as web-accessible resources, so we
    // can load it as a <script src>.
    try {
      const s = document.createElement('script');
      s.src = browser.runtime.getURL('/injected.js');
      s.onload = () => s.remove();
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      console.warn('[thanos] failed to inject provider:', e);
    }

    // Step 2: bridge page -> background.
    window.addEventListener('message', async (evt) => {
      if (evt.source !== window) return;
      const msg = evt.data as { target?: string; type?: string; id?: string; method?: string; params?: unknown[] } | null;
      if (!msg || msg.target !== 'thanos-content') return;
      if (msg.type !== 'request' || !msg.id || !msg.method) return;

      try {
        const result = await browser.runtime.sendMessage({
          type:   'thanos-rpc',
          method: msg.method,
          // Second line of defence: runtime.sendMessage serializes as JSON,
          // which mangles a Uint8Array into {0:…}. injected.ts already
          // hex-normalizes sign params, but a page could postMessage to the
          // bridge directly — normalize again while the bytes are intact.
          params: normalizeSignParams(msg.method, msg.params ?? []),
          origin: window.location.origin,
        });
        window.postMessage({ target: 'thanos-page', type: 'response', id: msg.id, result }, '*');
      } catch (err) {
        const e = err as { code?: number; message?: string };
        window.postMessage({
          target: 'thanos-page',
          type:   'response',
          id:     msg.id,
          error:  { code: e?.code ?? -32603, message: e?.message ?? 'Internal error' },
        }, '*');
      }
    });

    // Step 3: bridge background -> page (events like chainChanged, accountsChanged).
    browser.runtime.onMessage.addListener((msg: unknown) => {
      const m = msg as { type?: string; event?: string; args?: unknown[] } | null;
      if (!m || m.type !== 'thanos-event' || !m.event) return;
      window.postMessage({ target: 'thanos-page', type: 'event', event: m.event, args: m.args ?? [] }, '*');
    });
  },
});
