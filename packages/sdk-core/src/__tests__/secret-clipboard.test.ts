import { describe, it, expect, vi, afterEach } from 'vitest';
import { copySecretToClipboard } from '../security/secret-clipboard';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('copySecretToClipboard', () => {
  it('wipes the clipboard after the delay', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    await copySecretToClipboard('seed words', { write: async (t) => { writes.push(t); return true; }, clearAfterMs: 60_000 });
    expect(writes).toEqual(['seed words']);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(writes).toEqual(['seed words']);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(writes).toEqual(['seed words', '']);
  });

  it('does not wipe a newer secret copied in the meantime', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const write = async (t: string) => { writes.push(t); return true; };
    await copySecretToClipboard('first', { write, clearAfterMs: 60_000 });
    await vi.advanceTimersByTimeAsync(30_000);
    await copySecretToClipboard('second', { write, clearAfterMs: 60_000 });
    await vi.advanceTimersByTimeAsync(30_000); // first's timer: skipped
    expect(writes).toEqual(['first', 'second']);
    await vi.advanceTimersByTimeAsync(30_000); // second's timer
    expect(writes).toEqual(['first', 'second', '']);
  });

  it('retries a failed wipe when the window is focused again', async () => {
    vi.useFakeTimers();
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    let focused = true;
    const writes: string[] = [];
    const write = async (t: string) => { if (!focused) return false; writes.push(t); return true; };
    await copySecretToClipboard('secret', { write, clearAfterMs: 60_000 });
    focused = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writes).toEqual(['secret']);
    focused = true;
    win.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toEqual(['secret', '']);
  });

  it('reports a copy that failed', async () => {
    expect(await copySecretToClipboard('x', { write: async () => false })).toBe(false);
  });
});
