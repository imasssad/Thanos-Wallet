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
  Contract, HDNodeWallet, Mnemonic, Wallet,
  FallbackProvider, JsonRpcProvider,
  parseUnits, formatEther,
  type Provider,
} from 'ethers';
import { BitcoinClient, lithoToEvm, isLithoAddress } from '@thanos/sdk-core';

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
const MAKALU_CHAIN_ID = 700777;
// Makalu [primary, fallback] — same-origin /rpc/* proxy paths (Next
// rewrites), NOT the direct litho.ai hosts: the upstream nodes botch
// CORS preflights (OPTIONS answered by the Tendermint index page with
// no Access-Control-Allow-Origin), so a direct browser/worker POST is
// blocked before it's sent — broadcasts silently never left the
// machine. Workers share the page origin, so self.location.origin
// resolves the proxy correctly; the direct hosts remain as a fallback
// for non-browser contexts (tests).
const WORKER_ORIGIN = (typeof self !== 'undefined' && self.location?.origin) || '';
const DEFAULT_RPC_URLS = WORKER_ORIGIN.startsWith('http')
  ? [`${WORKER_ORIGIN}/rpc/makalu`, `${WORKER_ORIGIN}/rpc/makalu-2`]
  : ['https://rpc.litho.ai', 'https://rpc-2.litho.ai'];

/* ─── Provider (FallbackProvider in worker scope) ────────────────────── */

let _provider: Provider | null = null;
function getProvider(): Provider {
  if (_provider) return _provider;
  const urls = DEFAULT_RPC_URLS;
  if (urls.length === 1) {
    _provider = new JsonRpcProvider(urls[0], MAKALU_CHAIN_ID);
    return _provider;
  }
  _provider = new FallbackProvider(
    urls.map(url => ({
      provider:     new JsonRpcProvider(url, MAKALU_CHAIN_ID),
      priority:     1,
      weight:       1,
      stallTimeout: 1500,
    })),
    MAKALU_CHAIN_ID,
    { quorum: 1 },
  );
  return _provider;
}

/* ─── Build a fresh ethers signer per operation ──────────────────────── */

function getSigner(withProvider: boolean): HDNodeWallet | Wallet {
  if (!source) throw new Error('worker_locked');
  const provider = withProvider ? getProvider() : undefined;
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

/* ─── Token registry (small subset — keep the worker bundle tiny) ───── */

// Mirror of apps/web/lib/tokens.ts — we only need the address + decimals here,
// not the icon / colour / price fields. Keep in sync manually.
const TOKEN_REGISTRY: Record<string, { address: string | null; decimals: number }> = {
  LITHO:  { address: null,                                         decimals: 18 },
  LitBTC: { address: '0xC4645CA5411D6E27556780AB4cdd0DF7e609df74', decimals: 18 },
  JOT:    { address: '0xEF2f35f6d0fb7DC9E87b8ca8252AE2E6ffb2a25e', decimals: 18 },
  LAX:    { address: '0x1Cde2Ca6c2ab8622003ebe06e382bC07850d4B8d', decimals: 18 },
  COLLE:  { address: '0x10D4BB600c96e9243E2f50baFED8b2478F25af61', decimals: 18 },
  IMAGE:  { address: '0xAcD98E323968647936887aD4934e64B01060727e', decimals: 18 },
  // FGPT = Finesse GPT (verified on-chain). The old "FurGPT" entries at
  // 0xDB829be / 0xa25c2a49 were both wrong: 0xDB829be is MUSA, and
  // 0xa25c2a49 is dead. See packages/sdk-core/src/tokens/makalu-lep100-source.ts.
  FGPT:   { address: '0x151ef362eA96853702Cc5e7728107e3961fbD22e', decimals: 18 },
  MUSA:   { address: '0xDB829befCF8E582379E2c034FA2589b8D2EA1c5D', decimals: 18 },
};

const LEP100_TRANSFER_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
];

/* ─── RPC handlers ───────────────────────────────────────────────────── */

interface InitPayload  { source: WalletSource; accountIndex?: number }
interface InitReply    { address: string }
interface SetIdxPayload { accountIndex: number }
interface SetIdxReply  { address: string }

interface SendPayload  { symbol: string; recipient: string; amount: string }
interface SendReply    { hash: string; symbol: string; to: string; value: string }

interface SignMsgPayload { message: string }    // utf-8 string OR 0x-prefixed hex
interface SignMsgReply   { signature: string }

interface SignTypedDataPayload {
  domain:      Record<string, unknown>;
  types:       Record<string, Array<{ name: string; type: string }>>;
  message:     Record<string, unknown>;
}
interface SignTypedDataReply   { signature: string }

interface SignTxPayload {
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
  const signer = getSigner(false);
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
  const signer = getSigner(false);
  cachedAddress = await signer.getAddress();
  return { address: cachedAddress };
}

async function handleSend(p: SendPayload): Promise<SendReply> {
  const token = TOKEN_REGISTRY[p.symbol];
  if (!token) throw new Error('invalid_token');
  // Accept either an EVM hex address OR a bech32 litho1… address —
  // they map 1:1 on Lithosphere chains. The Send modal already
  // converts most flows, but defending in depth here means a future
  // caller can't accidentally surface "invalid_address" on a valid
  // litho1 input.
  let to = '';
  const raw = (p.recipient || '').trim();
  if (raw.startsWith('0x')) to = raw;
  else if (isLithoAddress(raw)) {
    try { to = lithoToEvm(raw); } catch { /* fall through to invalid_address */ }
  }
  if (!to) throw new Error('invalid_address');
  let value: bigint;
  try { value = parseUnits(p.amount, token.decimals); }
  catch { throw new Error('invalid_amount'); }
  if (value <= 0n) throw new Error('invalid_amount');

  const signer = getSigner(true);
  let txHash: string;
  if (token.address === null) {
    const tx = await signer.sendTransaction({ to, value });
    txHash = tx.hash;
  } else {
    const c = new Contract(token.address, LEP100_TRANSFER_ABI, signer);
    const tx = await c.transfer(to, value);
    txHash = tx.hash;
  }
  return { hash: txHash, symbol: p.symbol, to, value: value.toString() };
}

async function handleSignMessage(p: SignMsgPayload): Promise<SignMsgReply> {
  const signer = getSigner(false);
  const messageBytes = p.message.startsWith('0x')
    ? new Uint8Array(p.message.slice(2).match(/.{1,2}/g)!.map(h => parseInt(h, 16)))
    : new TextEncoder().encode(p.message);
  const signature = await signer.signMessage(messageBytes);
  return { signature };
}

/** EIP-712 typed-data signing. The caller is expected to have already
 *  stripped the EIP712Domain key from `types` (ethers v6 wants it absent). */
async function handleSignTypedData(p: SignTypedDataPayload): Promise<SignTypedDataReply> {
  const signer = getSigner(false);
  const signature = await signer.signTypedData(p.domain, p.types, p.message);
  return { signature };
}

/** Build, sign, and broadcast a raw EVM transaction. Used for
 *  `eth_sendTransaction` requests coming from WalletConnect dApps. */
async function handleSignTransaction(p: SignTxPayload): Promise<SignTxReply> {
  const signer = getSigner(true);
  const tx = await signer.sendTransaction({
    to:    p.to,
    value: p.value ? BigInt(p.value) : undefined,
    data:  p.data,
    gasLimit:             p.gasLimit,
    maxFeePerGas:         p.maxFeePerGas,
    maxPriorityFeePerGas: p.maxPriorityFeePerGas,
  });
  return { hash: tx.hash };
}

async function handleAddress(): Promise<{ address: string }> {
  if (cachedAddress) return { address: cachedAddress };
  if (!source) throw new Error('worker_locked');
  const signer = getSigner(false);
  cachedAddress = await signer.getAddress();
  return { address: cachedAddress };
}

function handleLock(): { ok: true } {
  source = null;
  cachedAddress = null;
  _provider = null;
  return { ok: true };
}

/* ─── Bitcoin handler ────────────────────────────────────────────────── */

let _btcClient: BitcoinClient | null = null;
function getBtcClient(): BitcoinClient {
  if (_btcClient) return _btcClient;
  _btcClient = new BitcoinClient();
  return _btcClient;
}

async function handleSendBitcoin(p: SendBtcPayload): Promise<SendBtcReply> {
  if (!source) throw new Error('worker_locked');
  if (source.kind !== 'mnemonic') throw new Error('btc_requires_mnemonic');
  const btc = parseFloat(p.amount);
  if (!btc || btc <= 0) throw new Error('invalid_amount');
  const amountSats = Math.round(btc * 1e8);

  const txid = await getBtcClient().send(source.mnemonic, {
    networkId:       'bitcoin-mainnet',
    to:              p.recipient.trim(),
    amountSats,
    feeRateSatPerVb: p.feeRateSatPerVb,
  });
  return { hash: txid };
}

/* ─── Message dispatch ───────────────────────────────────────────────── */

interface RpcRequest {
  id:      number;
  op:      'init' | 'send' | 'send-btc' | 'sign-message' | 'sign-typed-data' | 'sign-transaction' | 'address' | 'lock' | 'set-account-index';
  payload?: unknown;
}

self.addEventListener('message', async (ev: MessageEvent<RpcRequest>) => {
  const { id, op, payload } = ev.data;
  try {
    let result: unknown;
    switch (op) {
      case 'init':             result = await handleInit(payload as InitPayload); break;
      case 'send':             result = await handleSend(payload as SendPayload); break;
      case 'send-btc':         result = await handleSendBitcoin(payload as SendBtcPayload); break;
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
