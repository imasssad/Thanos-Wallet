import { describe, expect, it } from 'vitest';
import * as core from '../portfolio/token-discovery';

// The mobile app carries a detached twin (EAS can't resolve this workspace
// package); run the same suite against it. Loaded at runtime so it stays
// outside this package's tsc rootDir.
const MOBILE_TWIN = '../../../../apps/mobile/lib/token-discovery';
const mobile = (await import(/* @vite-ignore */ MOBILE_TWIN)) as typeof import('../portfolio/token-discovery');

const ME = '0x1111111111111111111111111111111111111111';
const SOL_ME = 'SoLMe111111111111111111111111111111111111';
const ATOM_ME = 'cosmos1me00000000000000000000000000000000000';
const LAX = '0xbd79b7db6f70979df7f4124e161eb3586085d140';
const IMAGE = '0x1c3547dfa9ce7acd9c54ae49244575fa65bc75e2';
const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const E18 = '000000000000000000';

/* ── Lithosphere (chain 9005): LithoScan names candidates, the node settles
      them. The wallet reads the token's own balanceOf/symbol/decimals, so
      these helpers speak ABI. ── */
const TSYN  = '0xef22613e7cec1c3ce4f8af98594045c664dfb312';
const GONE  = '0x2222222222222222222222222222222222222222';
const OLD   = '0x3333333333333333333333333333333333333333';
const ROUTER = '0x4444444444444444444444444444444444444444';
const SEL = { bal: '0x70a08231', sym: '0x95d89b41', dec: '0x313ce567' };

/** A 32-byte ABI word from an address or a number. */
const w = (v: string | number | bigint): string =>
  (typeof v === 'string' ? v.replace(/^0x/, '').toLowerCase() : BigInt(v).toString(16)).padStart(64, '0');
const abiUint = (v: string | number | bigint): string => '0x' + w(typeof v === 'string' ? BigInt(v) : v);
/** An ABI-encoded dynamic `string` return. */
const abiStr = (t: string): string => {
  const hex = [...t].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  return '0x' + w(32) + w(t.length) + hex.padEnd(64, '0');
};
/** A `bytes32` symbol, as pre-ERC-20 tokens return it. */
const b32Str = (t: string): string =>
  '0x' + [...t].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0');
/** fakeFetch key for one eth_call: the node URL plus the start of its body. */
const ethCall = (token: string, sel: string): string => `{"to":"${token}","data":"${sel}`;
const rpcOk = (result: string) => ({ jsonrpc: '2.0', id: 1, result });
/** A transfer() / transferFrom() call as LithoScan's tx list shows it. */
const transferTx = (token: string, from: string, to: string, amt = '1') =>
  ({ evmHash: '0x' + 'a'.repeat(64), evmFromAddr: from, evmToAddr: token, inputData: '0xa9059cbb' + w(to) + w(BigInt(amt)) });
const transferFromTx = (token: string, caller: string, from: string, to: string) =>
  ({ evmHash: '0x' + 'b'.repeat(64), evmFromAddr: caller, evmToAddr: token, inputData: '0x23b872dd' + w(from) + w(to) + w(1n) });

type Route = [match: string, body: unknown];

/** fetch stand-in: the first route whose substring is in the URL (or POST
 *  body) answers; a body of `Error` (or no route) makes that request fail. */
function fakeFetch(routes: Route[], seen: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const key = `${url} ${typeof init?.body === 'string' ? init.body : ''}`;
    seen.push(key);
    const hit = routes.find(([m]) => key.includes(m));
    if (!hit || hit[1] instanceof Error) return { ok: false, status: 403, json: async () => ({}) } as Response;
    return { ok: true, status: 200, json: async () => hit[1] } as Response;
  }) as typeof fetch;
}

const rsItem = (chainId: number, tokenAddress: string, tokenSymbol: string, tokenQuantity: string, extra: Record<string, unknown> = {}) =>
  ({ chainId: String(chainId), tokenAddress, tokenSymbol, tokenName: tokenSymbol, tokenDecimals: 18, tokenQuantity, ...extra });
const bsItem = (address: string, symbol: string, value: string, extra: Record<string, unknown> = {}) =>
  ({ token: { address_hash: address, symbol, name: symbol, decimals: '18', type: 'ERC-20', exchange_rate: null, reputation: 'ok', ...extra }, value });

describe.each([['sdk-core', core], ['mobile twin', mobile]])('%s discoverTokenHoldings', (_name, m) => {
  it('lists what an EVM address holds, classes it, and drops spam', async () => {
    const seen: string[] = [];
    const { tokens, read, failed } = await m.discoverTokenHoldings({ evm: ME }, {
      chainIds: [1, 43114],
      fetchImpl: fakeFetch([
        ['erc20-holdings?limit=100&next=P2', { items: [rsItem(43114, '0xa1', 'JOE', '5' + E18)], link: {} }],
        ['/erc20-holdings?limit=100', { items: [
          rsItem(1, LAX.toUpperCase().replace('0X', '0x'), 'LAX', '10000' + E18),     // listed (checksum case)
          rsItem(1, '0xfeed', 'PEPE', '3' + E18),                                       // priced on Blockscout
          rsItem(1, '0xcafe', 'NEWT', '7' + E18),                                       // held, unknown: less known
          rsItem(1, '0xdead', 'NEWT2', '0'),                                            // nothing held
          rsItem(1088, '0xmetis', 'METIS', '1' + E18),                                  // a network the wallet lacks
        ], link: { next: `/v2/network/mainnet/evm/all/address/${ME}/erc20-holdings?limit=100&next=P2` } }],
        ['eth.blockscout.com', [
          bsItem(IMAGE, 'IMAGE', '100000' + E18, { exchange_rate: '7.39487E-7', icon_url: 'https://x/image.png' }),
          bsItem('0xfeed', 'PEPE', '3' + E18, { exchange_rate: '0.00001' }),
          bsItem('0xbad1', 'USDC', '9' + E18, { exchange_rate: '1' }),                  // fake USDC
          bsItem('0xbad2', 'GIFT', '9' + E18, { exchange_rate: '1', reputation: 'scam' }), // flagged
          bsItem('0xbad3', 'visit-x.com', '9' + E18),                                  // URL lure symbol
          bsItem('0xbad4', 'OK', '9' + E18, { name: 'Claim at www.x.io' }),             // lure name
          bsItem('0xbad5', 'IMAGE', '9' + E18),                                        // a listed symbol, other contract
          bsItem('0xbad6', 'ETH', '9' + E18),                                          // the network's coin
          { token: { address_hash: '0xnft', symbol: 'APE', decimals: null, type: 'ERC-721' }, value: '1' },
        ]],
      ], seen),
    });
    expect(failed).toEqual([]);
    expect(read).toEqual(['ethereum', 'avalanche']);
    expect(tokens.map((t) => `${t.chainId}:${t.symbol}:${t.balance}:${t.known ? 'listed' : t.wellKnown ? 'well' : 'less'}`)).toEqual([
      '1:IMAGE:100000:listed', '1:LAX:10000:listed',
      '1:PEPE:3:well',
      '1:NEWT:7:less', '43114:JOE:5:less',
    ]);
    const image = tokens.find((t) => t.symbol === 'IMAGE')!;
    expect(image).toMatchObject({ key: `1:${IMAGE}`, address: IMAGE, network: 'ethereum', networkName: 'Ethereum', source: 'blockscout', priced: true, priceUsd: 7.39487e-7, reputation: 'ok', logo: 'https://x/image.png' });
    expect(tokens.find((t) => t.symbol === 'LAX')).toMatchObject({ address: LAX, source: 'routescan', priced: false, decimals: 18, rawBalance: '10000' + E18 });
    expect(seen.filter((u) => u.includes('routescan')).length).toBe(2);           // followed link.next
    expect(seen.some((u) => u.includes('base.blockscout'))).toBe(false);          // only the networks asked for
  });

  it('accepts tokens the user added, and their symbol marks look-alikes', async () => {
    const { tokens } = await m.discoverTokenHoldings({ evm: ME }, {
      chainIds: [8453],
      knownTokens: [{ chainId: 8453, address: '0xAbCd', symbol: 'MINE' }],
      fetchImpl: fakeFetch([['base.blockscout.com', [
        bsItem('0xabcd', 'MINE', '3' + E18),
        bsItem('0xf00d', 'MINE', '3' + E18),
      ]]]),
    });
    expect(tokens.map((t) => [t.address, t.known, t.wellKnown])).toEqual([['0xabcd', true, true]]);
  });

  it('skips a network it cannot read (Cloudflare) and still returns the others', async () => {
    const { tokens, read, failed } = await m.discoverTokenHoldings({ evm: ME }, {
      chainIds: [1, 8453, 42161, 43114],
      fetchImpl: fakeFetch([
        ['routescan', new Error('down')],
        ['eth.blockscout.com', [bsItem('0xfeed', 'PEPE', '3' + E18, { exchange_rate: '0.00001' })]],
        ['arbitrum.blockscout.com', [bsItem('0xa4b1', 'ARB', '2' + E18, { exchange_rate: '0.3' })]],
        ['base.blockscout.com', new Error('challenge')],
      ]),
    });
    expect(read).toEqual(['ethereum', 'arbitrum']);
    expect(failed).toEqual(['avalanche', 'base']);
    expect(tokens.map((t) => t.symbol).sort()).toEqual(['ARB', 'PEPE']);
  });

  it('reads Solana token accounts, falling back to the second RPC', async () => {
    const seen: string[] = [];
    const acct = (mint: string, amount: string, decimals: number) =>
      ({ account: { data: { parsed: { info: { mint, owner: SOL_ME, tokenAmount: { amount, decimals } } } } } });
    const { tokens, read } = await m.discoverTokenHoldings({ solana: SOL_ME }, {
      fetchImpl: fakeFetch([
        ['publicnode.com', { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Request blocked' } }],
        ['Tokenkeg', { jsonrpc: '2.0', id: 1, result: { value: [
          acct(USDC_SOL, '12500000', 6), acct(USDC_SOL, '500000', 6),   // two accounts, one mint
          acct('47vYX5zWwPg67cEtLZr6BG7qdXLx4EQuyMxJ7XbnhL49', '2000000000', 9),
          acct('NFTmint1111111111111111111111111111111111111', '1', 0), // an NFT
          acct('Empty11111111111111111111111111111111111111', '0', 6),
        ] } }],
        ['Tokenz', new Error('down')],                                   // Token-2022: best effort
      ], seen),
    });
    expect(read).toEqual(['solana']);
    expect(tokens.map((t) => `${t.symbol}:${t.name}:${t.balance}:${t.wellKnown}`)).toEqual([
      'USDC:USD Coin:13:true',
      '47vY…hL49:Unknown token:2:false',
    ]);
    expect(tokens[0]).toMatchObject({ chain: 'solana', key: `solana:${USDC_SOL}`, address: USDC_SOL, priced: false, known: true });
    expect(seen.some((u) => u.includes('api.mainnet-beta.solana.com'))).toBe(true);
  });

  it('reads Cosmos Hub balances, naming IBC denoms from their trace', async () => {
    const OSMO = 'ibc/14F9BC3E44B8A9C1BE1FB08980FAB87034C9905EF17CF2F5008FC085218811CC';
    const OLD = 'ibc/' + 'A'.repeat(64);
    const LOST = 'ibc/' + 'B'.repeat(64);
    const { tokens } = await m.discoverTokenHoldings({ cosmos: ATOM_ME }, {
      fetchImpl: fakeFetch([
        ['/bank/v1beta1/balances/', { balances: [
          { denom: 'uatom', amount: '5000000' },                        // the native coin: Home has it
          { denom: OSMO, amount: '1500000' },
          { denom: OLD, amount: '2' + E18 },
          { denom: LOST, amount: '42' },
          { denom: 'uphoton', amount: '3000000' },
          { denom: 'factory/cosmos1x/claim-at-x.com', amount: '1' },    // lure
        ] }],
        ['/denoms/14F9BC3E', { denom: { base: 'uosmo', trace: [{ port_id: 'transfer', channel_id: 'channel-141' }] } }],
        ['/denom_traces/' + 'A'.repeat(64), { denom_trace: { path: 'transfer/channel-1', base_denom: 'aevmos' } }],
      ]),
    });
    expect(tokens.map((t) => `${t.symbol}:${t.balance}:${t.name}`).sort()).toEqual([
      'EVMOS:2:EVMOS (IBC)',
      'OSMO:1.5:OSMO (IBC)',
      'PHOTON:3:PHOTON',
      'ibc/…BBBB:42:IBC token',
    ]);
    expect(tokens.every((t) => t.chain === 'cosmos' && !t.wellKnown && t.networkName === 'Cosmos Hub')).toBe(true);
  });

  it('lays a fresh read over the last one, keeping networks that failed', () => {
    const tok = (network: string, address: string, extra: Partial<core.DiscoveredToken> = {}): core.DiscoveredToken => ({
      key: `${network}:${address}`, chain: 'evm', chainId: 1, network, networkName: network, address,
      symbol: address.toUpperCase(), name: address, decimals: 0, balance: '1', rawBalance: '1',
      source: 'blockscout', priced: false, known: false, wellKnown: false, ...extra,
    });
    const prev = [
      tok('ethereum', 'pepe', { priced: true, priceUsd: 2, wellKnown: true }),
      tok('ethereum', 'gone'),
      tok('base', 'kept'),
    ];
    const merged = m.mergeDiscoveredTokens(prev, {
      read: ['ethereum'], failed: ['base'],
      tokens: [tok('ethereum', 'pepe', { source: 'routescan', balance: '5' }), tok('ethereum', 'new')],
    });
    expect(merged.map((t) => `${t.address}:${t.balance}:${t.wellKnown}`)).toEqual(['pepe:5:true', 'new:1:false', 'kept:1:false']);
    expect(merged[0]).toMatchObject({ priced: true, priceUsd: 2, source: 'routescan' });
  });

  it('caps the list, keeping listed and priced tokens first', async () => {
    const many = Array.from({ length: 30 }, (_, i) => bsItem(`0x${(1000 + i).toString(16)}`, `T${i}`, '1' + E18));
    const { tokens } = await m.discoverTokenHoldings({ evm: ME }, {
      chainIds: [137], maxTokens: 5,
      fetchImpl: fakeFetch([['polygon.blockscout.com', [...many, bsItem('0xbeef', 'WETH', '1' + E18, { exchange_rate: '2400' })]]]),
    });
    expect(tokens.length).toBe(5);
    expect(tokens[0]).toMatchObject({ symbol: 'WETH', wellKnown: true, priceUsd: 2400 });
    expect(m.discoveryEvmChainIds()).toEqual(expect.arrayContaining([9005, 1, 10, 43114, 8453, 42161, 137]));
    expect(m.discoveryEvmChainIds()).not.toContain(56);
  });

  /* ── Lithosphere ──────────────────────────────────────────────────── */

  it('takes Lithosphere candidates from LithoScan and the balance from the chain', async () => {
    const seen: string[] = [];
    const { tokens, read, failed } = await m.discoverTokenHoldings({ evm: ME }, {
      chainIds: [9005],
      fetchImpl: fakeFetch([
        ['/token-transfers?limit=100', { items: [
          { token: { address: TSYN.toUpperCase().replace('0X', '0x'), symbol: 'TSYN' } },  // checksum case
          { contractAddress: GONE, tokenSymbol: 'GONE' },                                  // sent away since
          { token: { address: 'not-an-address' } },
        ] }],
        [ethCall(TSYN, SEL.bal), rpcOk(abiUint('25' + E18))],
        [ethCall(TSYN, SEL.sym), rpcOk(abiStr('TSYN'))],
        [ethCall(TSYN, SEL.dec), rpcOk(abiUint(18))],
        [ethCall(GONE, SEL.bal), rpcOk(abiUint(0))],
        [ethCall(GONE, SEL.sym), rpcOk(abiStr('GONE'))],
        [ethCall(GONE, SEL.dec), rpcOk(abiUint(18))],
      ], seen),
    });
    expect(failed).toEqual([]);
    expect(read).toEqual(['lithosphere']);
    expect(tokens.map((t) => `${t.chainId}:${t.symbol}:${t.balance}`)).toEqual(['9005:TSYN:25']);
    expect(tokens[0]).toMatchObject({
      key: `9005:${TSYN}`, address: TSYN, network: 'lithosphere', networkName: 'Lithosphere',
      // Shown like a listed token: the home chain has no price source, so
      // `priced` can't carry it (see classify).
      source: 'lithoscan', decimals: 18, rawBalance: '25' + E18, priced: false, known: false, wellKnown: true,
    });
    // The amount came from the chain, not from the transfer list.
    expect(seen.some((u) => u.includes(ethCall(TSYN, SEL.bal)))).toBe(true);
    // Only Lithosphere was asked for.
    expect(seen.some((u) => u.includes('blockscout') || u.includes('routescan'))).toBe(false);
  });

  it('falls back to the transactions when LithoScan serves no token list', async () => {
    const seen: string[] = [];
    const { tokens, read } = await m.discoverTokenHoldings({ evm: ME }, {
      chainIds: [9005],
      fetchImpl: fakeFetch([
        ['/token-transfers?limit=100', new Error('404')],
        ['/txs?limit=100', { items: [
          transferTx(TSYN, ME, '0x9999999999999999999999999999999999999999'),  // sent by me
          transferTx(OLD, '0x8888888888888888888888888888888888888888', ME),    // sent to me
          transferFromTx(ROUTER, ME, ME, '0x7777777777777777777777777777777777777777'),
          { evmHash: '0xc', evmFromAddr: ME, evmToAddr: GONE, inputData: '0xdeadbeef' + w(1n) }, // another call
          { evmHash: '0xd', evmFromAddr: ME, evmToAddr: OLD, inputData: '0x', value: '1' },      // native send
        ], hasMore: false }],
        [ethCall(TSYN, SEL.bal), rpcOk(abiUint('4' + E18))],
        [ethCall(TSYN, SEL.sym), rpcOk(abiStr('TSYN'))],
        [ethCall(TSYN, SEL.dec), rpcOk(abiUint(18))],
        [ethCall(OLD, SEL.bal), rpcOk(abiUint('7000000'))],
        [ethCall(OLD, SEL.sym), rpcOk(b32Str('LRC'))],          // bytes32 symbol
        [ethCall(OLD, SEL.dec), rpcOk(abiUint(6))],
        // ROUTER is a transferFrom target too, but not an ERC-20: it reverts.
        [ethCall(ROUTER, SEL.bal), { jsonrpc: '2.0', id: 1, error: { message: 'execution reverted' } }],
      ], seen),
    });
    expect(read).toEqual(['lithosphere']);
    expect(tokens.map((t) => `${t.symbol}:${t.balance}:${t.decimals}`).sort()).toEqual(['LRC:7:6', 'TSYN:4:18']);
    // A call that isn't a transfer never becomes a candidate.
    expect(seen.some((u) => u.includes(ethCall(GONE, SEL.bal)))).toBe(false);
  });

  it('marks Lithosphere failed when LithoScan cannot be read at all', async () => {
    const { tokens, read, failed } = await m.discoverTokenHoldings({ evm: ME }, {
      chainIds: [9005],
      fetchImpl: fakeFetch([['lithoscan.ai', new Error('down')]]),
    });
    expect(read).toEqual([]);
    expect(failed).toEqual(['lithosphere']);
    expect(tokens).toEqual([]);
  });

  it('marks Lithosphere failed when the node answers nothing, not empty', async () => {
    const { read, failed } = await m.discoverTokenHoldings({ evm: ME }, {
      chainIds: [9005],
      fetchImpl: fakeFetch([
        ['/token-transfers?limit=100', { items: [{ token: { address: TSYN } }] }],
        ['rpc-mainnet.litho.ai', new Error('node down')],
      ]),
    });
    expect(read).toEqual([]);
    expect(failed).toEqual(['lithosphere']);
  });

  it('drops a fake LITHO, a lure symbol and a non-token on Lithosphere', async () => {
    const FAKE = '0x5555555555555555555555555555555555555555';
    const LURE = '0x6666666666666666666666666666666666666666';
    const { tokens } = await m.discoverTokenHoldings({ evm: ME }, {
      chainIds: [9005],
      fetchImpl: fakeFetch([
        ['/token-transfers?limit=100', { items: [
          { token: { address: FAKE } }, { token: { address: LURE } }, { token: { address: ROUTER } },
        ] }],
        [ethCall(FAKE, SEL.bal), rpcOk(abiUint('1' + E18))],
        [ethCall(FAKE, SEL.sym), rpcOk(abiStr('LITHO'))],           // impersonates the gas coin
        [ethCall(FAKE, SEL.dec), rpcOk(abiUint(18))],
        [ethCall(LURE, SEL.bal), rpcOk(abiUint('1' + E18))],
        [ethCall(LURE, SEL.sym), rpcOk(abiStr('claim-x.io'))],
        [ethCall(LURE, SEL.dec), rpcOk(abiUint(18))],
        [ethCall(ROUTER, SEL.bal), rpcOk(abiUint('1' + E18))],
        [ethCall(ROUTER, SEL.sym), rpcOk('0x')],                     // no symbol: not an ERC-20
        [ethCall(ROUTER, SEL.dec), rpcOk(abiUint(18))],
      ]),
    });
    expect(tokens).toEqual([]);
  });

  it('accepts a Lithosphere token the user added as listed', async () => {
    const { tokens } = await m.discoverTokenHoldings({ evm: ME }, {
      chainIds: [9005],
      knownTokens: [{ chainId: 9005, address: TSYN.toUpperCase().replace('0X', '0x'), symbol: 'TSYN' }],
      fetchImpl: fakeFetch([
        ['/token-transfers?limit=100', { items: [{ token: { address: TSYN } }] }],
        [ethCall(TSYN, SEL.bal), rpcOk(abiUint('2' + E18))],
        [ethCall(TSYN, SEL.sym), rpcOk(abiStr('TSYN'))],
        [ethCall(TSYN, SEL.dec), rpcOk(abiUint(18))],
      ]),
    });
    expect(tokens.map((t) => [t.symbol, t.known, t.wellKnown])).toEqual([['TSYN', true, true]]);
  });
});
