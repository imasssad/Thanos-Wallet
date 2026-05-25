/**
 * Portfolio aggregation.
 *
 * Wraps the indexer's per-chain balance reads + CoinGecko spot prices into
 * a single endpoint clients can hit at refresh time:
 *
 *   GET /portfolio/:address?chains=evm,bitcoin,solana,cosmos
 *
 * Returns:
 *   {
 *     address: "0x…" | bech32 | base58 (echoed back),
 *     totalUsd: number,
 *     positions: [{
 *       chain: 'lithosphere'|'bitcoin'|'solana'|'cosmos',
 *       symbol: 'LITHO', native: true, balance: '12.3', priceUsd: 0.3,
 *       valueUsd: 3.69, tokenAddress?: '0x…' (for LEP-100), decimals: 18
 *     }, …]
 *   }
 *
 * Source of truth:
 *   - Lithosphere LEP-100 balances → services/indexer's HTTP API at
 *     INDEXER_URL (env). Local cache (5s) in this process to absorb
 *     burst polling from multiple clients.
 *   - Bitcoin → mempool.space /address/:addr (no key, public).
 *   - Solana → public mainnet RPC getBalance.
 *   - Cosmos → REST LCD /cosmos/bank/v1beta1/balances/:addr.
 *   - Prices → CoinGecko /simple/price (cached 30s in-process).
 *
 * The endpoint is unauthenticated — addresses are public on-chain. We do
 * rate-limit per IP to avoid weaponising the proxy.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { log } from '../lib/log.js';

export const portfolioRouter = Router();

const INDEXER_URL = (process.env.INDEXER_URL ?? 'http://localhost:8081').replace(/\/$/, '');
const COSMOS_REST = process.env.COSMOS_REST_URL ?? 'https://cosmos-rest.publicnode.com';
const SOLANA_RPC  = process.env.SOLANA_RPC_URL  ?? 'https://api.mainnet-beta.solana.com';
const BTC_API     = process.env.BITCOIN_MEMPOOL_URL ?? 'https://mempool.space/api';
const COINGECKO   = 'https://api.coingecko.com/api/v3';

const CACHE_TTL_MS  = 5_000;
const PRICE_TTL_MS  = 30_000;

interface CachedPortfolio { at: number; data: PortfolioResponse }
const portfolioCache = new Map<string, CachedPortfolio>();
interface CachedPrices    { at: number; data: Record<string, number> }
let priceCache: CachedPrices | null = null;

const ChainsQuery = z.object({
  chains: z.string().optional(),
});

const CHAIN_KEYS = ['lithosphere', 'bitcoin', 'solana', 'cosmos'] as const;
type ChainKey = (typeof CHAIN_KEYS)[number];

interface Position {
  chain:        ChainKey;
  symbol:       string;
  native:       boolean;
  balance:      string;
  priceUsd:     number;
  valueUsd:     number;
  tokenAddress?: string;
  decimals:     number;
}

interface PortfolioResponse {
  address:   string;
  totalUsd:  number;
  positions: Position[];
  /** Per-chain reachability — UI shows "Bitcoin offline" without failing
   *  the whole request when one upstream is down. */
  health:    Record<ChainKey, boolean>;
  fetchedAt: string;
}

async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 5_000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json() as T;
  } finally { clearTimeout(t); }
}

async function getPrices(symbols: string[]): Promise<Record<string, number>> {
  if (priceCache && Date.now() - priceCache.at < PRICE_TTL_MS) return priceCache.data;
  // Map symbols → coingecko ids. Same canonical set the wallet uses on-chain.
  const ids = symbols.map(s => COINGECKO_IDS[s] ?? null).filter((x): x is string => !!x);
  if (ids.length === 0) return {};
  try {
    const url = `${COINGECKO}/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd`;
    const json = await fetchJson<Record<string, { usd?: number }>>(url, undefined, 4_000);
    const out: Record<string, number> = {};
    for (const sym of symbols) {
      const id = COINGECKO_IDS[sym];
      if (id && json[id]?.usd) out[sym] = json[id].usd!;
    }
    priceCache = { at: Date.now(), data: out };
    return out;
  } catch {
    return priceCache?.data ?? {};
  }
}

const COINGECKO_IDS: Record<string, string> = {
  LITHO:  'lithosphere',
  BTC:    'bitcoin',
  SOL:    'solana',
  ATOM:   'cosmos',
  ETH:    'ethereum',
  USDC:   'usd-coin',
};

interface IndexerHoldingsResp {
  items?: Array<{
    contractAddress?: string;
    symbol?: string;
    name?: string;
    decimals?: number;
    balance: string;
    native?: boolean;
  }>;
}

async function fetchLithoPositions(address: string): Promise<Position[]> {
  try {
    const json = await fetchJson<IndexerHoldingsResp>(
      `${INDEXER_URL}/lep100/holdings/${encodeURIComponent(address)}`,
    );
    const items = json.items ?? [];
    const symbols = Array.from(new Set(items.map(i => (i.symbol ?? 'LITHO').toUpperCase())));
    const prices  = await getPrices(symbols);
    return items.map(i => {
      const sym = (i.symbol ?? 'LITHO').toUpperCase();
      const balanceHuman = formatBalance(i.balance, i.decimals ?? 18);
      const price = prices[sym] ?? 0;
      return {
        chain:    'lithosphere',
        symbol:   sym,
        native:   !!i.native,
        balance:  balanceHuman,
        priceUsd: price,
        valueUsd: parseFloat(balanceHuman) * price,
        tokenAddress: i.contractAddress,
        decimals: i.decimals ?? 18,
      };
    });
  } catch { return []; }
}

async function fetchBtcPosition(address: string): Promise<Position | null> {
  try {
    const data = await fetchJson<{
      chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
      mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
    }>(`${BTC_API}/address/${encodeURIComponent(address)}`);
    const sats = (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum)
               + (data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum);
    const btc = sats / 1e8;
    const prices = await getPrices(['BTC']);
    return {
      chain: 'bitcoin', symbol: 'BTC', native: true,
      balance: btc.toFixed(8),
      priceUsd: prices.BTC ?? 0,
      valueUsd: btc * (prices.BTC ?? 0),
      decimals: 8,
    };
  } catch { return null; }
}

async function fetchSolPosition(address: string): Promise<Position | null> {
  try {
    const data = await fetchJson<{ result: { value: number } }>(SOLANA_RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] }),
    });
    const sol = (data.result?.value ?? 0) / 1e9;
    const prices = await getPrices(['SOL']);
    return {
      chain: 'solana', symbol: 'SOL', native: true,
      balance: sol.toFixed(9), priceUsd: prices.SOL ?? 0,
      valueUsd: sol * (prices.SOL ?? 0), decimals: 9,
    };
  } catch { return null; }
}

async function fetchCosmosPosition(address: string): Promise<Position | null> {
  try {
    const data = await fetchJson<{ balances?: Array<{ denom: string; amount: string }> }>(
      `${COSMOS_REST}/cosmos/bank/v1beta1/balances/${encodeURIComponent(address)}`,
      { headers: { accept: 'application/json' } },
    );
    const row = (data.balances ?? []).find(b => b.denom === 'uatom');
    if (!row) return null;
    const atom = Number(row.amount) / 1e6;
    const prices = await getPrices(['ATOM']);
    return {
      chain: 'cosmos', symbol: 'ATOM', native: true,
      balance: atom.toFixed(6), priceUsd: prices.ATOM ?? 0,
      valueUsd: atom * (prices.ATOM ?? 0), decimals: 6,
    };
  } catch { return null; }
}

function formatBalance(raw: string, decimals: number): string {
  if (!raw) return '0';
  const s = raw.padStart(decimals + 1, '0');
  const intPart  = s.slice(0, s.length - decimals);
  const fracPart = s.slice(s.length - decimals).replace(/0+$/, '');
  return `${intPart}${fracPart ? '.' + fracPart : ''}`;
}

portfolioRouter.get('/:address', async (req: Request, res: Response) => {
  const parsed = ChainsQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'bad_request' });
    return;
  }
  const addressRaw = req.params.address;
  const address = typeof addressRaw === 'string' ? addressRaw : '';
  if (!address || address.length > 128) {
    res.status(400).json({ error: 'bad_address' });
    return;
  }
  const askedChains = (parsed.data.chains?.split(',').map(s => s.trim()) ?? CHAIN_KEYS as readonly string[])
    .filter((c): c is ChainKey => (CHAIN_KEYS as readonly string[]).includes(c));
  const cacheKey = `${address}:${askedChains.sort().join(',')}`;

  const hit = portfolioCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    res.json(hit.data);
    return;
  }

  const positions: Position[] = [];
  const health: Record<ChainKey, boolean> = {
    lithosphere: false, bitcoin: false, solana: false, cosmos: false,
  };

  const work: Array<Promise<void>> = [];
  if (askedChains.includes('lithosphere')) {
    work.push(fetchLithoPositions(address).then(rows => {
      if (rows.length > 0) health.lithosphere = true;
      positions.push(...rows);
    }));
  }
  if (askedChains.includes('bitcoin')) {
    work.push(fetchBtcPosition(address).then(r => {
      if (r) { positions.push(r); health.bitcoin = true; }
    }));
  }
  if (askedChains.includes('solana')) {
    work.push(fetchSolPosition(address).then(r => {
      if (r) { positions.push(r); health.solana = true; }
    }));
  }
  if (askedChains.includes('cosmos')) {
    work.push(fetchCosmosPosition(address).then(r => {
      if (r) { positions.push(r); health.cosmos = true; }
    }));
  }
  await Promise.allSettled(work);

  const totalUsd = positions.reduce((s, p) => s + (Number.isFinite(p.valueUsd) ? p.valueUsd : 0), 0);
  const out: PortfolioResponse = {
    address, totalUsd, positions, health, fetchedAt: new Date().toISOString(),
  };
  portfolioCache.set(cacheKey, { at: Date.now(), data: out });
  log.info({ address: address.slice(0, 8) + '…', total: totalUsd.toFixed(2) }, 'portfolio served');
  res.json(out);
});
