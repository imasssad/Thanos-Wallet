export interface ConfirmationReceipt {
  status: number | string | null;
  hash?: string;
  transactionHash?: string;
}

export interface TransactionConfirmation {
  stage: 'pending' | 'confirmed' | 'failed';
  message: string | null;
}

function settledReceipt(
  hash: string, receipt: ConfirmationReceipt | null | undefined, requireHash = false,
): TransactionConfirmation | null {
  if (!receipt) return null;
  const receiptHash = receipt.hash ?? receipt.transactionHash;
  if (requireHash && !receiptHash) return null;
  if (receiptHash && receiptHash.toLowerCase() !== hash.toLowerCase()) return null;
  if (receipt.status === 1 || receipt.status === '0x1') return { stage: 'confirmed', message: null };
  if (receipt.status === 0 || receipt.status === '0x0') return { stage: 'failed', message: 'Transaction reverted on-chain' };
  return null;
}

/** A failed receipt lookup cannot undo a broadcast. Only a receipt for this
 *  transaction establishes success or execution failure; transport errors
 *  leave its recorded hash pending for Activity to reconcile. */
export async function confirmSubmittedTransaction(
  hash: string,
  wait: () => Promise<ConfirmationReceipt | null>,
  readReceipt: () => Promise<ConfirmationReceipt | null>,
): Promise<TransactionConfirmation> {
  try {
    const settled = settledReceipt(hash, await wait());
    if (settled) return settled;
  } catch (error) {
    // Ethers may throw with a mined receipt, including a replacement's.
    // Never attribute the replacement's status to the submitted hash.
    const receipt = (error as { receipt?: ConfirmationReceipt } | null)?.receipt;
    const settled = settledReceipt(hash, receipt, true);
    if (settled) return settled;
  }
  try {
    const settled = settledReceipt(hash, await readReceipt());
    if (settled) return settled;
  } catch {
    // The read-only fallback can also be unavailable or rate limited.
  }
  return {
    stage: 'pending',
    message: 'Transaction submitted; confirmation is temporarily unavailable. Check Activity or the explorer before sending again.',
  };
}
