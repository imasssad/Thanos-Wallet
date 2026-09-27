/**
 * WalletConnect `session_request` routing for the web wallet.
 *
 * Kept free of React and of WalletKit so the rule that matters most is unit
 * tested (wc-requests.test.ts): nothing is signed or sent until the user
 * approves it. Every personal_sign / eth_signTypedData_v4 /
 * eth_sendTransaction goes to `confirm` with sdk-core's reviewSigningRequest
 * of it (permits, Permit2, Seaport, approve, … decoded). A `block` verdict —
 * another chain or account, a scam address, a Seaport order that pays
 * nothing, a known phishing origin, or a transaction for a session that
 * isn't on the chain the wallet broadcasts to — can only be rejected.
 *
 * Read-only methods (accounts, chainId) and chain switches answer directly.
 */
import { reviewSigningRequest, type SignReview } from '@thanos/sdk-core';

export interface WcSessionRequest {
  topic: string;
  id: number;
  params: { request: { method: string; params?: unknown }; chainId?: string };
  verifyContext?: { verified?: { origin?: string } };
}

export interface TypedDataToSign {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  message: Record<string, unknown>;
}

export interface TxToSend {
  to: string;
  value?: string;
  data?: string;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export interface ConfirmEntry<R> {
  request: R;
  review: SignReview;
  /** Signs / sends and answers the dApp (with the error, if it fails). */
  approve: () => Promise<void>;
  /** Answers the dApp with a user-rejected error. */
  reject: () => Promise<void>;
}

export interface WcRequestDeps<R extends WcSessionRequest> {
  account(): string;
  sessionChainId(topic: string): number;
  setSessionChainId(topic: string, chainId: number): void;
  supportedChainIds: ReadonlySet<number>;
  /** The chain eth_sendTransaction is broadcast on. */
  broadcastChainId: number;
  respond(topic: string, id: number, result: unknown): Promise<void>;
  respondError(topic: string, id: number, code: number, message: string): Promise<void>;
  emitChainChanged(topic: string, chainId: number): Promise<void>;
  signMessage(messageHex: string): Promise<string>;
  signTypedData(typed: TypedDataToSign): Promise<string>;
  sendTransaction(tx: TxToSend): Promise<string>;
  /** Show the confirm sheet (queued — never replacing the one on screen). */
  confirm(entry: ConfirmEntry<R>): void;
  /** A reason string when the dApp origin must not get a signature. */
  blockedOrigin?(origin: string): string | null;
  now?(): number;
}

export function withBlock(review: SignReview, reason: string): SignReview {
  return review.blockReason
    ? review
    : { ...review, risk: 'block', blockReason: reason, warnings: [reason, ...review.warnings] };
}

const DEDUP_WINDOW_MS = 3000;

export function createSessionRequestHandler<R extends WcSessionRequest>(deps: WcRequestDeps<R>): (request: R) => Promise<void> {
  const now = deps.now ?? Date.now;
  /* Signature-spam dedup: dApps sometimes fire the same request twice in
     quick succession (double clicks, state races). An identical method +
     params within 3 s is soft-rejected so the user sees one prompt. */
  const recent = new Map<string, number>();
  const isDuplicate = (method: string, params: unknown): boolean => {
    const key = `${method}::${JSON.stringify(params)}`;
    const t = now();
    for (const [k, at] of recent) if (t - at > DEDUP_WINDOW_MS) recent.delete(k);
    const last = recent.get(key);
    recent.set(key, t);
    return last !== undefined && t - last < DEDUP_WINDOW_MS;
  };

  return async (request: R) => {
    const { topic, id } = request;
    const method = request.params.request.method;
    const params = Array.isArray(request.params.request.params) ? (request.params.request.params as unknown[]) : [];
    const ok = (result: unknown) => deps.respond(topic, id, result);
    const fail = (code: number, message: string) => deps.respondError(topic, id, code, message);

    if (isDuplicate(method, params)) {
      await fail(-32002, 'Duplicate request rejected (already submitted within 3s)');
      return;
    }

    const confirm = (review: SignReview, run: () => Promise<unknown>, what: 'signature' | 'transaction') => {
      const origin = request.verifyContext?.verified?.origin;
      const originBlock = origin && deps.blockedOrigin ? deps.blockedOrigin(origin) : null;
      const final = originBlock ? withBlock(review, originBlock) : review;
      deps.confirm({
        request,
        review: final,
        approve: async () => {
          // The sheet offers no Approve for a block; refuse here as well.
          if (final.risk === 'block') throw new Error(final.blockReason ?? 'Blocked');
          let result: unknown;
          try {
            result = await run();
          } catch (e) {
            const x = e as { code?: unknown; message?: string };
            await fail(typeof x.code === 'number' ? x.code : -32603, x.message || 'Signing failed');
            throw e;
          }
          await ok(result);
        },
        reject: () => fail(4001, `User rejected the ${what}`),
      });
    };
    const review = (chainId: number) =>
      reviewSigningRequest({ method, params, account: deps.account(), activeChainId: chainId });

    try {
      switch (method) {
        case 'personal_sign': {
          const messageHex = String(params[0] ?? '');
          confirm(review(deps.sessionChainId(topic)), () => deps.signMessage(messageHex), 'signature');
          return;
        }
        case 'eth_signTypedData_v4': {
          let typed: TypedDataToSign & { primaryType?: string };
          try {
            const raw = params[1];
            typed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as TypedDataToSign & { primaryType?: string };
            if (!typed || typeof typed !== 'object' || !typed.types || !typed.domain || !typed.message) throw new Error('shape');
          } catch {
            await fail(-32602, 'Invalid typed data');
            return;
          }
          // ethers v6 derives EIP712Domain from `domain` and rejects it in `types`.
          const { EIP712Domain: _omit, ...types } = typed.types as Record<string, Array<{ name: string; type: string }>>;
          void _omit;
          confirm(
            review(deps.sessionChainId(topic)),
            () => deps.signTypedData({ domain: typed.domain, types, message: typed.message }),
            'signature',
          );
          return;
        }
        case 'eth_sendTransaction': {
          const tx = (params[0] ?? {}) as {
            to: string; value?: string; data?: string; gas?: string; gasLimit?: string;
            maxFeePerGas?: string; maxPriorityFeePerGas?: string;
          };
          // Reviewed against the chain it will really be broadcast on; a
          // session the dApp switched elsewhere is refused, not re-routed.
          let r = review(deps.broadcastChainId);
          const sessionChain = deps.sessionChainId(topic);
          if (sessionChain !== deps.broadcastChainId) {
            r = withBlock(r, `This wallet sends dApp transactions on chain ${deps.broadcastChainId} only, but this session is on chain ${sessionChain}.`);
          }
          confirm(r, () => deps.sendTransaction({
            to: tx.to, value: tx.value, data: tx.data,
            gasLimit: tx.gas ?? tx.gasLimit,
            maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
          }), 'transaction');
          return;
        }
        case 'eth_accounts':
        case 'eth_requestAccounts':
          await ok([deps.account()]);
          return;
        case 'eth_chainId':
          await ok(`0x${deps.sessionChainId(topic).toString(16)}`);
          return;
        case 'wallet_switchEthereumChain':
        case 'wallet_addEthereumChain': {
          // Spec: params is [{ chainId: '0xHEX' }]; null on success. Switch
          // answers 4902 for an unknown chain (the dApp may add it first);
          // add answers 4001 — 4902 there would loop switch().catch(add).
          const p = (params[0] as { chainId?: string } | undefined) ?? {};
          const requested = typeof p.chainId === 'string' ? parseInt(p.chainId, 16) : NaN;
          if (!Number.isFinite(requested)) { await fail(-32602, 'Invalid chainId'); return; }
          if (!deps.supportedChainIds.has(requested)) {
            if (method === 'wallet_switchEthereumChain') await fail(4902, `Unrecognised chain ${requested}. Call wallet_addEthereumChain first.`);
            else await fail(4001, `Chain ${p.chainId} is not supported by this wallet.`);
            return;
          }
          deps.setSessionChainId(topic, requested);
          void deps.emitChainChanged(topic, requested).catch(() => { /* the dApp would poll instead */ });
          await ok(null);
          return;
        }
        default:
          await fail(4200, `Method not supported: ${method}`);
      }
    } catch (e) {
      const x = e as { code?: unknown; message?: string };
      await fail(typeof x.code === 'number' ? x.code : -32603, x.message ?? 'Internal error');
    }
  };
}
