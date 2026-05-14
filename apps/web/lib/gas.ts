'use client';
/**
 * Makalu gas helper.
 *
 * Centralises every fee-rate / gas-limit read so we have one canonical
 * place to swap in a better oracle later. Today the source-of-truth is
 * the chain itself via ethers' `getFeeData()` (which hits `eth_gasPrice`
 * and `eth_maxPriorityFeePerGas` on rpc.litho.ai). The explorer at
 * https://makalu.litho.ai does NOT publish a gas-tracker API right now;
 * if it ever does (the typical shape is something like
 * `/api?module=gastracker&action=gasoracle`), the only change is the
 * oracle branch below — every caller already routes through this
 * module so they pick up the upgrade for free.
 *
 * The shape we return mirrors the EIP-1559 fields ethers reports plus
 * an optional tiered breakdown (slow / standard / fast) for future
 * "choose your speed" UX. Today we surface a single "standard" tier
 * from the RPC's current head.
 */
import {
  parseUnits,
  type FeeData,
  type Provider,
  type TransactionRequest,
} from 'ethers';
import { getMakaluProvider } from './rpc';

/** EIP-1559 + breakdown shape every consumer should use. */
export interface MakaluGasEstimate {
  /** Units the tx is expected to consume (gasLimit). */
  gasLimit:             bigint;
  /** EIP-1559 max fee per gas — what ethers reports. */
  maxFeePerGas:         bigint;
  /** EIP-1559 priority tip per gas. */
  maxPriorityFeePerGas: bigint;
  /** Ceiling = gasLimit × maxFeePerGas, in wei. */
  totalWei:             bigint;
  /** Same total formatted in LITHO (string, 18-dp). */
  totalLitho:           string;
  /** Optional tiered breakdown if a gas oracle is configured. */
  tiers?: {
    slow:     { maxFeePerGas: bigint; etaSec: number };
    standard: { maxFeePerGas: bigint; etaSec: number };
    fast:     { maxFeePerGas: bigint; etaSec: number };
  };
  /** Where the numbers came from — useful for tooltips. */
  source: 'rpc' | 'explorer' | 'override';
}

/* ─── Optional explorer-side gas oracle (currently a no-op) ────────── */

/** If makalu.litho.ai exposes a gas-tracker API in the future, point
 *  NEXT_PUBLIC_MAKALU_GAS_ORACLE_URL at it. The expected response is
 *  the Etherscan-style { fast, standard, slow } in gwei. */
async function fetchExplorerOracle(): Promise<MakaluGasEstimate['tiers'] | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const url = (typeof process !== 'undefined' && (process as any).env?.NEXT_PUBLIC_MAKALU_GAS_ORACLE_URL) || '';
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json() as {
      fast?:     number | string;
      standard?: number | string;
      slow?:     number | string;
      // Etherscan-style:
      result?: {
        FastGasPrice?:    string;
        ProposeGasPrice?: string;
        SafeGasPrice?:    string;
      };
    };
    const pick = (v: unknown): bigint | null => {
      if (v === undefined || v === null) return null;
      try { return parseUnits(String(v), 'gwei'); }
      catch { return null; }
    };
    // Try both flat and Etherscan-shaped responses.
    const fast     = pick(json.fast     ?? json.result?.FastGasPrice);
    const standard = pick(json.standard ?? json.result?.ProposeGasPrice);
    const slow     = pick(json.slow     ?? json.result?.SafeGasPrice);
    if (!fast || !standard || !slow) return null;
    return {
      slow:     { maxFeePerGas: slow,     etaSec: 60 },
      standard: { maxFeePerGas: standard, etaSec: 20 },
      fast:     { maxFeePerGas: fast,     etaSec: 6  },
    };
  } catch {
    return null;
  }
}

/* ─── RPC head-of-chain fees (always available) ────────────────────── */

async function rpcFees(provider: Provider): Promise<Pick<MakaluGasEstimate, 'maxFeePerGas' | 'maxPriorityFeePerGas'>> {
  const fd: FeeData = await provider.getFeeData();
  return {
    maxFeePerGas:         fd.maxFeePerGas         ?? fd.gasPrice            ?? 0n,
    maxPriorityFeePerGas: fd.maxPriorityFeePerGas ?? 1_500_000_000n /* 1.5 gwei */,
  };
}

/* ─── Public API ───────────────────────────────────────────────────── */

/**
 * One-stop gas estimate for any tx on Makalu. Combines the explorer
 * oracle (if available) with the chain's own getFeeData. The tx itself
 * is needed for the gasLimit estimate — pass at least `{ from, to,
 * value?, data? }`.
 *
 * Throws on truly-broken RPC failure so the caller can surface "fee
 * unavailable" instead of silently misrepresenting cost.
 */
export async function estimateMakaluGas(args: {
  tx?:       TransactionRequest;
  provider?: Provider;
}): Promise<MakaluGasEstimate> {
  const provider = args.provider ?? getMakaluProvider();

  const [tiers, head, gasLimit] = await Promise.all([
    fetchExplorerOracle(),
    rpcFees(provider),
    args.tx ? provider.estimateGas(args.tx) : Promise.resolve(21_000n),
  ]);

  const maxFeePerGas         = tiers?.standard.maxFeePerGas ?? head.maxFeePerGas;
  const maxPriorityFeePerGas = head.maxPriorityFeePerGas;
  const totalWei             = gasLimit * maxFeePerGas;
  // 18-decimal LITHO format inlined to avoid pulling formatEther.
  const intPart  = totalWei / 1_000_000_000_000_000_000n;
  const fracPart = (totalWei % 1_000_000_000_000_000_000n).toString().padStart(18, '0');
  const totalLitho = `${intPart}.${fracPart}`.replace(/0+$/, '').replace(/\.$/, '');

  return {
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    totalWei,
    totalLitho,
    tiers: tiers ?? undefined,
    source: tiers ? 'explorer' : 'rpc',
  };
}
