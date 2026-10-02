import { describe, it, expect } from 'vitest';
import { agentFundingOptions } from '../quantt/agent-config';

describe('agentFundingOptions', () => {
  it('offers the quote asset on each chain the agent trades, in its order', () => {
    expect(agentFundingOptions({ chains: ['base', 'arbitrum'], quoteAsset: 'USDT' })).toEqual([
      { sym: 'USDT', chain: 'base', chainId: 8453, label: 'Base' },
      { sym: 'USDT', chain: 'arbitrum', chainId: 42161, label: 'Arbitrum' },
    ]);
  });

  it('defaults to USDC and maps lithosphere to Mainnet 9005', () => {
    expect(agentFundingOptions({ agent: { chains: ['lithosphere'] } })).toEqual([
      { sym: 'USDC', chain: 'lithosphere', chainId: 9005, label: 'Lithosphere Mainnet' },
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
