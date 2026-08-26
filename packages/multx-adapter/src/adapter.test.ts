import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MultXAdapter } from './adapter.js';
import type { MultXSigner } from './types.js';

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock('./bridge.js', () => ({
  approveAndLock: vi.fn().mockResolvedValue({ sourceTxHash: '0xsource' }),
}));
vi.mock('./status.js', () => ({
  pollAndReconcile: vi.fn().mockResolvedValue({ status: 'RELEASED', destinationTxHash: '0xdest' }),
}));

const VALID_MANIFEST = {
  tag: '2026.08.1', commit: 'a'.repeat(40), disabled: false, apiUrl: 'https://bridge.litho.ai',
  routes: [{
    sourceChainId: 700777, sourceBridge: '0x5832D5E609c6690f74c7683606Eb20F89ff096a6',
    destinationChainId: 900523, destinationBridge: '0x3a896BDF3a1088287FA84aB5a43bB30e2535F263',
    tokens: [{ symbol: 'wLITHO', sourceAddress: '0x599a7E135f1790ae117b4EdDc0422D24Bc766161', destinationAddress: '0x599a7E135f1790ae117b4EdDc0422D24Bc766161', decimals: 18 }],
  }],
};

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fakeSigner(chainId = 700777): MultXSigner {
  return {
    getAddress: async () => '0xuser',
    provider: { getNetwork: async () => ({ chainId: BigInt(chainId) }) },
  };
}

function makeManifestFetch(manifest: unknown): { fetchImpl: typeof fetch; sha: Promise<string> } {
  const raw = JSON.stringify(manifest);
  return {
    fetchImpl: vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => raw }) as unknown as typeof fetch,
    sha: sha256Hex(raw),
  };
}

describe('MultXAdapter — defaults to disabled', () => {
  it('refuses to transfer when the partner app has not explicitly enabled it', async () => {
    const { fetchImpl, sha } = makeManifestFetch(VALID_MANIFEST);
    const persist = vi.fn();
    const adapter = new MultXAdapter({
      integration: 'ignite',
      enabled: false, // explicit — this is the default a partner app should ship with
      manifestUrl: 'https://example.com/m.json',
      manifestSha256: await sha,
      persist,
      fetchImpl,
    });

    await expect(adapter.transfer({
      integrationRequestId: 'req-1',
      signer: fakeSigner() as never,
      sourceChainId: 700777, destinationChainId: 900523, tokenSymbol: 'wLITHO',
      amountBaseUnits: '1', recipient: '0xuser',
      verifyDestinationReceipt: vi.fn(),
    })).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  });

  it('refuses to transfer when the manifest itself carries the kill switch, even if the app enabled it', async () => {
    const { fetchImpl, sha } = makeManifestFetch({ ...VALID_MANIFEST, disabled: true });
    const adapter = new MultXAdapter({
      integration: 'ignite',
      enabled: true,
      manifestUrl: 'https://example.com/m.json',
      manifestSha256: await sha,
      persist: vi.fn(),
      fetchImpl,
    });

    await expect(adapter.transfer({
      integrationRequestId: 'req-1',
      signer: fakeSigner() as never,
      sourceChainId: 700777, destinationChainId: 900523, tokenSymbol: 'wLITHO',
      amountBaseUnits: '1', recipient: '0xuser',
      verifyDestinationReceipt: vi.fn(),
    })).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  });

  it('isEnabled() is false until a manifest has actually loaded, even if the app flag is on', () => {
    const adapter = new MultXAdapter({
      integration: 'ignite', enabled: true,
      manifestUrl: 'https://example.com/m.json', manifestSha256: 'a'.repeat(64),
      persist: vi.fn(),
    });
    expect(adapter.isEnabled()).toBe(false);
  });
});

describe('MultXAdapter — happy path persists every state transition', () => {
  it('persists SUBMITTED, then FINALIZING with the lock hash, then the terminal record', async () => {
    const { fetchImpl, sha } = makeManifestFetch(VALID_MANIFEST);
    const persist = vi.fn().mockResolvedValue(undefined);
    const adapter = new MultXAdapter({
      integration: 'ignite', enabled: true,
      manifestUrl: 'https://example.com/m.json', manifestSha256: await sha,
      persist, fetchImpl,
    });

    const record = await adapter.transfer({
      integrationRequestId: 'req-1',
      signer: fakeSigner() as never,
      sourceChainId: 700777, destinationChainId: 900523, tokenSymbol: 'wLITHO',
      amountBaseUnits: '1000', recipient: '0xuser',
      verifyDestinationReceipt: vi.fn().mockResolvedValue(true),
    });

    expect(record.status).toBe('RELEASED');
    expect(record.sourceTxHash).toBe('0xsource');
    expect(record.destinationTxHash).toBe('0xdest');

    const statuses = persist.mock.calls.map((c) => (c[0] as { status: string }).status);
    expect(statuses).toEqual(['SUBMITTED', 'FINALIZING', 'RELEASED']);
  });

  it('rejects a transfer on the wrong network before ever calling approveAndLock', async () => {
    const { approveAndLock } = await import('./bridge.js');
    const { fetchImpl, sha } = makeManifestFetch(VALID_MANIFEST);
    const adapter = new MultXAdapter({
      integration: 'ignite', enabled: true,
      manifestUrl: 'https://example.com/m.json', manifestSha256: await sha,
      persist: vi.fn(), fetchImpl,
    });

    await expect(adapter.transfer({
      integrationRequestId: 'req-2',
      signer: fakeSigner(1) as never, // Ethereum, not Makalu
      sourceChainId: 700777, destinationChainId: 900523, tokenSymbol: 'wLITHO',
      amountBaseUnits: '1000', recipient: '0xuser',
      verifyDestinationReceipt: vi.fn(),
    })).rejects.toMatchObject({ code: 'WRONG_NETWORK' });

    expect(approveAndLock).not.toHaveBeenCalled();
  });
});
