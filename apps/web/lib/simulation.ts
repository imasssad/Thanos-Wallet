/**
 * Pre-send simulation — adapter between the Send modal's UI state and
 * the sdk-core `TransactionSimulator`. Surfaces warnings the user
 * should see *before* their key signs:
 *
 *   - Recipient is a smart contract (warning)
 *   - Insufficient balance for the requested amount + gas (critical)
 *   - Free-form fee estimate
 *
 * The simulator only runs on chains the sdk-core network registry
 * knows about (Lithosphere primarily). For external EVM chains where
 * the registry has no entry, `simulateEvmSend()` returns null and the
 * UI silently degrades to fee-only display. That's deliberate — better
 * to show no simulation than to fail the modal with a registry miss.
 */
import {
  TransactionSimulator,
  type SimulationReport,
  type SimulationIssue,
} from '@thanos/sdk-core';

/** Lazy singleton — TransactionSimulator stores no per-call state but
 *  the underlying EvmClient/LithicClient cache provider instances, so
 *  reusing the simulator avoids re-creating providers on every keystroke. */
let _simulator: TransactionSimulator | null = null;
function simulator(): TransactionSimulator {
  if (!_simulator) _simulator = new TransactionSimulator();
  return _simulator;
}

export interface SimulateSendArgs {
  chainId:       number;
  from:          string;
  to:            string;
  /** Human-readable amount (ether-units), the same string the user typed. */
  amount:        string;
  tokenAddress?: string;
  tokenSymbol?:  string;
}

/**
 * Run the simulator. Returns null if the chain isn't in sdk-core's
 * registry, or if the simulator itself throws — both are non-fatal,
 * the UI just won't show a simulation panel.
 */
export async function simulateEvmSend(args: SimulateSendArgs): Promise<SimulationReport | null> {
  try {
    return await simulator().simulateSend(args);
  } catch {
    return null;
  }
}

export type { SimulationReport, SimulationIssue };
