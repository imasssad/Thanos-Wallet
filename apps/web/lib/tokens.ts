/**
 * Lithosphere ecosystem tokens — single source of truth for the wallet UI.
 *
 * Confirmed on-chain by Litho infra team 2026-06-10 (kmp/kamet-network-config).
 * Addresses are on Makalu (chain 700777 — still testnet) and the verified
 * source-of-truth lives at packages/sdk-core/src/tokens/makalu-lep100-source.ts.
 *
 * Icon paths point at `apps/web/public/images/tokens/{file}`. The 2026-06
 * client icon pack (litho/jot/lax/colle/image/agii/fgpt/musa/atua) is
 * committed there — per the client, the marks are pre-sized for visual
 * parity with the BTC/ETH logos, so render them as-is (no extra scaling).
 * Tokens with `icon: ''` have no bundled asset and resolve their logo at
 * runtime via lib/token-logos.ts (CoinGecko CDN) — BTC, SOL, ATOM, LitBTC.
 *
 * `color` is the brand-circle fallback AND the backdrop a transparent
 * icon (e.g. furgpt) is composited onto — so it MUST match the icon's
 * actual hue, not an arbitrary value.
 */

export type Token = {
  /** Ticker. Used as React keys and shown to users. */
  sym:       string;
  /** Full name (e.g. 'Lithosphere'). */
  name:      string;
  /** Where it lives. 'native' for the chain coin. */
  chain:     'Makalu' | 'Kamet' | 'Bitcoin' | 'EVM' | 'Solana' | 'Cosmos';
  /** Contract address. `null` for native gas coin. */
  address:   string | null;
  /** Decimals — 18 for all LEP100 (ERC-20) tokens. */
  decimals:  number;
  /** Brand color (used for avatar dot when image isn't loaded). */
  color:     string;
  /** Public path for the token icon (PNG/SVG). Falls back to avatar dot. */
  icon:      string;
  /** USD price floor — used only as a fallback when the live oracle in
   *  lib/pricing.ts can't resolve a symbol (e.g. obscure tokens not on
   *  CoinGecko). Real prices come from usePrices() at runtime. */
  priceUsd:  number;
  /** Deprecated — kept for legacy callers but always '0'. Live balances
   *  come from useLiveBalances() (wallet RPC + indexer + mempool.space). */
  balance:   string;
  /** Deprecated — kept for legacy callers but always 0. Live 24h change
   *  comes from CoinGecko via usePrices(). */
  change24h: number;
};

/**
 * Pricing rules (per client spec):
 *   LAX    = hard-coded $1.0001 always
 *   LITHO  = placeholder $8.60 (client-set 2026-06-12) until oracle wired
 *   JOT    = placeholder $0.50 until oracle wired
 *   IMAGE  = fetched live (CoinGecko id 'imagen-ai' — confirmed by Ignite team)
 *   LitBTC = fetched live (tracks BTC via CoinGecko)
 *   FGPT   = fetched live (symbol lookup on CoinGecko, falls back to placeholder)
 *   COLLE  = fetched live (symbol lookup on CoinGecko, falls back to placeholder)
 * See apps/web/lib/pricing.ts for the fetcher + cache.
 */
export const TOKENS: Token[] = [
  {
    sym: 'LITHO',
    name: 'Lithosphere',
    chain: 'Makalu',
    address: null, // native gas coin
    decimals: 18,
    color: '#3b7af7',
    icon: '/images/tokens/litho.png',  // 2026-06 client icon pack (sized to match BTC etc.)
    priceUsd: 8.60,        // placeholder per client (2026-06-12) — see pricing.ts
    balance: '0',
    change24h: 0,
  },
  {
    sym: 'LitBTC',
    name: 'Bitcoin (wrapped on Lithosphere)',
    chain: 'Makalu',
    address: '0xC4645CA5411D6E27556780AB4cdd0DF7e609df74',
    decimals: 18,
    color: '#f7931a',
    icon: '',               // no bundled asset — token-logos resolves litbtc → bitcoin CDN
    priceUsd: 63200,        // fetched live — pricing.ts overrides this on load
    balance: '0',
    change24h: 0,
  },
  {
    sym: 'JOT',
    name: 'Jot Art',
    chain: 'Makalu',
    address: '0xEF2f35f6d0fb7DC9E87b8ca8252AE2E6ffb2a25e',
    decimals: 18,
    color: '#ef4444',       // red — matches the Jot-red coin Esha pinned (2026-06)
    icon: '/images/tokens/jot.png',
    priceUsd: 0.50,         // placeholder — see pricing.ts
    balance: '0',
    change24h: 0,
  },
  {
    sym: 'LAX',
    name: 'Lithosphere Algorithmic',
    chain: 'Makalu',
    address: '0x1Cde2Ca6c2ab8622003ebe06e382bC07850d4B8d',
    decimals: 18,
    color: '#2f6bff',       // blue — matches the full-bg lax.png coin
    icon: '/images/tokens/lax.png',
    priceUsd: 1.0001,       // HARD-CODED — never fetched. see pricing.ts
    balance: '0',
    change24h: 0,
  },
  {
    sym: 'COLLE',
    name: 'Colle AI',
    // Verified on Makalu by Litho infra 2026-06-10 (was truncated to 32 hex chars).
    address: '0x10D4BB600c96e9243E2f50baFED8b2478F25af61',
    chain: 'Makalu',
    decimals: 18,
    color: '#29b6d8',       // teal — matches the colle.png circuit accent
    icon: '/images/tokens/colle.png',
    priceUsd: 0.020,        // fetched live — pricing.ts overrides this on load
    balance: '0',
    change24h: 0,
  },
  {
    sym: 'IMAGE',
    name: 'Imagen Network',
    chain: 'Makalu',
    address: '0xAcD98E323968647936887aD4934e64B01060727e',
    decimals: 18,
    color: '#22d3ee',
    icon: '/images/tokens/image.png',  // 2026-06 client icon pack
    priceUsd: 0.0000115,    // fallback — live via CoinGecko id 'imagen-ai' (pricing.ts)
    balance: '0',
    change24h: 0,
  },
  {
    // FGPT — on-chain name() returns "FurGPT", symbol() "FGPT" (re-verified
    // live via eth_call 2026-06-15). Litho-side lists that map FurGPT to
    // 0xDB829be are wrong — that contract is on-chain "Mansa AI"/MUSA (see
    // the MUSA entry below). Same project as the furgpt.org dApp tile.
    sym: 'FGPT',
    name: 'FurGPT',
    chain: 'Makalu',
    address: '0x151ef362eA96853702Cc5e7728107e3961fbD22e',
    decimals: 18,
    color: '#a855f7',
    icon: '/images/tokens/fgpt.png',   // real FGPT mark from the 2026-06 client icon pack
    priceUsd: 0.015,
    balance: '0',
    change24h: 0,
  },
  {
    // MUSA — on-chain name() returns "Mansa AI" (verified via eth_call
    // 2026-06-12). Matches the mansa.world dApp tile.
    sym: 'MUSA',
    name: 'Mansa AI',
    chain: 'Makalu',
    address: '0xDB829befCF8E582379E2c034FA2589b8D2EA1c5D',
    decimals: 18,
    color: '#a855f7',
    icon: '/images/tokens/musa.png',   // 2026-06 client icon pack
    priceUsd: 0.01,
    balance: '0',
    change24h: 0,
  },
  // ─── Solana ────────────────────────────────────────────────────────────
  // Native SOL: `address: null` follows the same convention as LITHO. The
  // wallet derives a Solana keypair from the BIP39 seed at the SLIP-0010
  // path m/44'/501'/0'/0' (handled by sdk-core's deriveSolanaKeypair).
  // Recipients on this row use base58 PublicKey strings, not 0x / litho1.
  {
    sym: 'SOL',
    name: 'Solana',
    chain: 'Solana',
    address: null, // native
    decimals: 9,
    color: '#14f195',
    icon: '/images/tokens/sol.png',  // official solana.com/branding logomark (rendered from canonical SVG)
    priceUsd: 150.00,       // fetched live from CoinGecko via pricing.ts
    balance: '0',
    change24h: 0,
  },
  // ─── Bitcoin ───────────────────────────────────────────────────────────
  // Native BTC at BIP84 segwit path m/84'/0'/0'/0/0 → bc1q… address.
  // UTXO management + PSBT signing handled by sdk-core's BitcoinClient
  // talking to mempool.space. Recipients on this row use legacy /
  // segwit / bech32 / taproot addresses, not 0x / litho1.
  {
    sym: 'BTC',
    name: 'Bitcoin',
    chain: 'Bitcoin',
    address: null, // native
    decimals: 8,
    color: '#f7931a',
    icon: '',               // no bundled asset — token-logos resolves btc → CoinGecko CDN
    priceUsd: 63200,        // fetched live from CoinGecko via pricing.ts
    balance: '0',
    change24h: 0,
  },
  // ─── Cosmos Hub ───────────────────────────────────────────────────────
  // ATOM at BIP44 path m/44'/118'/0'/0/0 → cosmos1… bech32. Send + sign
  // via @cosmjs/stargate (see lib/cosmos.ts). Recipients on this row
  // must be cosmos1-prefixed bech32 addresses.
  {
    sym: 'ATOM',
    name: 'Cosmos Hub',
    chain: 'Cosmos',
    address: null, // native
    decimals: 6,
    color: '#6f7390',
    icon: '/images/tokens/atom.png',  // bundled — cropped CoinGecko logo
    priceUsd: 8.50,         // fetched live from CoinGecko via pricing.ts
    balance: '0',
    change24h: 0,
  },
  // NOTE: the old IGNITE + QUANTT rows were removed (2026-06-12). Neither
  // exists as a Makalu LEP100 contract — they shipped with zero-address
  // placeholders and rendered as real assets in the UI. Ignite is a dApp
  // (Discover tile), and the only Quantt-family token on-chain is QTT on
  // Kamet (0x16EE7127C9E03e29ca5727e23dd7CB03D283cDBe) — add a Kamet row
  // for it when the wallet grows a Kamet network switch.
];

/** Quick lookup by ticker. */
export const TOKEN_BY_SYM: Record<string, Token> =
  Object.fromEntries(TOKENS.map(t => [t.sym, t]));

/** Canonical Lithosphere explorer host per chain (Litho-confirmed
 *  2026-06-15). Chain-aware so links never go stale post-Kamet-migration —
 *  do NOT hard-code makalu.litho.ai as the permanent explorer. */
export function lithoExplorerBase(chain: Token['chain']): string {
  return chain === 'Kamet' ? 'https://explorer-3.litho.ai' : 'https://makalu.litho.ai';
}

/** Explorer URL for a token (or 'native' for the chain coin). */
export function explorerUrl(t: Token): string {
  return `${lithoExplorerBase(t.chain)}/token/${t.address ?? 'native'}`;
}
