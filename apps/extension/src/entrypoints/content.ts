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

    // Each page request is delivered to the page EXACTLY ONCE, via whichever
    // channel answers first: the awaited runtime.sendMessage return (fast path)
    // or the background's durable tab-push (survives SW eviction). injected.ts
    // also dedupes by id, but we dedupe here too so a stale channel can't
    // clobber a real result.
    type Payload = { result: unknown } | { error: { code: number; message: string } };
    const inflight = new Map<string, { done: boolean; timer: ReturnType<typeof setTimeout> }>();
    function deliver(pageId: string, payload: Payload) {
      const rec = inflight.get(pageId);
      if (!rec || rec.done) return;
      rec.done = true;
      clearTimeout(rec.timer);
      inflight.delete(pageId);
      window.postMessage({ target: 'thanos-page', type: 'response', id: pageId, ...payload }, '*');
    }

    // Step 2: bridge page -> background.
    window.addEventListener('message', async (evt) => {
      if (evt.source !== window) return;
      const msg = evt.data as { target?: string; type?: string; id?: string; method?: string; params?: unknown[] } | null;
      if (!msg || msg.target !== 'thanos-content') return;
      if (msg.type !== 'request' || !msg.id || !msg.method) return;

      const pageId = msg.id;
      // Backstop: if neither channel ever answers (SW died AND the tab push
      // couldn't be delivered), surface a real error instead of hanging the
      // dApp forever. 5 min matches Chrome's SW message-port hard cap.
      inflight.set(pageId, {
        done: false,
        timer: setTimeout(() => deliver(pageId, {
          error: { code: -32603, message: 'Thanos Wallet did not respond (the request may have expired). Please try again.' },
        }), 300_000),
      });

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
          pageId,   // lets background push the result straight back to this tab
        });
        // `undefined` is webextension-polyfill's signal for "the message port
        // closed before a response" — i.e. the background SW was evicted mid-
        // approval. The real result then arrives via the durable 'thanos-rpc-
        // push'; delivering undefined here would surface {} on the dApp
        // (the personal_sign / SIWE bug). No handler returns undefined
        // legitimately (null is used for switch/add-chain), so this is safe.
        if (result !== undefined) deliver(pageId, { result });
      } catch (err) {
        const e = err as { code?: number; message?: string };
        // A closed port during an approval is expected on SW eviction — wait
        // for the durable push (or the timeout) rather than erroring early.
        if (/message port closed/i.test(e?.message ?? '')) return;
        deliver(pageId, { error: { code: e?.code ?? -32603, message: e?.message ?? 'Internal error' } });
      }
    });

    // Step 3: bridge background -> page — events, plus the durable RPC result
    // push that decouples delivery from the background SW's lifetime.
    browser.runtime.onMessage.addListener((msg: unknown) => {
      const m = msg as { type?: string; event?: string; args?: unknown[]; pageId?: string; result?: unknown; error?: { code: number; message: string } } | null;
      if (!m) return;
      if (m.type === 'thanos-rpc-push' && typeof m.pageId === 'string') {
        deliver(m.pageId, m.error ? { error: m.error } : { result: m.result });
        return;
      }
      if (m.type === 'thanos-event' && m.event) {
        window.postMessage({ target: 'thanos-page', type: 'event', event: m.event, args: m.args ?? [] }, '*');
      }
    });
  },
});
