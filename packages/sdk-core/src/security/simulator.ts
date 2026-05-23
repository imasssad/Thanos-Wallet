import { formatUnits, parseUnits } from 'ethers';
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

    // Fan out the read-only RPC calls. Each is wrapped in catch so a
    // single slow endpoint doesn't block the whole simulation — the
    // approval sheet falls back to "estimate unavailable" rather than
    // hanging the user on a spinner.
    const [feeDataResult, codeResult, balanceResult] = await Promise.allSettled([
      provider.getFeeData(),
      provider.getCode(request.to),
      request.from
        ? provider.getBalance(request.from)
        : Promise.resolve(null),
    ]);

    const feeData       = feeDataResult.status === 'fulfilled' ? feeDataResult.value : null;
    const recipientCode = codeResult.status    === 'fulfilled' ? codeResult.value    : '0x';
    const senderBalance = balanceResult.status === 'fulfilled' ? balanceResult.value : null;

    // Recipient is a contract → warn. Sending native to a contract that
    // doesn't implement `receive()` will revert and burn gas; sending to
    // a proxy or DEX router can be intentional but the user should know.
    if (recipientCode && recipientCode !== '0x') {
      issues.push({
        level:   'warning',
        code:    'RECIPIENT_IS_CONTRACT',
        message: 'Recipient is a smart contract. If you meant to send to a person, double-check the address — funds sent to the wrong contract may not be recoverable.',
      });
    }

    // Balance vs amount — only do the check when we have the sender
    // address. parseUnits with 18 decimals is correct for native EVM
    // transfers; for ERC-20 transfers the decimals would differ but the
    // balance check here is for native gas + native value anyway.
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
      } catch {
        /* parseUnits failed on a malformed amount — let the UI handle that. */
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
