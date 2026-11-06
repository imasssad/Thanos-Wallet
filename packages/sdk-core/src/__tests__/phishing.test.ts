/**
 * Phishing classifier tests. The thresholds + reasons are user-facing
 * (they drive the "block" / "review" / "allow" banner on the
 * WalletConnect approval), so the suite locks the verdict boundaries.
 */
import { describe, it, expect } from 'vitest';
import { inspectWebsite } from '../security/phishing.js';

describe('inspectWebsite', () => {
  it('allows a clean hostname', () => {
    const r = inspectWebsite('uniswap.org');
    expect(r.verdict).toBe('allow');
    expect(r.score).toBe(0);
    expect(r.reasons).toEqual([]);
  });

  it('blocks a hostname containing a known phishing keyword', () => {
    const r = inspectWebsite('seed-verify.example.com');
    expect(r.verdict).toBe('block');
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.reasons.join(' ')).toMatch(/phishing keyword/i);
  });

  it('flags a high-risk TLD as review (.zip)', () => {
    const r = inspectWebsite('totally-legit.zip');
    expect(r.verdict).toBe('review');
    expect(r.reasons.join(' ')).toMatch(/top-level domain/i);
  });

  it('flags a MetaMask lookalike', () => {
    const r = inspectWebsite('metamask-login.io');
    expect(r.score).toBeGreaterThanOrEqual(35);
    expect(r.verdict).not.toBe('allow');
    expect(r.reasons.join(' ')).toMatch(/lookalike/i);
  });

  it('does NOT flag the genuine metamask.io', () => {
    const r = inspectWebsite('metamask.io');
    expect(r.verdict).toBe('allow');
    expect(r.score).toBe(0);
  });

  it('compounds risk when multiple signals fire', () => {
    // Lookalike (+65) + .zip TLD (+35) ⇒ ≥100 ⇒ block.
    const r = inspectWebsite('metamask-recovery.zip');
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.verdict).toBe('block');
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('is case-insensitive', () => {
    const r = inspectWebsite('SEED-VERIFY.example.COM');
    expect(r.verdict).toBe('block');
  });

  /* ── O-03: the classifier was 4 keywords / 3 TLDs / 1 brand ──────────── */

  it('flags a lookalike of a brand other than MetaMask (Phantom)', () => {
    const r = inspectWebsite('phantom-wallet-verify.com');
    expect(r.score).toBeGreaterThanOrEqual(35);
    expect(r.verdict).not.toBe('allow');
    expect(r.reasons.join(' ')).toMatch(/phantom\.app/);
  });

  it('does not flag the genuine phantom.app or its real subdomains', () => {
    expect(inspectWebsite('phantom.app').verdict).toBe('allow');
    expect(inspectWebsite('help.phantom.app').verdict).toBe('allow');
  });

  it('flags a lookalike of the wallet\'s own brand (thanos)', () => {
    const r = inspectWebsite('thanos-wallet-support.com');
    expect(r.verdict).not.toBe('allow');
    expect(r.reasons.join(' ')).toMatch(/thanos\.fi/);
  });

  it('does not flag thanos.fi itself or its real subdomains', () => {
    expect(inspectWebsite('thanos.fi').verdict).toBe('allow');
    expect(inspectWebsite('app.thanos.fi').verdict).toBe('allow');
  });

  it('flags a newer abused TLD (.top) beyond the original .zip/.mov/.xyz', () => {
    const r = inspectWebsite('wallet-bonus.top');
    expect(r.verdict).toBe('review');
    expect(r.reasons.join(' ')).toMatch(/top-level domain/i);
  });

  it('flags a newer keyword pattern (airdrop-claim) beyond the original four', () => {
    const r = inspectWebsite('airdrop-claim.example.com');
    expect(r.verdict).toBe('block');
  });

  it('flags punycode hostnames (homograph attack vector)', () => {
    const r = inspectWebsite('xn--metmask-f2a.io'); // "metamask" with a homoglyph, punycode-encoded
    expect(r.score).toBeGreaterThanOrEqual(50);
    expect(r.reasons.join(' ')).toMatch(/punycode/i);
  });

  it('flags a raw IP-literal hostname', () => {
    const r = inspectWebsite('203.0.113.42');
    expect(r.reasons.join(' ')).toMatch(/raw IP address/i);
  });

  it('flags a hostname chaining many hyphenated lure words', () => {
    const r = inspectWebsite('connect-wallet-verify-now-secure.example.com');
    expect(r.reasons.join(' ')).toMatch(/hyphenated/i);
  });

  it('does not false-positive a legitimate two-word hyphenated hostname', () => {
    const r = inspectWebsite('my-exchange.com');
    expect(r.verdict).toBe('allow');
    expect(r.score).toBe(0);
  });
});
