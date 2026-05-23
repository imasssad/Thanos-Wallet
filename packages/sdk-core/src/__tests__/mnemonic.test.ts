/**
 * Mnemonic + key-derivation tests. Bugs here would silently produce a
 * different EVM/Solana account than the seed actually controls, so this
 * pins the BIP-39 + BIP-44 paths.
 */
import { describe, it, expect } from 'vitest';
import { createMnemonic, walletFromMnemonic, deriveSolanaKeypair } from '../utils/mnemonic.js';

// Canonical BIP-39 test vector — used by every wallet test suite on earth.
const ABANDON =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('createMnemonic', () => {
  it('produces 12 words from the BIP-39 wordlist', () => {
    const m = createMnemonic();
    const words = m.split(' ');
    expect(words.length).toBe(12);
    // No empty / whitespace-only words.
    expect(words.every((w) => /^[a-z]+$/.test(w))).toBe(true);
  });

  it('two calls produce different phrases (random entropy)', () => {
    expect(createMnemonic()).not.toBe(createMnemonic());
  });
});

describe('walletFromMnemonic', () => {
  it('derives the canonical first EVM account at m/44\'/60\'/0\'/0/0', () => {
    const w = walletFromMnemonic(ABANDON, 0);
    // Standard test-vector address for the "abandon" phrase at index 0.
    expect(w.address).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
  });

  it('derives a distinct account at index 1', () => {
    const a0 = walletFromMnemonic(ABANDON, 0).address;
    const a1 = walletFromMnemonic(ABANDON, 1).address;
    expect(a0).not.toBe(a1);
  });

  it('rejects an invalid phrase', () => {
    expect(() => walletFromMnemonic('not a real bip39 phrase')).toThrow();
  });
});

describe('deriveSolanaKeypair', () => {
  it('produces a base58 public key and a 64-byte secret', () => {
    const kp = deriveSolanaKeypair(ABANDON, 0);
    expect(kp.publicKey).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(kp.secretKey.length).toBe(64);
    expect(kp.derivationPath).toBe("m/44'/501'/0'/0'");
  });

  it('is deterministic — same phrase + index ⇒ same key', () => {
    const a = deriveSolanaKeypair(ABANDON, 0);
    const b = deriveSolanaKeypair(ABANDON, 0);
    expect(a.publicKey).toBe(b.publicKey);
  });

  it('index 1 produces a different key from index 0', () => {
    const a = deriveSolanaKeypair(ABANDON, 0);
    const b = deriveSolanaKeypair(ABANDON, 1);
    expect(a.publicKey).not.toBe(b.publicKey);
  });
});
