/**
 * Native Lithic contracts on Makalu — read-only balance display.
 *
 * Native Lithic contracts are not EVM contracts: `eth_getCode` at the native
 * target returns `0x`, and ERC-20 `balanceOf` sent there returns nothing. A
 * read is an `eth_call` to the native gateway (0x…f000), whose
 * `call(address target, bytes32 selector, bytes arguments)` takes the FULL
 * 32-byte keccak256 of the native signature (`balance_of(address)`, not
 * `balanceOf(address)`) and LVAL v1 arguments, and returns LVAL inside one ABI
 * `bytes` wrapper.
 *
 * Ported from the read path of the Litho native Lithic handoff
 * (native-lithic.cjs, 2026-10-26) and checked against its golden vectors
 * (__tests__/native-lithic.test.ts). Read-only on purpose: there is no
 * transfer, signing or broadcast here. Native LAX transfers stay disabled
 * until Litho authorises the execution workflow.
 *
 * Self-contained (ethers only) — apps/mobile/lib/native-lithic.ts is a copy,
 * kept identical by scripts/sync-native-lithic.mjs.
 */
import {
  AbiCoder,
  Interface,
  concat,
  formatUnits,
  getAddress,
  getBytes,
  hexlify,
  id,
  toBeHex,
  toUtf8Bytes,
  toUtf8String,
  zeroPadValue,
} from 'ethers';

export const MAKALU_CHAIN_ID = 700777;
export const NATIVE_LITHIC_GATEWAY = '0x000000000000000000000000000000000000f000';

/** Native LAX on Makalu. Keyed by chain + execution profile + native target,
 *  never by symbol: the historical EVM LAX (0x1Cde2Ca6…4B8d) is a different
 *  asset and keeps its own ERC-20 reader. */
export const NATIVE_LAX = {
  chainId: MAKALU_CHAIN_ID,
  executionProfile: 'lithovm-native-v12-makalu',
  nativeTarget: '0x5803af8a82a8ecfb6d6a3b3d64814807b59d09ed',
  gateway: NATIVE_LITHIC_GATEWAY,
  name: 'Lithosphere Algorithmic',
  symbol: 'LAX',
  decimals: 18,
  balanceTransport: 'gateway-eth-call-lval-v1',
  transferEnabled: false,
} as const;

/* ── LVAL v1 ─────────────────────────────────────────────────────────── */

export type LvalType = 'u64' | 'u256' | 'bool' | 'address' | 'bytes32' | 'string';
export type LvalValue =
  | { type: 'u64' | 'u256'; value: bigint }
  | { type: 'bool'; value: boolean }
  | { type: 'address' | 'bytes32' | 'string'; value: string };
/** Encoder input: integers as bigint or a canonical decimal string — never a
 *  JS number, which silently loses precision above 2^53. */
export type LvalInput =
  | { type: 'u64' | 'u256'; value: bigint | string }
  | { type: 'bool'; value: boolean }
  | { type: 'address' | 'bytes32' | 'string'; value: string };

const MAGIC = Uint8Array.from([0x4c, 0x56, 0x41, 0x4c, 0x01]); // "LVAL" v1
const TAGS: Record<LvalType, number> = { u64: 1, u256: 2, bool: 3, address: 4, bytes32: 5, string: 6 };
const TYPE_OF_TAG = new Map(Object.entries(TAGS).map(([t, n]) => [n, t as LvalType]));
const MAX_VALUES = 64;
const MAX_ENVELOPE = 65_536;
const MAX_STRING = 4_096;
const U64_LIMIT = 1n << 64n;
const WORD_LIMIT = 1n << 256n;

function need(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function integer(value: unknown): bigint {
  need(
    typeof value === 'bigint' || (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)),
    'Use a bigint or a canonical decimal string',
  );
  return BigInt(value);
}

function word(n: bigint): Uint8Array {
  need(n >= 0n && n < WORD_LIMIT, 'Word out of range');
  return getBytes(toBeHex(n, 32));
}

function u16(n: number): Uint8Array {
  need(Number.isSafeInteger(n) && n >= 0 && n <= 0xffff, 'Invalid u16');
  return Uint8Array.from([n >> 8, n & 0xff]);
}

function scalar(v: LvalInput): Uint8Array {
  switch (v.type) {
    case 'address': return getBytes(zeroPadValue(getAddress(v.value), 32));
    case 'bytes32': {
      const b = getBytes(v.value);
      need(b.length === 32, 'bytes32 length differs');
      return b;
    }
    case 'bool':
      need(typeof v.value === 'boolean', 'Boolean required');
      return word(v.value ? 1n : 0n);
    case 'u64': {
      const n = integer(v.value);
      need(n < U64_LIMIT, 'u64 overflow');
      return word(n);
    }
    case 'u256': return word(integer(v.value));
    default: throw new Error('Unsupported LVAL type');
  }
}

export function encodeLval(values: readonly LvalInput[]): string {
  need(Array.isArray(values) && values.length <= MAX_VALUES, `At most ${MAX_VALUES} values`);
  const parts: Uint8Array[] = [MAGIC, u16(values.length)];
  for (const v of values) {
    // Own keys only — `type: 'toString'` must not reach the prototype.
    const tag = v && Object.prototype.hasOwnProperty.call(TAGS, v.type) ? TAGS[v.type as LvalType] : undefined;
    need(tag !== undefined, 'Unsupported LVAL type');
    parts.push(Uint8Array.of(tag));
    if (v.type === 'string') {
      need(typeof v.value === 'string', 'String required');
      const b = toUtf8Bytes(v.value);
      need(b.length <= MAX_STRING, `String exceeds ${MAX_STRING} UTF-8 bytes`);
      parts.push(u16(b.length), b);
    } else {
      parts.push(scalar(v));
    }
  }
  const out = concat(parts);
  need(getBytes(out).length <= MAX_ENVELOPE, `LVAL envelope exceeds ${MAX_ENVELOPE} bytes`);
  return out;
}

/** Strict decoder: wrong magic/version, unknown tags, noncanonical padding,
 *  invalid UTF-8, truncation and trailing bytes all throw. */
export function decodeLval(encoded: string | Uint8Array): LvalValue[] {
  const b = getBytes(encoded);
  need(b.length >= 7 && b.length <= MAX_ENVELOPE, 'Invalid LVAL size');
  need(MAGIC.every((m, i) => b[i] === m), 'Wrong LVAL magic/version');
  const count = (b[5] << 8) | b[6];
  need(count <= MAX_VALUES, 'Too many LVAL values');
  let pos = 7;
  const take = (n: number): Uint8Array => {
    need(pos + n <= b.length, 'Truncated LVAL');
    const v = b.subarray(pos, pos + n);
    pos += n;
    return v;
  };
  const out: LvalValue[] = [];
  for (let i = 0; i < count; i++) {
    const type = TYPE_OF_TAG.get(take(1)[0]);
    need(type, 'Unknown LVAL type');
    if (type === 'string') {
      const len = take(2);
      const n = (len[0] << 8) | len[1];
      need(n <= MAX_STRING, 'String length exceeds bound');
      // ethers' strict decoder throws on invalid UTF-8 (Hermes has no fatal TextDecoder).
      out.push({ type, value: toUtf8String(take(n)) });
      continue;
    }
    const w = take(32);
    const n = BigInt(hexlify(w));
    if (type === 'u64') {
      need(n < U64_LIMIT, 'Noncanonical u64');
      out.push({ type, value: n });
    } else if (type === 'u256') {
      out.push({ type, value: n });
    } else if (type === 'bool') {
      need(n <= 1n, 'Noncanonical bool');
      out.push({ type, value: n === 1n });
    } else if (type === 'address') {
      need(n < 1n << 160n, 'Noncanonical address padding');
      out.push({ type, value: getAddress(hexlify(w.subarray(12))) });
    } else {
      out.push({ type, value: hexlify(w) });
    }
  }
  need(pos === b.length, 'Trailing LVAL bytes');
  return out;
}

/* ── Gateway calls ───────────────────────────────────────────────────── */

export const NATIVE_GATEWAY_ABI = new Interface([
  'function call(address target, bytes32 selector, bytes arguments) returns (bytes)',
]);

/** Gateway calldata for a native call. `signature` is the exact native
 *  signature (native type names: `u256`, not `uint256`); the argument types
 *  must match it one for one. */
export function encodeNativeCall(target: string, signature: string, args: readonly LvalInput[] = []): string {
  need(/^[A-Za-z_][A-Za-z0-9_]*\([A-Za-z0-9_,]*\)$/.test(signature), 'Exact native signature required');
  const inner = signature.slice(signature.indexOf('(') + 1, -1);
  const types = inner ? inner.split(',') : [];
  need(
    types.length === args.length && types.every((t, i) => t === args[i].type),
    'Argument types/count differ from the native signature',
  );
  return NATIVE_GATEWAY_ABI.encodeFunctionData('call', [getAddress(target), id(signature), encodeLval(args)]);
}

/** Unwrap the gateway's ABI `bytes` return (rejecting a noncanonical
 *  encoding), then decode the LVAL inside it. */
export function decodeGatewayResult(raw: string): LvalValue[] {
  const coder = AbiCoder.defaultAbiCoder();
  const [inner] = coder.decode(['bytes'], raw);
  need(coder.encode(['bytes'], [inner]).toLowerCase() === raw.toLowerCase(), 'Noncanonical gateway return ABI');
  return decodeLval(inner as string);
}

/* ── Read-only RPC ───────────────────────────────────────────────────── */

export type NativeFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface NativeReadOptions {
  /** The Makalu RPC the user added (checked to be chain 700777). */
  rpcUrl: string;
  fetchImpl?: NativeFetch;
  timeoutMs?: number;
}

const READ_METHODS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_call']);
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;

function rpcClient({ rpcUrl, fetchImpl, timeoutMs = 15_000 }: NativeReadOptions) {
  const url = new URL(rpcUrl);
  need((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password, 'Invalid RPC URL');
  const send = fetchImpl ?? (globalThis.fetch as unknown as NativeFetch);
  let nextId = 0;
  return async function rpc(method: string, params: unknown[] = []): Promise<string> {
    need(READ_METHODS.has(method), 'Read-only methods only');
    const requestId = ++nextId;
    // AbortController rather than AbortSignal.timeout — Hermes (mobile) lacks it.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const r = await send(url.href, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
        signal: abort.signal,
      });
      need(r.ok, `RPC HTTP ${r.status}`);
      const j = (await r.json()) as { jsonrpc?: string; id?: number; result?: unknown; error?: unknown };
      need(j && j.jsonrpc === '2.0' && j.id === requestId, 'RPC response id/version differs');
      need(!j.error && typeof j.result === 'string', `RPC rejected ${method}: ${JSON.stringify(j.error ?? null)}`);
      return j.result as string;
    } finally {
      clearTimeout(timer);
    }
  };
}

export interface NativeLaxBalance {
  chainId: typeof MAKALU_CHAIN_ID;
  nativeTarget: string;
  owner: string;
  /** The one block every field was read at (decimal). */
  blockHeight: string;
  name: string;
  symbol: string;
  decimals: number;
  /** Exact balance in base units (decimal string — JSON-safe). */
  balanceBaseUnits: string;
  /** Exact balance in LAX, e.g. "10000000000.0". */
  balanceFormatted: string;
  /** An RPC answer, not a consensus proof. */
  canonicalProofVerified: false;
}

/** Read native LAX metadata and `owner`'s balance at one block. Throws on any
 *  RPC failure, wrong chain or metadata mismatch — a failed read must never
 *  be shown as a zero balance. */
export async function readNativeLaxBalance(owner: string, options: NativeReadOptions): Promise<NativeLaxBalance> {
  const holder = getAddress(owner);
  need(BigInt(holder) !== 0n, 'Nonzero owner required');
  const rpc = rpcClient(options);
  need(BigInt(await rpc('eth_chainId')) === BigInt(MAKALU_CHAIN_ID), 'This RPC is not Makalu (700777)');
  const blockTag = await rpc('eth_blockNumber');
  need(QUANTITY.test(blockTag), 'Bad block number');
  const read = async (signature: string, args: LvalInput[], type: LvalType): Promise<LvalValue['value']> => {
    // `from` is only the execution context of the call (the wallet's own
    // address) — it signs nothing and spends nothing.
    const raw = await rpc('eth_call', [{
      from: holder,
      to: NATIVE_LITHIC_GATEWAY,
      value: '0x0',
      gas: '0x4c4b40',
      data: encodeNativeCall(NATIVE_LAX.nativeTarget, signature, args),
    }, blockTag]);
    const values = decodeGatewayResult(raw);
    need(values.length === 1 && values[0].type === type, `Unexpected return type for ${signature}`);
    return values[0].value;
  };
  const [name, symbol, decimals, balance] = await Promise.all([
    read('name()', [], 'string'),
    read('symbol()', [], 'string'),
    read('decimals()', [], 'u64'),
    read('balance_of(address)', [{ type: 'address', value: holder }], 'u256'),
  ]);
  need(
    name === NATIVE_LAX.name && symbol === NATIVE_LAX.symbol && decimals === BigInt(NATIVE_LAX.decimals),
    'Native LAX metadata mismatch',
  );
  return {
    chainId: MAKALU_CHAIN_ID,
    nativeTarget: NATIVE_LAX.nativeTarget,
    owner: holder,
    blockHeight: BigInt(blockTag).toString(),
    name: NATIVE_LAX.name,
    symbol: NATIVE_LAX.symbol,
    decimals: NATIVE_LAX.decimals,
    balanceBaseUnits: (balance as bigint).toString(),
    balanceFormatted: formatUnits(balance as bigint, NATIVE_LAX.decimals),
    canonicalProofVerified: false,
  };
}

/** Balance for a list row, from exact base units: thousands separators and at
 *  most `maxFraction` decimals, cut (never rounded up), dust as "< 0.0001". */
export function formatNativeAmount(baseUnits: string, decimals: number, maxFraction = 4): string {
  const [whole, fraction = ''] = formatUnits(integer(baseUnits), decimals).split('.');
  const cut = fraction.slice(0, maxFraction).replace(/0+$/, '');
  if (whole === '0' && !cut) return /[1-9]/.test(fraction) ? `< 0.${'0'.repeat(maxFraction - 1)}1` : '0';
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${cut ? `.${cut}` : ''}`;
}
