/**
 * RPC + contract bindings for Makalu (chain 700777) and Kamet (chain 900523).
 *
 * The indexer uses a *separate* RPC endpoint from user-facing requests
 * (rpc-2.litho.ai) so head-of-chain reads don't compete with sync traffic.
 * Multiple endpoints (comma-separated) build a FallbackProvider so one
 * dead RPC doesn't pause the sync loop.
 */
import { Contract, FallbackProvider, JsonRpcProvider, ZeroAddress, type Provider } from 'ethers';
import { LEP100_ABI } from './abi/lep100.js';

export const MAKALU_CHAIN_ID = 700777;
export const KAMET_CHAIN_ID  = 900523;

function readIndexerRpcUrls(): string[] {
  // The indexer prefers rpc-2 as its primary so sync traffic doesn't
  // compete with user requests on rpc.litho.ai; rpc.litho.ai is the
  // fallback. LITHO_RPC_INDEXER (comma-separated) overrides the list.
  const raw =
    process.env.LITHO_RPC_INDEXER
    || 'https://rpc-2.litho.ai,https://rpc.litho.ai';
  return String(raw).split(',').map(s => s.trim()).filter(Boolean);
}

function buildProvider(): Provider {
  const urls = readIndexerRpcUrls();
  if (urls.length === 1) return new JsonRpcProvider(urls[0], MAKALU_CHAIN_ID);
  return new FallbackProvider(
    urls.map(url => ({
      provider:     new JsonRpcProvider(url, MAKALU_CHAIN_ID),
      priority:     1,
      weight:       1,
      stallTimeout: 1500,
    })),
    MAKALU_CHAIN_ID,
    { quorum: 1 },
  );
}

/** Provider used by the sync loop. Will failover automatically across the
 *  configured endpoint list. */
export const makaluProvider: Provider = buildProvider();

/** The canonical full LEP100 ABI (ERC-20 + ERC20Burnable + Ownable) is
 *  defined once in ./abi/lep100.ts — sourced from the LEP100Token.json
 *  artifact — and re-exported here for existing importers. burn shows
 *  as a Transfer to 0x0, so the sync loop needs no burn-specific event. */
export { LEP100_ABI } from './abi/lep100.js';

export interface TokenSpec {
  chainId: number;
  address: string;
  /** Hint used if the on-chain symbol read fails. */
  fallbackSymbol?: string;
}

/**
 * Built-in token list for Makalu — the canonical LITHO ecosystem tokens
 * the wallet UI knows about. The indexer syncs `Transfer` logs for each
 * of these contracts so the wallet sees real balances / activity without
 * the operator having to set a dozen env vars on every fresh deploy.
 *
 * Operator overrides via env vars still win: setting any of
 * MAKALU_LEP100_*_ADDRESS replaces the built-in entry, and setting
 * MAKALU_LEP100_DISABLE_DEFAULTS=1 removes them entirely.
 */
// Verified live on-chain by Litho infra team 2026-06-10 (kmp/kamet-network-config).
// Mirrors packages/sdk-core/src/tokens/makalu-lep100-source.ts — kept here as a
// hard-coded copy because services/indexer must boot without an SDK import.
const DEFAULT_MAKALU_TOKENS: ReadonlyArray<{ symbol: string; address: string }> = [
  { symbol: 'wLITHO', address: '0x599a7E135f1790ae117b4EdDc0422D24Bc766161' },
  { symbol: 'LitBTC', address: '0xC4645CA5411D6E27556780AB4cdd0DF7e609df74' },
  { symbol: 'LAX',    address: '0x1Cde2Ca6c2ab8622003ebe06e382bC07850d4B8d' },
  { symbol: 'JOT',    address: '0xEF2f35f6d0fb7DC9E87b8ca8252AE2E6ffb2a25e' },
  { symbol: 'COLLE',  address: '0x10D4BB600c96e9243E2f50baFED8b2478F25af61' },
  { symbol: 'IMAGE',  address: '0xAcD98E323968647936887aD4934e64B01060727e' },
  { symbol: 'AGII',   address: '0x10052B8ccD2160b8F9880C6b4F5DD117fF253B1c' },
  { symbol: 'BLDR',   address: '0x798eD6bFc5bfCFc60938d5098825b354427A0786' },
  // FGPT = Finesse GPT, MUSA = Musa AI. The old "FurGPT" labels at
  // 0xDB829be (=MUSA) and 0xa25c2a49 (dead) were Kamet-explorer mislabels.
  { symbol: 'FGPT',   address: '0x151ef362eA96853702Cc5e7728107e3961fbD22e' },
  { symbol: 'MUSA',   address: '0xDB829befCF8E582379E2c034FA2589b8D2EA1c5D' },
];

/** Build the canonical Makalu token list. Env-var overrides (one per
 *  symbol, MAKALU_LEP100_<SYM>_ADDRESS) win over the built-in defaults.
 *  Set MAKALU_LEP100_DISABLE_DEFAULTS=1 to start from an empty list. */
export function getConfiguredTokens(): TokenSpec[] {
  const env = process.env;
  const useDefaults = env.MAKALU_LEP100_DISABLE_DEFAULTS !== '1';

  // Symbol → address, seeded from the defaults if enabled.
  const map = new Map<string, string>();
  if (useDefaults) {
    for (const t of DEFAULT_MAKALU_TOKENS) map.set(t.symbol, t.address);
  }

  // Env overrides + extra tokens via MAKALU_LEP100_<SYM>_ADDRESS.
  for (const [key, value] of Object.entries(env)) {
    const m = key.match(/^MAKALU_LEP100_(.+)_ADDRESS$/);
    if (!m || !value) continue;
    // Symbol comes back uppercase from env key; canonicalise the well-known
    // ones to match the wallet's TOKENS list ('LITBTC' → 'LitBTC' etc.).
    const symRaw = m[1];
    // FURGPT is intentionally NOT canonicalised: there is no FurGPT token
    // on-chain (FGPT = Finesse GPT, and 0xDB829be is MUSA). A leftover
    // MAKALU_LEP100_FURGPT_ADDRESS env var would resurrect the mislabel,
    // so it's ignored outright.
    if (symRaw === 'FURGPT') continue;
    const sym =
      symRaw === 'LITBTC' ? 'LitBTC' :
      symRaw === 'WLITHO' ? 'wLITHO' :
      symRaw;
    map.set(sym, value);
  }

  const tokens: TokenSpec[] = [];
  for (const [sym, addr] of map) {
    if (/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      tokens.push({
        chainId:        MAKALU_CHAIN_ID,
        address:        addr.toLowerCase(),
        fallbackSymbol: sym,
      });
    }
  }
  return tokens;
}

export function tokenContract(address: string): Contract {
  return new Contract(address, LEP100_ABI, makaluProvider);
}

/** Sentinel: when from == ZeroAddress, the Transfer represents a mint. */
export const ZERO_ADDRESS = ZeroAddress;
