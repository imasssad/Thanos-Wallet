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
import { Interface, JsonRpcProvider, FallbackProvider, formatUnits, parseUnits } from 'ethers';

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
  chainId:        number;
  from?:          string;
  to:             string;
  amount:         string;
  tokenAddress?:  string;
  tokenSymbol?:   string;
  /** LEP100/ERC-20 decimals — lets the simulator parse the human amount
   *  without an extra decimals() RPC. */
  tokenDecimals?: number;
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

    const isToken  = !!request.tokenAddress;
    const tokenDec = request.tokenDecimals ?? 18;
    const sendSym  = request.tokenSymbol ?? nativeSym;

    // Parse the human amount up front: native transfers are 18 decimals;
    // token transfers use the token's own decimals.
    let amountUnits: bigint | null = null;
    try { amountUnits = parseUnits(request.amount || '0', isToken ? tokenDec : 18); }
    catch { /* malformed amount — the UI handles input validation */ }

    const erc20 = new Interface([
      'function transfer(address to, uint256 amount) returns (bool)',
      'function balanceOf(address owner) view returns (uint256)',
    ]);

    // Fan out read-only RPC calls; each tolerates failure so one slow
    // endpoint doesn't hang the approval sheet. estimateGas rejects when
    // the transfer would revert — fallback constants keep the fee check alive.
    const [feeDataResult, codeResult, balanceResult, tokenBalResult, gasResult] = await Promise.allSettled([
      p.getFeeData(),
      p.getCode(request.to),
      request.from ? p.getBalance(request.from) : Promise.resolve(null),
      isToken && request.from
        ? p.call({ to: request.tokenAddress!, data: erc20.encodeFunctionData('balanceOf', [request.from]) })
        : Promise.resolve(null),
      request.from && amountUnits !== null
        ? p.estimateGas(isToken
            ? { from: request.from, to: request.tokenAddress!,
                data: erc20.encodeFunctionData('transfer', [request.to, amountUnits]) }
            : { from: request.from, to: request.to, value: amountUnits })
        : Promise.resolve(null),
    ]);
    const feeData       = feeDataResult.status === 'fulfilled' ? feeDataResult.value : null;
    const recipientCode = codeResult.status    === 'fulfilled' ? codeResult.value    : '0x';
    const senderBalance = balanceResult.status === 'fulfilled' ? balanceResult.value : null;

    let tokenBalance: bigint | null = null;
    if (tokenBalResult.status === 'fulfilled' && typeof tokenBalResult.value === 'string' && tokenBalResult.value.length > 2) {
      try { tokenBalance = BigInt(tokenBalResult.value); } catch { /* non-numeric eth_call result */ }
    }

    const gasLimit = gasResult.status === 'fulfilled' && gasResult.value != null
      ? BigInt(gasResult.value.toString())
      : (isToken ? 65_000n : 21_000n);
    const gasPrice = feeData?.maxFeePerGas ?? feeData?.gasPrice ?? null;
    const feeWei   = gasPrice != null ? gasLimit * BigInt(gasPrice.toString()) : null;

    if (recipientCode && recipientCode !== '0x') {
      issues.push({
        level:   'warning',
        code:    'RECIPIENT_IS_CONTRACT',
        message: 'Recipient is a smart contract. If you meant to send to a person, double-check the address — funds sent to the wrong contract may not be recoverable.',
      });
    }

    if (isToken) {
      // Token send: amount vs TOKEN balance, gas vs NATIVE balance — two
      // independent checks with distinct messages (mirrors sdk-core).
      if (tokenBalance !== null && amountUnits !== null && tokenBalance < amountUnits) {
        issues.push({
          level:   'critical',
          code:    'INSUFFICIENT_TOKEN_BALANCE',
          message: `Not enough ${sendSym} — you have ${formatUnits(tokenBalance, tokenDec)} ${sendSym} and are trying to send ${request.amount}.`,
        });
      }
      if (senderBalance !== null && feeWei !== null && senderBalance < feeWei) {
        issues.push({
          level:   'critical',
          code:    'INSUFFICIENT_GAS',
          message: `You don't have enough ${nativeSym || 'LITHO'} to cover network fees on ${netName} — ${sendSym} transfers are paid for in ${nativeSym || 'LITHO'}. Deposit or buy ${nativeSym || 'LITHO'}, then try again.`,
        });
      }
    } else if (senderBalance !== null && amountUnits !== null) {
      // Native send: balance must cover amount + network fee.
      const required = amountUnits + (feeWei ?? 0n);
      if (senderBalance < required) {
        issues.push({
          level:   'critical',
          code:    'INSUFFICIENT_BALANCE',
          message: feeWei !== null && senderBalance >= amountUnits
            ? `You don't have enough ${nativeSym || 'LITHO'} to cover the amount plus network fees on ${netName}. Reduce the amount or deposit more ${nativeSym || 'LITHO'}.`
            : `Not enough ${nativeSym || 'LITHO'} — you have ${formatUnits(senderBalance, 18)} ${nativeSym} and are trying to send ${request.amount}.`,
        });
      }
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
