/**
 * Several wallets in one vault — the web's port of the phone / extension
 * wallet set (lib/vault.ts, "Several wallets in one vault").
 *
 * What must never regress: an existing single-wallet vault opens exactly as
 * before and is not rewritten until a wallet is added; a vault whose first
 * wallet is a private key can still take more wallets (the reported bug);
 * each wallet's settings stay its own; nothing secret leaves the vault.
 *
 * Run with: pnpm --filter @thanos/web test
 */
import { describe, expect, it, beforeAll, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto'; // cacheSessionKey/getSessionKey now cache a CryptoKey in IndexedDB (hardening-audit H-2)

class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string)   { return this.m.get(k) ?? null; }
  key(i: number)       { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string){ this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

beforeAll(() => {
  vi.stubGlobal('window',         {});
  vi.stubGlobal('localStorage',   new MemStorage());
  vi.stubGlobal('sessionStorage', new MemStorage());
});
afterEach(() => { vi.restoreAllMocks(); });

import {
  createVault, openVault, saveVault, loadVault, clearVault, cacheSessionKey, clearSessionKey,
  parseWalletSet, serializeWalletSet, openWallet, listWallets, addWallet, switchWallet, openAccount,
  addAccountToWallet, renameWallet, removeWallet, readWalletSecret, currentWalletId, walletSourceOf,
  getActiveAccountIndex, setActiveAccountIndex, getAccountCount, setAccountCount,
  getAccountName, setAccountName, hideAccount, getVisibleAccountIndices, readWalletAccounts,
  isSeedBackedUp, setSeedBackedUp, getWalletOrigin, setWalletOrigin, getWalletAddresses, setWalletAddresses,
  FIRST_WALLET_ID, MAX_ACCOUNTS, MAX_WALLETS,
} from './vault';
import { serializeSource, deserializeSource } from './wallet-source';

const SLOW = { timeout: 30_000 };
const PASSWORD = 'correct horse battery staple';
const PHRASE_1 = 'test test test test test test test test test test test junk';
const PHRASE_2 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PK_1 = `0x${'11'.repeat(32)}`;
const PK_2 = `0x${'ab'.repeat(32)}`;

/** A fresh device holding one vault whose plaintext is `plaintext`, unlocked
 *  (session key cached) and opened — what the unlock screen does. */
async function freshVault(plaintext: string) {
  localStorage.clear();
  sessionStorage.clear();
  clearVault();
  const vault = await createVault(plaintext, PASSWORD);
  saveVault(vault);
  const opened = await openVault(vault, PASSWORD);
  await cacheSessionKey(opened!.key);
  return openWallet(opened!.mnemonic);
}

async function vaultPlaintext(): Promise<string> {
  const opened = await openVault(loadVault()!, PASSWORD);
  return opened!.mnemonic;
}

const added = (r: Awaited<ReturnType<typeof addWallet>>) => {
  if ('error' in r) throw new Error(r.error);
  return r.wallet;
};

describe('wallet set — format', () => {
  it('reads every single-wallet plaintext as the first wallet', () => {
    const phraseJson = serializeSource({ kind: 'mnemonic', mnemonic: PHRASE_1 });
    const keyJson = serializeSource({ kind: 'privateKey', privateKey: PK_1 });
    expect(parseWalletSet(phraseJson).wallets).toEqual([{ id: 'w0', name: 'Wallet 1', secret: PHRASE_1 }]);
    expect(parseWalletSet(keyJson).wallets).toEqual([{ id: 'w0', name: 'Wallet 1', secret: PK_1 }]);
    // The first web vaults stored the bare phrase; the phone / extension a bare secret.
    expect(parseWalletSet(PHRASE_1).wallets[0].secret).toBe(PHRASE_1);
    expect(parseWalletSet(PK_1).wallets[0].secret).toBe(PK_1);
  });

  it('writes a lone first wallet in the web’s single-wallet form, several as the shared set', () => {
    expect(serializeWalletSet({ wallets: [{ id: 'w0', name: 'Wallet 1', secret: PHRASE_1 }] }))
      .toBe(serializeSource({ kind: 'mnemonic', mnemonic: PHRASE_1 }));
    expect(serializeWalletSet({ wallets: [{ id: 'w0', name: 'Wallet 1', secret: PK_1 }] }))
      .toBe(serializeSource({ kind: 'privateKey', privateKey: PK_1 }));
    const set = { wallets: [{ id: 'w0', name: 'Wallet 1', secret: PK_1 }, { id: 'w1a2b3c4d', name: 'Savings', secret: PHRASE_2 }] };
    const json = serializeWalletSet(set);
    expect(JSON.parse(json)).toEqual({ format: 'thanos.wallets/1', wallets: set.wallets });
    expect(parseWalletSet(json)).toEqual(set);
  });

  it('ignores malformed set entries and non-set JSON', () => {
    const json = JSON.stringify({ format: 'thanos.wallets/1', wallets: [{ id: 'w0', name: '', secret: PHRASE_1 }, { id: 'w9', secret: '  ' }, null] });
    expect(parseWalletSet(json).wallets).toEqual([{ id: 'w0', name: 'Wallet', secret: PHRASE_1 }]);
    expect(parseWalletSet('{"format":"other"}').wallets[0].id).toBe('w0');
  });
});

describe('wallet set — an existing single-wallet vault', () => {
  for (const [label, plaintext, secret] of [
    ['recovery phrase', serializeSource({ kind: 'mnemonic', mnemonic: PHRASE_1 }), PHRASE_1],
    ['bare legacy phrase', PHRASE_1, PHRASE_1],
    ['private key', serializeSource({ kind: 'privateKey', privateKey: PK_1 }), PK_1],
  ] as const) {
    it(`${label}: opens unchanged and is never rewritten`, async () => {
      const w = await freshVault(plaintext);
      const before = localStorage.getItem('thanos.vault');
      expect(w).toEqual({ id: FIRST_WALLET_ID, name: 'Wallet 1', secret });
      // The signer gets exactly what it got before multi-wallet.
      expect(walletSourceOf(w.secret)).toEqual(deserializeSource(plaintext));
      expect(await listWallets()).toEqual({
        wallets: [{ id: 'w0', name: 'Wallet 1', kind: secret === PK_1 ? 'key' : 'phrase' }], activeId: 'w0',
      });
      // Opening, switching, renaming and removing the only wallet change nothing.
      expect(await switchWallet('w0')).toEqual(w);
      expect(await openAccount('w0', 0)).toEqual(w);
      expect(await renameWallet('w0', 'Main')).toBe(false);
      expect(await removeWallet('w0')).toEqual({ error: 'This is the only wallet.' });
      expect(localStorage.getItem('thanos.vault')).toBe(before);
      expect(localStorage.getItem('thanos.active_wallet')).toBeNull();
      // Its settings keep the original, un-suffixed keys.
      setAccountName(0, 'Main');
      expect(JSON.parse(localStorage.getItem('thanos.account_names')!)).toEqual({ 0: 'Main' });
    }, SLOW);
  }
});

describe('wallet set — adding wallets', () => {
  it('a private-key-first vault can add a created wallet and another key', async () => {
    await freshVault(serializeSource({ kind: 'privateKey', privateKey: PK_1 }));

    const created = added(await addWallet(PHRASE_2, undefined, 'created'));
    expect(created.id).toMatch(/^w[0-9a-f]{8}$/);
    expect(created.name).toBe('Wallet 2');
    // Opens on its first account, backed up, labelled.
    expect(currentWalletId()).toBe(created.id);
    expect(getActiveAccountIndex()).toBe(0);
    expect(getAccountCount()).toBe(1);
    expect(isSeedBackedUp()).toBe(true);
    expect(getWalletOrigin(created.id)).toBe('created');
    expect(localStorage.getItem('thanos.active_wallet')).toBe(created.id);

    // A key pasted without 0x / in capitals is the same key; a private key is
    // always "imported", whatever the caller says.
    const key = added(await addWallet(PK_2.slice(2).toUpperCase(), undefined, 'created'));
    expect(key.secret).toBe(PK_2);
    expect(getWalletOrigin(key.id)).toBe('imported');

    // The same wallet twice is refused.
    expect(await addWallet(PK_1)).toEqual({ error: 'This wallet is already in Thanos (“Wallet 1”).' });
    expect(await addWallet(`  ${PHRASE_2.toUpperCase().replace(/ /g, '   ')} `)).toEqual({ error: 'This wallet is already in Thanos (“Wallet 2”).' });

    expect(await listWallets()).toEqual({
      wallets: [
        { id: 'w0', name: 'Wallet 1', kind: 'key' },
        { id: created.id, name: 'Wallet 2', kind: 'phrase' },
        { id: key.id, name: 'Wallet 3', kind: 'key' },
      ],
      activeId: key.id,
    });

    // The vault password still opens it — the set in the shared format, bare secrets.
    expect(JSON.parse(await vaultPlaintext())).toEqual({
      format: 'thanos.wallets/1',
      wallets: [
        { id: 'w0', name: 'Wallet 1', secret: PK_1 },
        { id: created.id, name: 'Wallet 2', secret: PHRASE_2 },
        { id: key.id, name: 'Wallet 3', secret: PK_2 },
      ],
    });
    expect(await readWalletSecret(created.id)).toBe(PHRASE_2);

    // Any wallet opens again by id; the choice is remembered for the next unlock.
    expect((await switchWallet('w0'))?.secret).toBe(PK_1);
    expect(localStorage.getItem('thanos.active_wallet')).toBeNull();
    await switchWallet(created.id);
    expect(openWallet(await vaultPlaintext()).id).toBe(created.id);

    // Rename only with several wallets — and it survives the round-trip.
    expect(await renameWallet(created.id, '  Savings account  ')).toBe(true);
    expect((await listWallets())!.wallets[1].name).toBe('Savings account');
  }, SLOW);

  it('stops at the wallet limit and refuses while locked', async () => {
    await freshVault(serializeSource({ kind: 'mnemonic', mnemonic: PHRASE_1 }));
    for (let i = 2; i <= MAX_WALLETS; i++) added(await addWallet(`0x${i.toString(16).padStart(64, '0')}`));
    expect(await addWallet(PK_1)).toEqual({ error: `Thanos holds up to ${MAX_WALLETS} wallets.` });
    await clearSessionKey();
    expect(await addWallet(PK_2)).toEqual({ error: 'The wallet is locked — unlock it and try again.' });
    expect(await listWallets()).toBeNull();
  }, SLOW);

  it('leaves the vault as it was when the write fails', async () => {
    await freshVault(serializeSource({ kind: 'mnemonic', mnemonic: PHRASE_1 }));
    const before = localStorage.getItem('thanos.vault');
    const real = localStorage.setItem.bind(localStorage);
    let failed = false;
    vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
      if (k === 'thanos.vault' && !failed) { failed = true; throw new Error('QuotaExceededError'); }
      real(k, v);
    });
    const r = await addWallet(PK_1);
    expect('error' in r && r.error).toMatch(/nothing was changed/);
    expect(localStorage.getItem('thanos.vault')).toBe(before);
    expect(currentWalletId()).toBe('w0');
    expect((await listWallets())!.wallets).toHaveLength(1);
  }, SLOW);
});

describe('wallet set — accounts', () => {
  it('addAccountToWallet adds to recovery-phrase wallets only', async () => {
    await freshVault(serializeSource({ kind: 'mnemonic', mnemonic: PHRASE_1 }));
    const key = added(await addWallet(PK_1));
    expect(await addAccountToWallet(key.id)).toEqual({ error: 'This wallet was imported from a private key, so it has just the one account.' });
    expect(await addAccountToWallet('wnope')).toEqual({ error: 'That wallet is not in Thanos.' });

    // From the key wallet, "+ Add account" under the phrase wallet opens it on the new account.
    const r = await addAccountToWallet('w0');
    expect(r).toEqual({ wallet: { id: 'w0', name: 'Wallet 1', secret: PHRASE_1 }, idx: 1 });
    expect(currentWalletId()).toBe('w0');
    expect(getAccountCount()).toBe(2);
    expect(getActiveAccountIndex()).toBe(1);

    for (let i = 2; i < MAX_ACCOUNTS; i++) await addAccountToWallet('w0');
    expect(getAccountCount()).toBe(MAX_ACCOUNTS);
    expect(await addAccountToWallet('w0')).toEqual({ error: `A wallet holds up to ${MAX_ACCOUNTS} accounts.` });

    // Tapping an account of another wallet opens that wallet on that account.
    await switchWallet(key.id);
    expect((await openAccount('w0', 4))?.id).toBe('w0');
    expect(getActiveAccountIndex()).toBe(4);

    await clearSessionKey();
    expect(await addAccountToWallet('w0')).toEqual({ error: 'The wallet is locked — unlock it and try again.' });
  }, SLOW);

  it('keeps each wallet’s settings under its own keys', async () => {
    await freshVault(serializeSource({ kind: 'mnemonic', mnemonic: PHRASE_1 }));
    setAccountCount(3);
    setAccountName(1, 'Savings');
    expect(hideAccount(2)).toBe(true);
    setActiveAccountIndex(1);

    const second = added(await addWallet(PHRASE_2, undefined, 'imported'));
    // A new wallet starts clean — nothing inherited from the first.
    expect(getAccountCount()).toBe(1);
    expect(getActiveAccountIndex()).toBe(0);
    expect(getVisibleAccountIndices()).toEqual([0]);
    expect(getAccountName(1)).toBe('Account 2');
    setAccountName(0, 'Trading');
    setAccountCount(2);
    expect(JSON.parse(localStorage.getItem(`thanos.account_names@${second.id}`)!)).toEqual({ 0: 'Trading' });
    expect(localStorage.getItem(`thanos.account_count@${second.id}`)).toBe('2');
    // The first wallet's keys are the original, un-suffixed ones, untouched.
    expect(JSON.parse(localStorage.getItem('thanos.account_names')!)).toEqual({ 1: 'Savings' });
    expect(localStorage.getItem('thanos.account_count')).toBe('3');
    expect(readWalletAccounts('w0')).toEqual({ active: 1, visible: [0, 1], count: 3, names: { 1: 'Savings' } });
    expect(readWalletAccounts(second.id)).toEqual({ active: 0, visible: [0, 1], count: 2, names: { 0: 'Trading' } });

    // Backup flags are per wallet too.
    expect(isSeedBackedUp(second.id)).toBe(true);
    expect(isSeedBackedUp('w0')).toBe(false);

    await switchWallet('w0');
    expect(getAccountName(1)).toBe('Savings');
    expect(getActiveAccountIndex()).toBe(1);
    expect(isSeedBackedUp()).toBe(false);
    setSeedBackedUp(true);
    expect(localStorage.getItem('thanos.seed_backed_up')).toBe('1');

    // Removing a wallet takes its settings and metadata with it.
    setWalletAddresses(second.id, { 0: '0x1234567890123456789012345678901234567890' });
    const r = await removeWallet(second.id);
    expect('next' in r && r.next.id).toBe('w0');
    for (const base of ['thanos.account_names', 'thanos.account_count', 'thanos.account_hidden', 'thanos.active_account_idx', 'thanos.seed_backed_up']) {
      expect(localStorage.getItem(`${base}@${second.id}`)).toBeNull();
    }
    expect(getWalletAddresses(second.id)).toEqual({});
    expect(getWalletOrigin(second.id)).toBeUndefined();
  }, SLOW);
});

describe('wallet set — removing and erasing', () => {
  it('back to the first wallet alone, the vault is the single-wallet form again', async () => {
    await freshVault(serializeSource({ kind: 'mnemonic', mnemonic: PHRASE_1 }));
    const second = added(await addWallet(PK_1));
    expect(currentWalletId()).toBe(second.id);
    const r = await removeWallet(second.id);
    expect(r).toEqual({ next: { id: 'w0', name: 'Wallet 1', secret: PHRASE_1 } });
    expect(currentWalletId()).toBe('w0');
    expect(await vaultPlaintext()).toBe(serializeSource({ kind: 'mnemonic', mnemonic: PHRASE_1 }));
    expect(localStorage.getItem('thanos.active_wallet')).toBeNull();
  }, SLOW);

  it('removing the first wallet keeps the others and opens one', async () => {
    await freshVault(serializeSource({ kind: 'privateKey', privateKey: PK_1 }));
    const second = added(await addWallet(PHRASE_2, 'Main', 'created'));
    await switchWallet('w0');
    const r = await removeWallet('w0');
    expect(r).toEqual({ next: second });
    expect(currentWalletId()).toBe(second.id);
    expect(JSON.parse(await vaultPlaintext())).toEqual({ format: 'thanos.wallets/1', wallets: [second] });
    expect(await removeWallet(second.id)).toEqual({ error: 'This is the only wallet.' });
  }, SLOW);

  it('clearVault forgets every added wallet’s settings and the metadata', async () => {
    await freshVault(serializeSource({ kind: 'mnemonic', mnemonic: PHRASE_1 }));
    setWalletOrigin('w0', 'created');
    const second = added(await addWallet(PHRASE_2));
    setAccountName(0, 'Other');
    clearVault();
    expect(loadVault()).toBeNull();
    for (let i = 0; i < localStorage.length; i++) expect(localStorage.key(i)).not.toMatch(/@w/);
    expect(localStorage.getItem('thanos.wallet_meta')).toBeNull();
    expect(localStorage.getItem('thanos.active_wallet')).toBeNull();
    expect(currentWalletId()).toBe('w0');
    expect(readWalletAccounts(second.id).names).toEqual({});
  }, SLOW);
});

describe('wallet set — public metadata', () => {
  it('holds origins and addresses only — no secret is stored outside the vault', async () => {
    await freshVault(serializeSource({ kind: 'mnemonic', mnemonic: PHRASE_1 }));
    setWalletOrigin('w0', 'created');
    const key = added(await addWallet(PK_2));
    const phrase = added(await addWallet(PHRASE_2, undefined, 'imported'));
    setWalletAddresses('w0', { 0: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', 1: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' });
    setWalletAddresses(key.id, { 0: '0x1234567890123456789012345678901234567890' });
    // Anything that isn't an account address is refused.
    setWalletAddresses(phrase.id, { 0: PK_2, 1: PHRASE_2, 2: '0x0000000000000000000000000000000000000000' } as Record<number, string>);
    expect(getWalletAddresses(phrase.id)).toEqual({});

    const meta = JSON.parse(localStorage.getItem('thanos.wallet_meta')!) as Record<string, Record<string, unknown>>;
    expect(Object.keys(meta).sort()).toEqual(['w0', key.id, phrase.id].sort());
    for (const m of Object.values(meta)) for (const k of Object.keys(m)) expect(['origin', 'addrs']).toContain(k);
    expect(meta.w0).toEqual({
      origin: 'created',
      addrs: { 0: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', 1: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' },
    });

    // No stored value but the encrypted vault (and the session key) holds a
    // phrase, a word run from one, or a key.
    const needles = [PHRASE_1, PHRASE_2, 'test test test', 'abandon abandon', PK_1.slice(2), PK_2.slice(2)];
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i)!;
        if (k === 'thanos.vault' || k === 'thanos.session_key') continue;
        const v = (store.getItem(k) ?? '').toLowerCase();
        for (const n of needles) expect(v.includes(n.toLowerCase()), `${k} holds a secret`).toBe(false);
      }
    }
    const vaultRaw = localStorage.getItem('thanos.vault')!.toLowerCase();
    for (const n of needles) expect(vaultRaw.includes(n.toLowerCase())).toBe(false);
  }, SLOW);
});
