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
});
