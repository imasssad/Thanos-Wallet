/**
 * Litho dual-address tests.
 *
 * A bug in bech32 encode/decode or the EIP-55 checksum lets users send to
 * the wrong wallet, so this suite is the gate that protects every
 * dual-format flow (Receive, Send recipient resolution, WalletConnect
 * approvals). Cover the round-trip + every public validator.
 */
import { describe, it, expect } from 'vitest';
import {
  isEvmAddress,
  isLithoAddress,
  detectAddressFormat,
  evmToLitho,
  lithoToEvm,
  normaliseLithoAddress,
  resolveToEvm,
  truncateLithoAddress,
  preferredAddressFormat,
  formatAddressForChain,
  validateAddressForChain,
  toChecksumAddress,
  LITHO_BECH32_PREFIX,
} from '../utils/litho-address.js';

// Fixed-bytes test vector: the well-known Vitalik mainnet address.
const EVM  = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const EVM_LC = EVM.toLowerCase();

describe('format detection', () => {
  it('accepts a canonical 0x EVM address', () => {
    expect(isEvmAddress(EVM)).toBe(true);
    expect(isEvmAddress(EVM_LC)).toBe(true);
    expect(detectAddressFormat(EVM)).toBe('evm');
  });

  it('rejects an EVM address with the wrong length or characters', () => {
    expect(isEvmAddress('0x' + 'a'.repeat(39))).toBe(false);
    expect(isEvmAddress('0x' + 'g'.repeat(40))).toBe(false);
    expect(isEvmAddress('')).toBe(false);
    expect(detectAddressFormat('garbage')).toBe(null);
  });

  it('accepts a litho1 bech32 address derived from a valid EVM', () => {
    const litho = evmToLitho(EVM);
    expect(litho.startsWith(LITHO_BECH32_PREFIX + '1')).toBe(true);
    expect(isLithoAddress(litho)).toBe(true);
    expect(detectAddressFormat(litho)).toBe('litho');
  });

  it('rejects a bech32 string with a non-litho prefix', () => {
    expect(isLithoAddress('cosmos1abcdefghijklmnopqrstuvwxyz0123456789')).toBe(false);
  });
});

describe('round-trip evmToLitho ↔ lithoToEvm', () => {
  it('round-trips a known address byte-for-byte', () => {
    const litho = evmToLitho(EVM);
    const back  = lithoToEvm(litho);
    expect(back.toLowerCase()).toBe(EVM_LC);
  });

  it('produces the EIP-55 checksum on round-trip back to EVM', () => {
    const litho = evmToLitho(EVM_LC);   // input lowercase
    const back  = lithoToEvm(litho);
    expect(back).toBe(EVM);             // mixed-case checksum
  });

  it('round-trips deterministically across 100 random keypair-shaped addresses', () => {
    for (let i = 0; i < 100; i++) {
      // 20 random bytes → hex, then evm-shape it; we only need deterministic bytes.
      const hex = Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      const addr = '0x' + hex;
      const litho = evmToLitho(addr);
      const back  = lithoToEvm(litho).toLowerCase();
      expect(back).toBe(addr.toLowerCase());
    }
  });

  it('throws on a malformed input rather than returning garbage', () => {
    expect(() => evmToLitho('not-an-address')).toThrow();
    expect(() => lithoToEvm('litho1notvalidchecksum')).toThrow();
  });
});

describe('normaliseLithoAddress', () => {
  it('returns both formats for an EVM input', () => {
    const { evm, litho } = normaliseLithoAddress(EVM);
    expect(evm).toBe(EVM);
    expect(litho).toBe(evmToLitho(EVM));
  });

  it('returns both formats for a litho1 input', () => {
    const inputLitho = evmToLitho(EVM);
    const { evm, litho } = normaliseLithoAddress(inputLitho);
    expect(evm.toLowerCase()).toBe(EVM_LC);
    expect(litho).toBe(inputLitho);
  });
});

describe('resolveToEvm', () => {
  it('returns the checksummed EVM for either input format', () => {
    expect(resolveToEvm(EVM)).toBe(EVM);
    expect(resolveToEvm(EVM_LC)).toBe(EVM);
    expect(resolveToEvm(evmToLitho(EVM))).toBe(EVM);
  });

  it('returns null for garbage', () => {
    expect(resolveToEvm('hello')).toBe(null);
  });
});

describe('truncateLithoAddress', () => {
  it('keeps the leading + trailing slices intact', () => {
    const litho = evmToLitho(EVM);
    const short = truncateLithoAddress(litho, 8, 6);
    expect(short.startsWith(litho.slice(0, 8))).toBe(true);
    expect(short.endsWith(litho.slice(-6))).toBe(true);
    expect(short).toContain('...');
  });

  it('returns the address untouched when it is already short', () => {
    expect(truncateLithoAddress('litho1abc', 10, 6)).toBe('litho1abc');
  });
});

describe('chain-aware helpers', () => {
  it('prefers litho on Lithosphere chains (Makalu, Kamet) and evm everywhere else', () => {
    expect(preferredAddressFormat(700777)).toBe('litho');
    expect(preferredAddressFormat(900523)).toBe('litho');
    expect(preferredAddressFormat(1)).toBe('evm');
    expect(preferredAddressFormat(56)).toBe('evm');
  });

  it('formatAddressForChain converts EVM → litho1 on Lithosphere; returns input unchanged on other chains', () => {
    expect(formatAddressForChain(EVM, 700777)).toBe(evmToLitho(EVM));
    // On non-Lithosphere chains the function returns the input as-is —
    // it's a display helper, not a converter.
    expect(formatAddressForChain(evmToLitho(EVM), 1)).toBe(evmToLitho(EVM));
    expect(formatAddressForChain(EVM, 1)).toBe(EVM);
  });

  it('validateAddressForChain accepts both formats on Lithosphere; only EVM on other chains', () => {
    expect(validateAddressForChain(EVM, 700777).valid).toBe(true);
    expect(validateAddressForChain(evmToLitho(EVM), 700777).valid).toBe(true);
    expect(validateAddressForChain(EVM, 1).valid).toBe(true);
    const bad1 = validateAddressForChain(evmToLitho(EVM), 1);
    expect(bad1.valid).toBe(false);
    expect(bad1.reason).toMatch(/Lithosphere/);
    expect(validateAddressForChain('garbage', 1).valid).toBe(false);
  });
});

describe('toChecksumAddress', () => {
  it('returns the canonical EIP-55 form regardless of input case', () => {
    expect(toChecksumAddress(EVM_LC)).toBe(EVM);
    expect(toChecksumAddress(EVM.toUpperCase().replace('0X', '0x'))).toBe(EVM);
  });
});
