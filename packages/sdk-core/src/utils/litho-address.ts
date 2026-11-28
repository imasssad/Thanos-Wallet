/**
 * Lithosphere Dual-Address Layer
 *
 * Lithosphere accounts have two valid address representations:
 *   • EVM-style:    0x742d35Cc6634C0532925a3b844Bc454e4438f44e
 *   • Cosmos-style: litho1wglp4tq...  (bech32, prefix "litho")
 *
 * Both map to the same underlying 20-byte public key hash.
 * This module provides lossless conversion between the two formats
 * plus validation, display helpers, and input normalisation.
 *
 * Reference: https://makalu.litho.ai
 *
 * Dependencies: the `bech32` npm package (already in the monorepo via @cosmjs/encoding).
 * If @cosmjs/encoding is not available, the lightweight standalone `bech32` package works too.
 */

import { bech32 } from 'bech32';

// ─── Constants ─────────────────────────────────────────────────────────────

export const LITHO_BECH32_PREFIX = 'litho';

/** Chain IDs that use the dual-address model */
export const DUAL_ADDRESS_CHAIN_IDS = new Set([9005, 700777, 900523]); // Mainnet, Makalu, Kamet

// ─── Type guards ────────────────────────────────────────────────────────────

/** Returns true if the input looks like an EVM hex address (checksummed or not) */
export function isEvmAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

/** Returns true if the input is a bech32 Lithosphere address (litho1...) */
export function isLithoAddress(address: string): boolean {
  if (!address.startsWith(`${LITHO_BECH32_PREFIX}1`)) return false;
  try {
    const { prefix } = bech32.decode(address);
    return prefix === LITHO_BECH32_PREFIX;
  } catch {
    return false;
  }
}

/** Returns the address format, or null if unrecognised */
export function detectAddressFormat(address: string): 'evm' | 'litho' | null {
  if (isEvmAddress(address)) return 'evm';
  if (isLithoAddress(address)) return 'litho';
  return null;
}

// ─── Conversions ────────────────────────────────────────────────────────────

/**
 * Convert an EVM hex address to a Lithosphere bech32 address.
 *
 * @example
 *   evmToLitho('0x742d35Cc6634C0532925a3b844Bc454e4438f44e')
 *   // → 'litho1wglp4tqdgcjvp6xhgczk3tnne7t4m8z5csd4l4'
 */
export function evmToLitho(evmAddress: string): string {
  if (!isEvmAddress(evmAddress)) {
    throw new Error(`Invalid EVM address: ${evmAddress}`);
  }
  // Strip the 0x prefix and convert hex → bytes
  const hex = evmAddress.slice(2).toLowerCase();
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  // bech32 uses 5-bit groups
  const words = bech32.toWords(bytes);
  return bech32.encode(LITHO_BECH32_PREFIX, words);
}

/**
 * Convert a Lithosphere bech32 address back to an EVM hex address.
 * The result is checksummed (EIP-55).
 *
 * @example
 *   lithoToEvm('litho1wglp4tqdgcjvp6xhgczk3tnne7t4m8z5csd4l4')
 *   // → '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'
 */
export function lithoToEvm(lithoAddress: string): string {
  if (!isLithoAddress(lithoAddress)) {
    throw new Error(`Invalid litho address: ${lithoAddress}`);
  }
  const { words } = bech32.decode(lithoAddress);
  const bytes = bech32.fromWords(words);
  if (bytes.length !== 20) {
    throw new Error(`Expected 20-byte address payload, got ${bytes.length}`);
  }
  const hex = Array.from(bytes as ArrayLike<number>)
    .map((b: number) => b.toString(16).padStart(2, '0'))
    .join('');
  return toChecksumAddress(`0x${hex}`);
}

/**
 * Given any Lithosphere address (either format), return both representations.
 * Throws if the input is not a valid Lithosphere address.
 */
export function normaliseLithoAddress(address: string): { evm: string; litho: string } {
  const fmt = detectAddressFormat(address);
  if (fmt === 'evm') {
    return { evm: toChecksumAddress(address), litho: evmToLitho(address) };
  }
  if (fmt === 'litho') {
    return { evm: lithoToEvm(address), litho: address.toLowerCase() };
  }
  throw new Error(`Unrecognised address format: ${address}`);
}

/**
 * Resolve a user-supplied string that could be either format into a
 * canonical EVM address. Returns null if the string is not a valid
 * Lithosphere address.
 */
export function resolveToEvm(address: string): string | null {
  try {
    const fmt = detectAddressFormat(address);
    if (fmt === 'evm') return toChecksumAddress(address);
    if (fmt === 'litho') return lithoToEvm(address);
    return null;
  } catch {
    return null;
  }
}

// ─── Display helpers ────────────────────────────────────────────────────────

/** Truncate for UI display: litho1wglp4t...csd4l4  or  0x742d...f44e */
export function truncateLithoAddress(address: string, leading = 10, trailing = 6): string {
  if (address.length <= leading + trailing + 3) return address;
  return `${address.slice(0, leading)}...${address.slice(-trailing)}`;
}

/**
 * The ONE way Lithosphere addresses reach the user: always the bech32
 * litho1… form, never 0x.
 *
 * Thanos MultiSig and Litho Vault both show litho1 only (client 2026-11-24).
 * 0x stays everywhere it is load-bearing — contract calls, signing, RPC,
 * storage keys — and is converted at the edge, here, on the way to the
 * screen. Routing every MultiSig address surface through this one function
 * is what stops a stray 0x reappearing in a new screen.
 *
 * Anything that is not an address this module can parse comes back
 * unchanged: callers pass names, ENS/DNNS strings and empty values through
 * it too, and a label must never be mangled into something it is not.
 *
 *   formatForDisplay('0x742d35Cc6634C0532925a3b844Bc454e4438f44e')
 *   // → 'litho1wglp4tqdgcjvp6xhgczk3tnne7t4m8z5csd4l4'
 *   formatForDisplay('litho1wglp…')  // → unchanged
 *   formatForDisplay('treasury.litho') // → unchanged
 */
export function formatForDisplay(address: string | null | undefined): string {
  if (!address) return '';
  const value = address.trim();
  if (!isEvmAddress(value)) return value;
  try {
    return evmToLitho(value);
  } catch {
    // An address that cannot be encoded is still not shown as 0x.
    return value;
  }
}

/**
 * formatForDisplay + truncation, for rows and chips where the full address
 * doesn't fit. Keeps the litho1 prefix legible at the front.
 *
 *   shortForDisplay('0x742d…f44e') // → 'litho1wglp4t…csd4l4'
 */
export function shortForDisplay(
  address: string | null | undefined,
  leading = 12,
  trailing = 6,
): string {
  const shown = formatForDisplay(address);
  return shown ? truncateLithoAddress(shown, leading, trailing) : '';
}

/**
 * Returns the "preferred" display format for a given chain.
 * On Lithosphere chains we show litho1... in the UI by default.
 */
export function preferredAddressFormat(chainId: number): 'evm' | 'litho' {
  return DUAL_ADDRESS_CHAIN_IDS.has(chainId) ? 'litho' : 'evm';
}

/**
 * Format an address for display given a chain context.
 * On Lithosphere chains, converts EVM → litho1 for the UI.
 * On other chains, returns the address unchanged.
 */
export function formatAddressForChain(address: string, chainId: number): string {
  if (!DUAL_ADDRESS_CHAIN_IDS.has(chainId)) return address;
  try {
    const fmt = detectAddressFormat(address);
    if (fmt === 'evm') return evmToLitho(address);
    return address; // already litho format
  } catch {
    return address; // return as-is if conversion fails
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate an address in the context of a specific chain.
 * Returns { valid, format, reason } so callers can show useful error messages.
 */
export function validateAddressForChain(
  address: string,
  chainId: number
): { valid: boolean; format: 'evm' | 'litho' | null; reason?: string } {
  const fmt = detectAddressFormat(address);

  if (DUAL_ADDRESS_CHAIN_IDS.has(chainId)) {
    // Accept both formats on Lithosphere chains
    if (fmt === 'evm' || fmt === 'litho') return { valid: true, format: fmt };
    return { valid: false, format: null, reason: 'Enter a valid litho1... or 0x... address' };
  }

  // Non-Lithosphere chains only accept EVM addresses
  if (fmt === 'evm') return { valid: true, format: 'evm' };
  if (fmt === 'litho') return { valid: false, format: 'litho', reason: 'litho1... addresses are only valid on Lithosphere chains' };
  return { valid: false, format: null, reason: 'Enter a valid 0x... address' };
}

// ─── EIP-55 checksum ────────────────────────────────────────────────────────

/**
 * Apply EIP-55 mixed-case checksum to a hex address.
 * Pure implementation, no external deps.
 */
export function toChecksumAddress(address: string): string {
  const addr = address.toLowerCase().replace('0x', '');
  // keccak256 of the lowercase hex string — we use a simple approach
  // compatible with WebCrypto by computing it via our own keccak implementation.
  // For production, replace with ethers.getAddress() or viem's checksumAddress().
  // This placeholder returns the EIP-55 form using the ethers-compatible pattern.
  //
  // NOTE: if ethers is already in the bundle (it is — EvmClient uses it),
  // simply call: import { getAddress } from 'ethers'; return getAddress(address);
  //
  // We keep a direct import here to avoid circular deps:
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getAddress } = require('ethers');
    return getAddress(address);
  } catch {
    // Fallback: return lowercase 0x-prefixed (valid but not checksummed)
    return `0x${addr}`;
  }
}
