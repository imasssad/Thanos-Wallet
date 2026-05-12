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

/* ─── In-worker secret state ─────────────────────────────────────────── */

type WalletSource =
  | { kind: 'mnemonic';  mnemonic:   string }
  | { kind: 'privateKey'; privateKey: string };

let source: WalletSource | null = null;
let cachedAddress: string | null = null;

const HD_PATH = "m/44'/60'/0'/0/0";
const MAKALU_CHAIN_ID = 700777;
const DEFAULT_RPC_URLS = [
  'https://rpc.litho.ai',
  'https://rpc-2.litho.ai',
  'https://rpc-3.litho.ai',
];

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
  const hd = HDNodeWallet.fromMnemonic(m, HD_PATH);
  return provider ? (hd.connect(provider) as HDNodeWallet) : hd;
}

/* ─── Token registry (small subset — keep the worker bundle tiny) ───── */

// Mirror of apps/web/lib/tokens.ts — we only need the address + decimals here,
// not the icon / colour / price fields. Keep in sync manually.
const TOKEN_REGISTRY: Record<string, { address: string | null; decimals: number }> = {
  LITHO:  { address: null,                                          decimals: 18 },
  LitBTC: { address: '0xC4645CA5411D6E27556780AB4cdd0DF7e609df74', decimals: 18 },
  JOT:    { address: '0xEF2f35f6d0fb7DC9E87b8ca8252AE2E6ffb2a25e', decimals: 18 },
  LAX:    { address: '0x1Cde2Ca6c2ab8622003ebe06e382bC07850d4B8d', decimals: 18 },
  IMAGE:  { address: '0xAcD98E323968647936887aD4934e64B01060727e', decimals: 18 },
  FurGPT: { address: '0xDB829befCF8E582379E2c034FA2589b8D2EA1c5D', decimals: 18 },
};

const LEP100_TRANSFER_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
];

/* ─── RPC handlers ───────────────────────────────────────────────────── */

interface InitPayload  { source: WalletSource }
interface InitReply    { address: string }

interface SendPayload  { symbol: string; recipient: string; amount: string }
interface SendReply    { hash: string; symbol: string; to: string; value: string }

interface SignMsgPayload { message: string }    // utf-8 string OR 0x-prefixed hex
interface SignMsgReply   { signature: string }

async function handleInit(p: InitPayload): Promise<InitReply> {
  source = p.source;
  const signer = getSigner(false);
  cachedAddress = await signer.getAddress();
  return { address: cachedAddress };
}

async function handleSend(p: SendPayload): Promise<SendReply> {
  const token = TOKEN_REGISTRY[p.symbol];
  if (!token) throw new Error('invalid_token');
  const to = p.recipient.startsWith('0x') ? p.recipient : '';
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

/* ─── Message dispatch ───────────────────────────────────────────────── */

interface RpcRequest {
  id:      number;
  op:      'init' | 'send' | 'sign-message' | 'address' | 'lock';
  payload?: unknown;
}

self.addEventListener('message', async (ev: MessageEvent<RpcRequest>) => {
  const { id, op, payload } = ev.data;
  try {
    let result: unknown;
    switch (op) {
      case 'init':         result = await handleInit(payload as InitPayload); break;
      case 'send':         result = await handleSend(payload as SendPayload); break;
      case 'sign-message': result = await handleSignMessage(payload as SignMsgPayload); break;
      case 'address':      result = await handleAddress(); break;
      case 'lock':         result = handleLock(); break;
      default:             throw new Error(`unknown_op:${op as string}`);
    }
    (self as unknown as Worker).postMessage({ id, ok: true, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    (self as unknown as Worker).postMessage({ id, ok: false, error: message });
  }
});
