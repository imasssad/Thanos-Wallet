/**
 * Ledger hardware wallet — EVM signing via WebUSB.
 *
 * The user plugs in a Ledger Nano / Stax / Flex, unlocks it, opens the
 * Ethereum app, and we talk to it through @ledgerhq/hw-transport-webusb.
 *
 * Browser support: Chrome/Edge/Brave (WebUSB). Firefox + Safari don't have
 * it — those users have to use the desktop app build (Electron has full USB).
 *
 * This module does NOT touch the unlocked mnemonic vault — Ledger flows are
 * an alternative signing path. The wallet remembers the Ledger account
 * separately so users can mix derivations later.
 */

import { ethers } from 'ethers';

const DEFAULT_DERIVATION_PATH = "44'/60'/0'/0/0";

/* ─── Types ────────────────────────────────────────────────────────────── */

export interface LedgerAccount {
  /** EIP-55 checksummed address. */
  address:     string;
  /** Path used to derive (so we can sign with the same path later). */
  path:        string;
  /** Public key hex, useful for some chains but stored in case we need it. */
  publicKey:   string;
}

export class LedgerError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/* ─── Transport singleton ─────────────────────────────────────────────── */

/* Generic Transport type — the WebUSB subclass extends this. We hold the
   base type here because TransportWebUSB.create() is statically typed to
   return Transport, not the subclass instance. */
type GenericTransport = import('@ledgerhq/hw-transport').default;
let _transport: GenericTransport | null = null;
let _appEth:    import('@ledgerhq/hw-app-eth').default | null = null;

async function open(): Promise<{ transport: GenericTransport; eth: NonNullable<typeof _appEth> }> {
  if (typeof navigator === 'undefined' || !('usb' in navigator)) {
    throw new LedgerError('webusb_unsupported', 'WebUSB is not available in this browser. Use Chrome / Edge / Brave, or open the desktop app.');
  }

  if (_transport && _appEth) return { transport: _transport, eth: _appEth };

  try {
    const TransportWebUSB = (await import('@ledgerhq/hw-transport-webusb')).default;
    const AppEth          = (await import('@ledgerhq/hw-app-eth')).default;
    _transport = await TransportWebUSB.create();
    _appEth    = new AppEth(_transport);
    return { transport: _transport, eth: _appEth };
  } catch (e) {
    const msg = (e as Error).message || '';
    if (/no device selected/i.test(msg)) throw new LedgerError('no_device', 'No Ledger selected');
    throw new LedgerError('connect_failed', msg || 'Could not connect to Ledger');
  }
}

export async function disconnect(): Promise<void> {
  if (_transport) { try { await _transport.close(); } catch {} }
  _transport = null;
  _appEth    = null;
}

/* ─── Account discovery ────────────────────────────────────────────────── */

export async function getAccount(path = DEFAULT_DERIVATION_PATH): Promise<LedgerAccount> {
  const { eth } = await open();
  try {
    const { address, publicKey } = await eth.getAddress(path, false /* no on-device prompt */);
    return { address: ethers.getAddress(address), path, publicKey };
  } catch (e) {
    const msg = (e as Error).message || '';
    if (/locked/i.test(msg)) throw new LedgerError('locked', 'Unlock your Ledger and open the Ethereum app');
    if (/not open/i.test(msg)) throw new LedgerError('app_closed', 'Open the Ethereum app on your Ledger');
    throw new LedgerError('rpc_error', msg || 'Failed to read account');
  }
}

/** Discover the first N accounts under m/44'/60'/0'/0/i. Useful for an
 *  "import account" picker. */
export async function discoverAccounts(count = 5): Promise<LedgerAccount[]> {
  const out: LedgerAccount[] = [];
  for (let i = 0; i < count; i++) {
    out.push(await getAccount(`44'/60'/0'/0/${i}`));
  }
  return out;
}

/* ─── Signing ──────────────────────────────────────────────────────────── */

/** Sign a serialized unsigned tx (RLP hex, no 0x prefix). Returns the v/r/s
 *  components — the caller assembles the signed tx via ethers. */
export async function signTransaction(
  serializedUnsignedTxHex: string,
  path = DEFAULT_DERIVATION_PATH,
): Promise<{ v: string; r: string; s: string }> {
  const { eth } = await open();
  try {
    const result = await eth.signTransaction(path, serializedUnsignedTxHex.replace(/^0x/, ''));
    return result;
  } catch (e) {
    const msg = (e as Error).message || '';
    if (/denied|rejected|0x6985/i.test(msg)) throw new LedgerError('rejected', 'You rejected the transaction on the Ledger');
    throw new LedgerError('rpc_error', msg || 'Failed to sign');
  }
}

/** Build, sign, and broadcast an EVM tx via Ledger. */
export async function signAndBroadcastTx(args: {
  provider: ethers.JsonRpcProvider;
  from:     string;
  to:       string;
  value:    bigint;
  data?:    string;
  path?:    string;
}): Promise<string> {
  const path = args.path ?? DEFAULT_DERIVATION_PATH;

  // Pull nonce + fee data + chainId off the provider.
  const [nonce, feeData, network] = await Promise.all([
    args.provider.getTransactionCount(args.from),
    args.provider.getFeeData(),
    args.provider.getNetwork(),
  ]);

  const maxFeePerGas         = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 1_500_000_000n;
  const gasLimit = await args.provider.estimateGas({
    from: args.from, to: args.to, value: args.value, data: args.data,
  });

  // Serialize without signature → ask Ledger to sign → reassemble.
  const tx = ethers.Transaction.from({
    type:                 2, // EIP-1559
    chainId:              network.chainId,
    to:                   args.to,
    value:                args.value,
    data:                 args.data,
    nonce,
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });
  const unsignedSerialized = tx.unsignedSerialized;
  const sig = await signTransaction(unsignedSerialized, path);

  tx.signature = {
    v: parseInt(sig.v, 16),
    r: '0x' + sig.r,
    s: '0x' + sig.s,
  };

  // Broadcast.
  const response = await args.provider.broadcastTransaction(tx.serialized);
  return response.hash;
}

/** Sign an EIP-191 personal message. */
export async function signPersonalMessage(message: string, path = DEFAULT_DERIVATION_PATH): Promise<string> {
  const { eth } = await open();
  try {
    const bytes = ethers.hexlify(ethers.toUtf8Bytes(message)).slice(2);
    const sig = await eth.signPersonalMessage(path, bytes);
    return '0x' + sig.r + sig.s + sig.v.toString(16).padStart(2, '0');
  } catch (e) {
    const msg = (e as Error).message || '';
    if (/denied|rejected|0x6985/i.test(msg)) throw new LedgerError('rejected', 'You rejected the signature on the Ledger');
    throw new LedgerError('rpc_error', msg || 'Failed to sign message');
  }
}
