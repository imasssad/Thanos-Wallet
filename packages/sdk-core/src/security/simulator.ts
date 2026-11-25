import { Interface, formatUnits, parseUnits } from 'ethers';
import { getNetworkByChainId } from '../chains/networks';
import type {
  LithicCallRequest, SendAssetRequest, SimulationIssue, SimulationReport,
} from '../types';
import { EvmClient } from '../clients/evm-client';
import { LithicClient } from '../clients/lithic-client';

/**
 * Pre-transaction simulator. Surfaces enough information for an approval
 * UI to show the user "what will actually happen if I sign this" — gas
 * estimate, balance check, contract-recipient warning — *before* the
 * private key ever signs. Every approval surface (Send modal, EIP-1193
 * popup, WalletConnect signing sheet) should call this and render the
 * resulting `SimulationReport`.
 *
 * The simulator never signs and never broadcasts. RPC calls are
 * read-only (`eth_call`, `eth_getCode`, `eth_getBalance`, `eth_feeData`)
 * and tolerant of failures — a missing RPC reduces fidelity but doesn't
 * crash the approval flow.
 */
export class TransactionSimulator {
  constructor(
    private readonly evm    = new EvmClient(),
    private readonly lithic = new LithicClient(),
  ) {}

  async simulateSend(request: SendAssetRequest): Promise<SimulationReport> {
    const network = getNetworkByChainId(request.chainId);
    if (network.kind === 'lithic') {
      // Lithic chains route via the native RPC simulator (lithic_simulateContract).
      return this.lithic.simulateContract({
        chainId:  request.chainId,
        contract: 'system.transfer',
        method:   'transfer',
        args:     [request.to, request.amount],
      });
    }

    const provider = this.evm.getProvider(request.chainId);
    const issues:  SimulationIssue[] = [];

    const nativeSym = network.nativeCurrency?.symbol || 'the native coin';
    const isToken   = !!request.tokenAddress;
    const tokenDec  = request.tokenDecimals ?? 18;
    const sendSym   = request.tokenSymbol ?? nativeSym;
    // O-03: a dApp's eth_sendTransaction can carry a contract call dressed
    // up as a plain transfer — without this, estimateGas below ran against
    // {to, value} alone, silently treating any calldata-bearing call as a
    // bare native send. Native sends only: a token send builds its own data.
    const data = !isToken && request.data && request.data !== '0x' ? request.data : undefined;

    // Parse the human amount up front: native transfers are 18 decimals;
    // ERC-20 transfers use the token's own decimals (BSC-peg USDT is 18,
    // most other USDT/USDC deployments are 6).
    let amountUnits: bigint | null = null;
    try { amountUnits = parseUnits(request.amount || '0', isToken ? tokenDec : 18); }
    catch { /* malformed amount — the UI's own input validation handles it */ }

    // ERC-20 iface for the token-balance read and a realistic gas estimate
    // of the actual transfer() call.
    const erc20 = new Interface([
      'function transfer(address to, uint256 amount) returns (bool)',
      'function balanceOf(address owner) view returns (uint256)',
    ]);

    // Fan out the read-only RPC calls. Each is wrapped so a single slow or
    // missing endpoint (or a provider without the method) reduces fidelity
    // instead of hanging or crashing the approval sheet. estimateGas
    // rejects when the transfer would revert (e.g. not enough balance) —
    // the gas fallback constants below keep the fee check alive.
    const [feeDataResult, codeResult, balanceResult, tokenBalResult, gasResult] = await Promise.allSettled([
      Promise.resolve().then(() => provider.getFeeData()),
      Promise.resolve().then(() => provider.getCode(request.to)),
      request.from
        ? Promise.resolve().then(() => provider.getBalance(request.from!))
        : Promise.resolve(null),
      isToken && request.from
        ? Promise.resolve().then(() => provider.call({
            to:   request.tokenAddress!,
            data: erc20.encodeFunctionData('balanceOf', [request.from!]),
          }))
        : Promise.resolve(null),
      request.from && amountUnits !== null
        ? Promise.resolve().then(() => provider.estimateGas(isToken
            ? { from: request.from!, to: request.tokenAddress!,
                data: erc20.encodeFunctionData('transfer', [request.to, amountUnits!]) }
            : { from: request.from!, to: request.to, value: amountUnits!, ...(data ? { data } : {}) }))
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
    // Network fee ≈ gasLimit × maxFeePerGas. When estimateGas failed (dead
    // RPC, or the call itself would revert) fall back to standard limits —
    // 21k base plus calldata at 16 gas/non-zero-byte (never undershoots) —
    // so the gas-sufficiency check still runs.
    const gasLimit = gasEstimated
      ? BigInt(estimatedGas!.toString())
      : (isToken ? 65_000n : 21_000n + (data ? BigInt((data.length - 2) / 2) * 16n : 0n));
    const gasPrice = feeData?.maxFeePerGas ?? feeData?.gasPrice ?? null;
    const feeWei   = gasPrice != null ? gasLimit * BigInt(gasPrice.toString()) : null;

    // O-03: estimateGas rejects when a contract call would revert — the one
    // signal available without decoding the call. Surfaced only when there
    // IS calldata to blame (a plain native send's estimate failing means
    // something else, like insufficient balance, caught below instead).
    if (data && request.from && amountUnits !== null && !gasEstimated) {
      issues.push({
        level:   'warning',
        code:    'CALL_MAY_FAIL',
        message: `The network couldn't estimate gas for this transaction's data — it will probably fail on ${network.name}. Check the data and the recipient.`,
      });
    }

    // Recipient is a contract → warn. Sending native to a contract that
    // doesn't implement `receive()` will revert and burn gas; sending to a
    // proxy or DEX router can be intentional but the user should know. Not
    // when calldata is present — calling the contract IS the point then,
    // and CALL_MAY_FAIL above already covers the "will this revert" signal.
    if (!data && recipientCode && recipientCode !== '0x') {
      issues.push({
        level:   'warning',
        code:    'RECIPIENT_IS_CONTRACT',
        message: 'Recipient is a smart contract. If you meant to send to a person, double-check the address — funds sent to the wrong contract may not be recoverable.',
      });
    }

    if (isToken) {
      // Token send: (1) amount vs the TOKEN balance, (2) gas vs the NATIVE
      // balance — two independent checks with distinct messages. Comparing
      // the token amount against the native balance (the old behavior when
      // callers forgot tokenAddress) produced nonsense like "you have
      // 0.000000001 and are trying to send 5" for a user with plenty of
      // USDT and dust BNB.
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
          message: `You don't have enough ${nativeSym} to cover network fees on ${network.name} — ${sendSym} transfers are paid for in ${nativeSym}. Deposit or buy ${nativeSym}, then try again.`,
        });
      }
    } else if (senderBalance !== null && amountUnits !== null) {
      // Native send: the balance must cover amount + network fee.
      const required = amountUnits + (feeWei ?? 0n);
      if (senderBalance < required) {
        issues.push({
          level:   'critical',
          code:    'INSUFFICIENT_BALANCE',
          message: feeWei !== null && senderBalance >= amountUnits
            ? `You don't have enough ${nativeSym} to cover the amount plus network fees on ${network.name}. Reduce the amount or deposit more ${nativeSym}.`
            : `Not enough ${nativeSym} — you have ${formatUnits(senderBalance, 18)} ${nativeSym} and are trying to send ${request.amount}.`,
        });
      }
    }

    // Add an info-level issue summarising what kind of transfer this is.
    issues.push({
      level: 'info',
      code:  request.tokenAddress ? 'TOKEN_TRANSFER' : 'NATIVE_TRANSFER',
      message: request.tokenAddress
        ? `Token transfer on ${network.name}.`
        : `Native ${network.nativeCurrency?.symbol || 'token'} transfer on ${network.name}.`,
    });

    const shortTo = `${request.to.slice(0, 6)}…${request.to.slice(-4)}`;
    const sym     = request.tokenSymbol ?? network.nativeCurrency?.symbol ?? '';
    return {
      chainId:       request.chainId,
      summary:       `Send ${request.amount} ${sym} to ${shortTo}`,
      estimatedFee:  feeData?.maxFeePerGas
                       ? `${formatUnits(feeData.maxFeePerGas, 9)} gwei`
                       : undefined,
      issues,
    };
  }

  async simulateLithic(request: LithicCallRequest): Promise<SimulationReport> {
    return this.lithic.simulateContract(request);
  }
}
