import { describe, it, expect, vi } from 'vitest';
import { Wallet } from 'ethers';
import {
  QuanttClient, assertQuanttChallenge, QuanttChallengeError, typesForEthers,
  type Eip712TypedData,
} from '../index';
// The mobile app carries a detached copy (EAS can't resolve workspace deps);
// the guard suite below runs against both so the twins can't drift. Loaded by
// path at runtime so this package's tsc (rootDir src) never pulls the mobile
// app's sources into its program.
const MOBILE_MIRROR = '../../../../apps/mobile/lib/quantt-challenge';
const mobileMirror = (await import(/* @vite-ignore */ MOBILE_MIRROR)) as typeof import('../quantt/challenge');

const IMPLEMENTATIONS = [
  ['sdk-core', { assertQuanttChallenge, QuanttChallengeError }],
  ['mobile mirror', mobileMirror],
] as const;

const wallet = Wallet.createRandom();
const ME = wallet.address;
const OTHER = '0x000000000022D473030F116dDEE9F6B43aC78BA3'; // Permit2's address — a "spender"

/** The shape Quantt's /v1/auth/wallet/typed-challenge issues (see client.ts). */
function signInChallenge(overrides: Partial<Eip712TypedData> = {}): Eip712TypedData {
  return {
    domain: { name: 'Quantts.ai', version: '1', chainId: 700777 },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' },
      ],
      SignIn: [
        { name: 'address', type: 'address' }, { name: 'nonce', type: 'bytes32' }, { name: 'validUntil', type: 'uint256' },
      ],
    },
    primaryType: 'SignIn',
    message: { address: ME, nonce: `0x${'ab'.repeat(32)}`, validUntil: 1_900_000_000 },
    ...overrides,
  };
}

function permit2Payload(domainName: string): Eip712TypedData {
  return {
    domain: { name: domainName, chainId: 1, verifyingContract: OTHER },
    types: {
      PermitSingle: [
        { name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' },
      ],
      PermitDetails: [
        { name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' },
      ],
    },
    primaryType: 'PermitSingle',
    message: {
      details: { token: OTHER, amount: '1461501637330902918203684832716283019655932542975', expiration: 0, nonce: 0 },
      spender: OTHER,
      sigDeadline: '999999999999',
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe.each(IMPLEMENTATIONS)('assertQuanttChallenge — %s', (_impl, { assertQuanttChallenge, QuanttChallengeError }) => {
  it('accepts a genuine SignIn challenge, and ethers can sign it', async () => {
    const typed = signInChallenge();
    expect(assertQuanttChallenge(typed, { kind: 'sign-in', address: ME })).toBe(typed);
    const sig = await wallet.signTypedData(typed.domain, typesForEthers(typed), typed.message);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it('matches the wallet address case-insensitively', () => {
    const typed = signInChallenge({ message: { address: ME.toLowerCase(), nonce: `0x${'00'.repeat(32)}`, validUntil: 1 } });
    expect(() => assertQuanttChallenge(typed, { kind: 'sign-in', address: ME })).not.toThrow();
  });

  it('rejects a Permit2 approval served in place of the challenge', () => {
    expect(() => assertQuanttChallenge(permit2Payload('Permit2'), { kind: 'sign-in', address: ME }))
      .toThrow(/domain name is "Permit2"/);
  });

  it('rejects an approval struct even under a spoofed Quantts.ai domain', () => {
    expect(() => assertQuanttChallenge(permit2Payload('Quantts.ai'), { kind: 'withdrawal-address', address: ME }))
      .toThrow(/"PermitSingle" struct/);
  });

  it('rejects an EIP-2612 Permit on a token domain', () => {
    const permit: Eip712TypedData = {
      domain: { name: 'USD Coin', version: '2', chainId: 1, verifyingContract: OTHER },
      types: { Permit: [
        { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
      ] },
      primaryType: 'Permit',
      message: { owner: ME, spender: OTHER, value: '1', nonce: 0, deadline: 1 },
    };
    expect(() => assertQuanttChallenge(permit, { kind: 'sign-in', address: ME })).toThrow(QuanttChallengeError);
  });

  it('rejects a SignIn that carries an address other than the wallet', () => {
    const typed = signInChallenge({ message: { address: OTHER, nonce: `0x${'ab'.repeat(32)}`, validUntil: 1 } });
    expect(() => assertQuanttChallenge(typed, { kind: 'sign-in', address: ME }))
      .toThrow(/SignIn\.address is an address other than this wallet's/);
  });

  it('checks addresses inside nested structs and arrays', () => {
    const typed: Eip712TypedData = {
      domain: { name: 'Quantts.ai', chainId: 700777 },
      types: {
        BindWithdrawalAddress: [{ name: 'owner', type: 'Party' }, { name: 'cc', type: 'address[]' }],
        Party: [{ name: 'wallet', type: 'address' }],
      },
      primaryType: 'BindWithdrawalAddress',
      message: { owner: { wallet: ME }, cc: [ME, OTHER] },
    };
    expect(() => assertQuanttChallenge(typed, { kind: 'withdrawal-address', address: ME }))
      .toThrow(/BindWithdrawalAddress\.cc\[1\]/);
  });

  it('requires the SignIn primary type for login', () => {
    const typed = signInChallenge({ primaryType: 'Login', types: { Login: signInChallenge().types.SignIn } });
    expect(() => assertQuanttChallenge(typed, { kind: 'sign-in', address: ME })).toThrow(/expected "SignIn"/);
  });

  it('rejects malformed payloads', () => {
    expect(() => assertQuanttChallenge(null, { kind: 'sign-in', address: ME })).toThrow(QuanttChallengeError);
    expect(() => assertQuanttChallenge({ domain: { name: 'Quantts.ai' }, types: {}, primaryType: 'SignIn', message: {} },
      { kind: 'sign-in', address: ME })).toThrow(/number of types/);
    expect(() => assertQuanttChallenge(signInChallenge({ primaryType: 'Missing' }), { kind: 'withdrawal-address', address: ME }))
      .toThrow(/not defined/);
  });
});

describe('QuanttClient challenge flows', () => {
  it('signIn never reaches the signer when the challenge is a Permit2 payload', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(permit2Payload('Permit2'))) as unknown as typeof fetch;
    const sign = vi.fn(async () => '0x');
    const client = new QuanttClient({ fetchImpl });
    await expect(client.signIn(ME, sign)).rejects.toBeInstanceOf(QuanttChallengeError);
    expect(sign).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no typed-verify call either
  });

  it('signIn signs a genuine challenge and stores the session', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return url.endsWith('/typed-challenge')
        ? jsonResponse(signInChallenge())
        : jsonResponse({ accessToken: 'at', refreshToken: 'rt' });
    }) as unknown as typeof fetch;
    const sign = vi.fn(async (t: Eip712TypedData) => wallet.signTypedData(t.domain, typesForEthers(t), t.message));
    const client = new QuanttClient({ fetchImpl });
    const session = await client.signIn(ME, sign);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(session.accessToken).toBe('at');
    expect(calls.map((u) => u.split('/v1/')[1])).toEqual(['auth/wallet/typed-challenge', 'auth/wallet/typed-verify']);
  });

  it('withdrawalAddressChallenge rejects a challenge naming a foreign address', async () => {
    const bad = signInChallenge({ primaryType: 'BindAddress', types: { BindAddress: [{ name: 'target', type: 'address' }] },
      message: { target: OTHER } });
    const fetchImpl = vi.fn(async () => jsonResponse(bad)) as unknown as typeof fetch;
    const client = new QuanttClient({ fetchImpl, store: { get: () => ({ accessToken: 'at' }), set: () => {} } });
    await expect(client.withdrawalAddressChallenge(ME)).rejects.toThrow(/BindAddress\.target/);
  });
});
