/**
 * Trezor sign + broadcast for the desktop Send flow.
 *
 * Uses @trezor/connect-web in the renderer — Trezor Connect runs through
 * a hidden iframe to connect.trezor.io, so no native USB transport in
 * the main process is needed. The Electron main allow-listed Trezor's
 * USB vendor IDs (0x534c / 0x1209) so the device picker resolves; the
 * heavy lifting is the Connect popup window which Chromium handles.
 *
 * The seed never participates in this path — Trezor signs on-device and
 * returns {v, r, s}; we attach the signature to an unsigned EIP-1559
 * transaction and broadcast through Makalu's FallbackProvider.
 */
import { Transaction, getAddress, toBeHex, type Provider } from 'ethers';
import TrezorConnect from '@trezor/connect-web';
import { getMakaluProvider } from '@thanos/sdk-core';

const HD_PATH_STR    = "m/44'/60'/0'/0/0";
const HD_PATH_ARRAY  = [44 | 0x80000000, 60 | 0x80000000, 0 | 0x80000000, 0, 0];

let initialised = false;
async function ensureInit(): Promise<void> {
  if (initialised) return;
  await TrezorConnect.init({
    lazyLoad:    true,
    manifest: {
      appName: 'Thanos Wallet',
      email:   'support@thanos.fi',
      appUrl:  'https://thanos.fi',
    },
  });
  initialised = true;
}

export interface TrezorConnection {
  address: string;
  close:   () => Promise<void>;
}

/** Open Trezor Connect + derive the first EVM account. */
export async function connectTrezor(): Promise<TrezorConnection> {
  await ensureInit();
  const res = await TrezorConnect.ethereumGetAddress({
    path:        HD_PATH_STR,
    showOnTrezor: true,
  });
  if (!res.success) throw new Error(res.payload?.error || 'Trezor returned an error');
  return {
    address: getAddress(res.payload.address),
    // TrezorConnect manages its own iframe lifecycle; nothing to close
    // per-connection. We expose close() to match LedgerConnection so the
    // Send flow can treat both uniformly.
    close: async () => { /* iframe stays mounted for the session */ },
  };
}

export interface TrezorSendParams {
  /** Contract address for LEP100, recipient for native sends. */
  to:    string;
  /** Native value (wei). 0n for LEP100 transfers. */
  value: bigint;
  /** Calldata for contract calls; '0x' for plain native transfers. */
  data?: string;
}

/** Build → sign-on-device → broadcast. Returns the tx hash. */
export async function sendViaTrezor(
  connection: TrezorConnection,
  params: TrezorSendParams,
): Promise<string> {
  await ensureInit();
  const provider: Provider = getMakaluProvider();
  const from = connection.address;

  const [nonce, feeData, network, gasLimit] = await Promise.all([
    provider.getTransactionCount(from),
    provider.getFeeData(),
    provider.getNetwork(),
    provider.estimateGas({ from, to: params.to, value: params.value, data: params.data ?? '0x' }),
  ]);
  if (feeData.maxFeePerGas == null || feeData.maxPriorityFeePerGas == null) {
    throw new Error('Makalu RPC did not return EIP-1559 fee data');
  }

  const chainId = Number(network.chainId);

  // TrezorConnect signs EIP-1559 transactions when the tx has
  // maxFeePerGas + maxPriorityFeePerGas (type 2). All numeric fields
  // must be hex strings (no leading zeros, no decimals).
  const signed = await TrezorConnect.ethereumSignTransaction({
    path: HD_PATH_STR,
    transaction: {
      to:                   params.to,
      value:                toBeHex(params.value),
      data:                 params.data ?? '0x',
      chainId,
      nonce:                toBeHex(nonce),
      gasLimit:             toBeHex(gasLimit),
      maxFeePerGas:         toBeHex(feeData.maxFeePerGas),
      maxPriorityFeePerGas: toBeHex(feeData.maxPriorityFeePerGas),
    },
  });
  if (!signed.success) throw new Error(signed.payload?.error || 'Trezor signing failed');

  // Apply the device signature to a Transaction object so ethers can
  // serialize it for broadcast.
  const tx = Transaction.from({
    type:                 2,
    chainId,
    nonce,
    to:                   params.to,
    value:                params.value,
    data:                 params.data ?? '0x',
    gasLimit,
    maxFeePerGas:         feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  });
  tx.signature = {
    r: signed.payload.r.startsWith('0x') ? signed.payload.r : '0x' + signed.payload.r,
    s: signed.payload.s.startsWith('0x') ? signed.payload.s : '0x' + signed.payload.s,
    v: parseInt(signed.payload.v, 16),
  };

  // Sanity check: signature must recover to the same address the user
  // confirmed on the device. A mismatch means something between the
  // popup and the device tampered with the path or the signature —
  // refuse to broadcast.
  const recovered = tx.from;
  if (!recovered || recovered.toLowerCase() !== from.toLowerCase()) {
    throw new Error(
      `Hardware-wallet address mismatch: signature recovered to ${recovered ?? 'null'}, expected ${from}. Refusing to broadcast.`,
    );
  }

  const sent = await provider.broadcastTransaction(tx.serialized);
  return sent.hash;
}
