/**
 * Bridge to the offscreen signer.
 *
 * The popup uses this instead of calling ethers.HDNodeWallet directly,
 * so derived private keys live exclusively in the offscreen document's
 * JS context — the popup's heap never holds them.
 *
 * What the popup still holds: the BIP-39 seed words (in
 * WalletSeedContext, set at unlock time). The seed crosses the
 * structured-clone bridge for each signing call. We send the seed
 * as a joined string rather than the array form so postMessage clones
 * a single immutable primitive.
 */

interface BridgeOk { ok: true; [k: string]: unknown }
interface BridgeErr { ok: false; error: string }

async function send<T extends BridgeOk>(payload: object): Promise<T> {
  const reply = await browser.runtime.sendMessage(payload) as BridgeOk | BridgeErr;
  if (!reply?.ok) throw new Error((reply as BridgeErr)?.error ?? 'offscreen unreachable');
  return reply as T;
}

export interface TxParams {
  to?:    string;
  value?: string;          // hex 0x… or decimal wei
  data?:  string;
  from?:  string;
  gas?:   string;
  gasPrice?: string;
  nonce?: number;
  chainId?: number;
}

export async function signAndBroadcastTx(args: {
  seed: string[]; hdPath?: string; tx: TxParams;
  /** Target chain. Omit (or rpcUrl='') to broadcast on Makalu via the sdk
   *  provider; set both to route an external EVM chain (chainId is pinned
   *  onto the tx in the offscreen signer). */
  chainId?: number; rpcUrl?: string;
}): Promise<string> {
  const r = await send<BridgeOk & { hash: string }>({
    type:    'sign.evm-tx',
    seed:    args.seed.join(' '),
    hdPath:  args.hdPath ?? "m/44'/60'/0'/0/0",
    tx:      args.tx,
    chainId: args.chainId,
    rpcUrl:  args.rpcUrl,
  });
  return r.hash;
}

export async function signTx(args: {
  seed: string[]; hdPath?: string; tx: TxParams;
}): Promise<string> {
  const r = await send<BridgeOk & { signed: string }>({
    type:   'sign.evm-sign-tx',
    seed:   args.seed.join(' '),
    hdPath: args.hdPath ?? "m/44'/60'/0'/0/0",
    tx:     args.tx,
  });
  return r.signed;
}

export async function signPersonalMessage(args: {
  seed: string[]; hdPath?: string; messageHex: string;
}): Promise<string> {
  // messageHex is a 0x hex string, NOT a Uint8Array: chrome.runtime.sendMessage
  // serializes as JSON, so a Uint8Array would arrive as a plain object
  // {0:.., 1:..} and ethers.signMessage would throw "invalid BytesLike". The
  // offscreen getBytes()-decodes this hex and signs the raw bytes.
  const r = await send<BridgeOk & { signature: string }>({
    type:       'sign.evm-personal',
    seed:       args.seed.join(' '),
    hdPath:     args.hdPath ?? "m/44'/60'/0'/0/0",
    messageHex: args.messageHex,
  });
  return r.signature;
}

export async function signTypedData(args: {
  seed:    string[];
  hdPath?: string;
  payload: {
    domain: Record<string, unknown>;
    types:  Record<string, Array<{ name: string; type: string }>>;
    value:  Record<string, unknown>;
  };
}): Promise<string> {
  const r = await send<BridgeOk & { signature: string }>({
    type:    'sign.evm-typed-data',
    seed:    args.seed.join(' '),
    hdPath:  args.hdPath ?? "m/44'/60'/0'/0/0",
    payload: args.payload,
  });
  return r.signature;
}

export async function transferErc20(args: {
  seed: string[]; hdPath?: string; tokenAddress: string; to: string; amount: bigint;
}): Promise<string> {
  const r = await send<BridgeOk & { hash: string }>({
    type:         'sign.evm-erc20-transfer',
    seed:         args.seed.join(' '),
    hdPath:       args.hdPath ?? "m/44'/60'/0'/0/0",
    tokenAddress: args.tokenAddress,
    to:           args.to,
    amount:       args.amount.toString(),
  });
  return r.hash;
}
