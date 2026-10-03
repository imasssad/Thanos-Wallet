/**
 * Detached transaction simulator.
 *
 * Mobile is workspace-detached (EAS Cloud can't resolve @thanos/sdk-core
 * symlinks), so this is a local copy of sdk-core's security/simulator.ts —
 * trimmed to the EVM read-only path the wallet actually uses. Both call
 * sites (Send sheet, WalletConnect approval) simulate on the chain the
 * transaction is for — any network in the wallet's registry (built-in or
 * custom, lib/evm-external). A chain the wallet doesn't know throws, and the
 * caller shows no report rather than checking some other chain.
 *
 * Read-only: never signs, never broadcasts. RPC calls are tolerant of
 * failure — a missing endpoint lowers fidelity but never crashes approval.
 */
import { Interface, formatUnits, parseUnits } from 'ethers';
import { getExtEvmChain, getExtEvmProvider } from './evm-external';

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
  /** Calldata sent with a native transfer (Settings → Show hex data). */
  data?: string;
}

export class TransactionSimulator {
  async simulateSend(request: SendAssetRequest): Promise<SimulationReport> {
    const chain = getExtEvmChain(request.chainId);
    if (!chain) throw new Error(`Unknown network ${request.chainId}`);
    const p         = getExtEvmProvider(chain.chainId);
    const issues:   SimulationIssue[] = [];
    const netName   = chain.chainId === 9005 ? 'Lithosphere Mainnet' : chain.name;
    const nativeSym = chain.nativeSymbol;

    const isToken  = !!request.tokenAddress;
    const data     = !isToken && request.data && request.data !== '0x' ? request.data : undefined;
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
            : { from: request.from, to: request.to, value: amountUnits, ...(data ? { data } : {}) })
        : Promise.resolve(null),
    ]);
    const feeData       = feeDataResult.status === 'fulfilled' ? feeDataResult.value : null;
    const recipientCode = codeResult.status    === 'fulfilled' ? codeResult.value    : '0x';
    const senderBalance = balanceResult.status === 'fulfilled' ? balanceResult.value : null;

    let tokenBalance: bigint | null = null;
    if (tokenBalResult.status === 'fulfilled' && typeof tokenBalResult.value === 'string' && tokenBalResult.value.length > 2) {
      try { tokenBalance = BigInt(tokenBalResult.value); } catch { /* non-numeric eth_call result */ }
    }

    const estimatedGas = gasResult.status === 'fulfilled' ? gasResult.value : null;
    const gasEstimated = estimatedGas != null;
    // Without an estimate: 21k base plus calldata at 16 gas per byte, the
    // non-zero-byte price (zero bytes cost 4, so this never undershoots).
    const gasLimit = estimatedGas != null
      ? BigInt(estimatedGas.toString())
      : (isToken ? 65_000n : 21_000n + (data ? BigInt((data.length - 2) / 2) * 16n : 0n));
    const gasPrice = feeData?.maxFeePerGas ?? feeData?.gasPrice ?? null;
    const feeWei   = gasPrice != null ? gasLimit * BigInt(gasPrice.toString()) : null;

    if (data && request.from && amountUnits !== null && !gasEstimated) {
      issues.push({
        level:   'warning',
        code:    'CALL_MAY_FAIL',
        message: `The network couldn't estimate gas for this hex data — the transaction will probably fail on ${netName}. Check the data and the recipient.`,
      });
    }

    // Sending hex data to a contract is the point of it, so no warning then.
    if (!data && recipientCode && recipientCode !== '0x') {
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
