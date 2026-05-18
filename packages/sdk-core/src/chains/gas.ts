/**
 * Makalu gas estimation — shared across every client.
 *
 * Source of truth is the chain itself via ethers `getFeeData()`. If a
 * gas-tracker oracle becomes available (Etherscan-style { fast,
 * standard, slow }), an app points at it once with `setGasOracleUrl()`
 * — the web app wires NEXT_PUBLIC_MAKALU_GAS_ORACLE_URL into that — and
 * the tiered slow/standard/fast breakdown is surfaced.
 *
 * Hoisted out of apps/web/lib/gas.ts so desktop / extension / mobile
 * estimate Makalu gas the same way.
 */
import {
  parseUnits,
  type FeeData,
  type Provider,
  type TransactionRequest,
} from 'ethers';
import { getMakaluProvider } from './provider';

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

/* ─── Optional explorer-side gas oracle ────────────────────────────── */

let gasOracleUrl = '';

/**
 * Point the estimator at an Etherscan-style gas-tracker endpoint. Call
 * once at startup; with no oracle set, estimates come straight from the
 * RPC head-of-chain fees.
 */
export function setGasOracleUrl(url: string): void {
  gasOracleUrl = (url ?? '').trim();
}

/** Fetch the oracle's { fast, standard, slow } tiers, or null. */
async function fetchExplorerOracle(): Promise<MakaluGasEstimate['tiers'] | null> {
  if (!gasOracleUrl) return null;
  try {
    const res = await fetch(gasOracleUrl, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const json = (await res.json()) as {
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

async function rpcFees(
  provider: Provider,
): Promise<Pick<MakaluGasEstimate, 'maxFeePerGas' | 'maxPriorityFeePerGas'>> {
  const fd: FeeData = await provider.getFeeData();
  return {
    maxFeePerGas:         fd.maxFeePerGas         ?? fd.gasPrice ?? 0n,
    maxPriorityFeePerGas: fd.maxPriorityFeePerGas ?? 1_500_000_000n /* 1.5 gwei */,
  };
}

/* ─── Public API ───────────────────────────────────────────────────── */

/**
 * One-stop gas estimate for any tx on Makalu. Combines the explorer
 * oracle (if configured via setGasOracleUrl) with the chain's own
 * getFeeData. The tx itself is needed for the gasLimit estimate — pass
 * at least `{ from, to, value?, data? }`.
 *
 * Throws on a truly-broken RPC failure so the caller can surface "fee
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
