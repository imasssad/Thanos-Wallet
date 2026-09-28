import { describe, it, expect } from 'vitest';
import * as core from '../security/password-strength';

// The mobile app carries a detached twin (EAS can't resolve this workspace
// package); run the same suite against it. Loaded at runtime so it stays
// outside this package's tsc rootDir.
const MOBILE_TWIN = '../../../../apps/mobile/lib/password-strength';
const mobile = (await import(/* @vite-ignore */ MOBILE_TWIN)) as typeof import('../security/password-strength');

describe.each([['sdk-core', core], ['mobile twin', mobile]])('%s passwordProblem', (_name, m) => {
  const refused = (pw: string, why: RegExp) => expect(m.passwordProblem(pw), pw).toMatch(why);

  it('keeps the 8-character minimum', () => {
    refused('k9#Vq2!', /at least 8 characters/);
  });

  it('refuses the most common passwords, dressed up or not', () => {
    for (const pw of [
      'password', 'Password123!', 'P@ssw0rd', 'p4ssw0rd1', '!!password!!', 'passwordpassword',
      'iloveyou2', 'Dragon2024!', 'letmein1', 'Sunshine99', 'football', 'l3tm31n!',
      'thanoswallet', 'Thanos2024', 'bitcoin!!', 'Metamask1', 'satoshi21',
    ]) refused(pw, /common/);
  });

  it('refuses keyboard, alphabet and digit runs', () => {
    for (const pw of [
      '12345678', '87654321', '123456789012', 'qwertyui', 'asdfghjk', 'abcdefgh', 'zyxwvuts',
      '1q2w3e4r', 'zaq12wsx', 'abcd1234', 'qwerty123', 'asdf!234', 'abcdabcd',
    ]) refused(pw, /runs/);
  });

  it('refuses too few different characters, and short numbers-only passwords', () => {
    for (const pw of ['aaaaaaaa', 'abababab', '12121212', 'xyzxyzxyz']) refused(pw, /repetitive/);
    for (const pw of ['19871987', '20240101', '90210456']) refused(pw, /numbers-only/);
  });

  it('accepts anything else — passphrases, random strings, the e2e passwords', () => {
    for (const pw of [
      'correct horse battery staple', 'Tr0ub4dor&3', '8#Rty!29^', 'k9#Vq2!mZx', 'MoonLambo2025!',
      'dragon-fly-mountain-42', 'password-manager-rocks', '573920184466',
      'test-password-123', 'lock-unlock-pw-321', 'auto-lock-pw-555', 'quantt-lock-pw-777',
      'reload-test-pw-456', 'import-test-pw-789',
    ]) expect(m.passwordProblem(pw), pw).toBeNull();
  });
});
