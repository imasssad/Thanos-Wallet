/**
 * Signing worker — runs in a dedicated Worker context.
 *
 * Security goal: the unlocked WalletSource (mnemonic or private key) lives
 * ONLY inside this worker after init(). The main thread holds the worker
 * handle but never sees the secret again — sends RPC requests, receives
 * signatures + tx hashes. Defence-in-depth against:
 *
 *   - browser extensions reading React state / window globals
 *   - React DevTools accidentally exposing context
 *   - XSS that scrapes __NEXT_DATA__ or context internals
 *
 * It is NOT protection against an attacker controlling the main thread —
 * they can still call signer.send() to exfiltrate funds. But the surface
 * area for passive reads of the secret shrinks dramatically.
 *
 * Protocol: every request has an `{ id, op, payload }` shape; every reply
 * is `{ id, ok, result | error }`. The main-thread client correlates by id.
 */

import {
  HDNodeWallet, Mnemonic, Wallet, JsonRpcProvider,
  type Provider,
} from 'ethers';
// Pure module (ethers primitives only), so it doesn't delay the ready
// handshake below the way an sdk-core barrel import would.
import { messageBytesFor } from '../lib/message-bytes';
// Deep import, NOT the @thanos/sdk-core barrel: this worker's entry must stay
// synchronous (see the ready handshake at the bottom). The Bitcoin client is
// loaded on demand in handleSendBitcoin — it pulls tiny-secp256k1's async
// WebAssembly init, which as a static import delayed the message listener
// until after the wasm loaded, so the `init` sent right after `new Worker()`
// was dropped and the worker never held the unlocked wallet.
import type { BitcoinClient } from '@thanos/sdk-core/src/clients/bitcoin-client';

/* ─── In-worker secret state ─────────────────────────────────────────── */

type WalletSource =
  | { kind: 'mnemonic';  mnemonic:   string }
  | { kind: 'privateKey'; privateKey: string };

let source: WalletSource | null = null;
let cachedAddress: string | null = null;
/* Active HD-derivation index for mnemonic sources. The main thread
   passes this on every initSigner / setActiveIndex message; we hold
   it here so each getSigner() call derives from the right path. */
let accountIdx = 0;

/* ─── Provider for the chain a transaction names ─────────────────────── */

/** Every transaction names its chain — there is no default network (the
 *  worker used to broadcast everything on Makalu). The chainId is handed to
 *  ethers, which checks the RPC really serves that chain, and pinned into
 *  the signature. The main thread passes the browser-reachable RPC URL. */
function chainProvider(chainId: unknown, rpcUrl: unknown): { provider: Provider; chainId: number } {
  const id = typeof chainId === 'number' && Number.isSafeInteger(chainId) && chainId > 0 ? chainId : 0;
  const url = typeof rpcUrl === 'string' && /^https?:\/\//i.test(rpcUrl) ? rpcUrl : '';
  if (!id || !url) throw new Error('no_chain');
  return { provider: new JsonRpcProvider(url, id), chainId: id };
}

/* ─── Build a fresh ethers signer per operation ──────────────────────── */

function getSigner(provider?: Provider): HDNodeWallet | Wallet {
  if (!source) throw new Error('worker_locked');
  if (source.kind === 'privateKey') {
    const w = new Wallet(source.privateKey);
    return provider ? (w.connect(provider) as Wallet) : w;
  }
  const m = Mnemonic.fromPhrase(source.mnemonic);
  // Derive at the active account index — switched via setActiveIndex
  // messages from the main thread, defaults to 0.
  const hd = HDNodeWallet.fromMnemonic(m, `m/44'/60'/0'/0/${accountIdx}`);
  return provider ? (hd.connect(provider) as HDNodeWallet) : hd;
}

/* ─── RPC handlers ───────────────────────────────────────────────────── */

interface InitPayload  { source: WalletSource; accountIndex?: number }
interface InitReply    { address: string }
interface SetIdxPayload { accountIndex: number }
interface SetIdxReply  { address: string }


interface SignMsgPayload { message: string }    // utf-8 string OR 0x-prefixed hex
interface SignMsgReply   { signature: string }

interface SignTypedDataPayload {
  domain:      Record<string, unknown>;
  types:       Record<string, Array<{ name: string; type: string }>>;
  message:     Record<string, unknown>;
}
interface SignTypedDataReply   { signature: string }

interface SignTxPayload {
  /** The chain to sign for and broadcast on — required. */
  chainId:               number;
  rpcUrl:                string;
  to:                    string;
  value?:                string;       // bigint as string
  data?:                 string;
  gasLimit?:             string;
  maxFeePerGas?:         string;
  maxPriorityFeePerGas?: string;
}
interface SignTxReply { hash: string }

/* Bitcoin payload: amount is human-readable BTC ("0.001"), worker converts
   to satoshis. Mnemonic-only — PK imports use a different worker path. */
interface SendBtcPayload {
  recipient:        string;
  amount:           string;          // BTC, human-readable
  feeRateSatPerVb?: number;
}
interface SendBtcReply  { hash: string }

async function handleInit(p: InitPayload): Promise<InitReply> {
  source = p.source;
  // accountIndex only meaningful for mnemonic sources — privateKey is
  // a single account. Default to 0 when not passed.
  accountIdx = typeof p.accountIndex === 'number' && p.accountIndex >= 0 ? p.accountIndex : 0;
  const signer = getSigner();
  cachedAddress = await signer.getAddress();
  return { address: cachedAddress };
}

async function handleSetAccountIndex(p: SetIdxPayload): Promise<SetIdxReply> {
  if (!source) throw new Error('worker_locked');
  // Only mnemonic sources have multiple accounts; the privateKey path
  // ignores the switch silently (the chip just doesn't move).
  if (source.kind === 'mnemonic') {
    accountIdx = Math.max(0, Math.floor(p.accountIndex));
  }
  const signer = getSigner();
  cachedAddress = await signer.getAddress();
  return { address: cachedAddress };
}

/** Signs exactly the bytes the approval sheet displayed — see
 *  lib/message-bytes.ts for why the decode lives there (O-05). */
async function handleSignMessage(p: SignMsgPayload): Promise<SignMsgReply> {
  const signer = getSigner();
  const signature = await signer.signMessage(messageBytesFor(p.message));
  return { signature };
}

/** EIP-712 typed-data signing. The caller is expected to have already
 *  stripped the EIP712Domain key from `types` (ethers v6 wants it absent). */
async function handleSignTypedData(p: SignTypedDataPayload): Promise<SignTypedDataReply> {
  const signer = getSigner();
  const signature = await signer.signTypedData(p.domain, p.types, p.message);
  return { signature };
}

/** Build, sign, and broadcast a raw EVM transaction on the chain it names.
 *  Used for `eth_sendTransaction` requests coming from WalletConnect dApps. */
async function handleSignTransaction(p: SignTxPayload): Promise<SignTxReply> {
  const { provider, chainId } = chainProvider(p.chainId, p.rpcUrl);
  const signer = getSigner(provider);
  const tx = await signer.sendTransaction({
    to:    p.to,
    value: p.value ? BigInt(p.value) : undefined,
    data:  p.data,
    gasLimit:             p.gasLimit,
    maxFeePerGas:         p.maxFeePerGas,
    maxPriorityFeePerGas: p.maxPriorityFeePerGas,
    chainId:              BigInt(chainId),
  });
  return { hash: tx.hash };
}

async function handleAddress(): Promise<{ address: string }> {
  if (cachedAddress) return { address: cachedAddress };
  if (!source) throw new Error('worker_locked');
  const signer = getSigner();
  cachedAddress = await signer.getAddress();
  return { address: cachedAddress };
}

function handleLock(): { ok: true } {
  source = null;
  cachedAddress = null;
  return { ok: true };
}

/* ─── Bitcoin handler ────────────────────────────────────────────────── */

let _btcClient: BitcoinClient | null = null;
async function getBtcClient(): Promise<BitcoinClient> {
  if (_btcClient) return _btcClient;
  const { BitcoinClient: Client } = await import('@thanos/sdk-core/src/clients/bitcoin-client');
  _btcClient = new Client();
  return _btcClient;
}

async function handleSendBitcoin(p: SendBtcPayload): Promise<SendBtcReply> {
  if (!source) throw new Error('worker_locked');
  if (source.kind !== 'mnemonic') throw new Error('btc_requires_mnemonic');
  const btc = parseFloat(p.amount);
  if (!btc || btc <= 0) throw new Error('invalid_amount');
  const amountSats = Math.round(btc * 1e8);

  const txid = await (await getBtcClient()).send(source.mnemonic, {
    networkId:       'bitcoin-mainnet',
    to:              p.recipient.trim(),
    amountSats,
    feeRateSatPerVb: p.feeRateSatPerVb,
  });
  return { hash: txid };
}

/* ─── Solana handler ─────────────────────────────────────────────────── */
// O-01 (H-1 residual): Solana sends always use a mnemonic-derived account
// (no private-key import exists for SOL yet — lib/solana.ts's own call
// sites refuse to even try), so every send here now goes through the
// worker, same as EVM and Bitcoin.

interface SendSolPayload {
  recipient:    string;
  amount:       string;       // human-readable SOL
  mintAddress?: string;       // omitted → native SOL
  decimals?:    number;
}
interface SendSolReply { hash: string }

async function handleSendSolana(p: SendSolPayload): Promise<SendSolReply> {
  if (!source) throw new Error('worker_locked');
  if (source.kind !== 'mnemonic') throw new Error('sol_requires_mnemonic');
  const { SolanaClient, SOLANA_MAINNET } = await import('@thanos/sdk-core');
  const client = new SolanaClient();
  const hash = await client.send(source.mnemonic, {
    chainId:     SOLANA_MAINNET.chainId,
    to:          p.recipient.trim(),
    amount:      p.amount,
    mintAddress: p.mintAddress,
    decimals:    p.decimals,
  });
  return { hash };
}

/* ─── Cosmos handler ─────────────────────────────────────────────────── */
// O-01 (H-1 residual): same reasoning as Solana — mnemonic-only, no
// private-key import for ATOM.

interface SendCosmosPayload {
  recipient: string;
  amount:    string;    // human-readable ATOM
  memo?:     string;
}
interface SendCosmosReply { hash: string }

// Matches apps/web/lib/cosmos.ts's own defaults/env overrides exactly —
// keep both in sync if either changes.
function cosmosEnv(name: string, fallback: string): string {
  const env = typeof process !== 'undefined' ? (process as { env?: Record<string, string | undefined> }).env : undefined;
  return env?.[name] || fallback;
}
const COSMOS_RPC_URL   = cosmosEnv('NEXT_PUBLIC_COSMOS_RPC', 'https://cosmos-rpc.publicnode.com');
const COSMOS_BECH32    = 'cosmos';
const COSMOS_HD_PATH   = "m/44'/118'/0'/0/0";
const COSMOS_DENOM     = 'uatom';
const COSMOS_DECIMALS  = 6;
const COSMOS_GAS_PRICE = '0.025uatom';

async function handleSendCosmos(p: SendCosmosPayload): Promise<SendCosmosReply> {
  if (!source) throw new Error('worker_locked');
  if (source.kind !== 'mnemonic') throw new Error('cosmos_requires_mnemonic');
  const amt = parseFloat(p.amount);
  if (!amt || amt <= 0) throw new Error('invalid_amount');

  const { DirectSecp256k1HdWallet } = await import('@cosmjs/proto-signing');
  const { SigningStargateClient, GasPrice } = await import('@cosmjs/stargate');
  const { stringToPath } = await import('@cosmjs/crypto');
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(source.mnemonic, {
    prefix:  COSMOS_BECH32,
    hdPaths: [stringToPath(COSMOS_HD_PATH)],
  });
  const [acc] = await wallet.getAccounts();
  const client = await SigningStargateClient.connectWithSigner(COSMOS_RPC_URL, wallet, {
    gasPrice: GasPrice.fromString(COSMOS_GAS_PRICE),
  });
  const amountMicro = Math.round(amt * 10 ** COSMOS_DECIMALS).toString();
  const result = await client.sendTokens(
    acc.address,
    p.recipient.trim(),
    [{ denom: COSMOS_DENOM, amount: amountMicro }],
    'auto',
    p.memo ?? '',
  );
  if (result.code !== 0) throw new Error(result.rawLog || `cosmos_tx_failed_code_${result.code}`);
  return { hash: result.transactionHash };
}

/* ─── Message dispatch ───────────────────────────────────────────────── */

interface RpcRequest {
  id:      number;
  op:      'init' | 'send-btc' | 'send-sol' | 'send-cosmos' | 'sign-message' | 'sign-typed-data' | 'sign-transaction' | 'address' | 'lock' | 'set-account-index';
  payload?: unknown;
}

self.addEventListener('message', async (ev: MessageEvent<RpcRequest>) => {
  const { id, op, payload } = ev.data;
  try {
    let result: unknown;
    switch (op) {
      case 'init':             result = await handleInit(payload as InitPayload); break;
      case 'send-btc':         result = await handleSendBitcoin(payload as SendBtcPayload); break;
      case 'send-sol':         result = await handleSendSolana(payload as SendSolPayload); break;
      case 'send-cosmos':      result = await handleSendCosmos(payload as SendCosmosPayload); break;
      case 'sign-message':     result = await handleSignMessage(payload as SignMsgPayload); break;
      case 'sign-typed-data':  result = await handleSignTypedData(payload as SignTypedDataPayload); break;
      case 'sign-transaction': result = await handleSignTransaction(payload as SignTxPayload); break;
      case 'address':          result = await handleAddress(); break;
      case 'lock':             result = handleLock(); break;
      case 'set-account-index': result = await handleSetAccountIndex(payload as SetIdxPayload); break;
      default:                 throw new Error(`unknown_op:${op as string}`);
    }
    (self as unknown as Worker).postMessage({ id, ok: true, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    (self as unknown as Worker).postMessage({ id, ok: false, error: message });
  }
});

// Tell the main thread the listener is live — lib/signer-client.ts holds every
// request until this arrives, so none can be posted into the void.
(self as unknown as Worker).postMessage({ ready: true });
