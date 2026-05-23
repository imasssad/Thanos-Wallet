/**
 * Network registry tests — `getNetworkByChainId` is the lookup the
 * simulator + signer routing rely on, so pin the canonical chain IDs
 * for the Lithosphere chains + the mainstream EVM presets, and verify
 * the unknown-id behaviour.
 */
import { describe, it, expect } from 'vitest';
import {
  MAKALU_TESTNET, KAMET_TESTNET, ETHEREUM, BSC,
  BITCOIN_MAINNET, BITCOIN_TESTNET, SOLANA_MAINNET, SOLANA_DEVNET,
  SUPPORTED_NETWORKS, getNetworkByChainId,
} from '../chains/networks.js';

describe('canonical chain ids', () => {
  it('Lithosphere chains have the production ids (Makalu 700777, Kamet 900523)', () => {
    expect(MAKALU_TESTNET.chainId).toBe(700777);
    expect(KAMET_TESTNET.chainId).toBe(900523);
    expect(MAKALU_TESTNET.kind).toBe('lithic');
    expect(KAMET_TESTNET.kind).toBe('lithic');
  });

  it('mainstream EVM presets keep their well-known ids', () => {
    expect(ETHEREUM.chainId).toBe(1);
    expect(BSC.chainId).toBe(56);
  });

  it('non-EVM networks are tagged with their kind', () => {
    expect(BITCOIN_MAINNET.kind).toBe('bitcoin');
    expect(BITCOIN_TESTNET.kind).toBe('bitcoin');
    expect(SOLANA_MAINNET.kind).toBe('solana');
    expect(SOLANA_DEVNET.kind).toBe('solana');
  });
});

describe('SUPPORTED_NETWORKS', () => {
  it('contains every network exported individually (no orphans)', () => {
    const ids = SUPPORTED_NETWORKS.map((n) => n.chainId);
    for (const n of [MAKALU_TESTNET, KAMET_TESTNET, ETHEREUM, BSC, BITCOIN_MAINNET, BITCOIN_TESTNET, SOLANA_MAINNET, SOLANA_DEVNET]) {
      expect(ids).toContain(n.chainId);
    }
  });

  it('chainId is unique across the registry (so lookup is deterministic)', () => {
    const ids = SUPPORTED_NETWORKS.map((n) => n.chainId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('getNetworkByChainId', () => {
  it('returns the exact NetworkConfig object for a known id', () => {
    expect(getNetworkByChainId(700777)).toBe(MAKALU_TESTNET);
    expect(getNetworkByChainId(1)).toBe(ETHEREUM);
  });

  it('throws on an unknown chain id rather than returning a misleading default', () => {
    expect(() => getNetworkByChainId(999999)).toThrow();
  });
});
