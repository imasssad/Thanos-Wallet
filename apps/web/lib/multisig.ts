'use client';
/**
 * Thanos MultiSig on the web: the network it runs on and the bridge to this app's signer.
 *
 * By default Lithosphere Mainnet with the Litho Vault deployment published in @litho-vault/sdk;
 * NEXT_PUBLIC_MULTISIG_* point a build at a testnet or a local chain. Each value is written out
 * as process.env.NEXT_PUBLIC_… so Next inlines it at build time.
 */
import { JsonRpcProvider, Wallet as EthersWallet } from 'ethers';
import { multisigNetwork, type MultisigNetwork, type WalletBridge } from '@thanos/multisig';
import { browserRpcUrl } from './evm-chains';
import { getSignerAddress, signerSignTransaction, signerSignTypedData, SignerError } from './signer-client';
import { walletFromSeed } from './signer';

let cached: MultisigNetwork | null = null;

export function webMultisigNetwork(): MultisigNetwork {
  if (cached) return cached;
  cached = multisigNetwork(
    {
      CHAIN_ID:       process.env.NEXT_PUBLIC_MULTISIG_CHAIN_ID,
      CHAIN_NAME:     process.env.NEXT_PUBLIC_MULTISIG_CHAIN_NAME,
      RPC_URL:        process.env.NEXT_PUBLIC_MULTISIG_RPC_URL,
      EXPLORER_URL:   process.env.NEXT_PUBLIC_MULTISIG_EXPLORER_URL,
      FACTORY:        process.env.NEXT_PUBLIC_MULTISIG_FACTORY,
      LENS:           process.env.NEXT_PUBLIC_MULTISIG_LENS,
      AI_GUARD:       process.env.NEXT_PUBLIC_MULTISIG_AI_GUARD,
      RECOVERY_GUARD: process.env.NEXT_PUBLIC_MULTISIG_RECOVERY_GUARD,
      FREEZE_GUARD:   process.env.NEXT_PUBLIC_MULTISIG_FREEZE_GUARD,
      IMPLEMENTATION: process.env.NEXT_PUBLIC_MULTISIG_IMPLEMENTATION,
      DEPLOY_BLOCK:   process.env.NEXT_PUBLIC_MULTISIG_DEPLOY_BLOCK,
      INDEXER_URL:    process.env.NEXT_PUBLIC_MULTISIG_INDEXER_URL,
      APP_URL:        process.env.NEXT_PUBLIC_MULTISIG_APP_URL,
    },
    // Reads go through the same-origin proxy for RPCs that send no CORS headers.
    { browserRpcUrl },
  );
  return cached;
}

/** The signing worker when it is running, else an in-process wallet (as WalletConnect does). */
async function withWorker<T>(viaWorker: () => Promise<T>, inProcess: () => Promise<T>): Promise<T> {
  try {
    return await viaWorker();
  } catch (e) {
    const code = e instanceof SignerError ? e.code : '';
    if (code === 'worker_locked' || code === 'worker_crashed') return inProcess();
    throw e;
  }
}

/**
 * A bridge to the unlocked wallet's active account. The MultiSig screens show the full review
 * before any of these run, so they sign directly, like Send after its confirmation step.
 */
export function webMultisigBridge(wallet: { evmAddress: string; seed: string[]; privateKey?: string; accountName?: string }): WalletBridge {
  const expected = wallet.evmAddress.toLowerCase();
  const inProcess = (rpcUrl?: string, chainId?: number) => {
    const provider = rpcUrl ? new JsonRpcProvider(browserRpcUrl(rpcUrl), chainId, { staticNetwork: true }) : undefined;
    const w = wallet.privateKey ? new EthersWallet(wallet.privateKey, provider) : walletFromSeed(wallet.seed, provider);
    if (w.address.toLowerCase() !== expected) throw new Error('The active account changed. Go back and try again.');
    return w;
  };
  // The worker derives the active account too; never sign with a different one than shown.
  const checkWorker = async () => {
    const { address } = await getSignerAddress();
    if (address.toLowerCase() !== expected) throw new Error('The active account changed. Go back and try again.');
  };
  return {
    address: wallet.evmAddress,
    accountName: wallet.accountName,
    canSign: wallet.seed.length > 0 || !!wallet.privateKey,
    cannotSignReason: 'Unlock your wallet to act on multisigs',
    sendTransaction: (tx) =>
      withWorker(
        async () => {
          await checkWorker();
          return (await signerSignTransaction({ chainId: tx.chainId, rpcUrl: tx.rpcUrl, to: tx.to, data: tx.data, value: tx.value.toString(), gasLimit: tx.gasLimit.toString() })).hash;
        },
        async () => (await inProcess(tx.rpcUrl, tx.chainId).sendTransaction({ to: tx.to, data: tx.data, value: tx.value, gasLimit: tx.gasLimit, chainId: BigInt(tx.chainId) })).hash,
      ),
    signTypedData: ({ domain, types, message }) =>
      withWorker(
        async () => {
          await checkWorker();
          return (await signerSignTypedData({ domain: domain as Record<string, unknown>, types, message })).signature;
        },
        () => inProcess().signTypedData(domain, types, message),
      ),
  };
}
