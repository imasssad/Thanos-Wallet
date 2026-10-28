import { describe, expect, it, vi } from 'vitest';
import { confirmSubmittedTransaction, type ConfirmationReceipt } from './transaction-confirmation';

const HASH = `0x${'a'.repeat(64)}`;
const OTHER_HASH = `0x${'b'.repeat(64)}`;
const pending = { stage: 'pending', message: expect.stringContaining('confirmation') };
const confirmed = { stage: 'confirmed', message: null };
const failed = { stage: 'failed', message: 'Transaction reverted on-chain' };
const receipt = (status: number | string | null, hash = HASH): ConfirmationReceipt => ({ hash, status });

describe('confirmSubmittedTransaction', () => {
  it.each([1, '0x1'])('confirms a successful receipt (%s) without an extra lookup', async status => {
    const read = vi.fn();
    expect(await confirmSubmittedTransaction(HASH, async () => receipt(status), read)).toEqual(confirmed);
    expect(read).not.toHaveBeenCalled();
  });

  it.each([0, '0x0'])('reports a mined execution failure (%s)', async status => {
    expect(await confirmSubmittedTransaction(HASH, async () => receipt(status), vi.fn())).toEqual(failed);
  });

  it.each(['RPC request timed out', 'HTTP 429 Too Many Requests'])('keeps a submitted payment pending after %s', async message => {
    const read = vi.fn(async () => null);
    const wait = vi.fn(async () => { throw new Error(message); });
    expect(await confirmSubmittedTransaction(HASH, wait, read)).toEqual(pending);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('recovers a successful transaction by reading its receipt after a polling error', async () => {
    const read = vi.fn(async () => receipt(1));
    expect(await confirmSubmittedTransaction(HASH, async () => { throw new Error('timeout'); }, read)).toEqual(confirmed);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('keeps the transaction pending when both confirmation reads fail', async () => {
    expect(await confirmSubmittedTransaction(HASH,
      async () => { throw new Error('timeout'); },
      async () => { throw new Error('HTTP 429'); },
    )).toEqual(pending);
  });

  it.each([null, receipt(null), receipt(2)])('does not invent a failure for an unavailable or unknown receipt', async value => {
    expect(await confirmSubmittedTransaction(HASH, async () => value, async () => null)).toEqual(pending);
  });

  it('accepts the signer wait result, which exposes status without a hash', async () => {
    expect(await confirmSubmittedTransaction(HASH, async () => ({ status: 1 }), vi.fn())).toEqual(confirmed);
  });

  it('preserves an ethers execution error carrying this transaction\'s reverted receipt', async () => {
    const error = Object.assign(new Error('execution reverted'), { receipt: receipt(0, HASH.toUpperCase()) });
    const read = vi.fn();
    expect(await confirmSubmittedTransaction(HASH, async () => { throw error; }, read)).toEqual(failed);
    expect(read).not.toHaveBeenCalled();
  });

  it.each([receipt(0, OTHER_HASH), { status: 0 }])('does not attribute an unverified error receipt to this transaction', async value => {
    const error = Object.assign(new Error('transaction replaced'), { receipt: value });
    expect(await confirmSubmittedTransaction(HASH, async () => { throw error; }, async () => null)).toEqual(pending);
  });

  it('checks the original hash when an error contains a replacement\'s receipt', async () => {
    const error = Object.assign(new Error('transaction replaced'), { receipt: receipt(1, OTHER_HASH) });
    const read = vi.fn(async () => receipt(1));
    expect(await confirmSubmittedTransaction(HASH, async () => { throw error; }, read)).toEqual(confirmed);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('does not accept a returned receipt for a different transaction', async () => {
    expect(await confirmSubmittedTransaction(HASH, async () => receipt(1, OTHER_HASH), async () => null)).toEqual(pending);
  });
});
