import { describe, it, expect, vi } from 'vitest';
import { loadManifest } from './manifest.js';
import { MultXAdapterError } from './errors.js';

const VALID_MANIFEST = {
  tag: '2026.08.1',
  commit: 'a'.repeat(40),
  disabled: false,
  apiUrl: 'https://bridge.litho.ai',
  routes: [
    {
      sourceChainId: 700777,
      sourceBridge: '0x5832D5E609c6690f74c7683606Eb20F89ff096a6',
      destinationChainId: 900523,
      destinationBridge: '0x3a896BDF3a1088287FA84aB5a43bB30e2535F263',
      tokens: [
        { symbol: 'wLITHO', sourceAddress: '0x599a7E135f1790ae117b4EdDc0422D24Bc766161', destinationAddress: '0x599a7E135f1790ae117b4EdDc0422D24Bc766161', decimals: 18 },
      ],
    },
  ],
};

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fetchReturning(body: string, ok = true, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({ ok, status, text: async () => body }) as unknown as typeof fetch;
}

describe('loadManifest', () => {
  it('loads and validates a correctly-hashed manifest', async () => {
    const raw = JSON.stringify(VALID_MANIFEST);
    const hash = await sha256Hex(raw);
    const manifest = await loadManifest({
      manifestUrl: 'https://example.com/manifest.json',
      expectedSha256: hash,
      fetchImpl: fetchReturning(raw),
    });
    expect(manifest.tag).toBe('2026.08.1');
    expect(manifest.routes).toHaveLength(1);
  });

  it('rejects a non-HTTPS manifest URL', async () => {
    await expect(loadManifest({
      manifestUrl: 'http://example.com/manifest.json',
      expectedSha256: 'a'.repeat(64),
    })).rejects.toBeInstanceOf(MultXAdapterError);
  });

  it('rejects a malformed expected hash', async () => {
    await expect(loadManifest({
      manifestUrl: 'https://example.com/manifest.json',
      expectedSha256: 'not-a-hash',
    })).rejects.toMatchObject({ code: 'MANIFEST_INVALID' });
  });

  it('fails closed on a hash mismatch (integrity failure) rather than falling back', async () => {
    const raw = JSON.stringify(VALID_MANIFEST);
    await expect(loadManifest({
      manifestUrl: 'https://example.com/manifest.json',
      expectedSha256: 'b'.repeat(64), // deliberately wrong
      fetchImpl: fetchReturning(raw),
    })).rejects.toMatchObject({ code: 'MANIFEST_INVALID' });
  });

  it('rejects a manifest with a non-checksummable bridge address', async () => {
    const bad = { ...VALID_MANIFEST, routes: [{ ...VALID_MANIFEST.routes[0], sourceBridge: 'not-an-address' }] };
    const raw = JSON.stringify(bad);
    const hash = await sha256Hex(raw);
    await expect(loadManifest({
      manifestUrl: 'https://example.com/manifest.json',
      expectedSha256: hash,
      fetchImpl: fetchReturning(raw),
    })).rejects.toMatchObject({ code: 'MANIFEST_INVALID' });
  });

  it('rejects a manifest with a non-40-char commit', async () => {
    const bad = { ...VALID_MANIFEST, commit: 'short' };
    const raw = JSON.stringify(bad);
    const hash = await sha256Hex(raw);
    await expect(loadManifest({
      manifestUrl: 'https://example.com/manifest.json',
      expectedSha256: hash,
      fetchImpl: fetchReturning(raw),
    })).rejects.toMatchObject({ code: 'MANIFEST_INVALID' });
  });

  it('surfaces a non-2xx fetch as MANIFEST_UNREACHABLE', async () => {
    await expect(loadManifest({
      manifestUrl: 'https://example.com/manifest.json',
      expectedSha256: 'a'.repeat(64),
      fetchImpl: fetchReturning('', false, 503),
    })).rejects.toMatchObject({ code: 'MANIFEST_UNREACHABLE' });
  });
});
