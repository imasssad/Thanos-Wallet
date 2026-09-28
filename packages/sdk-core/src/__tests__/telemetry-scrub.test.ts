import { describe, it, expect } from 'vitest';
import { encodeBase58, hexlify, randomBytes, Wallet } from 'ethers';
import * as core from '../security/telemetry-scrub';

// The mobile app carries a detached twin (EAS can't resolve this workspace
// package); run the same suite against it. Loaded at runtime so it stays
// outside this package's tsc rootDir.
const MOBILE_TWIN = '../../../../apps/mobile/lib/telemetry-scrub';
const mobile = (await import(/* @vite-ignore */ MOBILE_TWIN)) as typeof import('../security/telemetry-scrub');

const PHRASE = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
const PHRASE_24 = 'legal winner thank year wave sausage worth useful legal winner thank yellow '.repeat(2).trim();

describe.each([['sdk-core', core], ['mobile twin', mobile]])('%s', (_name, m) => {
  const { redactSecretStrings: redact, scrubTelemetry, REDACTED } = m;

  describe('redactSecretStrings', () => {
    it('cuts a recovery phrase quoted inside an error message', () => {
      expect(redact(`Error: invalid mnemonic "${PHRASE}" (argument="phrase")`))
        .toBe(`Error: invalid mnemonic "${REDACTED}" (argument="phrase")`);
      expect(redact(`restore failed: ${PHRASE_24}`)).toBe(`restore failed: ${REDACTED}`);
    });

    it('cuts a phrase whatever separates the words — numbering, JSON, capitals, newlines', () => {
      const words = PHRASE.split(' ');
      for (const text of [
        words.map((w, i) => `${i + 1}. ${w}`).join(' '),
        JSON.stringify(words),
        words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
        words.join('\n'),
      ]) {
        const out = redact(text);
        for (const w of words) expect(out).not.toMatch(new RegExp(`\\b${w}\\b`, 'i'));
      }
    });

    it('cuts eight words of a phrase — enough to brute-force the rest', () => {
      const eight = PHRASE.split(' ').slice(0, 8).join(' ');
      expect(redact(`words: ${eight}`)).toBe(`words: ${REDACTED}`);
    });

    it('leaves ordinary error text alone', () => {
      for (const text of [
        "Cannot read properties of undefined (reading 'map')",
        'insufficient funds for intrinsic transaction cost',
        'user rejected action (action="sendTransaction", reason="rejected", code=ACTION_REJECTED, version=6.13.4)',
        'The user aborted a request. Please try again later or check your internet connection and wallet balance',
        'Unable to connect to the relay server. Check your network, then scan the QR code again to pair with the dapp.',
        'swap quote expired: price impact too high, slippage limit exceeded, retry with a larger slippage or smaller amount',
        'Failed to fetch dynamically imported module: https://thanos.fi/_next/static/chunks/app/page-7d3f1c2a9b8e4f60.js',
      ]) expect(redact(text)).toBe(text);
    });

    it('cuts a private key, with or without 0x, and a WalletConnect symKey', () => {
      const key = Wallet.createRandom().privateKey;
      expect(redact(`bad key ${key} for signer`)).toBe(`bad key ${REDACTED} for signer`);
      expect(redact(`k=${key.slice(2)}`)).toBe(`k=${REDACTED}`);
      const sym = hexlify(randomBytes(32)).slice(2);
      expect(redact(`wc:7f6e@2?relay-protocol=irn&symKey=${sym}`)).toBe(`wc:7f6e@2?relay-protocol=irn&symKey=${REDACTED}`);
    });

    it('keeps addresses, signatures and calldata — longer or shorter than a key', () => {
      const addr = Wallet.createRandom().address;
      const sig = hexlify(randomBytes(65));
      const calldata = '0xa9059cbb' + '00'.repeat(64);
      for (const text of [`to ${addr}`, `sig ${sig}`, `data ${calldata}`]) expect(redact(text)).toBe(text);
    });

    it('cuts extended private keys, Bitcoin WIF keys and Solana secret keys', () => {
      const xprv = 'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi';
      const wif = '5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ';
      const wifCompressed = 'KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617';
      const solana = encodeBase58(randomBytes(64));
      for (const secret of [xprv, wif, wifCompressed, solana]) {
        expect(redact(`key: ${secret}.`)).toBe(`key: ${REDACTED}.`);
      }
    });
  });

  describe('scrubTelemetry', () => {
    it('scrubs a Sentry-shaped event: secret fields whole, every string scanned, nothing else touched', () => {
      const key = Wallet.createRandom().privateKey;
      const event = {
        event_id: '9f3b2a1c8d7e6f5a4b3c2d1e0f9a8b7c',
        message: 'restore failed',
        exception: { values: [{ type: 'Error', value: `invalid mnemonic ${PHRASE}`, stacktrace: { frames: [{ filename: 'app.js', lineno: 10 }] } }] },
        breadcrumbs: [
          { category: 'console', message: `signing with ${key}`, level: 'log' },
          { category: 'fetch', data: { url: 'https://api.thanos.fi/contacts', method: 'GET', status_code: 200 } },
        ],
        request: { url: 'https://thanos.fi/app', headers: { Authorization: 'Bearer eyJhbGciOi', 'User-Agent': 'Chrome' }, cookies: { sid: 'abc' } },
        extra: { mnemonic: PHRASE, privateKey: key, sessionKey: 'k', vaultJson: '{}', chainId: 700777, recoveryPhrase: ['a'] },
        tags: { route: '/app' },
      };
      const before = JSON.stringify(event);
      const out = scrubTelemetry(event);

      expect(JSON.stringify(out)).not.toContain(key.slice(2));
      expect(JSON.stringify(out)).not.toMatch(/abandon|accident/);
      expect(out.exception.values[0].value).toBe(`invalid mnemonic ${REDACTED}`);
      expect(out.breadcrumbs[0].message).toBe(`signing with ${REDACTED}`);
      expect(out.request.headers).toEqual({ Authorization: REDACTED, 'User-Agent': 'Chrome' });
      expect(out.request.cookies).toBe(REDACTED);
      expect(out.extra).toEqual({
        mnemonic: REDACTED, privateKey: REDACTED, sessionKey: REDACTED, vaultJson: REDACTED,
        chainId: 700777, recoveryPhrase: REDACTED,
      });
      // Untouched: ids, frames, ordinary breadcrumbs, tags.
      expect(out.event_id).toBe(event.event_id);
      expect(out.exception.values[0].stacktrace).toEqual(event.exception.values[0].stacktrace);
      expect(out.breadcrumbs[1]).toEqual(event.breadcrumbs[1]);
      expect(out.tags).toEqual(event.tags);
      // A copy — the event the SDK holds isn't modified.
      expect(JSON.stringify(event)).toBe(before);
    });

    it('scrubOrDropEvent drops an event it cannot scrub instead of throwing', () => {
      const cyclic: Record<string, unknown> = { message: 'x' };
      cyclic.self = cyclic;
      expect(m.scrubOrDropEvent(cyclic)).toBeNull();
      expect(m.scrubOrDropEvent({ message: `invalid mnemonic ${PHRASE}` })).toEqual({ message: `invalid mnemonic ${REDACTED}` });
    });

    it('passes primitives and non-plain objects through', () => {
      const when = new Date(0);
      expect(scrubTelemetry(null)).toBeNull();
      expect(scrubTelemetry(42)).toBe(42);
      expect(scrubTelemetry(when)).toBe(when);
    });
  });
});
