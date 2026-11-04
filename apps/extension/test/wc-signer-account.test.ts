/**
 * Autha THN-R1 O-06 — the signature must come from the account the approval
 * sheet reviewed.
 *
 * executeWcRequest() derives its signer from hdPath(), which reads the ACTIVE
 * account index at sign time. The popup re-reads that index on
 * storage.onChanged, so the account can change while a sheet is open: the
 * sheet says "Signing as 0xf39F…" and the signature comes back from a
 * different account. The `account` field pins the reviewed address and the
 * request fails closed on mismatch.
 *
 * node:test under tsx, with the same in-memory storage shims vault.test.ts
 * uses (lib/vault reads localStorage on load).
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

class MemStorage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}
const local = new MemStorage();

/** Any call here means the request reached the offscreen signer. */
let signerCalls: unknown[] = [];

for (const [name, value] of [['localStorage', local], ['sessionStorage', new MemStorage()], ['window', globalThis]] as const) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
Object.defineProperty(globalThis, 'browser', {
  configurable: true,
  writable: true,
  value: {
    runtime: {
      id: 'thanos-ext-id',
      getURL: (p: string) => `chrome-extension://thanos-ext-id${p}`,
      sendMessage: async (m: unknown) => { signerCalls.push(m); return { ok: true, signature: '0x00' }; },
    },
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    },
    offscreen: { createDocument: async () => {}, hasDocument: async () => true },
  },
});

let W: typeof import('../src/entrypoints/popup/wc-signer');
let V: typeof import('../src/lib/vault');
before(async () => {
  V = await import('../src/lib/vault');
  W = await import('../src/entrypoints/popup/wc-signer');
});

// Hardhat test vectors — public, never funded.
const PHRASE = 'test test test test test test test test test test test junk';
const SEED = PHRASE.split(' ');
const ACCT_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const ACCT_1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

beforeEach(() => { local.clear(); signerCalls = []; });

const personalSign = (account?: string) =>
  W.executeWcRequest(SEED, {
    request: { method: 'personal_sign', params: ['0xdeadbeef', ACCT_0] },
    account,
  });

test('O-06: refuses to sign when the active account is not the reviewed one', async () => {
  // The sheet reviewed account 0; the user switched to account 1 before approving.
  V.setActiveAccountIndex(1);
  await assert.rejects(
    () => personalSign(ACCT_0),
    (e: Error) => /active account changed/i.test(e.message),
    'a mismatch between the reviewed and active account must fail closed',
  );
  assert.deepEqual(signerCalls, [], 'and must never reach the offscreen signer');
});

test('O-06: signs normally when the active account is the reviewed one', async () => {
  V.setActiveAccountIndex(0);
  await personalSign(ACCT_0);
  assert.equal(signerCalls.length, 1, 'the matching case must still sign');
});

test('O-06: the guard compares addresses case-insensitively', async () => {
  V.setActiveAccountIndex(0);
  await personalSign(ACCT_0.toLowerCase());
  assert.equal(signerCalls.length, 1, 'a lowercased address is the same account');
});

test('O-06: an account the sheet never pinned still signs (back-compat)', async () => {
  // Callers that pass no `account` keep the old behaviour, so an unrelated
  // caller can't be broken by the guard — but the two approval sheets that
  // display "Signing as" both pass it.
  V.setActiveAccountIndex(1);
  await personalSign(undefined);
  assert.equal(signerCalls.length, 1);
  assert.notEqual(ACCT_0, ACCT_1); // guards the fixture itself
});
