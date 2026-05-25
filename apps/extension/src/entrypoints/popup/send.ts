/**
 * Transaction send for the extension popup.
 *
 * Resolves a recipient (0x / litho1 / name.litho) to a 0x address, then
 * signs + broadcasts a native LITHO or LEP100 transfer on Makalu.
 * Reuses sdk-core's litho1 decoder and failover RPC provider.
 */
import { createContext, useContext } from 'react';
import { HDNodeWallet, Mnemonic, Contract, parseUnits, getAddress } from 'ethers';
import { getMakaluProvider, lithoToEvm } from '@thanos/sdk-core';
import { getActiveAccountIndex } from '../../lib/vault';

/** HD path for the active account. Computed at sign time so an account
 *  switch in the popup takes effect on the very next send. */
function activeHdPath(): string {
  return `m/44'/60'/0'/0/${getActiveAccountIndex()}`;
}

const API_BASE = String(
  (import.meta as unknown as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL ||
    'https://thanos.fi/api',
).replace(/\/$/, '');

const ERC20_TRANSFER_ABI = ['function transfer(address to, uint256 amount) returns (bool)'];

/* ─── Unlocked-seed context ──────────────────────────────────────────── */

/** BIP-39 seed words for the unlocked wallet; empty array while locked. */
export const WalletSeedContext = createContext<string[]>([]);
export function useWalletSeed(): string[] {
  return useContext(WalletSeedContext);
}

/* ─── Recipient resolution ───────────────────────────────────────────── */

async function resolveDnnsName(name: string): Promise<string> {
  const res = await fetch(
    `${API_BASE}/dnns/resolve?name=${encodeURIComponent(name.toLowerCase())}`,
    { headers: { accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`DNNS lookup failed (${res.status})`);
  const json = (await res.json()) as { record?: { address?: string | null } };
  const addr = json.record?.address;
  if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new Error(`"${name}" is not registered`);
  }
  return getAddress(addr);
}

/** Resolve any accepted recipient form to a canonical 0x address. */
export async function resolveRecipient(input: string): Promise<string> {
  const s = (input || '').trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return getAddress(s);
  if (/^litho1[0-9a-z]+$/i.test(s)) return lithoToEvm(s);
  if (/^[a-z0-9-]+\.litho$/i.test(s)) return resolveDnnsName(s);
  throw new Error('Enter a 0x…, litho1…, or name.litho address');
}

/* ─── Send ───────────────────────────────────────────────────────────── */

export interface SendAssetArgs {
  seed:          string[];
  to:            string;
  amount:        string;
  decimals:      number;
  tokenAddress?: string;
}

/**
 * Sign + broadcast a transfer on Makalu — native LITHO when
 * `tokenAddress` is absent, otherwise a LEP100 transfer(to, amount).
 * Returns the broadcast transaction hash.
 */
export async function sendAsset(args: SendAssetArgs): Promise<string> {
  if (!args.seed.length) throw new Error('Wallet is locked');

  let value: bigint;
  try {
    value = parseUnits(args.amount, args.decimals);
  } catch {
    throw new Error('Invalid amount');
  }
  if (value <= 0n) throw new Error('Amount must be greater than zero');

  const wallet = HDNodeWallet
    .fromMnemonic(Mnemonic.fromPhrase(args.seed.join(' ')), activeHdPath())
    .connect(getMakaluProvider());

  try {
    if (args.tokenAddress) {
      const token = new Contract(args.tokenAddress, ERC20_TRANSFER_ABI, wallet);
      const sent = await token.transfer(args.to, value);
      return sent.hash as string;
    }
    const sent = await wallet.sendTransaction({ to: args.to, value });
    return sent.hash;
  } catch (e) {
    const msg = (e as Error).message || 'Broadcast failed';
    if (/insufficient funds/i.test(msg)) throw new Error('Insufficient balance for amount + gas');
    throw new Error(msg);
  }
}
