/**
 * Thanos MultX bridge — the one service every Thanos client (web, desktop,
 * extension, mobile) runs a MultX transfer through.
 *
 * It wraps the shared partner adapter (./adapter, synced from
 * packages/multx-adapter) with what a wallet needs on top:
 *
 *  - Off unless the build turns it on: MULTX_ENABLED=true plus the release
 *    manifest's URL and pinned SHA-256. The manifest — not this file —
 *    decides which routes, bridges and tokens exist, and its `disabled`
 *    flag switches every route off on the next refresh.
 *  - A transfer history persisted in the app's own storage, updated at
 *    every step, so a transfer survives the app closing and is picked up
 *    again by resumePending().
 *  - Release verification on the destination chain over the app's own RPC:
 *    a transfer only shows as arrived once the release receipt there pays
 *    the user exactly the bridged amount.
 *
 * apps/mobile/lib/multx-thanos/ is a copy of this directory (EAS builds
 * mobile without the workspace) — edit here, then run
 * `node scripts/sync-multx-thanos.mjs`.
 */
import { JsonRpcProvider, Wallet, formatUnits, parseUnits, type Signer } from 'ethers';
import { MultXAdapter, MultXAdapterError, verifyErc20ReleaseViaRpc } from './adapter/index';
import type {
  InternalMultXTransfer, MultXManifest, MultXTelemetryEvent, TransferStatus,
} from './adapter/index';

export { MultXAdapterError };
export type { MultXManifest, TransferStatus };

export interface MultXThanosConfig {
  enabled: boolean;
  manifestUrl: string;
  manifestSha256: string;
}

/**
 * The bridge's build settings. On only when the flag is exactly "true" AND
 * the manifest URL is https AND its SHA-256 is 64 hex characters — a
 * half-configured build stays off rather than failing at the first tap.
 */
export function multxThanosConfig(
  flag: string | boolean | undefined,
  manifestUrl: string | undefined,
  manifestSha256: string | undefined,
): MultXThanosConfig {
  const url = (manifestUrl ?? '').trim();
  const sha = (manifestSha256 ?? '').trim().toLowerCase();
  const on = String(flag ?? '').trim().toLowerCase() === 'true';
  return {
    enabled: on && /^https:\/\/\S+$/i.test(url) && /^[0-9a-f]{64}$/.test(sha),
    manifestUrl: url,
    manifestSha256: sha,
  };
}

/** One token on one approved route, as the UI offers it. */
export interface MultXBridgeOption {
  /** `${sourceChainId}>${destinationChainId}:${SYMBOL}` — stable list key. */
  key: string;
  sourceChainId: number;
  destinationChainId: number;
  symbol: string;
  decimals: number;
  sourceToken: string;
  destinationToken: string;
  maxAmountBaseUnits?: string;
}

/** A persisted transfer: the adapter's record plus what the history list shows. */
export interface MultXBridgeTransfer extends InternalMultXTransfer {
  symbol: string;
  decimals: number;
}

/** Where a running transfer is, for the progress line. */
export type MultXBridgeStep = 'checking' | 'approving' | 'locking' | 'bridging';

/** The app's key/value storage (localStorage, chrome.storage, SecureStore…). */
export interface MultXKeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export const MULTX_HISTORY_KEY = 'thanos.multx.transfers.v1';
const HISTORY_LIMIT = 50;

export interface ThanosBridgeDeps {
  config: MultXThanosConfig;
  store: MultXKeyValueStore;
  /** JSON-RPC URL the app uses for a chain, or undefined if it has none. */
  rpcUrlFor: (chainId: number) => string | undefined;
  fetchImpl?: typeof fetch;
  /** For runtimes without WebCrypto (React Native). */
  sha256Hex?: (text: string) => Promise<string>;
  onEvent?: (event: MultXTelemetryEvent) => void;
  /** Waits between bridge status polls; injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ThanosBridge {
  readonly config: MultXThanosConfig;
  /** Loads the manifest (refresh re-fetches it, picking up the kill
   *  switch) and returns the routes on offer: [] when the build has the
   *  bridge off or the manifest disables it. Throws MultXAdapterError when
   *  the manifest can't be fetched or fails its hash check. */
  load(opts?: { refresh?: boolean }): Promise<MultXBridgeOption[]>;
  /** The release tag/commit of the loaded manifest, for the footer. */
  release(): { tag: string; commit: string } | null;
  /** Saved transfers, newest first; only `address`'s when given. */
  history(address?: string): Promise<MultXBridgeTransfer[]>;
  /** The user's balance of the option's token on its source chain, in base units. */
  balanceOf(option: MultXBridgeOption, owner: string): Promise<bigint>;
  /** Runs a transfer to the signer's own address on the destination chain.
   *  Resolves with the final record (RELEASED, FAILED or REVIEW); throws a
   *  MultXAdapterError, with a message fit to show, when it stops early. */
  send(params: {
    signer: Signer;
    option: MultXBridgeOption;
    /** Decimal amount as typed, e.g. "12.5". */
    amount: string;
    onStep?: (step: MultXBridgeStep) => void;
    onUpdate?: (transfer: MultXBridgeTransfer) => void;
  }): Promise<MultXBridgeTransfer>;
  /** Picks up the address's transfers still in flight after a restart. */
  resumePending(address: string, onUpdate?: (transfer: MultXBridgeTransfer) => void): Promise<void>;
}

/** Amount as typed → base units, or a MultXAdapterError saying what's wrong. */
export function parseBridgeAmount(amount: string, option: Pick<MultXBridgeOption, 'decimals' | 'maxAmountBaseUnits' | 'symbol'>): bigint {
  const text = amount.trim().replace(/,/g, '');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(text)) throw new MultXAdapterError('INVALID_AMOUNT', 'Enter an amount, like 10 or 2.5.');
  const [, frac = ''] = text.split('.');
  if (frac.length > option.decimals) {
    throw new MultXAdapterError('INVALID_AMOUNT', `${option.symbol} has ${option.decimals} decimal places at most.`);
  }
  const base = parseUnits(text.endsWith('.') ? text.slice(0, -1) : text, option.decimals);
  if (base <= 0n) throw new MultXAdapterError('INVALID_AMOUNT', 'Enter an amount greater than zero.');
  if (option.maxAmountBaseUnits && base > BigInt(option.maxAmountBaseUnits)) {
    throw new MultXAdapterError(
      'CAP_EXCEEDED',
      `This route takes at most ${formatBridgeAmount(option.maxAmountBaseUnits, option.decimals)} ${option.symbol} per transfer.`,
    );
  }
  return base;
}

/** Base units → a short readable amount (at most 6 decimals, no trailing zeros). */
export function formatBridgeAmount(baseUnits: string | bigint, decimals: number): string {
  const [whole, frac = ''] = formatUnits(baseUnits, decimals).split('.');
  const cut = frac.slice(0, 6).replace(/0+$/, '');
  return cut ? `${whole}.${cut}` : whole;
}

/** How the history list labels a transfer. */
export function bridgeTransferLabel(t: Pick<InternalMultXTransfer, 'status' | 'sourceTxHash'>): {
  label: string;
  tone: 'pending' | 'ok' | 'bad' | 'warn';
} {
  switch (t.status) {
    case 'SUBMITTED':  return t.sourceTxHash ? { label: 'Sending', tone: 'pending' } : { label: 'Not sent', tone: 'warn' };
    case 'FINALIZING': return { label: 'Confirming', tone: 'pending' };
    case 'SIGNING':    return { label: 'Validators signing', tone: 'pending' };
    case 'RELEASED':   return { label: 'Arrived', tone: 'ok' };
    case 'FAILED':     return { label: 'Failed', tone: 'bad' };
    case 'REVIEW':     return { label: 'Needs review', tone: 'warn' };
  }
}

/** A message fit to show for anything send()/load() throws. */
export function bridgeErrorMessage(err: unknown): string {
  if (err instanceof MultXAdapterError) return err.message;
  return 'Something went wrong with the bridge. Please try again.';
}

/** An ethers v6 signer for a self-custodied key on the route's source chain.
 *  The chain id is fixed rather than detected: the key signs for that chain
 *  (EIP-155), so an RPC serving any other chain can only reject it. Request
 *  caching is off — ethers reuses an identical call's answer for 250ms,
 *  which on a fast chain hands the lock the approval's already-used nonce.
 *  Call `destroy()` when the transfer is done. */
export function bridgeSigner(privateKey: string, rpcUrl: string, chainId: number): { signer: Wallet; destroy: () => void } {
  const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true, cacheTimeout: -1 });
  return { signer: new Wallet(privateKey, provider), destroy: () => provider.destroy() };
}

const IN_FLIGHT: ReadonlySet<TransferStatus> = new Set(['FINALIZING', 'SIGNING', 'REVIEW']);

function requestId(): string {
  return `thanos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createThanosBridge(deps: ThanosBridgeDeps): ThanosBridge {
  const { config, store } = deps;
  const doFetch = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const verify = verifyErc20ReleaseViaRpc({ rpcUrlFor: deps.rpcUrlFor, fetchImpl: doFetch });

  // Per-transfer extras the adapter's record doesn't carry, and listeners.
  const meta = new Map<string, { symbol: string; decimals: number; onUpdate?: (t: MultXBridgeTransfer) => void }>();
  const stepListeners = new Map<string, (step: MultXBridgeStep) => void>();
  const resuming = new Set<string>();

  async function readAll(): Promise<MultXBridgeTransfer[]> {
    try {
      const raw = await store.get(MULTX_HISTORY_KEY);
      const list = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(list) ? (list as MultXBridgeTransfer[]) : [];
    } catch {
      return [];
    }
  }

  // Writes are chained so two quick updates can't overwrite each other.
  let writes: Promise<unknown> = Promise.resolve();
  function upsert(record: InternalMultXTransfer): Promise<void> {
    const run = writes.then(async () => {
      const list = await readAll();
      const i = list.findIndex((t) => t.integrationRequestId === record.integrationRequestId);
      const extra = meta.get(record.integrationRequestId)
        ?? (i >= 0 ? { symbol: list[i].symbol, decimals: list[i].decimals } : { symbol: '', decimals: 18 });
      const next: MultXBridgeTransfer = { ...record, symbol: extra.symbol, decimals: extra.decimals };
      // A transfer that stopped before any lock was sent moved nothing — no
      // history entry; send() still throws so the screen shows why.
      const drop = next.status === 'FAILED' && !next.sourceTxHash;
      if (i >= 0) list.splice(i, 1);
      if (!drop) list.unshift(next);
      await store.set(MULTX_HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_LIMIT)));
      meta.get(record.integrationRequestId)?.onUpdate?.(next);
    });
    writes = run.catch(() => undefined);
    return run;
  }

  const adapter = new MultXAdapter({
    integration: 'thanos',
    enabled: config.enabled,
    manifestUrl: config.manifestUrl,
    manifestSha256: config.manifestSha256,
    persist: upsert,
    fetchImpl: doFetch,
    sha256Hex: deps.sha256Hex,
    sleep: deps.sleep,
    onEvent: (event) => {
      deps.onEvent?.(event);
      const step = event.integrationRequestId ? stepListeners.get(event.integrationRequestId) : undefined;
      if (!step) return;
      if (event.type === 'approve' && event.meta?.step === 'checking') step('checking');
      else if (event.type === 'approve' && event.meta?.step === 'approving') step('approving');
      else if (event.type === 'lock') step('locking');
      else if (event.type === 'poll') step('bridging');
    },
  });

  function offered(): MultXBridgeOption[] {
    return adapter.routes().flatMap((r) => r.tokens.map((t) => ({
      key: `${r.sourceChainId}>${r.destinationChainId}:${t.symbol.toUpperCase()}`,
      sourceChainId: r.sourceChainId,
      destinationChainId: r.destinationChainId,
      symbol: t.symbol,
      decimals: t.decimals,
      sourceToken: t.sourceAddress,
      destinationToken: t.destinationAddress,
      ...(r.maxAmountBaseUnits ? { maxAmountBaseUnits: r.maxAmountBaseUnits } : {}),
    })));
  }

  let loaded: MultXManifest | null = null;

  async function history(address?: string): Promise<MultXBridgeTransfer[]> {
    await writes;
    const all = await readAll();
    const who = address?.toLowerCase();
    return who ? all.filter((t) => t.userAddress.toLowerCase() === who) : all;
  }

  return {
    config,

    async load(opts) {
      if (!config.enabled) return [];
      loaded = await adapter.loadManifest({ refresh: opts?.refresh });
      return offered();
    },

    release() {
      return loaded ? { tag: loaded.tag, commit: loaded.commit } : null;
    },

    history,

    async balanceOf(option, owner) {
      const url = deps.rpcUrlFor(option.sourceChainId);
      if (!url) throw new MultXAdapterError('UNSUPPORTED_ROUTE', `No RPC is set up for chain ${option.sourceChainId}.`);
      const data = '0x70a08231' + owner.toLowerCase().replace(/^0x/, '').padStart(64, '0');
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: option.sourceToken, data }, 'latest'] }),
      });
      const body = (await res.json().catch(() => null)) as { result?: string } | null;
      if (!res.ok || typeof body?.result !== 'string' || !/^0x[0-9a-f]*$/i.test(body.result)) {
        throw new MultXAdapterError('UNKNOWN', 'Couldn’t read your balance on the source chain.');
      }
      return body.result === '0x' ? 0n : BigInt(body.result);
    },

    async send({ signer, option, amount, onStep, onUpdate }) {
      if (!config.enabled) throw new MultXAdapterError('FEATURE_DISABLED', 'The bridge isn’t available in this version.');
      const base = parseBridgeAmount(amount, option);
      // Re-read the manifest so a kill switch flipped since the screen opened applies.
      loaded = await adapter.loadManifest({ refresh: true });
      const id = requestId();
      meta.set(id, { symbol: option.symbol, decimals: option.decimals, onUpdate });
      if (onStep) stepListeners.set(id, onStep);
      try {
        const record = await adapter.transfer({
          integrationRequestId: id,
          signer,
          sourceChainId: option.sourceChainId,
          destinationChainId: option.destinationChainId,
          tokenSymbol: option.symbol,
          amountBaseUnits: base.toString(),
          recipient: await signer.getAddress(),
          verifyDestinationReceipt: verify,
        });
        await writes;
        return { ...record, symbol: option.symbol, decimals: option.decimals };
      } finally {
        stepListeners.delete(id);
        meta.delete(id);
      }
    },

    async resumePending(address, onUpdate) {
      if (!config.enabled) return;
      const pending = (await history(address)).filter((t) => t.sourceTxHash && IN_FLIGHT.has(t.status));
      await Promise.all(pending.map(async (t) => {
        if (resuming.has(t.integrationRequestId)) return;
        resuming.add(t.integrationRequestId);
        meta.set(t.integrationRequestId, { symbol: t.symbol, decimals: t.decimals, onUpdate });
        try {
          await adapter.resume(t, verify);
        } catch {
          // Manifest or status API unreachable — stays as saved; next launch retries.
        } finally {
          resuming.delete(t.integrationRequestId);
          meta.delete(t.integrationRequestId);
        }
      }));
    },
  };
}
