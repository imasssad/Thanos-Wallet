/**
 * Autha THN-R1 O-06 — the signature must come from the account the approval
 * sheet reviewed.
 *
 * executeWcRequest() asks the offscreen signer (sign.address) for the
 * account it will actually sign with and refuses to proceed if that
 * disagrees with the address the approval sheet reviewed and displayed as
 * "Signing as" — set via initSigner()/setSignerAccountIndex() at unlock /
 * account-switch time, exactly as main.tsx does. Without the guard, an
 * account switch between approval and signing would silently redirect the
 * signature to an account the user never reviewed.
 *
 * node:test under tsx. The mock offscreen signer below mirrors
 * entrypoints/offscreen/main.ts's real cached-source model closely enough
 * to exercise this: a cached mnemonic + account index, address derived on
 * demand, never re-sent per signing call.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { HDNodeWallet, Mnemonic } from 'ethers';

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

/** Calls that reached the (mocked) offscreen signer, reset before each
 *  test's actual signing attempt so "never reached it" is checkable. */
let signerCalls: unknown[] = [];

// Minimal stand-in for entrypoints/offscreen/main.ts's cached-source model —
// just enough to answer sign.init / sign.set-account-index / sign.address /
// sign.evm-personal the same way the real offscreen document would.
let cachedMnemonic: string | null = null;
let cachedIdx = 0;
function deriveAddr(): string {
  if (!cachedMnemonic) throw new Error('signer_locked');
  return HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(cachedMnemonic), `m/44'/60'/0'/0/${cachedIdx}`).address;
}

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
      sendMessage: async (m: { type: string; source?: { mnemonic: string }; accountIndex?: number }) => {
        signerCalls.push(m);
        if (m.type === 'sign.init') {
          cachedMnemonic = m.source!.mnemonic;
          cachedIdx = m.accountIndex ?? 0;
          return { ok: true, address: deriveAddr() };
        }
        if (m.type === 'sign.set-account-index') {
          cachedIdx = m.accountIndex ?? 0;
          return { ok: true, address: deriveAddr() };
        }
        if (m.type === 'sign.address') return { ok: true, address: deriveAddr() };
        if (m.type === 'sign.evm-personal') return { ok: true, signature: '0x00' };
        return { ok: true };
      },
    },
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    },
    offscreen: { createDocument: async () => {}, hasDocument: async () => true },
  },
});

let W: typeof import('../src/entrypoints/popup/wc-signer');
let O: typeof import('../src/entrypoints/popup/offscreen-sign');
before(async () => {
  W = await import('../src/entrypoints/popup/wc-signer');
  O = await import('../src/entrypoints/popup/offscreen-sign');
});

// Hardhat test vectors — public, never funded.
const PHRASE = 'test test test test test test test test test test test junk';
const SEED = PHRASE.split(' ');
const ACCT_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const ACCT_1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

beforeEach(async () => {
  local.clear();
  // Simulate main.tsx's onComplete(): the offscreen signer is initialised
  // once, at unlock, same as the real flow — not re-sent per signing call.
  await O.initSigner(SEED, 0);
  signerCalls = [];
});

const personalSign = (account?: string) =>
  W.executeWcRequest(SEED, {
    request: { method: 'personal_sign', params: ['0xdeadbeef', ACCT_0] },
    account,
  });

test('O-06: refuses to sign when the active account is not the reviewed one', async () => {
  // The sheet reviewed account 0; the user switched to account 1 before
  // approving — main.tsx's switchAccount() pushes that into the offscreen
  // cache via setSignerAccountIndex.
  await O.setSignerAccountIndex(1);
  signerCalls = [];
  await assert.rejects(
    () => personalSign(ACCT_0),
    (e: Error) => /active account changed/i.test(e.message),
    'a mismatch between the reviewed and active account must fail closed',
  );
  assert.deepEqual(signerCalls.filter((c) => (c as { type: string }).type === 'sign.evm-personal'), [], 'and must never reach the offscreen signer');
});

test('O-06: signs normally when the active account is the reviewed one', async () => {
  await personalSign(ACCT_0);
  assert.equal(signerCalls.filter((c) => (c as { type: string }).type === 'sign.evm-personal').length, 1, 'the matching case must still sign');
});

test('O-06: the guard compares addresses case-insensitively', async () => {
  await personalSign(ACCT_0.toLowerCase());
  assert.equal(signerCalls.filter((c) => (c as { type: string }).type === 'sign.evm-personal').length, 1, 'a lowercased address is the same account');
});

test('O-06: an account the sheet never pinned still signs (back-compat)', async () => {
  // Callers that pass no `account` keep the old behaviour, so an unrelated
  // caller can't be broken by the guard — but the two approval sheets that
  // display "Signing as" both pass it.
  await O.setSignerAccountIndex(1);
  signerCalls = [];
  await personalSign(undefined);
  assert.equal(signerCalls.filter((c) => (c as { type: string }).type === 'sign.evm-personal').length, 1);
  assert.notEqual(ACCT_0, ACCT_1); // guards the fixture itself
});
