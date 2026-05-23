/**
 * Transaction send for the desktop wallet.
 *
 * Resolves a recipient (0x / litho1 / name.litho) to a 0x address, then
 * signs + broadcasts a native LITHO or LEP100 transfer on Makalu.
 *
 * Desktop can import @thanos/sdk-core directly, so the litho1 decoder
 * (lithoToEvm) and the failover RPC provider (getMakaluProvider) are
 * reused from there rather than re-implemented.
 */
import { createContext, useContext } from 'react';
import { HDNodeWallet, Interface, Mnemonic, Contract, parseUnits, getAddress } from 'ethers';
import { getMakaluProvider, lithoToEvm } from '@thanos/sdk-core';
import { sendViaLedger, type LedgerConnection } from './ledger-sign';
import { sendViaTrezor, type TrezorConnection } from './trezor-sign';

const HD_PATH = "m/44'/60'/0'/0/0";

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
  /** Unlocked BIP-39 seed words. Ignored when `signWith === 'ledger'`. */
  seed: string[];
  /** Resolved 0x recipient address. */
  to: string;
  /** Human-readable amount, e.g. "12.5". */
  amount: string;
  /** Token decimals — 18 for native LITHO. */
  decimals: number;
  /** LEP100 contract address; omit for a native LITHO send. */
  tokenAddress?: string;
  /** Which signer to use. Defaults to the local seed. */
  signWith?: 'seed' | 'ledger' | 'trezor';
  /** Open Ledger connection (transport + derived address). Required when
   *  `signWith === 'ledger'`. The caller owns transport lifecycle. */
  ledger?: LedgerConnection;
  /** Open Trezor connection (derived address). Required when
   *  `signWith === 'trezor'`. */
  trezor?: TrezorConnection;
}

/**
 * Sign + broadcast a transfer on Makalu — a native LITHO send when
 * `tokenAddress` is absent, otherwise a LEP100 transfer(to, amount).
 * Returns the broadcast transaction hash.
 */
export async function sendAsset(args: SendAssetArgs): Promise<string> {
  let value: bigint;
  try {
    value = parseUnits(args.amount, args.decimals);
  } catch {
    throw new Error('Invalid amount');
  }
  if (value <= 0n) throw new Error('Amount must be greater than zero');

  // ─── Hardware-wallet signing paths ────────────────────────────────────
  if (args.signWith === 'ledger') {
    if (!args.ledger) throw new Error('Ledger not connected');
    try {
      if (args.tokenAddress) {
        const data = new Interface(ERC20_TRANSFER_ABI).encodeFunctionData('transfer', [args.to, value]);
        return await sendViaLedger(args.ledger, { to: args.tokenAddress, value: 0n, data });
      }
      return await sendViaLedger(args.ledger, { to: args.to, value });
    } catch (e) {
      const msg = (e as Error).message || 'Broadcast failed';
      if (/0x6985/.test(msg))              throw new Error('Rejected on Ledger device');
      if (/insufficient funds/i.test(msg)) throw new Error('Insufficient balance on Ledger account for amount + gas');
      throw new Error(msg);
    }
  }

  if (args.signWith === 'trezor') {
    if (!args.trezor) throw new Error('Trezor not connected');
    try {
      if (args.tokenAddress) {
        const data = new Interface(ERC20_TRANSFER_ABI).encodeFunctionData('transfer', [args.to, value]);
        return await sendViaTrezor(args.trezor, { to: args.tokenAddress, value: 0n, data });
      }
      return await sendViaTrezor(args.trezor, { to: args.to, value });
    } catch (e) {
      const msg = (e as Error).message || 'Broadcast failed';
      if (/cancelled|rejected|denied/i.test(msg)) throw new Error('Rejected on Trezor device');
      if (/insufficient funds/i.test(msg))        throw new Error('Insufficient balance on Trezor account for amount + gas');
      throw new Error(msg);
    }
  }

  // ─── Default: sign with the unlocked seed ─────────────────────────────
  if (!args.seed.length) throw new Error('Wallet is locked');
  const wallet = HDNodeWallet
    .fromMnemonic(Mnemonic.fromPhrase(args.seed.join(' ')), HD_PATH)
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
