/**
 * Ledger sign + broadcast for the desktop Send flow.
 *
 * Uses @ledgerhq/hw-transport-webhid (renderer-side WebHID, unblocked by
 * the Ledger vendor allowlist in src/main/index.ts) + @ledgerhq/hw-app-eth
 * to sign an EIP-1559 transaction with the device, then broadcasts the
 * signed serialized hex through Makalu's FallbackProvider.
 *
 * The seed never participates in this path — the user's HD wallet stays
 * untouched and the broadcast is `from` the Ledger's own derived address.
 */
import { Transaction, getAddress, type Provider } from 'ethers';
import TransportWebHID from '@ledgerhq/hw-transport-webhid';
import Eth from '@ledgerhq/hw-app-eth';
import { getMakaluProvider } from '@thanos/sdk-core';

const HD_PATH = "44'/60'/0'/0/0"; // Ledger uses the path without leading m/

export interface LedgerConnection {
  address:   string;
  transport: Awaited<ReturnType<typeof TransportWebHID.create>>;
  close:     () => Promise<void>;
}

/** Open WebHID + derive the first EVM account from the connected Ledger. */
export async function connectLedger(): Promise<LedgerConnection> {
  const transport = await TransportWebHID.create();
  try {
    const eth = new Eth(transport);
    const { address } = await eth.getAddress(HD_PATH, /* display */ false);
    return {
      address: getAddress(address),
      transport,
      close: async () => { try { await transport.close(); } catch { /* best-effort */ } },
    };
  } catch (e) {
    try { await transport.close(); } catch { /* ignore */ }
    throw e;
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

  // Ledger signs the unsigned RLP (hex without 0x).
  const eth = new Eth(connection.transport);
  const unsignedHex = tx.unsignedSerialized.startsWith('0x')
    ? tx.unsignedSerialized.slice(2)
    : tx.unsignedSerialized;
  const sig = await eth.signTransaction(HD_PATH, unsignedHex, null);

  tx.signature = {
    r: '0x' + sig.r,
    s: '0x' + sig.s,
    v: parseInt(sig.v, 16),
  };

  const sent = await provider.broadcastTransaction(tx.serialized);
  return sent.hash;
}
