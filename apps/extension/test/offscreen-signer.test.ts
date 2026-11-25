/**
 * O-01/M14 — the offscreen signer's own sender gate.
 *
 * `src/entrypoints/offscreen/main.ts` registers its own
 * `browser.runtime.onMessage` listener and guards it with
 * `isExtensionSender(sender)` before it will touch the cached signing
 * secret (lib/message-sender.ts). background.test.ts's M10 case already
 * pins that helper's own logic from background.ts's call site; this file
 * pins the SAME guard at the offscreen document's call site, since a
 * mutant that deletes line 317's `if (!isExtensionSender(sender)) return
 * false;` in offscreen/main.ts specifically would not be caught by a test
 * that only exercises background.ts.
 *
 * offscreen/main.ts is a plain module (not a WXT `defineBackground`
 * wrapper) that calls `getKit()` at import time, which opens a
 * WalletConnect relay WebSocket that never settles in this sandbox (no
 * network) and keeps the event loop alive indefinitely. Node's test
 * runner spawns one subprocess per file passed to `--test`, so an
 * explicit `process.exit()` at the end of this file only ends THIS
 * subprocess — it does not abort the other test files in the suite.
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

type Listener = (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown;

function makeFakeBrowser() {
  const session = new Map<string, unknown>();
  const listeners: Listener[] = [];
  const fake = {
    runtime: {
      id: 'thanos-ext-id',
      getURL: (p: string) => `chrome-extension://thanos-ext-id${p}`,
      onMessage: { addListener: (fn: Listener) => { listeners.push(fn); } },
      sendMessage: async () => ({ ok: true }),
    },
    storage: {
      session: {
        set: async (obj: Record<string, unknown>) => { for (const [k, v] of Object.entries(obj)) session.set(k, v); },
        remove: async (k: string) => { session.delete(k); },
      },
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
    },
  };
  return { fake, session, listeners };
}

let onMessage: Listener;
let session: Map<string, unknown>;

before(async () => {
  const b = makeFakeBrowser();
  session = b.session;
  (globalThis as Record<string, unknown>).browser = b.fake;
  await import('../src/entrypoints/offscreen/main.ts');
  onMessage = b.listeners[0];
  assert.ok(onMessage, 'offscreen/main.ts registered no onMessage listener');
});

beforeEach(() => { session.clear(); });

const extensionPageSender = { id: 'thanos-ext-id' }; // service-worker-like: no url/tab, passes isExtensionSender
const contentScriptSender = { id: 'thanos-ext-id', url: 'https://evil.example/page', tab: { id: 1 } };

test('O-01/M14: a page-originated sign.init is ignored, never caches a secret', async () => {
  const res = contentScriptSender && onMessage(
    { type: 'sign.init', __target: 'offscreen', source: { kind: 'mnemonic', mnemonic: 'test test test test test test test test test test test junk' } },
    contentScriptSender,
    () => {},
  );
  // isExtensionSender fails synchronously inside the listener, so it returns
  // `false` (not handled) rather than the async `true` sign.* normally does.
  assert.equal(res, false, 'a content-script sender must never reach the sign.* fast-path');

  // With no secret cached, sign.address from a legitimate extension-page
  // sender must fail closed (signer_locked), proving the forged sign.init
  // above cached nothing.
  const addrResult = await new Promise((resolve) => {
    onMessage({ type: 'sign.address', __target: 'offscreen' }, extensionPageSender, resolve);
  });
  assert.equal((addrResult as { ok?: boolean }).ok, false, 'no address should be derivable — M14 must have refused the forged sign.init');
  assert.match((addrResult as { error?: string }).error ?? '', /signer_locked/);
});

test('O-01/M14: a legitimate extension-page sign.init is accepted and caches the secret', async () => {
  const result = await new Promise((resolve) => {
    onMessage(
      { type: 'sign.init', __target: 'offscreen', source: { kind: 'mnemonic', mnemonic: 'test test test test test test test test test test test junk' } },
      extensionPageSender,
      resolve,
    );
  });
  const ok = result as { ok?: boolean; address?: string };
  assert.equal(ok.ok, true);
  assert.ok(ok.address?.startsWith('0x'), 'a legitimate sign.init must derive and return an address');

  // Clean up so this cached secret doesn't leak into the next test.
  await new Promise((resolve) => { onMessage({ type: 'sign.lock', __target: 'offscreen' }, extensionPageSender, resolve); });
});

test('O-01/M14: a message not tagged __target: offscreen is ignored even from an extension page', async () => {
  // Only the background forwards tagged messages; an untagged broadcast
  // (e.g. the popup's own original message before background proxies it)
  // must not reach the signer fast-path either.
  const res = onMessage({ type: 'sign.address' }, extensionPageSender, () => {});
  assert.equal(res, false, 'a message missing __target: "offscreen" must be ignored');
});

// getKit()'s relay connection attempt never settles in this sandbox (no
// network) and would otherwise keep this subprocess's event loop alive
// forever. Node's test runner spawns one subprocess per file given to
// `--test`, so exiting here only ends this file's run, not the suite's.
after(() => { setTimeout(() => process.exit(0), 10); });
