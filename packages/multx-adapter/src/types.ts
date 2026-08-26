/**
 * Shared types for the MultX partner adapter.
 *
 * Nothing in this file hardcodes a bridge address, token address, or chain —
 * those all come from a signed release manifest at runtime (see manifest.ts).
 * That's a deliberate constraint from the acceptance checklist: "No
 * historical bridge or token address is hard-coded."
 */

export type PartnerId = 'ignite' | 'magmadex' | 'quantts' | 'kajlabs';

/** The normalized record every integration persists, per the integration plan. */
export interface InternalMultXTransfer {
  integration:           PartnerId;
  integrationRequestId:  string;
  manifestTag:           string;
  manifestCommit:        string;
  sourceChainId:         number;
  sourceBridge:          string;
  sourceToken:           string;
  sourceTxHash:          string;
  sourceNonce?:          string;
  userAddress:           string;
  amountBaseUnits:       string;
  destinationChainId:    number;
  destinationBridge:     string;
  destinationToken:      string;
  status:                TransferStatus;
  destinationTxHash?:    string;
  createdAt:             string;
  updatedAt:             string;
}

export type TransferStatus =
  | 'SUBMITTED'
  | 'FINALIZING'
  | 'SIGNING'
  | 'RELEASED'
  | 'FAILED'
  | 'REVIEW';

/** A single approved bridge route, as published in the release manifest. */
export interface MultXRoute {
  sourceChainId:      number;
  sourceBridge:       string;
  destinationChainId: number;
  destinationBridge:  string;
  tokens: Array<{
    symbol:            string;
    sourceAddress:     string;
    destinationAddress: string;
    decimals:           number;
  }>;
  /** Optional per-route cap — enforced client-side as defense in depth; the
   *  contract/backend is the actual source of truth. */
  maxAmountBaseUnits?: string;
}

/** The signed, versioned config the adapter is allowed to act on. Everything
 *  the adapter touches on-chain traces back to one of these fields — never
 *  to a value baked into this package. */
export interface MultXManifest {
  /** Human-readable release tag, e.g. "2026.08.1". */
  tag:      string;
  /** 40-character git commit the release was cut from. */
  commit:   string;
  /** Global kill switch — set true by Autha/KaJ Labs to disable every route
   *  instantly on the next manifest fetch, independent of each partner's
   *  own MULTX_ENABLED flag. */
  disabled: boolean;
  apiUrl:   string;
  routes:   MultXRoute[];
}

/** Normalized, user-safe error categories — never a raw provider/RPC error
 *  string, which can leak internals or just be unreadable to an end user. */
export type MultXErrorCode =
  | 'FEATURE_DISABLED'
  | 'MANIFEST_INVALID'
  | 'MANIFEST_UNREACHABLE'
  | 'WRONG_NETWORK'
  | 'UNSUPPORTED_ROUTE'
  | 'UNSUPPORTED_TOKEN'
  | 'INVALID_AMOUNT'
  | 'INSUFFICIENT_BALANCE'
  | 'INSUFFICIENT_ALLOWANCE'
  | 'CAP_EXCEEDED'
  | 'WALLET_REJECTED'
  | 'EXECUTION_REVERTED'
  | 'INSUFFICIENT_GAS'
  | 'NONCE_MISMATCH'
  | 'DUPLICATE_SUBMISSION'
  | 'SOURCE_TX_FAILED'
  | 'DESTINATION_UNVERIFIED'
  | 'TIMEOUT'
  | 'UNKNOWN';

/** Normalized telemetry the adapter emits — the caller supplies a sink
 *  (`onEvent`) and routes it to their own logging/metrics stack. The
 *  adapter never logs anything itself, so there's no risk of it writing
 *  secrets to a partner's log pipeline by surprise. */
export interface MultXTelemetryEvent {
  type: 'preflight' | 'approve' | 'lock' | 'poll' | 'reconcile' | 'error' | 'disabled';
  integration: PartnerId;
  integrationRequestId?: string;
  code?: MultXErrorCode;
  at: string;
  /** Redacted-safe metadata only — never an address's private key, a raw
   *  provider error object, or a full RPC response. */
  meta?: Record<string, string | number | boolean | null>;
}

export type TelemetrySink = (event: MultXTelemetryEvent) => void;

/** A partner-supplied persistence hook — the adapter has no database of its
 *  own, so it hands the caller a fully-formed record at each state change. */
export type PersistTransfer = (record: InternalMultXTransfer) => Promise<void>;

/** Minimal signer surface the adapter needs — deliberately narrow so it's
 *  satisfied by an ethers v6 Signer without importing ethers' full type
 *  surface into this file. */
export interface MultXSigner {
  getAddress(): Promise<string>;
  /** Nullable to match ethers v6's `Signer.provider` — a signer that was
   *  constructed without a connected provider is a caller bug, not
   *  something this package should paper over with a non-null assertion. */
  provider: {
    getNetwork(): Promise<{ chainId: bigint }>;
  } | null;
}
