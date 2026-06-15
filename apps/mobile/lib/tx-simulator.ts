/**
 * Detached transaction simulator.
 *
 * Mobile is workspace-detached (EAS Cloud can't resolve @thanos/sdk-core
 * symlinks), so this is a local copy of sdk-core's security/simulator.ts —
 * trimmed to the EVM read-only path the wallet actually uses. Both call
 * sites (Send sheet, WalletConnect approval) simulate on Makalu (chainId
 * 700777), which is EVM-compatible, so the EVM checks apply directly.
 *
 * Read-only: never signs, never broadcasts. RPC calls are tolerant of
 * failure — a missing endpoint lowers fidelity but never crashes approval.
 */
import { JsonRpcProvider, FallbackProvider, formatUnits, parseUnits } from 'ethers';

export interface SimulationIssue {
  level:   'info' | 'warning' | 'critical';
  code:    string;
  message: string;
}
export interface SimulationReport {
  chainId:       number;
  summary:       string;
  estimatedFee?: string;
  issues:        SimulationIssue[];
}
export interface SendAssetRequest {
  chainId:       number;
  from?:         string;
  to:            string;
  amount:        string;
  tokenAddress?: string;
  tokenSymbol?:  string;
}

const MAKALU_RPC_URLS = ['https://rpc.litho.ai', 'https://rpc-2.litho.ai'];
const NETWORK_NAME:  Record<number, string> = { 700777: 'Lithosphere Makalu', 900523: 'Lithosphere Kamet' };
const NATIVE_SYMBOL: Record<number, string> = { 700777: 'LITHO', 900523: 'LITHO' };

function provider(): JsonRpcProvider | FallbackProvider {
  const providers = MAKALU_RPC_URLS.map((url, i) => ({
    provider:     new JsonRpcProvider(url, undefined, { staticNetwork: true }),
    priority:     i,
    weight:       1,
    stallTimeout: 2000,
  }));
  return providers.length > 1
    ? new FallbackProvider(providers)
    : (providers[0].provider as JsonRpcProvider);
}

export class TransactionSimulator {
  async simulateSend(request: SendAssetRequest): Promise<SimulationReport> {
    const p         = provider();
    const issues:   SimulationIssue[] = [];
    const netName   = NETWORK_NAME[request.chainId]  ?? `chain ${request.chainId}`;
    const nativeSym = NATIVE_SYMBOL[request.chainId] ?? '';

    // Fan out read-only RPC calls; each tolerates failure so one slow
    // endpoint doesn't hang the approval sheet.
    const [feeDataResult, codeResult, balanceResult] = await Promise.allSettled([
      p.getFeeData(),
      p.getCode(request.to),
      request.from ? p.getBalance(request.from) : Promise.resolve(null),
    ]);
    const feeData       = feeDataResult.status === 'fulfilled' ? feeDataResult.value : null;
    const recipientCode = codeResult.status    === 'fulfilled' ? codeResult.value    : '0x';
    const senderBalance = balanceResult.status === 'fulfilled' ? balanceResult.value : null;

    if (recipientCode && recipientCode !== '0x') {
      issues.push({
        level:   'warning',
        code:    'RECIPIENT_IS_CONTRACT',
        message: 'Recipient is a smart contract. If you meant to send to a person, double-check the address — funds sent to the wrong contract may not be recoverable.',
      });
    }

    if (senderBalance !== null && !request.tokenAddress) {
      try {
        const amountWei = parseUnits(request.amount || '0', 18);
        if (senderBalance < amountWei) {
          issues.push({
            level:   'critical',
            code:    'INSUFFICIENT_BALANCE',
            message: `Not enough balance — you have ${formatUnits(senderBalance, 18)} and are trying to send ${request.amount}.`,
          });
        }
      } catch { /* malformed amount — the UI handles input validation */ }
    }

    issues.push({
      level:   'info',
      code:    request.tokenAddress ? 'TOKEN_TRANSFER' : 'NATIVE_TRANSFER',
      message: request.tokenAddress
        ? `Token transfer on ${netName}.`
        : `Native ${nativeSym || 'token'} transfer on ${netName}.`,
    });

    const shortTo = `${request.to.slice(0, 6)}…${request.to.slice(-4)}`;
    const sym     = request.tokenSymbol ?? nativeSym;
    return {
      chainId:      request.chainId,
      summary:      `Send ${request.amount} ${sym} to ${shortTo}`,
      estimatedFee: feeData?.maxFeePerGas ? `${formatUnits(feeData.maxFeePerGas, 9)} gwei` : undefined,
      issues,
    };
  }
}
