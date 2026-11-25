import { describe, it, expect } from 'vitest';
import { BitcoinClient } from '../clients/bitcoin-client';

// The wallet's Bitcoin derivation, pinned against the BIP-84 test vectors
// for the standard mnemonic. Written when bitcoinjs-lib moved 6.1.7 -> 6.1.10
// for GHSA-8vv3-6qpc-gpw6 and nothing in the repo covered Bitcoin at all: a
// library bump that changed key handling or address encoding would have gone
// out unnoticed, and a wrong address means funds sent somewhere unspendable.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('bitcoin account derivation', () => {
  it('derives the BIP-84 vector addresses on mainnet and testnet', () => {
    const c = new BitcoinClient();
    const main = c.deriveAccount(MNEMONIC, 0, 'bitcoin-mainnet');
    expect(main.address).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    const second = c.deriveAccount(MNEMONIC, 1, 'bitcoin-mainnet');
    expect(second.address).not.toBe(main.address);
    const test = c.deriveAccount(MNEMONIC, 0, 'bitcoin-testnet');
    expect(test.address.startsWith('tb1')).toBe(true);
  });
});
