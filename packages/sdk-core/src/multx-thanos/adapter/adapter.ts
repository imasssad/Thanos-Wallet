// Copied from packages/multx-adapter/src/adapter.ts by scripts/sync-multx-thanos.mjs — edit the original and re-run it.
import type { Signer } from 'ethers';
import { loadManifest } from './manifest';
import { resolveRoute, preflightNetwork, validateAmount } from './preflight';
import { approveAndLock } from './bridge';
import { pollAndReconcile, type VerifyDestinationReceipt } from './status';
import { classifyError, MultXAdapterError } from './errors';
import type {
  InternalMultXTransfer, MultXErrorCode, MultXManifest, PartnerId, PersistTransfer, TelemetrySink,
} from './types';

/** Errors raised before any lock transaction left the wallet. */
const NOTHING_SENT: ReadonlySet<MultXErrorCode> = new Set([
  'WALLET_REJECTED', 'INSUFFICIENT_BALANCE', 'INSUFFICIENT_GAS', 'UNSUPPORTED_TOKEN', 'EXECUTION_REVERTED', 'NONCE_MISMATCH',
]);

/** Where a transfer stands after an error. FAILED only when no tokens can
 *  have been locked: the lock was never broadcast and the error proves it,
 *  or the lock was mined and reverted. Anything else (a lock sent but
 *  unconfirmed, a status-API error mid-poll, a network error during send)
 *  is REVIEW, which a later resume() can still settle. */
function settledStatusAfterError(sourceTxHash: string, code: MultXErrorCode): InternalMultXTransfer['status'] {
  if (!sourceTxHash) return NOTHING_SENT.has(code) ? 'FAILED' : 'REVIEW';
  return code === 'EXECUTION_REVERTED' || code === 'SOURCE_TX_FAILED' ? 'FAILED' : 'REVIEW';
}

export interface MultXAdapterConfig {
  integration: PartnerId;
  /** The partner app's OWN feature flag (MULTX_ENABLED). Defaults false —
   *  "Feature defaults to disabled" is not optional. */
  enabled: boolean;
  manifestUrl: string;
  manifestSha256: string;
  persist: PersistTransfer;
  onEvent?: TelemetrySink;
  fetchImpl?: typeof fetch;
  /** SHA-256 for the manifest check, for runtimes without WebCrypto. */
  sha256Hex?: (text: string) => Promise<string>;
  /** Waits between status polls; injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface TransferParams {
  integrationRequestId: string;
  signer: Signer;
  sourceChainId: number;
  destinationChainId: number;
  tokenSymbol: string;
  amountBaseUnits: string;
  recipient: string;
  verifyDestinationReceipt: VerifyDestinationReceipt;
}

/**
 * The shared MultX adapter described in INTERNAL_PARTNER_INTEGRATION_PLAN.md.
 * One instance per partner app. Owns manifest loading, preflight, on-chain
 * approve/lock, status polling, and independent reconciliation — nothing
 * else. Each partner app is responsible for its own UI, auth, and
 * post-completion product logic (crediting a balance, unblocking an agent,
 * etc.) — this class never assumes any of that.
 */
export class MultXAdapter {
  private readonly config: MultXAdapterConfig;
  private manifestCache: MultXManifest | null = null;

  constructor(config: MultXAdapterConfig) {
    this.config = config;
  }

  private emit(event: Omit<Parameters<TelemetrySink>[0], 'at'>): void {
    this.config.onEvent?.({ ...event, at: new Date().toISOString() });
  }

  /** Loads (and caches) the manifest. Call `refresh: true` to force a
   *  re-fetch — the manifest's own `disabled` flag is the emergency kill
   *  switch, and it only takes effect on the NEXT fetch, so a caller that
   *  wants near-real-time disable behavior should refresh periodically
   *  rather than relying on a long-lived cache. */
  async loadManifest(opts?: { refresh?: boolean }): Promise<MultXManifest> {
    if (this.manifestCache && !opts?.refresh) return this.manifestCache;
    const manifest = await loadManifest({
      manifestUrl: this.config.manifestUrl,
      expectedSha256: this.config.manifestSha256,
      fetchImpl: this.config.fetchImpl,
      sha256Hex: this.config.sha256Hex,
    });
    this.manifestCache = manifest;
    return manifest;
  }

  /** The approved routes a UI may offer — none unless the feature is on
   *  (see isEnabled), so an app never shows a route it would refuse. */
  routes(): MultXManifest['routes'] {
    return this.isEnabled() && this.manifestCache ? this.manifestCache.routes : [];
  }

  /** True only when BOTH this partner app's own flag is on AND the last-
   *  loaded manifest doesn't carry the remote kill switch. Before a manifest
   *  has ever loaded successfully, this is false — an adapter that can't
   *  prove the feature is safe defaults to refusing, not to trusting. */
  isEnabled(): boolean {
    return this.config.enabled && this.manifestCache !== null && !this.manifestCache.disabled;
  }

  /**
   * Full transfer lifecycle: preflight → approve → lock → poll → reconcile.
   * Persists the record at every state transition via `config.persist`, so
   * a crash mid-flow leaves a resumable SUBMITTED/FINALIZING/SIGNING record
   * rather than silently losing track of an on-chain lock.
   */
  async transfer(params: TransferParams): Promise<InternalMultXTransfer> {
    const manifest = await this.loadManifest();
    if (!this.config.enabled) {
      this.emit({ type: 'disabled', integration: this.config.integration, code: 'FEATURE_DISABLED' });
      throw new MultXAdapterError('FEATURE_DISABLED', 'MultX transfers are currently disabled for this application.');
    }
    if (manifest.disabled) {
      this.emit({ type: 'disabled', integration: this.config.integration, code: 'FEATURE_DISABLED' });
      throw new MultXAdapterError('FEATURE_DISABLED', 'MultX transfers are disabled by the current release manifest.');
    }

    const { route, token } = resolveRoute(manifest, {
      sourceChainId: params.sourceChainId,
      destinationChainId: params.destinationChainId,
      tokenSymbol: params.tokenSymbol,
    });
    const amount = validateAmount(params.amountBaseUnits, route);

    this.emit({ type: 'preflight', integration: this.config.integration, integrationRequestId: params.integrationRequestId });
    await preflightNetwork(params.signer, route.sourceChainId);
    // lockTokens takes no recipient: the bridge releases to the locking
    // address on the destination chain. Refuse rather than imply otherwise.
    const signerAddress = await params.signer.getAddress();
    if (params.recipient.toLowerCase() !== signerAddress.toLowerCase()) {
      throw new MultXAdapterError('UNSUPPORTED_ROUTE', 'Bridged funds arrive at your own address on the destination chain; a different recipient isn’t supported.');
    }

    const now = new Date().toISOString();
    let record: InternalMultXTransfer = {
      integration: this.config.integration,
      integrationRequestId: params.integrationRequestId,
      manifestTag: manifest.tag,
      manifestCommit: manifest.commit,
      sourceChainId: route.sourceChainId,
      sourceBridge: route.sourceBridge,
      sourceToken: token.sourceAddress,
      userAddress: signerAddress,
      amountBaseUnits: amount.toString(),
      destinationChainId: route.destinationChainId,
      destinationBridge: route.destinationBridge,
      destinationToken: token.destinationAddress,
      status: 'SUBMITTED',
      sourceTxHash: '',
      createdAt: now,
      updatedAt: now,
    };
    await this.config.persist(record);

    try {
      this.emit({ type: 'approve', integration: this.config.integration, integrationRequestId: params.integrationRequestId });
      const { sourceTxHash } = await approveAndLock({
        signer: params.signer,
        tokenAddress: token.sourceAddress,
        bridgeAddress: route.sourceBridge,
        amountBaseUnits: amount,
        destinationChainId: route.destinationChainId,
        onStep: (step) => this.emit({
          type: step === 'locking' ? 'lock' : 'approve',
          integration: this.config.integration,
          integrationRequestId: params.integrationRequestId,
          meta: { step },
        }),
        // Keep the hash the moment the lock is broadcast, so a transfer the
        // app loses track of mid-confirmation can still be resumed.
        onLockSent: async (hash) => {
          record = { ...record, sourceTxHash: hash, status: 'FINALIZING', updatedAt: new Date().toISOString() };
          await this.config.persist(record).catch(() => { /* re-persisted below */ });
        },
      });

      record = { ...record, sourceTxHash, status: 'FINALIZING', updatedAt: new Date().toISOString() };
      await this.config.persist(record);

      this.emit({ type: 'poll', integration: this.config.integration, integrationRequestId: params.integrationRequestId });
      const reconciled = await pollAndReconcile({
        apiUrl: manifest.apiUrl,
        sourceTxHash,
        destinationChainId: route.destinationChainId,
        destinationTokenAddress: token.destinationAddress,
        expectedRecipient: record.userAddress,
        expectedAmountBaseUnits: amount,
        verifyDestinationReceipt: params.verifyDestinationReceipt,
        fetchImpl: this.config.fetchImpl,
        sleep: this.config.sleep,
        onStep: (status) => {
          if (status === 'signing' || status === 'signed' || status === 'locked') {
            record = { ...record, status: 'SIGNING', updatedAt: new Date().toISOString() };
            this.config.persist(record).catch(() => { /* re-persisted at the end */ });
          }
        },
      });

      record = {
        ...record,
        status: reconciled.status,
        destinationTxHash: reconciled.destinationTxHash,
        updatedAt: new Date().toISOString(),
      };
      await this.config.persist(record);

      this.emit({
        type: 'reconcile',
        integration: this.config.integration,
        integrationRequestId: params.integrationRequestId,
        meta: { status: reconciled.status, reason: reconciled.failureReason ?? null },
      });
      return record;
    } catch (err) {
      const classified = classifyError(err);
      record = { ...record, status: settledStatusAfterError(record.sourceTxHash, classified.code), updatedAt: new Date().toISOString() };
      await this.config.persist(record).catch(() => { /* persistence failure is logged by the caller's own emit path */ });
      this.emit({
        type: 'error',
        integration: this.config.integration,
        integrationRequestId: params.integrationRequestId,
        code: classified.code,
      });
      throw classified;
    }
  }

  /**
   * Continue a transfer persisted mid-flight — the app closed after the lock
   * (FINALIZING / SIGNING), or a REVIEW that may have settled since. Polls
   * and reconciles exactly like transfer(), against the record's own route
   * values rather than today's manifest, and persists the outcome.
   */
  async resume(
    record: InternalMultXTransfer,
    verifyDestinationReceipt: VerifyDestinationReceipt,
  ): Promise<InternalMultXTransfer> {
    if (!record.sourceTxHash || record.status === 'RELEASED' || record.status === 'FAILED') return record;
    const manifest = await this.loadManifest();
    const reconciled = await pollAndReconcile({
      apiUrl: manifest.apiUrl,
      sourceTxHash: record.sourceTxHash,
      destinationChainId: record.destinationChainId,
      destinationTokenAddress: record.destinationToken,
      expectedRecipient: record.userAddress,
      expectedAmountBaseUnits: BigInt(record.amountBaseUnits),
      verifyDestinationReceipt,
      fetchImpl: this.config.fetchImpl,
      sleep: this.config.sleep,
    });
    const next: InternalMultXTransfer = {
      ...record,
      status: reconciled.status,
      destinationTxHash: reconciled.destinationTxHash ?? record.destinationTxHash,
      updatedAt: new Date().toISOString(),
    };
    await this.config.persist(next);
    this.emit({
      type: 'reconcile',
      integration: this.config.integration,
      integrationRequestId: record.integrationRequestId,
      meta: { status: reconciled.status, reason: reconciled.failureReason ?? null, resumed: true },
    });
    return next;
  }
}
