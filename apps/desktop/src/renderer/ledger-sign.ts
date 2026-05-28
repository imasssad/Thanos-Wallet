/**
 * Ledger sign + broadcast for the desktop Send flow.
 *
 * Primary transport: @ledgerhq/hw-transport-webhid (renderer-side
 * WebHID, unblocked by the Ledger vendor allowlist in
 * src/main/index.ts) + @ledgerhq/hw-app-eth to sign an EIP-1559
 * transaction, then broadcast through Makalu's FallbackProvider.
 *
 * Fallback transport: if WebHID isn't available (typically Linux
 * configurations where the browser-side WebHID API is disabled), the
 * renderer routes signing through the main-process native-HID bridge
 * — see src/main/ledger-hid-bridge.ts and the `ledgerNative.*`
 * surface in src/main/preload.ts. The renderer never touches node-hid
 * directly; everything crosses IPC.
 *
 * The seed never participates in either path — the user's HD wallet
 * stays untouched and the broadcast is `from` the Ledger's own
 * derived address.
 */
import { Transaction, getAddress, type Provider } from 'ethers';
import TransportWebHID from '@ledgerhq/hw-transport-webhid';
import Eth from '@ledgerhq/hw-app-eth';
import { getMakaluProvider } from '@thanos/sdk-core';

const HD_PATH = "44'/60'/0'/0/0"; // Ledger uses the path without leading m/

/** Discriminated union — the WebHID path keeps a live transport handle
 *  in the renderer; the native-HID path keeps everything in the main
 *  process and the renderer only holds the derived address + a tag. */
export type LedgerConnection =
  | {
      kind:      'webhid';
      address:   string;
      transport: Awaited<ReturnType<typeof TransportWebHID.create>>;
      close:     () => Promise<void>;
    }
  | {
      kind:    'native';
      address: string;
      close:   () => Promise<void>;
    };

/** Try WebHID; on failure, fall back to the main-process native-HID
 *  bridge if the optional dep is installed. Throws a clear error when
 *  neither path is available so the UI can prompt for next steps. */
export async function connectLedger(): Promise<LedgerConnection> {
  // 1. Try WebHID — primary path, works on Electron's Chromium on
  //    macOS and Windows. The Ledger vendor allowlist in
  //    src/main/index.ts permits enumeration.
  try {
    const transport = await TransportWebHID.create();
    try {
      const eth = new Eth(transport);
      const { address } = await eth.getAddress(HD_PATH, /* display */ false);
      return {
        kind: 'webhid',
        address: getAddress(address),
        transport,
        close: async () => { try { await transport.close(); } catch { /* best-effort */ } },
      };
    } catch (e) {
      try { await transport.close(); } catch { /* ignore */ }
      throw e;
    }
  } catch (webhidErr) {
    // 2. WebHID failed — try the native-HID bridge over IPC. Available
    //    when the optional @ledgerhq/hw-transport-node-hid-noevents dep
    //    is installed in the main process.
    const native = window.thanosDesktop?.ledgerNative;
    if (native) {
      try {
        const available = await native.available();
        if (available) {
          const addr = await native.getAddress(HD_PATH);
          return {
            kind: 'native',
            address: getAddress(addr),
            // Native transport is process-scoped (closed on app quit
            // via ledgerHid.dispose() in main/index.ts), so there's
            // nothing to release per-connection here.
            close: async () => { /* no-op */ },
          };
        }
      } catch {
        // fall through to the combined error below
      }
    }
    // Neither WebHID nor the native bridge worked — surface a useful
    // message rather than the raw WebHID error.
    const msg = (webhidErr as Error)?.message || 'WebHID unavailable';
    throw new Error(
      `Ledger transport unavailable: ${msg}. ` +
      `Install @ledgerhq/hw-transport-node-hid-noevents and restart for ` +
      `native-HID fallback (Linux), or enable WebHID in your browser/OS.`,
    );
  }
}

export interface LedgerSendParams {
  /** Resolved 0x recipient. For LEP100 sends this is the contract address; the
   *  real recipient is encoded into `data`. */
  to:    string;
  /** Native-coin value (wei). 0n for LEP100 transfers. */
  value: bigint;
  /** Calldata for contract calls; '0x' for plain native transfers. */
  data?: string;
}

/**
 * Build → sign → broadcast a transaction with the Ledger device. Returns
 * the broadcast tx hash. The caller is responsible for having opened the
 * Ethereum app on the device.
 */
export async function sendViaLedger(
  connection: LedgerConnection,
  params: LedgerSendParams,
): Promise<string> {
  const provider: Provider = getMakaluProvider();
  const from = connection.address;

  // Populate the unsigned tx from chain state. estimateGas needs `from`
  // so contract reverts surface here instead of inside the device.
  const [nonce, feeData, network, gasLimit] = await Promise.all([
    provider.getTransactionCount(from),
    provider.getFeeData(),
    provider.getNetwork(),
    provider.estimateGas({ from, to: params.to, value: params.value, data: params.data ?? '0x' }),
  ]);

  if (feeData.maxFeePerGas == null || feeData.maxPriorityFeePerGas == null) {
    throw new Error('Makalu RPC did not return EIP-1559 fee data');
  }

  const tx = Transaction.from({
    type:                 2,
    chainId:              network.chainId,
    nonce,
    to:                   params.to,
    value:                params.value,
    data:                 params.data ?? '0x',
    gasLimit,
    maxFeePerGas:         feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  });

  // Ledger signs the unsigned RLP (hex without 0x). Branch on transport
  // kind — WebHID uses the renderer-side Eth() wrapper; native-HID goes
  // through the main-process IPC bridge.
  const unsignedHex = tx.unsignedSerialized.startsWith('0x')
    ? tx.unsignedSerialized.slice(2)
    : tx.unsignedSerialized;
  let sig: { v: string; r: string; s: string };
  if (connection.kind === 'webhid') {
    const eth = new Eth(connection.transport);
    sig = await eth.signTransaction(HD_PATH, unsignedHex, null);
  } else {
    const native = window.thanosDesktop?.ledgerNative;
    if (!native) throw new Error('native Ledger bridge missing from preload');
    sig = await native.signEvmTx(HD_PATH, unsignedHex);
  }

  tx.signature = {
    r: '0x' + sig.r,
    s: '0x' + sig.s,
    v: parseInt(sig.v, 16),
  };

  // Sanity check: the signed tx must recover to the same address the user
  // saw + confirmed. If the device returned a signature for a different
  // account (malware on the host swapped the HD path? hardware fault?
  // signature corruption?), refuse to broadcast — the funds would leave
  // an account the user didn't authorise.
  const recovered = tx.from;
  if (!recovered || recovered.toLowerCase() !== from.toLowerCase()) {
    throw new Error(
      `Hardware-wallet address mismatch: signature recovered to ${recovered ?? 'null'}, expected ${from}. Refusing to broadcast.`,
    );
  }

  const sent = await provider.broadcastTransaction(tx.serialized);
  return sent.hash;
}
