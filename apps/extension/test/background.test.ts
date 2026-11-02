/**
 * THN-02 regression — background.ts's connection-approval slot
 * (test/vault.test.ts's in-memory-shim style, run under node:test via tsx).
 *
 * background.ts is a WXT entrypoint: it reads the auto-imported globals
 * `browser` and `defineBackground`, neither of which exist under a plain
 * tsx run, so both are stubbed on `globalThis` before the module loads.
 * `defineBackground(fn)` is WXT's own identity wrapper ({ main: fn }), so
 * calling `.main()` on the import's default export runs exactly what the
 * real background script runs on startup — including registering the real
 * `browser.runtime.onMessage` listener this test drives directly.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

type Listener = (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown;

function makeFakeBrowser() {
  const local = new Map<string, unknown>();
  const session = new Map<string, unknown>();
  const listeners: Listener[] = [];
  const fake = {
    runtime: {
      id: 'thanos-ext-id',
      getURL: (p: string) => `chrome-extension://thanos-ext-id${p}`,
      onInstalled: { addListener: (_fn: () => void) => {} },
      onMessage: { addListener: (fn: Listener) => { listeners.push(fn); } },
      sendMessage: async () => ({ ok: true }),
    },
    storage: {
      local: {
        get: async (k: string) => ({ [k]: local.get(k) }),
        set: async (obj: Record<string, unknown>) => { for (const [k, v] of Object.entries(obj)) local.set(k, v); },
      },
      session: {
        get: async (k: string) => ({ [k]: session.get(k) }),
        set: async (obj: Record<string, unknown>) => { for (const [k, v] of Object.entries(obj)) session.set(k, v); },
        remove: async (k: string) => { session.delete(k); },
      },
    },
    tabs: { sendMessage: async () => {}, query: async () => [] },
    action: { openPopup: async () => {} },
    notifications: { create: async () => {} },
  };
  return { fake, local, session, listeners };
}

let onMessage: Listener;
let local: Map<string, unknown>;
let session: Map<string, unknown>;

before(async () => {
  const b = makeFakeBrowser();
  local = b.local;
  session = b.session;
  (globalThis as Record<string, unknown>).browser = b.fake;
  (globalThis as Record<string, unknown>).defineBackground = (fn: () => void) => ({ main: fn });
  const mod = await import('../src/entrypoints/background.ts');
  (mod.default as { main: () => void }).main();
  onMessage = b.listeners[0];
  assert.ok(onMessage, 'background.ts registered no onMessage listener');
});

beforeEach(() => { local.clear(); session.clear(); });

const GOOD = 'https://good.example';
const EVIL = 'https://evil.example';
const senderFor = (origin: string, tabId: number) => ({ id: 'thanos-ext-id', url: `${origin}/page`, tab: { id: tabId } });
const popupSender = { id: 'thanos-ext-id' }; // extension page, no url/tab (service-worker-like; passes isExtensionSender)

test('THN-02: a second connection request while one is pending is refused, not swapped in', async () => {
  const resultA = onMessage({ type: 'thanos-rpc', method: 'eth_requestAccounts', params: [], pageId: 'pA' }, senderFor(GOOD, 1), () => {});
  // Let the first request's async claim (storage.session.set) settle before the second fires.
  await new Promise((r) => setTimeout(r, 0));

  const resultB = await onMessage({ type: 'thanos-rpc', method: 'eth_requestAccounts', params: [], pageId: 'pB' }, senderFor(EVIL, 2), () => {});
  const bErr = resultB as { __thanosRpcError?: { code: number } };
  assert.equal(bErr.__thanosRpcError?.code, -32002, 'a second request while one is pending must get busy (-32002), not silently take the slot');

  // pending_approval must still be GOOD's request — EVIL never got in.
  const pending = session.get('pending_approval') as { origin?: string } | undefined;
  assert.equal(pending?.origin, GOOD);

  const approvalId = (session.get('pending_approval') as { id: string }).id;
  onMessage({ type: 'thanos-approval-result', approvalId, approved: true, address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }, popupSender, () => {});
  const resolvedA = await resultA as unknown[];
  assert.deepEqual(resolvedA, ['0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA']);

  const connections = (await local.get('connections')) as Record<string, { address: string }> | undefined;
  assert.equal(connections?.[GOOD]?.address, '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  assert.ok(!connections?.[EVIL], 'EVIL must never be connected — its request was refused as busy');
});

test('THN-02: an approval result only trusts pending_approval when the ids match', async () => {
  // GOOD's request claims the slot normally.
  const resultA = onMessage({ type: 'thanos-rpc', method: 'eth_requestAccounts', params: [], pageId: 'pA' }, senderFor(GOOD, 1), () => {});
  await new Promise((r) => setTimeout(r, 0));
  const approvalIdForGood = (session.get('pending_approval') as { id: string }).id;

  // Simulate the slot now (somehow) holding a DIFFERENT, later request —
  // e.g. a service-worker restart dropped the in-memory busy claim, and a
  // second site's request landed in storage before this stale approval
  // result arrives. The fix must not trust this stored origin for an
  // approvalId it was never issued to.
  session.set('pending_approval', { id: 'some-other-id', origin: EVIL, method: 'eth_requestAccounts', params: [], reply: 'accounts' });

  onMessage({ type: 'thanos-approval-result', approvalId: approvalIdForGood, approved: true, address: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' }, popupSender, () => {});
  await resultA;

  const connections = (await local.get('connections')) as Record<string, { address: string }> | undefined;
  assert.ok(!connections?.[EVIL], 'EVIL must never be connected from an approval it was not issued');
  assert.ok(!connections?.[GOOD], 'GOOD must not be connected either — the id it resolved against did not match what was stored');

  // The other (later) request's slot must be left alone, not wiped by a
  // result that was never bound to it.
  assert.deepEqual(session.get('pending_approval'), { id: 'some-other-id', origin: EVIL, method: 'eth_requestAccounts', params: [], reply: 'accounts' });
});
