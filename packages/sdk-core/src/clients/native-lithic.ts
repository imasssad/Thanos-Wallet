/**
 * Lithic contracts on Lithosphere — LITHO mainnet and the Makalu testnet.
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
 * (__tests__/native-lithic.test.ts).
 *
 * MAINNET (2026-11-25): Lithic went live on LITHO mainnet (chain 9005) at
 * block 14,946,527, and Litho's integration docs now document transfers, so
 * the "reads only until Litho authorises execution" note above has been
 * answered. The wire format did not change — this module's LVAL encoder and
 * gateway calldata already reproduce the mainnet docs' spec vector, both
 * 32-byte selectors and the worked `balance_of` calldata byte for byte
 * (see __tests__/native-lithic.test.ts). What is new here is:
 *   • mainnet LAX as a second known token, and reads that take the token
 *     rather than assuming Makalu;
 *   • `lithicTransferCall`, which builds the calldata for a send. It builds
 *     ONLY calldata: signing and broadcasting stay with each client's own
 *     signer, exactly as for every other asset, so no key material comes
 *     near this module;
 *   • the pre-flight reads (`paused()`, `is_frozen(address)`) a caller needs
 *     to explain a failure, because a failed Lithic call reverts with NO
 *     reason data;
 *   • `decodeLithicCall`, so a transaction to the gateway can be shown as
 *     "Send 25 LAX to …" instead of an opaque contract call — in the wallet's
 *     own review sheet and in a dApp signing request.
 *
 * Gas rules that callers must respect (Litho docs 02 §3, 01 §7): `value` is
 * always 0 (a non-zero value fails and burns all gas), `from` is mandatory
 * even for `eth_call`/`eth_estimateGas`, and the chain charges at least HALF
 * the gas limit — so estimate with the real sender and add a small margin
 * rather than sending a large fixed limit.
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
export const LITHO_MAINNET_CHAIN_ID = 9005;
export const NATIVE_LITHIC_GATEWAY = '0x000000000000000000000000000000000000f000';

/** keccak256("LithoNativeLab(bytes)") — the one topic every gateway log has.
 *  Contract and event name are NOT topics, so `eth_getLogs` can only filter
 *  on the gateway address plus this; the JSON payload is filtered client-side. */
export const LITHIC_LOG_TOPIC = '0x093843f5e9eb40384e28a2de05071eb8158d09a803dec22fa5b5fb21a61e29a2';

/** First block with a gateway that does anything. Before it, a call to
 *  0x…f000 was a no-op returning `0x`, so there are no logs to scan. */
export const LITHIC_MAINNET_FIRST_BLOCK = 14_946_527;

/** A Lithic fungible token, as the wallet needs to know it. `LITHIC_FT` is
 *  its own token type beside ERC-20: the address has NO EVM code, so any
 *  `eth_getCode`/`balanceOf` probe finds nothing and would class it an EOA. */
export interface LithicToken {
  readonly kind: 'LITHIC_FT';
  readonly chainId: number;
  readonly nativeTarget: string;
  readonly gateway: string;
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly transferEnabled: boolean;
}

/** Native LAX on Makalu. Keyed by chain + execution profile + native target,
 *  never by symbol: the historical EVM LAX (0x1Cde2Ca6…4B8d) is a different
 *  asset and keeps its own ERC-20 reader. */
export const NATIVE_LAX = {
  kind: 'LITHIC_FT',
  chainId: MAKALU_CHAIN_ID,
  executionProfile: 'lithovm-native-v12-makalu',
  nativeTarget: '0x5803af8a82a8ecfb6d6a3b3d64814807b59d09ed',
  gateway: NATIVE_LITHIC_GATEWAY,
  name: 'Lithosphere Algorithmic',
  symbol: 'LAX',
  decimals: 18,
  balanceTransport: 'gateway-eth-call-lval-v1',
  // Makalu is a testnet whose execution workflow Litho never authorised;
  // mainnet is the one that can send.
  transferEnabled: false,
} as const;

/** LAX on LITHO mainnet — the first Lithic token on mainnet, and a different
 *  asset again from both the Makalu native LAX above and the EVM LAX. */
export const MAINNET_LAX = {
  kind: 'LITHIC_FT',
  chainId: LITHO_MAINNET_CHAIN_ID,
  executionProfile: 'lithovm-native-mainnet',
  nativeTarget: '0x29147bEbb1C49C3a54aA464137611FE708886df3',
  gateway: NATIVE_LITHIC_GATEWAY,
  name: 'Lithosphere Algorithmic',
  symbol: 'LAX',
  decimals: 18,
  balanceTransport: 'gateway-eth-call-lval-v1',
  transferEnabled: true,
} as const;

/** Every Lithic token the wallet ships with, by chain. */
export const KNOWN_LITHIC_TOKENS: readonly LithicToken[] = [MAINNET_LAX, NATIVE_LAX];

export function knownLithicTokens(chainId: number): LithicToken[] {
  return KNOWN_LITHIC_TOKENS.filter((t) => t.chainId === chainId);
}

/** The Lithic token at `nativeTarget` on `chainId`, if the wallet ships it. */
export function findLithicToken(chainId: number, nativeTarget: string): LithicToken | null {
  const want = nativeTarget.toLowerCase();
  return KNOWN_LITHIC_TOKENS.find((t) => t.chainId === chainId && t.nativeTarget.toLowerCase() === want) ?? null;
}

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
  /** The chain's RPC. Checked against the token's own chainId before any
   *  read, so a wallet pointed at the wrong network can't show one chain's
   *  LAX under another's. */
  rpcUrl: string;
  fetchImpl?: NativeFetch;
  timeoutMs?: number;
}

/** Name the network in errors a user may see — "not Makalu (700777)" says
 *  more than a bare number when a wallet is pointed at the wrong RPC. */
function chainLabel(chainId: number): string {
  if (chainId === MAKALU_CHAIN_ID) return `Makalu (${MAKALU_CHAIN_ID})`;
  if (chainId === LITHO_MAINNET_CHAIN_ID) return `LITHO mainnet (${LITHO_MAINNET_CHAIN_ID})`;
  return `chain ${chainId}`;
}

/** Still read-only: eth_getLogs reads history and eth_estimateGas simulates.
 *  eth_sendRawTransaction is deliberately absent — broadcasting stays with
 *  each client's signer, so this module can never put a transaction on
 *  chain. */
const READ_METHODS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_call', 'eth_getLogs', 'eth_estimateGas']);
/** `eth_call` is refused outright without a non-zero `from` ("EVM origin does
 *  not match message sender"). For a read it is only an execution context —
 *  any address works, and this one signs nothing. */
const PROBE_FROM = '0x0000000000000000000000000000000000000001';
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;

function rpcClient({ rpcUrl, fetchImpl, timeoutMs = 15_000 }: NativeReadOptions) {
  const url = new URL(rpcUrl);
  need((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password, 'Invalid RPC URL');
  const send = fetchImpl ?? (globalThis.fetch as unknown as NativeFetch);
  let nextId = 0;
  // Most of these methods answer with a hex string; eth_getLogs answers with
  // an array, so the result type is the caller's to name.
  return async function rpc<T = string>(method: string, params: unknown[] = []): Promise<T> {
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
      need(!j.error && j.result != null, `RPC rejected ${method}: ${JSON.stringify(j.error ?? null)}`);
      need(
        method === 'eth_getLogs' ? Array.isArray(j.result) : typeof j.result === 'string',
        `Unexpected result type for ${method}`,
      );
      return j.result as T;
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

/** What a caller needs before offering a send: a failed Lithic call carries
 *  NO reason, so these turn "it just failed" into something to tell the user. */
export interface LithicSendPreflight {
  balanceBaseUnits: string;
  /** The whole token is paused — nothing moves. */
  paused: boolean;
  /** This holder is frozen. */
  senderFrozen: boolean;
  /** The recipient is frozen, when one was given. */
  recipientFrozen: boolean;
  /** Null when everything checks out, else why the send would fail. */
  blockedReason: string | null;
}

/** Read native LAX metadata and `owner`'s balance at one block. Throws on any
 *  RPC failure, wrong chain or metadata mismatch — a failed read must never
 *  be shown as a zero balance.
 *
 *  Kept for the Makalu callers that predate mainnet; `readLithicBalance` is
 *  the one to use for a given token. */
export async function readNativeLaxBalance(owner: string, options: NativeReadOptions): Promise<NativeLaxBalance> {
  const read = await readLithicBalance(owner, NATIVE_LAX, options);
  return { ...read, chainId: MAKALU_CHAIN_ID } as NativeLaxBalance;
}

/** Read `token`'s metadata and `owner`'s balance at one block, on whichever
 *  chain the token belongs to. */
export async function readLithicBalance(
  owner: string,
  token: LithicToken,
  options: NativeReadOptions,
): Promise<Omit<NativeLaxBalance, 'chainId'> & { chainId: number }> {
  const holder = getAddress(owner);
  need(BigInt(holder) !== 0n, 'Nonzero owner required');
  const rpc = rpcClient(options);
  need(
    BigInt(await rpc('eth_chainId')) === BigInt(token.chainId),
    `This RPC is not ${chainLabel(token.chainId)}`,
  );
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
      data: encodeNativeCall(token.nativeTarget, signature, args),
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
    name === token.name && symbol === token.symbol && decimals === BigInt(token.decimals),
    `${token.symbol} metadata mismatch`,
  );
  return {
    chainId: token.chainId,
    nativeTarget: token.nativeTarget,
    owner: holder,
    blockHeight: BigInt(blockTag).toString(),
    name: token.name,
    symbol: token.symbol,
    decimals: token.decimals,
    balanceBaseUnits: (balance as bigint).toString(),
    balanceFormatted: formatUnits(balance as bigint, token.decimals),
    canonicalProofVerified: false,
  };
}

/**
 * Everything needed to decide whether a send can go through, read in one
 * pass: the balance, whether the token is paused, and whether either party is
 * frozen. The chain gives no reason when a transfer reverts, so a wallet that
 * skips this can only tell the user "it failed".
 */
export async function readLithicSendPreflight(
  owner: string,
  token: LithicToken,
  amountBaseUnits: bigint,
  options: NativeReadOptions,
  recipient?: string,
): Promise<LithicSendPreflight> {
  const holder = getAddress(owner);
  const to = recipient ? getAddress(recipient) : null;
  const rpc = rpcClient(options);
  need(BigInt(await rpc('eth_chainId')) === BigInt(token.chainId), `This RPC is not ${chainLabel(token.chainId)}`);
  const read = async (signature: string, args: LvalInput[], type: LvalType): Promise<LvalValue['value']> => {
    const raw = await rpc('eth_call', [{
      from: holder,
      to: NATIVE_LITHIC_GATEWAY,
      value: '0x0',
      gas: '0x4c4b40',
      data: encodeNativeCall(token.nativeTarget, signature, args),
    }, 'latest']);
    const values = decodeGatewayResult(raw);
    need(values.length === 1 && values[0].type === type, `Unexpected return type for ${signature}`);
    return values[0].value;
  };
  const [balance, paused, senderFrozen, recipientFrozen] = await Promise.all([
    read(LITHIC_FT_SIGNATURES.balanceOf, [{ type: 'address', value: holder }], 'u256') as Promise<bigint>,
    read(LITHIC_FT_SIGNATURES.paused, [], 'bool') as Promise<boolean>,
    read(LITHIC_FT_SIGNATURES.isFrozen, [{ type: 'address', value: holder }], 'bool') as Promise<boolean>,
    to ? (read(LITHIC_FT_SIGNATURES.isFrozen, [{ type: 'address', value: to }], 'bool') as Promise<boolean>) : Promise.resolve(false),
  ]);
  const blockedReason =
    paused ? `${token.symbol} transfers are paused right now.`
    : senderFrozen ? `This account is frozen for ${token.symbol}.`
    : recipientFrozen ? `The recipient is frozen for ${token.symbol}.`
    : balance < amountBaseUnits ? `Not enough ${token.symbol}.`
    : null;
  return {
    balanceBaseUnits: balance.toString(),
    paused,
    senderFrozen,
    recipientFrozen,
    blockedReason,
  };
}

/**
 * Is there a Lithic fungible token at this address? Detection must be by
 * these reads succeeding WITH these return types — `eth_getCode` returns
 * `0x` for every Lithic contract, so a code check classes it as a plain
 * account (Litho docs 02 §1). Returns null when it is not one.
 */
export async function probeLithicToken(
  nativeTarget: string,
  chainId: number,
  options: NativeReadOptions,
): Promise<LithicToken | null> {
  const target = getAddress(nativeTarget);
  const rpc = rpcClient(options);
  try {
    need(BigInt(await rpc('eth_chainId')) === BigInt(chainId), `This RPC is not ${chainLabel(chainId)}`);
    const read = async (signature: string, type: LvalType): Promise<LvalValue['value']> => {
      const raw = await rpc('eth_call', [{
        // Reads only need SOME non-zero from; it signs nothing.
        from: PROBE_FROM,
        to: NATIVE_LITHIC_GATEWAY,
        value: '0x0',
        gas: '0x4c4b40',
        data: encodeNativeCall(target, signature, []),
      }, 'latest']);
      const values = decodeGatewayResult(raw);
      need(values.length === 1 && values[0].type === type, `Unexpected return type for ${signature}`);
      return values[0].value;
    };
    const [name, symbol, decimals] = await Promise.all([
      read(LITHIC_FT_SIGNATURES.name, 'string') as Promise<string>,
      read(LITHIC_FT_SIGNATURES.symbol, 'string') as Promise<string>,
      // u64, not the uint8 an ERC-20 would give.
      read(LITHIC_FT_SIGNATURES.decimals, 'u64') as Promise<bigint>,
    ]);
    need(decimals <= 36n, 'Implausible decimals');
    const known = findLithicToken(chainId, target);
    return {
      kind: 'LITHIC_FT',
      chainId,
      nativeTarget: target,
      gateway: NATIVE_LITHIC_GATEWAY,
      name,
      symbol,
      decimals: Number(decimals),
      transferEnabled: known?.transferEnabled ?? chainId === LITHO_MAINNET_CHAIN_ID,
    };
  } catch {
    return null;
  }
}

/** How a Lithic token's network reads in a list row: "Lithosphere native",
 *  "Makalu native". The row's own suffix ("· view only", "· balance
 *  unavailable") is the client's, since it depends on what it managed to read. */
export function lithicNetworkLabel(token: LithicToken): string {
  if (token.chainId === LITHO_MAINNET_CHAIN_ID) return 'Lithosphere native';
  if (token.chainId === MAKALU_CHAIN_ID) return 'Makalu native';
  return `Chain ${token.chainId} native`;
}

/* ── Sending: off until someone has confirmed a transfer on mainnet ──── */

/**
 * The kill switch for Lithic sends, read from each client's own environment
 * (Vite, Next and Expo expose variables differently, so the value is passed
 * in rather than read here).
 *
 * Default ON, which is a deliberate change of mind. This path was first
 * written behind an opt-in flag because it could not be exercised against
 * mainnet at the time. It has since been turned on for mainnet LAX on the
 * authority of the vendor's integration docs and the repository owner's
 * instruction (PR #71), and shipped that way in the desktop and mobile
 * clients. Keeping the opt-in would now mean sends working in two clients
 * and silently refusing in the other two, which is worse than either answer.
 *
 * So the token's own `transferEnabled` is the per-asset decision, and this
 * value only ever takes sends away: set it to "0" or "false" to disable them
 * everywhere without a release. Balances, history and transaction decoding
 * are unaffected either way.
 */
export const LITHIC_SEND_FLAG = 'THANOS_LITHIC_SENDS';

export function lithicSendsEnabled(flagValue: string | undefined | null): boolean {
  if (flagValue === undefined || flagValue === null || flagValue === '') return true;
  const v = flagValue.trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

/** Whether to offer Send for this token: the token must support it, and the
 *  kill switch must not have been thrown. */
export function canSendLithic(token: LithicToken, flagValue: string | undefined | null): boolean {
  return token.transferEnabled && lithicSendsEnabled(flagValue);
}

/** The Lithic tokens on `chainId` a user may send right now. */
export function sendableLithicTokens(chainId: number, flagValue?: string | null): LithicToken[] {
  return knownLithicTokens(chainId).filter((t) => canSendLithic(t, flagValue));
}

/* ── Naming a Lithic asset in a send picker ──────────────────────────────
 *
 * Every client's Send screen picks its asset by symbol. A Lithic token is
 * not an ERC-20 and is in no token catalog, so a bare "LAX" there would be
 * ambiguous the moment a user adds a custom token of the same name — and
 * the two are different assets, one reached through the gateway and one
 * not. Sending to the wrong one loses the money.
 *
 * So a Lithic asset carries its own id in the picker. These three helpers
 * are the only place that id's shape is known; every client shares them, so
 * the four Send screens cannot disagree about what "LAX" means.
 */
export const LITHIC_COIN_PREFIX = 'lithic:';

export function lithicCoinId(symbol: string): string {
  return `${LITHIC_COIN_PREFIX}${symbol}`;
}

export function isLithicCoinId(coinId: string): boolean {
  return coinId.startsWith(LITHIC_COIN_PREFIX);
}

/** What to show in the picker for a coin id: "LAX · Lithic", or the id
 *  unchanged when it is an ordinary symbol. */
export function lithicCoinLabel(coinId: string): string {
  return isLithicCoinId(coinId) ? `${coinId.slice(LITHIC_COIN_PREFIX.length)} · Lithic` : coinId;
}

/** The sendable Lithic token a picker id names, or null when the id is an
 *  ordinary symbol, the chain has no such token, or sends are switched off. */
export function lithicTokenForCoinId(
  chainId: number,
  coinId: string,
  flagValue?: string | null,
): LithicToken | null {
  if (!isLithicCoinId(coinId)) return null;
  const symbol = coinId.slice(LITHIC_COIN_PREFIX.length);
  return sendableLithicTokens(chainId, flagValue).find((t) => t.symbol === symbol) ?? null;
}

/* ── Writes: calldata only, never a signature ────────────────────────── */

/** The native signatures LAX defines. No formal Lithic token standard exists
 *  yet; LAX sets the convention (Litho docs 02 §1). Names are snake_case and
 *  the types are Lithic types — `u256`, never `uint256`. */
export const LITHIC_FT_SIGNATURES = {
  name: 'name()',
  symbol: 'symbol()',
  /** Returns u64, NOT uint8 like ERC-20. */
  decimals: 'decimals()',
  totalSupply: 'total_supply()',
  balanceOf: 'balance_of(address)',
  allowance: 'allowance(address,address)',
  transfer: 'transfer(address,u256)',
  approve: 'approve(address,u256)',
  transferFrom: 'transfer_from(address,address,u256)',
  paused: 'paused()',
  isFrozen: 'is_frozen(address)',
  admin: 'admin()',
} as const;

/** A transaction a client can hand to its own signer. `value` is 0 because a
 *  Lithic call carrying LITHO fails AND burns all gas, and `to` is the
 *  gateway, never the token: the token address has no EVM code. */
export interface LithicTxRequest {
  to: string;
  data: string;
  value: '0x0';
  chainId: number;
}

/** Calldata for sending a Lithic token. Builds the request only — signing and
 *  broadcasting stay with the caller's signer. */
export function lithicTransferCall(token: LithicToken, to: string, amountBaseUnits: bigint): LithicTxRequest {
  need(token.transferEnabled, `${token.symbol} transfers are not enabled on chain ${token.chainId}`);
  const recipient = getAddress(to);
  need(BigInt(recipient) !== 0n, 'Nonzero recipient required: a zero recipient is rejected by the token');
  need(amountBaseUnits > 0n, 'Amount must be above zero');
  need(amountBaseUnits < 1n << 256n, 'Amount out of range');
  return {
    to: token.gateway,
    data: encodeNativeCall(token.nativeTarget, LITHIC_FT_SIGNATURES.transfer, [
      { type: 'address', value: recipient },
      { type: 'u256', value: amountBaseUnits },
    ]),
    value: '0x0',
    chainId: token.chainId,
  };
}

/**
 * The gas limit to send, from an `eth_estimateGas` result.
 *
 * The chain charges for at least HALF the gas limit (`min_gas_multiplier`
 * 0.5), so a generous round number is not free — it is paid for. A small
 * margin over the estimate is the documented approach (Litho docs 02 §3).
 */
export function lithicGasLimit(estimate: bigint, marginPercent = 20): bigint {
  need(estimate > 0n, 'Estimate must be above zero');
  need(marginPercent >= 0 && marginPercent <= 100, 'Margin must be 0-100%');
  return (estimate * BigInt(100 + marginPercent)) / 100n;
}

/* ── Reading a transaction back ──────────────────────────────────────── */

export interface DecodedLithicCall {
  /** The Lithic contract the gateway call targets. */
  target: string;
  /** The 32-byte selector as sent. */
  selector: string;
  /** The matching signature when it is one this module knows, else null —
   *  the selector alone cannot be reversed. */
  signature: string | null;
  args: LvalValue[];
}

const SIGNATURE_BY_SELECTOR = new Map<string, string>(
  Object.values(LITHIC_FT_SIGNATURES).map((sig) => [id(sig).toLowerCase(), sig] as const),
);

/**
 * Decode calldata addressed to the gateway.
 *
 * This is what turns "contract interaction with 0x…f000" into "Send 25 LAX
 * to …" in a review sheet — the wallet's own, and a dApp's signing request.
 * Returns null when the calldata is not a gateway `call`, so a caller can
 * fall back to its generic display. A transaction to the gateway must NEVER
 * be blocked for looking like a precompile: this address is the intended
 * target of every Lithic interaction (Litho docs 02 §5).
 */
export function decodeLithicCall(data: string): DecodedLithicCall | null {
  try {
    const parsed = NATIVE_GATEWAY_ABI.parseTransaction({ data });
    if (!parsed || parsed.name !== 'call') return null;
    const [target, selector, args] = parsed.args as unknown as [string, string, string];
    // Re-encoding must reproduce the calldata byte for byte. ethers tolerates
    // trailing bytes and a noncanonical offset; the runtime does not, and a
    // transaction the chain would reject must not be captioned as if it were
    // the clean one — the caption is what the user approves.
    if (NATIVE_GATEWAY_ABI.encodeFunctionData('call', [target, selector, args]).toLowerCase()
        !== hexlify(getBytes(data)).toLowerCase()) {
      return null;
    }
    return {
      target: getAddress(target),
      selector: selector.toLowerCase(),
      signature: SIGNATURE_BY_SELECTOR.get(selector.toLowerCase()) ?? null,
      args: decodeLval(args),
    };
  } catch {
    return null;
  }
}

/** A `transfer(address,u256)` the wallet can describe in full, or null. */
export function describeLithicTransfer(
  data: string,
  chainId: number,
): { token: LithicToken | null; target: string; to: string; amountBaseUnits: bigint } | null {
  const call = decodeLithicCall(data);
  if (!call || call.signature !== LITHIC_FT_SIGNATURES.transfer) return null;
  const [to, amount] = call.args;
  if (to?.type !== 'address' || amount?.type !== 'u256') return null;
  return {
    token: findLithicToken(chainId, call.target),
    target: call.target,
    to: to.value,
    amountBaseUnits: amount.value,
  };
}

/* ── Gateway logs ────────────────────────────────────────────────────── */

export interface LithicLogEvent {
  contract: string;
  name: string;
  values: LvalValue[];
}

export interface LithicLogEntry {
  deployments: Array<{ contract: string; creator?: string; codeHash?: string }>;
  events: LithicLogEvent[];
}

/** A log as a JSON-RPC receipt carries it. */
export interface RawLog {
  address: string;
  topics: readonly string[];
  data: string;
}

/**
 * Decode the `LithoNativeLab` logs of a receipt. The payload is raw UTF-8
 * JSON (not ABI-encoded), and only SUCCESSFUL calls log at all — a failure
 * emits nothing, which is why a caller cannot learn why it failed.
 *
 * Anything malformed is skipped rather than thrown: a log is for display and
 * history, and one unreadable entry must not take a receipt down with it.
 */
export function parseLithicLogs(logs: readonly RawLog[]): LithicLogEntry[] {
  const out: LithicLogEntry[] = [];
  for (const log of logs) {
    if (log.address?.toLowerCase() !== NATIVE_LITHIC_GATEWAY) continue;
    if (log.topics?.length !== 1 || log.topics[0]?.toLowerCase() !== LITHIC_LOG_TOPIC) continue;
    try {
      const json = JSON.parse(toUtf8String(log.data)) as {
        Deployments?: Array<{ contract?: string; creator?: string; codeHash?: string }>;
        Events?: Array<{ contract?: string; name?: string; values?: string }>;
      };
      out.push({
        deployments: (json.Deployments ?? []).flatMap((d) =>
          typeof d?.contract === 'string' ? [{ contract: getAddress(d.contract), creator: d.creator, codeHash: d.codeHash }] : []),
        events: (json.Events ?? []).flatMap((e) => {
          if (typeof e?.contract !== 'string' || typeof e?.name !== 'string' || typeof e?.values !== 'string') return [];
          try {
            return [{ contract: getAddress(e.contract), name: e.name, values: decodeLval(e.values) }];
          } catch {
            return [];
          }
        }),
      });
    } catch {
      /* not JSON we understand — skip it */
    }
  }
  return out;
}

/** Did this receipt's logs carry a Transfer of `token` involving `owner`?
 *  Status 1 is what decides success; this confirms the effect. */
export function receiptHasLithicTransfer(logs: readonly RawLog[], token: LithicToken, owner: string): boolean {
  const target = token.nativeTarget.toLowerCase();
  const me = getAddress(owner);
  return parseLithicLogs(logs).some((entry) =>
    entry.events.some((e) =>
      e.contract.toLowerCase() === target
      && e.name === 'Transfer'
      && e.values.some((v) => v.type === 'address' && v.value === me)));
}

/* ── Gas ─────────────────────────────────────────────────────────────── */

/**
 * Estimate a Lithic transfer with the REAL sender, which the chain insists
 * on: without a non-zero `from` the node answers "EVM origin does not match
 * message sender". A LAX transfer estimates around 326,600.
 *
 * Returns the limit to send (estimate + margin), not the bare estimate,
 * because the chain charges for at least half the limit.
 */
export async function estimateLithicTransferGas(
  owner: string,
  token: LithicToken,
  to: string,
  amountBaseUnits: bigint,
  options: NativeReadOptions,
  marginPercent = 20,
): Promise<bigint> {
  const from = getAddress(owner);
  need(BigInt(from) !== 0n, 'Nonzero sender required');
  const tx = lithicTransferCall(token, to, amountBaseUnits);
  const rpc = rpcClient(options);
  need(BigInt(await rpc('eth_chainId')) === BigInt(token.chainId), `This RPC is not ${chainLabel(token.chainId)}`);
  const raw = await rpc('eth_estimateGas', [{ from, to: tx.to, value: tx.value, data: tx.data }]);
  return lithicGasLimit(BigInt(raw), marginPercent);
}

/* ── History ─────────────────────────────────────────────────────────── */

export interface LithicTransferRow {
  /** `${txHash}:${logIndex}:${eventIndex}` — stable per transfer. */
  id: string;
  txHash: string;
  blockNumber: number;
  direction: 'in' | 'out';
  /** The other party. */
  counterparty: string;
  /** Exact amount in base units (decimal string). */
  amountBaseUnits: string;
  /** Formatted with the token's decimals. */
  amount: string;
  symbol: string;
  chainId: number;
  nativeTarget: string;
}

export interface LithicHistoryOptions extends NativeReadOptions {
  /** Default: the first block the gateway did anything (mainnet). */
  fromBlock?: number;
  /** Default: the chain head. */
  toBlock?: number;
  /** Blocks per request — nodes cap the range. 10,000 is documented as safe. */
  windowSize?: number;
  /** Stop after this many requests, newest window first (default 12). */
  maxWindows?: number;
}

const HEX = (n: number): string => `0x${n.toString(16)}`;

/**
 * Transfers of `token` involving `owner`, read from the gateway's logs.
 *
 * The gateway emits ONE topic and the contract and event name are not
 * indexed, so a node can only filter by gateway + topic: everything else is
 * filtered here, over raw-JSON payloads. Windows are walked newest first so
 * a caller that stops early still has the recent history.
 *
 * Failures of a single window are skipped rather than thrown — partial
 * history beats none — but an unreachable RPC still throws from the first
 * call, so "no history" and "couldn't read" stay distinguishable.
 */
export async function fetchLithicTransfers(
  owner: string,
  token: LithicToken,
  options: LithicHistoryOptions,
): Promise<LithicTransferRow[]> {
  const me = getAddress(owner);
  const rpc = rpcClient(options);
  need(BigInt(await rpc('eth_chainId')) === BigInt(token.chainId), `This RPC is not ${chainLabel(token.chainId)}`);
  const head = options.toBlock ?? Number(BigInt(await rpc('eth_blockNumber')));
  const floor = Math.max(
    options.fromBlock ?? (token.chainId === LITHO_MAINNET_CHAIN_ID ? LITHIC_MAINNET_FIRST_BLOCK : 0),
    0,
  );
  const window = Math.max(1, options.windowSize ?? 10_000);
  const maxWindows = Math.max(1, options.maxWindows ?? 12);
  const target = token.nativeTarget.toLowerCase();

  const rows: LithicTransferRow[] = [];
  let to = head;
  for (let i = 0; i < maxWindows && to >= floor; i++) {
    const from = Math.max(floor, to - window + 1);
    let logs: unknown;
    try {
      logs = await rpc<unknown>('eth_getLogs', [{
        address: NATIVE_LITHIC_GATEWAY,
        topics: [LITHIC_LOG_TOPIC],
        fromBlock: HEX(from),
        toBlock: HEX(to),
      }]);
    } catch {
      to = from - 1;
      continue;   // one bad window must not lose the rest
    }
    for (const raw of (Array.isArray(logs) ? logs : []) as Array<Record<string, unknown>>) {
      const txHash = typeof raw.transactionHash === 'string' ? raw.transactionHash : '';
      const blockNumber = typeof raw.blockNumber === 'string' ? Number(BigInt(raw.blockNumber)) : 0;
      const logIndex = typeof raw.logIndex === 'string' ? Number(BigInt(raw.logIndex)) : 0;
      const entries = parseLithicLogs([{
        address: String(raw.address ?? ''),
        topics: (raw.topics as string[]) ?? [],
        data: String(raw.data ?? '0x'),
      }]);
      for (const entry of entries) {
        entry.events.forEach((event, eventIndex) => {
          if (event.contract.toLowerCase() !== target || event.name !== 'Transfer') return;
          const [fromV, toV, amountV] = event.values;
          if (fromV?.type !== 'address' || toV?.type !== 'address' || amountV?.type !== 'u256') return;
          const outgoing = fromV.value === me;
          if (!outgoing && toV.value !== me) return;
          rows.push({
            id: `${txHash}:${logIndex}:${eventIndex}`,
            txHash,
            blockNumber,
            direction: outgoing ? 'out' : 'in',
            counterparty: outgoing ? toV.value : fromV.value,
            amountBaseUnits: amountV.value.toString(),
            amount: formatUnits(amountV.value, token.decimals),
            symbol: token.symbol,
            chainId: token.chainId,
            nativeTarget: token.nativeTarget,
          });
        });
      }
    }
    to = from - 1;
  }
  return rows.sort((a, b) => b.blockNumber - a.blockNumber || b.id.localeCompare(a.id));
}

/** Balance for a list row, from exact base units: thousands separators and at
 *  most `maxFraction` decimals, cut (never rounded up), dust as "< 0.0001". */
export function formatNativeAmount(baseUnits: string, decimals: number, maxFraction = 4): string {
  const [whole, fraction = ''] = formatUnits(integer(baseUnits), decimals).split('.');
  const cut = fraction.slice(0, maxFraction).replace(/0+$/, '');
  if (whole === '0' && !cut) return /[1-9]/.test(fraction) ? `< 0.${'0'.repeat(maxFraction - 1)}1` : '0';
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${cut ? `.${cut}` : ''}`;
}

/* ── The `native*` API, kept for the clients already wired to it ──────
 *
 * Two implementations of Lithic mainnet were written in parallel and met
 * here: this module's `lithic*` names, and the `native*` names that PR #71
 * shipped to main and wired into the web, extension, desktop and mobile
 * portfolios. Both encode the same bytes — they were checked against the
 * same vendor vectors — so keeping two of each would only invite the twins
 * to drift apart the way quantt.ts once did.
 *
 * So there is one implementation, above, and the `native*` names remain as
 * the adapters below: same signatures, same return shapes, no second copy of
 * the decoding, encoding, log-reading or pre-flight logic. Call sites on
 * either side keep working, and a fix lands once.
 */

/** Alias of {@link LithicToken}. */
export type NativeLithicToken = LithicToken;
/** Alias of {@link MAINNET_LAX}. */
export const NATIVE_LAX_MAINNET = MAINNET_LAX;
/** Alias of {@link KNOWN_LITHIC_TOKENS}. */
export const NATIVE_LITHIC_TOKENS: readonly LithicToken[] = KNOWN_LITHIC_TOKENS;
/** Alias of {@link knownLithicTokens}. */
export function nativeLithicTokensFor(chainId: number): LithicToken[] {
  return knownLithicTokens(chainId);
}
/** The signatures this build can name, as a flat list. */
export const NATIVE_SIGNATURES: readonly string[] = Object.values(LITHIC_FT_SIGNATURES);

export interface DecodedNativeCall {
  /** The native contract, NOT the EVM `to` (which is always the gateway). */
  target: string;
  /** The full 32-byte native selector. */
  selector: string;
  /** The signature this selector matches, or null when unknown. */
  signature: string | null;
  args: LvalValue[];
  /** Set for transfer/approve/transfer_from, in base units. */
  amount: bigint | null;
  recipient: string | null;
  /** The known token this target is, when it is one. */
  token: LithicToken | null;
}

/**
 * Read a transaction to the gateway back into what it does, so a wallet can
 * show "Send 25 LAX to litho1…" instead of "Contract interaction".
 *
 * Returns null when the calldata is not a canonical gateway `call`: a partial
 * answer would be worse than none, since the runtime decodes its input
 * strictly and a transaction we cannot read in full is one we must not
 * caption.
 *
 * Note for the signing UI: a transaction to 0x…f000 must NOT be blocked as a
 * precompile call. It is the intended destination of every Lithic
 * interaction.
 */
export function decodeNativeCall(data: string, chainId?: number): DecodedNativeCall | null {
  const call = decodeLithicCall(data);
  if (!call) return null;
  const token = chainId === undefined
    ? KNOWN_LITHIC_TOKENS.find((t) => t.nativeTarget.toLowerCase() === call.target.toLowerCase()) ?? null
    : findLithicToken(chainId, call.target);
  let amount: bigint | null = null;
  let recipient: string | null = null;
  if (call.signature === LITHIC_FT_SIGNATURES.transfer || call.signature === LITHIC_FT_SIGNATURES.approve) {
    if (call.args[0]?.type === 'address' && call.args[1]?.type === 'u256') {
      recipient = call.args[0].value;
      amount = call.args[1].value;
    }
  } else if (call.signature === LITHIC_FT_SIGNATURES.transferFrom) {
    if (call.args[1]?.type === 'address' && call.args[2]?.type === 'u256') {
      recipient = call.args[1].value;
      amount = call.args[2].value;
    }
  }
  return { target: call.target, selector: call.selector, signature: call.signature, args: call.args, amount, recipient, token };
}

/** A one-line caption for a gateway transaction, or null when it cannot be read. */
export function describeNativeCall(data: string, chainId?: number): string | null {
  const call = decodeNativeCall(data, chainId);
  if (!call) return null;
  const units = call.amount === null ? null
    : call.token ? `${formatNativeAmount(call.amount.toString(), call.token.decimals)} ${call.token.symbol}`
    : `${call.amount} base units`;
  const where = call.token ? '' : ` of the Lithic contract ${call.target}`;
  if (call.signature === LITHIC_FT_SIGNATURES.transfer && units) return `Send ${units}${where} to ${call.recipient}`;
  if (call.signature === LITHIC_FT_SIGNATURES.transferFrom && units) return `Move ${units}${where} to ${call.recipient}`;
  if (call.signature === LITHIC_FT_SIGNATURES.approve && units) return `Allow ${call.recipient} to spend ${units}${where}`;
  if (call.signature) return `${call.signature} on ${call.token ? call.token.symbol : call.target}`;
  return `Unknown Lithic function ${call.selector.slice(0, 10)}… on ${call.target}`;
}

/**
 * The EVM transaction that moves a native Lithic token, in the shape the
 * clients wired to PR #71 expect. {@link lithicTransferCall} is the same
 * bytes; it also refuses a token whose `transferEnabled` is false, so
 * enabling sends stays one explicit decision per token.
 */
export function encodeNativeTransfer(
  token: LithicToken,
  to: string,
  amountBaseUnits: bigint | string,
): { to: string; value: string; data: string } {
  const { to: gateway, data, value } = lithicTransferCall(token, to, integer(amountBaseUnits));
  return { to: gateway, value, data };
}

/**
 * Whether a successful receipt actually moved the tokens from `from` to `to`.
 *
 * Status 1 is not enough on its own: a native function that returns `false`
 * still produces a successful transaction. A failed call emits no log at all,
 * so the presence of this event is the proof a transfer happened.
 */
export function confirmsNativeTransfer(
  logs: readonly RawLog[],
  token: LithicToken,
  from: string,
  to: string,
): boolean {
  const target = token.nativeTarget.toLowerCase();
  const sender = getAddress(from);
  const recipient = getAddress(to);
  return parseLithicLogs(logs).some((entry) =>
    entry.events.some((e) =>
      e.contract.toLowerCase() === target
      && e.name === 'Transfer'
      && e.values[0]?.type === 'address' && e.values[0].value === sender
      && e.values[1]?.type === 'address' && e.values[1].value === recipient));
}

export interface NativeTransferPlan {
  /** Ready to hand to a signer: an ordinary EVM transaction. */
  tx: { to: string; value: string; data: string; gas: string };
  /** Reasons this transfer would fail, read from the token before sending. */
  blockers: string[];
  /** The raw estimate, before the margin. */
  estimatedGas: bigint;
}

/**
 * Everything that has to happen before a native Lithic transfer is signed:
 * the calldata, the reasons it would fail, and a gas limit.
 *
 * Why this is not just calldata plus a signature:
 *
 * - **A failure carries no reason.** A rejected Lithic call gives status 0,
 *   `execution reverted`, empty revert data and no event. So the token is
 *   asked first — balance, `paused()`, `is_frozen()` for both parties — and
 *   the caller gets sentences instead of a silent failure after the fee is
 *   spent.
 * - **Gas must be estimated with the real sender**, and the chain charges for
 *   at least half the gas limit, so a generous fixed limit is money burned.
 * - **`value` is 0**: a Lithic call carrying LITHO fails and burns all the
 *   gas, and these contracts cannot hold LITHO.
 *
 * `blockers` being non-empty does not throw: a caller may want to show them
 * and let the user decide (a balance can change between the read and the
 * send). Refusing outright is {@link lithicTransferCall}'s job, for the cases
 * that can never work.
 */
export async function prepareNativeTransfer(
  token: LithicToken,
  from: string,
  to: string,
  amountBaseUnits: bigint | string,
  options: NativeReadOptions,
): Promise<NativeTransferPlan> {
  const amount = integer(amountBaseUnits);
  const base = encodeNativeTransfer(token, to, amount);   // refuses a disabled token or zero recipient
  const sender = getAddress(from);
  const rpc = rpcClient(options);

  // The wrong network is a refusal, not a blocker to show the user: a mainnet
  // balance must never be spendable through a testnet RPC. Checked here
  // because the pre-flight read below is allowed to fail quietly.
  need(
    BigInt(await rpc('eth_chainId')) === BigInt(token.chainId),
    `This RPC is not ${chainLabel(token.chainId)}`,
  );

  // One pre-flight read for both surfaces. A token that does not offer one of
  // these reads is not a blocker, which is why the sentences come back rather
  // than an exception.
  const pre = await readLithicSendPreflight(sender, token, amount, options, to).catch(() => null);
  const blockers: string[] = [];
  if (pre) {
    const balance = BigInt(pre.balanceBaseUnits);
    if (balance < amount) {
      blockers.push(`balance is ${formatNativeAmount(pre.balanceBaseUnits, token.decimals)} ${token.symbol}, less than the amount`);
    }
    if (pre.paused) blockers.push(`${token.symbol} transfers are paused`);
    if (pre.senderFrozen) blockers.push(`the sender is frozen for ${token.symbol}`);
    if (pre.recipientFrozen) blockers.push(`the recipient is frozen for ${token.symbol}`);
  }

  const estimated = BigInt(await rpc('eth_estimateGas', [{
    from: sender, to: base.to, value: base.value, data: base.data,
  }]));
  const gas = lithicGasLimit(estimated);                  // +20%, the documented margin
  return { tx: { ...base, gas: '0x' + gas.toString(16) }, blockers, estimatedGas: estimated };
}
