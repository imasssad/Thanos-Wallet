/**
 * Bridge to the offscreen signer.
 *
 * The popup uses this instead of calling ethers.HDNodeWallet directly,
 * so derived private keys live exclusively in the offscreen document's
 * JS context — the popup's heap never holds them.
 *
 * Hardening-audit H-1 (extension, slice 3 of 4): the seed used to cross
 * this bridge on EVERY signing call, because the popup kept it in React
 * state (WalletSeedContext) for the whole unlocked session and resent it
 * each time — "the signing component is a copy, not a boundary", in the
 * audit's words. initSigner() now pushes it ONCE, right after unlock,
 * into the offscreen document — which Chrome keeps alive independently of
 * the popup — and every signing call below carries no secret at all.
 * lockSigner() drops the cache on wallet lock; setSignerAccountIndex()
 * follows an HD account switch so the next signature matches the account
 * showing in the popup, the same shape as web's `signer-client.ts`.
 */

interface BridgeOk { ok: true; [k: string]: unknown }
interface BridgeErr { ok: false; error: string }

async function send<T extends BridgeOk>(payload: object): Promise<T> {
  const reply = await browser.runtime.sendMessage(payload) as BridgeOk | BridgeErr;
  if (!reply?.ok) throw new Error((reply as BridgeErr)?.error ?? 'offscreen unreachable');
  return reply as T;
}

/** Push the unlocked secret into the offscreen signer. Called once per
 *  unlock (and once per account-switch's worth of index, via
 *  setSignerAccountIndex) — never again per signing call. */
export async function initSigner(seed: string[], accountIndex = 0): Promise<{ address: string }> {
  const source = seed.length === 1 && /^0x[0-9a-fA-F]{64}$/.test(seed[0].trim())
    ? { kind: 'privateKey' as const, privateKey: seed[0].trim() }
    : { kind: 'mnemonic' as const, mnemonic: seed.join(' ') };
  const r = await send<BridgeOk & { address: string }>({ type: 'sign.init', source, accountIndex });
  return { address: r.address };
}

/** Wipe the offscreen signer's cached secret. Required on lock / sign-out. */
export async function lockSigner(): Promise<void> {
  await send<BridgeOk>({ type: 'sign.lock' });
}

/** Switch the offscreen signer's active HD account — no-op for a
 *  private-key source, same as the other clients' signer caches. */
export async function setSignerAccountIndex(accountIndex: number): Promise<{ address: string }> {
  const r = await send<BridgeOk & { address: string }>({ type: 'sign.set-account-index', accountIndex });
  return { address: r.address };
}

/** The offscreen signer's cached address. Throws if locked. */
export async function getSignerAddress(): Promise<string> {
  const r = await send<BridgeOk & { address: string }>({ type: 'sign.address' });
  return r.address;
}

export interface TxParams {
  to?:    string;
  value?: string;          // hex 0x… or decimal wei
  data?:  string;
  from?:  string;
  gas?:   string;
  /** Gas limit (decimal); ethers estimates when it is absent. */
  gasLimit?: string;
  gasPrice?: string;
  nonce?: number;
  chainId?: number;
}

export async function signAndBroadcastTx(args: {
  tx: TxParams;
  /** Target chain — required. The offscreen signer broadcasts through this
   *  RPC and pins chainId onto the tx; with no chain it refuses to sign. */
  chainId: number; rpcUrl: string;
}): Promise<string> {
  const r = await send<BridgeOk & { hash: string }>({
    type:    'sign.evm-tx',
    tx:      args.tx,
    chainId: args.chainId,
    rpcUrl:  args.rpcUrl,
  });
  return r.hash;
}

export async function signPersonalMessage(args: { messageHex: string }): Promise<string> {
  // messageHex is a 0x hex string, NOT a Uint8Array: chrome.runtime.sendMessage
  // serializes as JSON, so a Uint8Array would arrive as a plain object
  // {0:.., 1:..} and ethers.signMessage would throw "invalid BytesLike". The
  // offscreen getBytes()-decodes this hex and signs the raw bytes.
  const r = await send<BridgeOk & { signature: string }>({
    type:       'sign.evm-personal',
    messageHex: args.messageHex,
  });
  return r.signature;
}

export async function signTypedData(args: {
  payload: {
    domain: Record<string, unknown>;
    types:  Record<string, Array<{ name: string; type: string }>>;
    value:  Record<string, unknown>;
  };
}): Promise<string> {
  const r = await send<BridgeOk & { signature: string }>({
    type:    'sign.evm-typed-data',
    payload: args.payload,
  });
  return r.signature;
}

export async function transferErc20(args: {
  tokenAddress: string; to: string; amount: bigint;
  /** Chain the token lives on — required, as for signAndBroadcastTx. */
  chainId: number; rpcUrl: string;
}): Promise<string> {
  const r = await send<BridgeOk & { hash: string }>({
    type:         'sign.evm-erc20-transfer',
    tokenAddress: args.tokenAddress,
    to:           args.to,
    amount:       args.amount.toString(),
    chainId:      args.chainId,
    rpcUrl:       args.rpcUrl,
  });
  return r.hash;
}

/** O-01 (H-1 residual): Solana send via the offscreen signer — native SOL
 *  or an SPL token (when mintAddress is given). Mnemonic-only — no
 *  private-key import exists for SOL. */
export async function sendSolana(args: {
  recipient: string; amount: string; mintAddress?: string; decimals?: number;
}): Promise<string> {
  const r = await send<BridgeOk & { hash: string }>({
    type: 'sign.sol-send', recipient: args.recipient, amount: args.amount,
    mintAddress: args.mintAddress, decimals: args.decimals,
  });
  return r.hash;
}

/** O-01 (H-1 residual): Cosmos (ATOM) send via the offscreen signer.
 *  Mnemonic-only — no private-key import exists for ATOM. */
export async function sendCosmosTx(args: {
  recipient: string; amount: string; memo?: string;
}): Promise<string> {
  const r = await send<BridgeOk & { hash: string }>({
    type: 'sign.cosmos-send', recipient: args.recipient, amount: args.amount, memo: args.memo,
  });
  return r.hash;
}

/** O-01 (H-1 residual, non-signing): the cached account's Solana address,
 *  without the mnemonic leaving the offscreen document just to show a
 *  balance or receive address. */
export async function getSolanaAddressFromSigner(): Promise<string> {
  const r = await send<BridgeOk & { address: string }>({ type: 'sign.sol-address' });
  return r.address;
}

/** O-01 (H-1 residual, non-signing): same, for Cosmos. */
export async function getCosmosAddressFromSigner(): Promise<string> {
  const r = await send<BridgeOk & { address: string }>({ type: 'sign.cosmos-address' });
  return r.address;
}
