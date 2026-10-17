// Copied from packages/multisig/src/store.ts by scripts/sync-multisig.mjs — edit the original and re-run it.
/**
 * The multisigs this wallet keeps in its list, per chain, with the names the user gave them.
 * Only addresses and names: everything else is read from the chain.
 */
import { parseAddress, type Address } from '@litho-vault/sdk';

export interface KeyValueStore {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
}

/** localStorage, where the app has one (web, extension popup, desktop renderer). */
export const browserStore: KeyValueStore = {
  get(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* storage full or blocked: the list just isn't remembered */
    }
  },
};

export interface SavedVault {
  address: Address;
  name: string;
  addedAt: number;
}

export const MAX_SAVED_VAULTS = 100;
export const MAX_VAULT_NAME = 40;

/** Strips control and bidirectional-override characters (a name must not reorder what's shown next to it). */
export function cleanVaultName(name: string): string {
  return name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .trim()
    .slice(0, MAX_VAULT_NAME)
    .trim();
}

export class SavedVaults {
  private readonly key: string;

  constructor(
    private readonly store: KeyValueStore,
    chainId: number,
  ) {
    this.key = `thanos.multisig.v1.${chainId}.vaults`;
  }

  async list(): Promise<SavedVault[]> {
    let raw: unknown;
    try {
      raw = JSON.parse((await this.store.get(this.key)) ?? '[]');
    } catch {
      return [];
    }
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: SavedVault[] = [];
    for (const entry of raw.slice(0, MAX_SAVED_VAULTS)) {
      const address = parseAddress(String(entry?.address ?? ''));
      if (!address || seen.has(address)) continue;
      seen.add(address);
      out.push({ address, name: cleanVaultName(String(entry?.name ?? '')) || defaultName(address), addedAt: Number(entry?.addedAt) || 0 });
    }
    return out;
  }

  private async write(list: SavedVault[]): Promise<void> {
    await this.store.set(this.key, JSON.stringify(list.slice(0, MAX_SAVED_VAULTS)));
  }

  /** Adds a vault, or renames it if it is already in the list. Returns the saved entry. */
  async add(address: string, name?: string): Promise<SavedVault> {
    const a = parseAddress(address);
    if (!a) throw new Error('Enter a valid address (litho1… or 0x…)');
    const list = await this.list();
    const existing = list.find((v) => v.address === a);
    const clean = name !== undefined ? cleanVaultName(name) : '';
    if (existing) {
      if (clean) existing.name = clean;
      await this.write(list);
      return existing;
    }
    if (list.length >= MAX_SAVED_VAULTS) throw new Error(`You can keep up to ${MAX_SAVED_VAULTS} multisigs in the list`);
    const entry = { address: a, name: clean || defaultName(a), addedAt: Date.now() };
    await this.write([...list, entry]);
    return entry;
  }

  async remove(address: string): Promise<void> {
    const a = parseAddress(address);
    await this.write((await this.list()).filter((v) => v.address !== a));
  }

  /** How far the factory's creation events have been scanned for this wallet (see MultisigClient.discover). */
  async scanCursor(account: string): Promise<{ block: number; found: Address[] }> {
    try {
      const raw = JSON.parse((await this.store.get(`${this.key}.scan.${account.toLowerCase()}`)) ?? 'null');
      const found = Array.isArray(raw?.found) ? raw.found.map((x: unknown) => parseAddress(String(x))).filter(Boolean) : [];
      return { block: Number.isSafeInteger(raw?.block) ? raw.block : -1, found };
    } catch {
      return { block: -1, found: [] };
    }
  }

  async setScanCursor(account: string, block: number, found: Address[]): Promise<void> {
    await this.store.set(`${this.key}.scan.${account.toLowerCase()}`, JSON.stringify({ block, found: found.slice(0, MAX_SAVED_VAULTS) }));
  }

  /** Execution transactions this wallet sent, so the proposal screen can link them without an indexer. */
  async executionTx(vault: Address, id: bigint): Promise<string | null> {
    const tx = await this.store.get(`${this.key}.executed.${vault}.${id}`);
    return tx && /^0x[0-9a-fA-F]{64}$/.test(tx) ? tx : null;
  }

  async setExecutionTx(vault: Address, id: bigint, hash: string): Promise<void> {
    await this.store.set(`${this.key}.executed.${vault}.${id}`, hash);
  }
}

export function defaultName(address: string): string {
  return `MultiSig ${address.slice(2, 6).toUpperCase()}`;
}
