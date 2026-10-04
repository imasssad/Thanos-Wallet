import { describe, it, expect } from 'vitest';
import * as core from '../quantt/agent-config';

// The mobile app carries a detached copy (EAS can't resolve this workspace
// package); run the same suite against it. Loaded at runtime so it stays
// outside this package's tsc rootDir.
const MOBILE_AGENT_CONFIG = '../../../../apps/mobile/lib/quantt-agent-config';
const mobile = (await import(/* @vite-ignore */ MOBILE_AGENT_CONFIG)) as typeof core;

/** GET /v1/agents/{id}/wallet as the live API answered for a Lithosphere
 *  agent on 2026-10-04 (client screenshot). */
const MAKALU_WALLET = {
  address: '0x12e9d1000000000000000000000000000004D479', chainKey: 'lithosphere', chainName: 'Lithosphere Makalu',
  chainId: 700777, chainIsTestnet: true, asset: 'USDC', assetDecimals: 18, onChainSymbol: 'mUSDC', onChainUsdc: 0,
  onChainNative: 0, nativeSymbol: 'LITHO', gasLowWaterNative: 0.0005, magmaLedgerAvailable: true, vaultUsdc: 0,
  withdrawableUsdc: 0,
};
const MAINNET_WALLET = { ...MAKALU_WALLET, chainName: 'Lithosphere Mainnet', chainId: 9005, chainIsTestnet: false };

for (const [impl, { agentFundingOptions, agentWalletNetwork, agentFundingBlock }] of [['sdk-core', core], ['mobile mirror', mobile]] as const) {
describe(`agentFundingOptions (${impl})`, () => {
  it('offers the quote asset on each chain the agent trades, in its order', () => {
    expect(agentFundingOptions({ chains: ['base', 'arbitrum'], quoteAsset: 'USDT' })).toEqual([
      { sym: 'USDT', chain: 'base', chainId: 8453, label: 'Base' },
      { sym: 'USDT', chain: 'arbitrum', chainId: 42161, label: 'Arbitrum' },
    ]);
  });

  it('funds Lithosphere with LAX and LITHO on Mainnet 9005 — it has no USDC', () => {
    const lax = { sym: 'LAX', chain: 'lithosphere', chainId: 9005, label: 'Lithosphere Mainnet' };
    const litho = { sym: 'LITHO', chain: 'lithosphere', chainId: 9005, label: 'Lithosphere Mainnet' };
    expect(agentFundingOptions({ agent: { chains: ['lithosphere'] } })).toEqual([lax, litho]);
    expect(agentFundingOptions({ chains: ['lithosphere'], quoteAsset: 'LAX' })).toEqual([lax, litho]);
    expect(agentFundingOptions({ chains: ['base', 'lithosphere'], quoteAsset: 'USDC' })).toEqual([
      { sym: 'USDC', chain: 'base', chainId: 8453, label: 'Base' }, lax, litho,
    ]);
  });

  it('reads quote_asset and a single chain field, and drops unknown/duplicate chains', () => {
    expect(agentFundingOptions({ chain: 'bnb', quote_asset: 'LAX' })).toEqual([
      { sym: 'LAX', chain: 'bnb', chainId: 56, label: 'BNB Chain' },
    ]);
    expect(agentFundingOptions({ chains: ['base', 'solana', 'base'] }).map((o) => o.chainId)).toEqual([8453]);
  });

  it('returns nothing rather than guessing a network', () => {
    expect(agentFundingOptions({ chains: ['solana'] })).toEqual([]);
    expect(agentFundingOptions({})).toEqual([]);
    expect(agentFundingOptions(null)).toEqual([]);
    expect(agentFundingOptions({ chains: ['base'], quoteAsset: 'DAI' })[0].sym).toBe('USDC');
  });
});

describe(`agentWalletNetwork (${impl})`, () => {
  it('reads the network Quantts reports for the agent wallet', () => {
    expect(agentWalletNetwork(MAKALU_WALLET)).toEqual({ chain: 'lithosphere', chainId: 700777, name: 'Lithosphere Makalu', testnet: true });
    expect(agentWalletNetwork({ wallet: { chain_key: 'Base', chain_id: '0x2105' } })).toEqual({ chain: 'base', chainId: 8453, name: undefined, testnet: false });
    // Address nested under `wallet`, chain fields beside it.
    expect(agentWalletNetwork({ wallet: { address: '0xabc' }, chainKey: 'lithosphere', chainId: 700777, chainIsTestnet: true }))
      .toEqual({ chain: 'lithosphere', chainId: 700777, name: undefined, testnet: true });
  });

  it('is null when no chain id is given', () => {
    expect(agentWalletNetwork({ address: '0xabc' })).toBeNull();
    expect(agentWalletNetwork({ chainId: 'mainnet' })).toBeNull();
    expect(agentWalletNetwork({ chainId: -1 })).toBeNull();
    expect(agentWalletNetwork(null)).toBeNull();
  });
});

describe(`agentFundingBlock (${impl})`, () => {
  const [lax, litho] = agentFundingOptions({ chains: ['lithosphere'] });
  const base = agentFundingOptions({ chains: ['base'] })[0];

  it('holds a Mainnet deposit while Quantts runs the agent on Makalu', () => {
    const why = agentFundingBlock(lax, MAKALU_WALLET);
    expect(why).toBe("Quantts still runs this agent on Lithosphere Makalu (testnet, chain 700777), so a deposit on Lithosphere Mainnet wouldn't be credited. Quantts has to move the agent to Lithosphere Mainnet first.");
    expect(agentFundingBlock(litho, MAKALU_WALLET)).toBe(why);
  });

  it('allows it once Quantts reports Mainnet', () => {
    expect(agentFundingBlock(lax, MAINNET_WALLET)).toBeNull();
    expect(agentFundingBlock(litho, { ...MAKALU_WALLET, chainId: '9005' })).toBeNull();
  });

  it('only applies a reported network to its own chain', () => {
    expect(agentFundingBlock(base, MAKALU_WALLET)).toBeNull();
    expect(agentFundingBlock(base, { chainKey: 'base', chainId: 84532, chainName: 'Base Sepolia', chainIsTestnet: true }))
      .toMatch(/^Quantts still runs this agent on Base Sepolia \(testnet, chain 84532\)/);
    // No chain key: a Lithosphere testnet id still identifies the chain.
    expect(agentFundingBlock(lax, { chainId: 700777 })).toMatch(/another network \(chain 700777\)/);
    expect(agentFundingBlock(base, { chainId: 700777 })).toBeNull();
  });

  it('never blocks without a reported network or an option', () => {
    expect(agentFundingBlock(lax, { address: '0xabc' })).toBeNull();
    expect(agentFundingBlock(lax, null)).toBeNull();
    expect(agentFundingBlock(undefined, MAKALU_WALLET)).toBeNull();
  });
});
}
