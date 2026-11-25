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

/* ── O-01: the gates Autha's mutation run left unprotected ──────────────
 * Mutants M10–M13 each removed one of these checks and no shipped test
 * noticed. Autha's own THN-H3 harness killed M10, M12 and M13, but it lives
 * outside the repository, so nothing here stopped a regression. These four
 * tests pin the gates to the behaviour that harness asserted. */

test('O-01/M10: a privileged message from a web page is ignored (isExtensionSender)', async () => {
  // GOOD legitimately claims the approval slot.
  const resultA = onMessage({ type: 'thanos-rpc', method: 'eth_requestAccounts', params: [], pageId: 'pA' }, senderFor(GOOD, 1), () => {});
  await new Promise((r) => setTimeout(r, 0));
  const approvalId = (session.get('pending_approval') as { id: string }).id;

  // A content script forges the approval. It carries this extension's id —
  // what distinguishes it from the popup is the tab + web URL, which is
  // exactly what isExtensionSender() checks and what M10 deleted.
  onMessage(
    { type: 'thanos-approval-result', approvalId, approved: true, address: '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC' },
    senderFor(EVIL, 2),
    () => {},
  );
  await new Promise((r) => setTimeout(r, 0));

  const connections = (await local.get('connections')) as Record<string, unknown> | undefined;
  assert.ok(!connections || Object.keys(connections).length === 0, 'a page-originated approval must connect nothing');
  assert.ok(session.get('pending_approval'), 'the real pending approval must survive a forged result');

  // Resolve GOOD's request properly so it does not dangle.
  onMessage({ type: 'thanos-approval-result', approvalId, approved: false }, popupSender, () => {});
  await resultA.catch(() => {});
});

test('O-01/M11: a non-http(s) sender cannot drive the wallet (contentScriptOrigin filter)', async () => {
  const fileSender = { id: 'thanos-ext-id', url: 'file:///tmp/evil.html', tab: { id: 9 } };
  const res = await onMessage({ type: 'thanos-rpc', method: 'eth_requestAccounts', params: [], pageId: 'pF' }, fileSender, () => {});
  const err = res as { __thanosRpcError?: { code: number } };
  assert.equal(err.__thanosRpcError?.code, 4100, 'a file:// sender has no web origin and must be refused');
  assert.ok(!session.get('pending_approval'), 'and it must not claim the approval slot');
});

test('O-01/M12: an unconnected site cannot raise a signing request (connect-before-sign)', async () => {
  const res = await onMessage(
    { type: 'thanos-rpc', method: 'personal_sign', params: ['0xdeadbeef', '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'], pageId: 'pS' },
    senderFor(EVIL, 3),
    () => {},
  );
  const err = res as { __thanosRpcError?: { code: number; message?: string } };
  // Must be the deliberate 4100, not the incidental TypeError on conn.address
  // that Autha noted still "fails closed" with M12 removed (O-01).
  assert.equal(err.__thanosRpcError?.code, 4100, 'signing from an unconnected origin must be refused with 4100');
  assert.ok(!session.get('pending_rpc_request'), 'and must never reach the approval sheet');
});

test('O-01/M13: a connected site gets one signing request at a time', async () => {
  const ADDR = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  local.set('connections', { [GOOD]: { address: ADDR, connectedAt: Date.now() } });

  const first = onMessage(
    { type: 'thanos-rpc', method: 'personal_sign', params: ['0xdeadbeef', ADDR], pageId: 'pA' },
    senderFor(GOOD, 1),
    () => {},
  );
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(session.get('pending_rpc_request'), 'the first signing request should hold the slot');

  const second = await onMessage(
    { type: 'thanos-rpc', method: 'personal_sign', params: ['0xfeedface', ADDR], pageId: 'pB' },
    senderFor(GOOD, 1),
    () => {},
  );
  const err = second as { __thanosRpcError?: { code: number } };
  assert.equal(err.__thanosRpcError?.code, -32002, 'a second signing request must get busy (-32002)');

  const held = session.get('pending_rpc_request') as { params?: unknown[] } | undefined;
  assert.equal((held?.params as string[])?.[0], '0xdeadbeef', 'the slot must still hold the FIRST request');

  onMessage({ type: 'thanos-rpc-result', requestId: (session.get('pending_rpc_request') as { id: string }).id, error: { code: 4001, message: 'rejected' } }, popupSender, () => {});
  await first.catch(() => {});
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
