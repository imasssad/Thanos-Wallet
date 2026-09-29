'use client';
/**
 * Main-thread client for the signing worker.
 *
 * Wraps `workers/signer-worker.ts` behind a typed promise API. Every call
 * gets a fresh correlation id; the worker echoes it back so concurrent
 * sign requests resolve to their own callers without crossing wires.
 *
 * Lifecycle:
 *   - First call lazily constructs the Worker.
 *   - initSigner(source) must be called once after vault unlock; the
 *     worker stores the secret in its own module scope and never echoes
 *     it back.
 *   - lockSigner() blanks the secret in the worker. Re-init required to
 *     sign again.
 *
 * If anything in the worker throws ("worker_locked", "invalid_token",
 * "invalid_address", "invalid_amount", "insufficient", ...), the error
 * surfaces here as a typed SignerError so the UI can branch on the code.
 */
import type { WalletSource } from './wallet-source';
import { browserRpcUrl } from './evm-chains';

export class SignerError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SignerError';
  }
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject:  (err: SignerError) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, PendingCall>();
/** Resolves once the current worker has registered its message listener
 *  (it posts `{ ready: true }`). A message posted before that is silently
 *  dropped by the worker, so call() waits on this first. */
let workerReady: Promise<void> | null = null;
const READY_TIMEOUT_MS = 20_000;

function getWorker(): Worker {
  if (worker) return worker;
  // The (new URL(..., import.meta.url), { type: 'module' }) pattern is the
  // bundler-friendly way to ship a worker in Next.js. Turbopack and webpack
  // both rewrite this into a chunked worker bundle.
  worker = new Worker(
    new URL('../workers/signer-worker.ts', import.meta.url),
    { type: 'module' },
  );
  const w = worker;
  workerReady = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SignerError('worker_crashed', 'signing worker did not start')), READY_TIMEOUT_MS);
    const onReady = (ev: MessageEvent<{ ready?: boolean }>) => {
      if (ev.data?.ready !== true) return;
      clearTimeout(timer);
      w.removeEventListener('message', onReady);
      resolve();
    };
    w.addEventListener('message', onReady);
  });
  workerReady.catch(() => { /* surfaced to each waiting call() */ });
  worker.addEventListener('message', (ev: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
    const call = pending.get(ev.data.id);
    if (!call) return;
    pending.delete(ev.data.id);
    if (ev.data.ok) call.resolve(ev.data.result);
    else            call.reject(new SignerError(ev.data.error ?? 'unknown', ev.data.error ?? 'Signer error'));
  });
  worker.addEventListener('error', (ev) => {
    // The worker crashed — fail every in-flight call and reset state.
    for (const [, call] of pending) call.reject(new SignerError('worker_crashed', ev.message || 'worker crashed'));
    pending.clear();
    worker = null;
  });
  return worker;
}

function call<T>(op: string, payload?: unknown): Promise<T> {
  const w = getWorker();
  const ready = workerReady!;
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    ready.then(
      () => w.postMessage({ id, op, payload }),
      (e) => { if (pending.delete(id)) reject(e); },
    );
  });
}

/* ─── Public API ─────────────────────────────────────────────────────── */

/** Hand the unlocked WalletSource to the worker. After this returns the
 *  main thread can drop its own reference to the secret. `accountIndex`
 *  picks which HD-path account to derive (mnemonic sources only —
 *  privateKey sources are single-account and ignore it). */
export function initSigner(source: WalletSource, accountIndex = 0): Promise<{ address: string }> {
  return call('init', { source, accountIndex });
}

/** Switch the active HD-derivation account. The worker re-derives its
 *  cached signer + returns the new address so the UI can update. No-op
 *  for privateKey sources. */
export function setSignerAccountIndex(accountIndex: number): Promise<{ address: string }> {
  return call('set-account-index', { accountIndex });
}

/** Wipe the secret from the worker. Required on lock / sign-out. */
export function lockSigner(): Promise<{ ok: true }> {
  return call('lock');
}

/** Read the cached address from the worker (set during init). */
export function getSignerAddress(): Promise<{ address: string }> {
  return call('address');
}

/** EIP-191 personal_sign via the worker. */
export function signerSignMessage(message: string): Promise<{ signature: string }> {
  return call('sign-message', { message });
}

/** EIP-712 typed-data signing. The caller should have stripped the
 *  EIP712Domain key from `types` (ethers v6 wants it absent). */
export function signerSignTypedData(input: {
  domain:  Record<string, unknown>;
  types:   Record<string, Array<{ name: string; type: string }>>;
  message: Record<string, unknown>;
}): Promise<{ signature: string }> {
  return call('sign-typed-data', input);
}

/** Build, sign, and broadcast a raw EVM transaction (eth_sendTransaction). */
export function signerSignTransaction(input: {
  /** The chain to sign for and broadcast on — required; the worker has no
   *  default network. `rpcUrl` must be reachable from the browser (see
   *  evm-chains.ts browserRpcUrl). */
  chainId:               number;
  rpcUrl:                string;
  to:                    string;
  value?:                string;       // bigint serialised as string
  data?:                 string;
  gasLimit?:             string;
  maxFeePerGas?:         string;
  maxPriorityFeePerGas?: string;
}): Promise<{ hash: string }> {
  return call('sign-transaction', { ...input, rpcUrl: browserRpcUrl(input.rpcUrl) });
}

/** Bitcoin send via the worker. Mnemonic-only — PK-imported wallets must
 *  fall back to the direct (main-thread) sendBitcoin() path. */
export function signerSendBitcoin(input: {
  recipient:        string;
  amount:           string;      // human-readable BTC
  feeRateSatPerVb?: number;
}): Promise<{ hash: string }> {
  return call('send-btc', input);
}
