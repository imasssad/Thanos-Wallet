/**
 * Lithosphere ecosystem tokens — single source of truth for the wallet UI.
 *
 * Confirmed by the client; addresses are on Makalu mainnet (chain 700777).
 * NOTE: COLLE is intentionally truncated to 32 hex chars in the source the
 * client provided — flagging for verification on the explorer.
 *
 * Icon paths point at `apps/web/public/images/tokens/{file}.png`. The actual
 * image assets still need to be downloaded from the Dropbox / Wikipedia URLs
 * the client shared and committed to that public/ directory.
 */

export type Token = {
  /** Ticker. Used as React keys and shown to users. */
  sym:       string;
  /** Full name (e.g. 'Lithosphere'). */
  name:      string;
  /** Where it lives. 'native' for the chain coin. */
  chain:     'Makalu' | 'Kamet' | 'Bitcoin' | 'EVM' | 'Solana';
  /** Contract address. `null` for native gas coin. */
  address:   string | null;
  /** Decimals — 18 for all LEP100 (ERC-20) tokens. */
  decimals:  number;
  /** Brand color (used for avatar dot when image isn't loaded). */
  color:     string;
  /** Public path for the token icon (PNG/SVG). Falls back to avatar dot. */
  icon:      string;
  /** Mock USD price (until pricing service is wired). */
  priceUsd:  number;
  /** Mock balance, formatted. */
  balance:   string;
  /** Mock 24h % change. */
  change24h: number;
};

/**
 * Pricing rules (per client spec):
 *   LAX    = hard-coded $1.0001 always
 *   LITHO  = placeholder $5.00 until oracle wired
 *   JOT    = placeholder $0.50 until oracle wired
 *   IMAGE  = placeholder $0.025 until oracle wired
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
    icon: '/images/tokens/litho.png',
    priceUsd: 5.00,        // placeholder — see pricing.ts
    balance: '50,000',
    change24h: 18.40,
  },
  {
    sym: 'LitBTC',
    name: 'Bitcoin (wrapped on Lithosphere)',
    chain: 'Makalu',
    address: '0xC4645CA5411D6E27556780AB4cdd0DF7e609df74',
    decimals: 18,
    color: '#f7931a',
    icon: '/images/tokens/litbtc.png',
    priceUsd: 63200,        // fetched live — pricing.ts overrides this on load
    balance: '0.85',
    change24h: 2.40,
  },
  {
    sym: 'JOT',
    name: 'Jot Art',
    chain: 'Makalu',
    address: '0xEF2f35f6d0fb7DC9E87b8ca8252AE2E6ffb2a25e',
    decimals: 18,
    color: '#ef4444',
    icon: '/images/tokens/jot.png',
    priceUsd: 0.50,         // placeholder — see pricing.ts
    balance: '12,400',
    change24h: 11.20,
  },
  {
    sym: 'LAX',
    name: 'Lithosphere Algorithmic',
    chain: 'Makalu',
    address: '0x1Cde2Ca6c2ab8622003ebe06e382bC07850d4B8d',
    decimals: 18,
    color: '#06b6d4',
    icon: '/images/tokens/lax.png',
    priceUsd: 1.0001,       // HARD-CODED — never fetched. see pricing.ts
    balance: '4,200',
    change24h: 0.01,
  },
  {
    sym: 'COLLE',
    name: 'Colle AI',
    // Truncated as provided — only 32 hex chars instead of 40. Verify on explorer.
    address: '0x10D4BB600c96e9243E2f50baFED8b247',
    chain: 'Makalu',
    decimals: 18,
    color: '#9ca3af',
    icon: '/images/tokens/colle.png',
    priceUsd: 0.020,        // fetched live — pricing.ts overrides this on load
    balance: '18,000',
    change24h: 8.22,
  },
  {
    sym: 'IMAGE',
    name: 'Imagen Network',
    chain: 'Makalu',
    address: '0xAcD98E323968647936887aD4934e64B01060727e',
    decimals: 18,
    color: '#22d3ee',
    icon: '/images/tokens/image.png',
    priceUsd: 0.025,        // placeholder — see pricing.ts
    balance: '6,500',
    change24h: 5.40,
  },
  {
    sym: 'FurGPT',
    name: 'FurGPT',
    chain: 'Makalu',
    address: '0xDB829befCF8E582379E2c034FA2589b8D2EA1c5D',
    decimals: 18,
    color: '#f59e0b',
    icon: '/images/tokens/furgpt.png',
    priceUsd: 0.015,        // fetched live — pricing.ts overrides this on load
    balance: '80,000',
    change24h: 42.30,
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
    icon: '/images/tokens/sol.png',
    priceUsd: 150.00,       // fetched live from CoinGecko via pricing.ts
    balance: '0',
    change24h: 0,
  },
];

/** Quick lookup by ticker. */
export const TOKEN_BY_SYM: Record<string, Token> =
  Object.fromEntries(TOKENS.map(t => [t.sym, t]));

/** Explorer URL for a token (or 'native' for the chain coin). */
export function explorerUrl(t: Token): string {
  return `https://makalu.litho.ai/token/${t.address ?? 'native'}`;
}
