import { describe, it, expect } from 'vitest';
import { Interface, MaxUint256, parseEther, hexlify, toUtf8Bytes, TypedDataEncoder } from 'ethers';
import * as core from '../security/sign-review';

// The mobile app carries a detached twin (EAS can't resolve this workspace
// package); run the same suite against it. Loaded at runtime so it stays
// outside this package's tsc rootDir.
const MOBILE_TWIN = '../../../../apps/mobile/lib/sign-review';
const mobile = (await import(/* @vite-ignore */ MOBILE_TWIN)) as typeof import('../security/sign-review');
// …and so does the desktop main process (its approval dialog).
const DESKTOP_TWIN = '../../../../apps/desktop/src/main/sign-review';
const desktop = (await import(/* @vite-ignore */ DESKTOP_TWIN)) as typeof import('../security/sign-review');

const ME = '0x1111111111111111111111111111111111111111';
const SPENDER = '0x2222222222222222222222222222222222222222';
const TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const TOKEN2 = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const SCAM = '0x412f10aad96fd78da6736387e2c84931ac20313f';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const SEAPORT = '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC';
const MAX160 = (1n << 160n) - 1n;

// Real EIP-712 `types` maps for each decoder (THN-01): the reviewer now derives the struct it
// will actually sign from `types` — the same way ethers v6's signTypedData() does — and blocks
// if that disagrees with the declared `primaryType`. Earlier revisions of this suite built every
// case with `types: { EIP712Domain: [] }` alone, so the decoder was never run against the types
// map it depends on, and a dApp spoofing `primaryType` was invisible to it. `typed()` below now
// carries the real struct(s) for each primaryType it's called with, keyed here; call sites that
// reuse a primaryType name under a different shape (Dai's `Permit` below) pass their own override.
const TYPES_FOR: Record<string, Record<string, Array<{ name: string; type: string }>>> = {
  Permit: {
    Permit: [
      { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
    ],
  },
  PermitSingle: {
    PermitDetails: [
      { name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' },
    ],
    PermitSingle: [
      { name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' },
    ],
  },
  PermitBatch: {
    PermitDetails: [
      { name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' },
    ],
    PermitBatch: [
      { name: 'details', type: 'PermitDetails[]' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' },
    ],
  },
  PermitWitnessTransferFrom: {
    TokenPermissions: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }],
    Witness: [{ name: 'foo', type: 'uint256' }],
    PermitWitnessTransferFrom: [
      { name: 'permitted', type: 'TokenPermissions' }, { name: 'spender', type: 'address' },
      { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }, { name: 'witness', type: 'Witness' },
    ],
  },
  OrderComponents: {
    OfferItem: [
      { name: 'itemType', type: 'uint8' }, { name: 'token', type: 'address' }, { name: 'identifierOrCriteria', type: 'uint256' },
      { name: 'startAmount', type: 'uint256' }, { name: 'endAmount', type: 'uint256' },
    ],
    ConsiderationItem: [
      { name: 'itemType', type: 'uint8' }, { name: 'token', type: 'address' }, { name: 'identifierOrCriteria', type: 'uint256' },
      { name: 'startAmount', type: 'uint256' }, { name: 'endAmount', type: 'uint256' }, { name: 'recipient', type: 'address' },
    ],
    OrderComponents: [
      { name: 'offerer', type: 'address' }, { name: 'zone', type: 'address' }, { name: 'offer', type: 'OfferItem[]' },
      { name: 'consideration', type: 'ConsiderationItem[]' }, { name: 'orderType', type: 'uint8' }, { name: 'startTime', type: 'uint256' },
      { name: 'endTime', type: 'uint256' }, { name: 'zoneHash', type: 'bytes32' }, { name: 'salt', type: 'uint256' },
      { name: 'conduitKey', type: 'bytes32' }, { name: 'counter', type: 'uint256' },
    ],
  },
  Login: { Login: [{ name: 'wallet', type: 'address' }, { name: 'nonce', type: 'string' }, { name: 'issuedAt', type: 'string' }] },
  Grant: { Grant: [{ name: 'spender', type: 'address' }, { name: 'until', type: 'uint256' }] },
};
// BulkOrder shares OrderComponents' struct family, plus the root `tree` type — Seaport's bulk
// signature is a binary Merkle tree of orders; the fixed-array dimensions below match the
// `{ tree: [[listing, listing]] }` shape used in the bulk-order test.
TYPES_FOR.BulkOrder = { ...TYPES_FOR.OrderComponents, BulkOrder: [{ name: 'tree', type: 'OrderComponents[2][1]' }] };

const typed = (
  primaryType: string,
  message: Record<string, unknown>,
  domain: Record<string, unknown> = { name: 'USD Coin', version: '2', chainId: 1, verifyingContract: TOKEN },
  types: Record<string, unknown> = TYPES_FOR[primaryType] ?? {},
) =>
  ['eth_signTypedData_v4', [ME, JSON.stringify({ domain, primaryType, types: { EIP712Domain: [], ...types }, message })]] as const;

for (const [impl, m] of [['sdk-core', core], ['mobile twin', mobile], ['desktop main twin', desktop]] as const) {
  const review = (method: string, params: unknown, activeChainId = 1) =>
    m.reviewSigningRequest({ method, params, activeChainId, account: ME });
  const rowOf = (r: core.SignReview, label: string) => r.rows.find((x) => x.label === label)?.value;

  describe(`reviewSigningRequest — EIP-712 (${impl})`, () => {
    it('decodes an unlimited EIP-2612 permit', () => {
      const r = review(...typed('Permit', { owner: ME, spender: SPENDER, value: MaxUint256.toString(), nonce: 0, deadline: 1_900_000_000 }));
      expect(r.risk).toBe('review');
      expect(r.blockReason).toBeNull();
      expect(r.title).toContain(SPENDER);
      expect(rowOf(r, 'Spender')).toBe(SPENDER);
      expect(rowOf(r, 'Amount')).toBe('Unlimited');
      expect(rowOf(r, 'Valid until')).toBe('2030-03-17 17:46:40 UTC');
      expect(r.warnings.join(' ')).toMatch(/UNLIMITED/);
    });

    it('a limited permit is a caution with the amount shown', () => {
      const r = review(...typed('Permit', { owner: ME, spender: SPENDER, value: '2500000', nonce: 0, deadline: 1_900_000_000 }));
      expect(r.risk).toBe('caution');
      expect(rowOf(r, 'Amount')).toBe('2,500,000 (base units)');
    });

    it('blocks a signature for another chain, and accepts a hex chainId that matches', () => {
      const other = review(...typed('Permit', { owner: ME, spender: SPENDER, value: '1', nonce: 0, deadline: 1 }, { name: 'USD Coin', chainId: 137, verifyingContract: TOKEN }));
      expect(other.risk).toBe('block');
      expect(other.blockReason).toMatch(/chain 137.*chain 1/);
      // …and names the chain it needs, so a sheet can offer the switch.
      expect(other.requiredChainId).toBe(137);
      const hex = review(...typed('Permit', { owner: ME, spender: SPENDER, value: '1', nonce: 0, deadline: 1 }, { name: 'USD Coin', chainId: '0x89', verifyingContract: TOKEN }), 137);
      expect(hex.blockReason).toBeNull();
      expect(hex.requiredChainId).toBeUndefined();
    });

    // O-01/M06: the unreadable-chainId block survived Autha's mutation run —
    // no shipped test covered it. A domain that carries a chainId the wallet
    // cannot parse must be refused outright: it can't be compared against the
    // active chain, so it can't be shown to the user as pinned to one.
    it('blocks a chainId that is present but unreadable', () => {
      const r = review(...typed('Permit', { owner: ME, spender: SPENDER, value: '1', nonce: 0, deadline: 1 }, { name: 'USD Coin', chainId: 'banana', verifyingContract: TOKEN }));
      expect(r.risk).toBe('block');
      expect(r.blockReason).toMatch(/chainId is unreadable/i);
      // An ABSENT chainId is a different case — it stays reviewable, so the
      // block above must be about unreadability, not merely a missing field.
      const absent = review(...typed('Permit', { owner: ME, spender: SPENDER, value: '1', nonce: 0, deadline: 1 }, { name: 'USD Coin', verifyingContract: TOKEN }));
      expect(absent.risk).not.toBe('block');
    });

    it('decodes a DAI-style permit', () => {
      const daiTypes = { Permit: [
        { name: 'holder', type: 'address' }, { name: 'spender', type: 'address' },
        { name: 'nonce', type: 'uint256' }, { name: 'expiry', type: 'uint256' }, { name: 'allowed', type: 'bool' },
      ] };
      const r = review(...typed('Permit', { holder: ME, spender: SPENDER, nonce: 0, expiry: 0, allowed: true }, { name: 'Dai Stablecoin', chainId: 1, verifyingContract: TOKEN }, daiTypes));
      expect(r.risk).toBe('review');
      expect(rowOf(r, 'Amount')).toBe('Unlimited');
      expect(rowOf(r, 'Valid until')).toBe('Never');
    });

    it('decodes Permit2 allowances (single and batch)', () => {
      const d = { name: 'Permit2', chainId: 1, verifyingContract: PERMIT2 };
      const single = review(...typed('PermitSingle', { details: { token: TOKEN, amount: MAX160.toString(), expiration: 1_900_000_000, nonce: 0 }, spender: SPENDER, sigDeadline: 1_900_000_000 }, d));
      expect(single.risk).toBe('review');
      expect(rowOf(single, 'Token')).toBe(TOKEN);
      expect(rowOf(single, 'Amount')).toBe('Unlimited');
      const batch = review(...typed('PermitBatch', { details: [{ token: TOKEN, amount: '5', expiration: 0, nonce: 0 }, { token: TOKEN2, amount: '7', expiration: 0, nonce: 0 }], spender: SPENDER, sigDeadline: 1_900_000_000 }, d));
      expect(rowOf(batch, 'Token 2')).toBe(TOKEN2);
      expect(rowOf(batch, 'Amount 1')).toBe('5 (base units)');
      expect(batch.risk).toBe('caution');
    });

    it('decodes Permit2 signature transfers, including witness orders', () => {
      const d = { name: 'Permit2', chainId: 1, verifyingContract: PERMIT2 };
      const r = review(...typed('PermitWitnessTransferFrom', { permitted: { token: TOKEN, amount: '1000' }, spender: SPENDER, nonce: 1, deadline: 1_900_000_000, witness: { foo: 1 } }, d));
      expect(r.risk).toBe('review');
      expect(r.title).toMatch(/take tokens from your wallet/);
      expect(rowOf(r, 'Also signs')).toMatch(/witness/);
    });

    const order = (consideration: unknown[]) => ({
      offerer: ME, zone: '0x0000000000000000000000000000000000000000',
      offer: [{ itemType: 2, token: TOKEN2, identifierOrCriteria: '42', startAmount: '1', endAmount: '1' }],
      consideration, orderType: 0, startTime: 0, endTime: 1_900_000_000, zoneHash: '0x', salt: '1', conduitKey: '0x', counter: 0,
    });
    const seaportDomain = { name: 'Seaport', version: '1.5', chainId: 1, verifyingContract: SEAPORT };

    it('blocks a Seaport order that pays the signer nothing', () => {
      const r = review(...typed('OrderComponents', order([{ itemType: 0, token: '0x0000000000000000000000000000000000000000', identifierOrCriteria: '0', startAmount: '1', endAmount: '1', recipient: SPENDER }]), seaportDomain));
      expect(r.risk).toBe('block');
      expect(r.blockReason).toMatch(/pays you nothing/);
      expect(rowOf(r, 'You get')).toBe('NOTHING');
    });

    it('shows give / get for a normal Seaport listing (and in a bulk order)', () => {
      const listing = order([{ itemType: 0, token: '0x0000000000000000000000000000000000000000', identifierOrCriteria: '0', startAmount: parseEther('2').toString(), endAmount: parseEther('2').toString(), recipient: ME }]);
      const r = review(...typed('OrderComponents', listing, seaportDomain));
      expect(r.blockReason).toBeNull();
      expect(rowOf(r, 'You give')).toMatch(/NFT \(ERC-721\).*#42/);
      expect(rowOf(r, 'You get')).toMatch(/native coin/);
      const bulk = review(...typed('BulkOrder', { tree: [[listing, listing]] }, seaportDomain));
      expect(bulk.title).toBe('Seaport: sign 2 orders');
      expect(bulk.blockReason).toBeNull();
    });

    it('blocks known scam addresses, another account, and malformed data', () => {
      expect(review(...typed('Permit', { owner: ME, spender: SCAM, value: '1', nonce: 0, deadline: 1 })).risk).toBe('block');
      const otherAcct = m.reviewSigningRequest({ method: 'eth_signTypedData_v4', params: [SPENDER, typed('Permit', { owner: ME, spender: SPENDER, value: '1', nonce: 0, deadline: 1 })[1][1]], activeChainId: 1, account: ME });
      expect(otherAcct.blockReason).toMatch(/for account/);
      expect(review('eth_signTypedData_v4', [ME, '{not json']).risk).toBe('block');
    });

    // THN-01: the signer (ethers v6 signTypedData) derives what it signs from `types` alone and
    // never reads `primaryType` — so a dApp that ships the real struct in `types` under any other
    // name in `primaryType` must be blocked, not reviewed under the label it claims. Each case
    // pairs an attack (real struct, spoofed label) with its honest counterpart, and the
    // signature ethers would actually produce must be identical in both — proving the label
    // never changes what gets signed, only whether the sheet notices.
    it('THN-01: blocks when the declared primaryType disagrees with what `types` describes', () => {
      const spoofed = review(...typed('Mail', { owner: ME, spender: SPENDER, value: MaxUint256.toString(), nonce: 0, deadline: 1_900_000_000 }, undefined, TYPES_FOR.Permit));
      expect(spoofed.risk).toBe('block');
      expect(spoofed.blockReason).toMatch(/labelled "Mail"/);
      expect(spoofed.blockReason).toMatch(/"Permit"/);
      // The honest version of the exact same struct reviews as the dangerous unlimited permit
      // it is — proving the attack payload truly is a Permit, not a harmless "Mail".
      const honest = review(...typed('Permit', { owner: ME, spender: SPENDER, value: MaxUint256.toString(), nonce: 0, deadline: 1_900_000_000 }));
      expect(honest.risk).toBe('review');
      expect(rowOf(honest, 'Amount')).toBe('Unlimited');

      const payload = (primaryType: string) => JSON.parse(typed(primaryType, { owner: ME, spender: SPENDER, value: '1', nonce: 0, deadline: 1 }, undefined, TYPES_FOR.Permit)[1][1]);
      expect(TypedDataEncoder.hash(payload('Mail').domain, { Permit: TYPES_FOR.Permit.Permit }, payload('Mail').message))
        .toBe(TypedDataEncoder.hash(payload('Permit').domain, { Permit: TYPES_FOR.Permit.Permit }, payload('Permit').message));
    });

    it('THN-01: blocks a spoofed Seaport drainer listing disguised as an unrelated struct', () => {
      const order = { offerer: ME, zone: '0x0000000000000000000000000000000000000000',
        offer: [{ itemType: 2, token: TOKEN2, identifierOrCriteria: '42', startAmount: '1', endAmount: '1' }],
        consideration: [], orderType: 0, startTime: 0, endTime: 1_900_000_000, zoneHash: '0x', salt: '1', conduitKey: '0x', counter: 0 };
      const spoofed = review(...typed('TokenApproval', order, { name: 'Seaport', version: '1.5', chainId: 1, verifyingContract: SEAPORT }, TYPES_FOR.OrderComponents));
      expect(spoofed.risk).toBe('block');
      expect(spoofed.blockReason).toMatch(/"OrderComponents"/);
    });

    it('THN-01: blocks Permit2 transfers and allowances with a spoofed primaryType', () => {
      const d = { name: 'Permit2', chainId: 1, verifyingContract: PERMIT2 };
      const spoofedSingle = review(...typed('Message', { details: { token: TOKEN, amount: MAX160.toString(), expiration: 0, nonce: 0 }, spender: SPENDER, sigDeadline: 1_900_000_000 }, d, TYPES_FOR.PermitSingle));
      expect(spoofedSingle.risk).toBe('block');
      const spoofedTransfer = review(...typed('Message', { permitted: { token: TOKEN, amount: '1000' }, spender: SPENDER, nonce: 1, deadline: 1_900_000_000 }, d, TYPES_FOR.PermitWitnessTransferFrom));
      expect(spoofedTransfer.risk).toBe('block');
    });

    it('THN-01: blocks types that cannot be resolved to one unambiguous struct', () => {
      // No struct besides EIP712Domain: nothing to derive at all.
      expect(review(...typed('Anything', { x: 1 }, undefined, {})).risk).toBe('block');
      // Two root structs, neither referencing the other: ethers itself calls this ambiguous.
      const ambiguous = { A: [{ name: 'x', type: 'uint256' }], B: [{ name: 'y', type: 'uint256' }] };
      expect(review(...typed('A', { x: 1 }, undefined, ambiguous)).risk).toBe('block');
    });

    it('shows unknown typed data field by field', () => {
      const login = review(...typed('Login', { wallet: ME, nonce: 'abc', issuedAt: '2026-09-27' }, { name: 'Example', chainId: 1 }));
      expect(login.risk).toBe('safe');
      expect(login.title).toBe('Sign Login');
      expect(rowOf(login, 'wallet')).toBe(ME);
      const withSpender = review(...typed('Grant', { spender: SPENDER, until: 5 }, { name: 'Example', chainId: 1 }));
      expect(withSpender.risk).toBe('caution');
    });
  });

  describe(`checkRecipient (${impl})`, () => {
    it('refuses the zero address and scam addresses, allows others', () => {
      expect(m.checkRecipient('0x0000000000000000000000000000000000000000')).toMatch(/zero address/);
      expect(m.checkRecipient(SCAM.toUpperCase().replace('0X', '0x'))).toMatch(/scam-address list/);
      expect(m.checkRecipient(SPENDER)).toBeNull();
    });
  });

  describe(`reviewSigningRequest — transactions and messages (${impl})`, () => {
    const erc20 = new Interface(['function approve(address,uint256)', 'function transfer(address,uint256)', 'function setApprovalForAll(address,bool)']);
    const permit2 = new Interface(['function approve(address,address,uint160,uint48)']);
    const tx = (extra: Record<string, unknown>) => review('eth_sendTransaction', [{ from: ME, ...extra }]);

    it('a plain coin transfer names amount and recipient', () => {
      const r = tx({ to: SPENDER, value: '0x' + parseEther('1.5').toString(16) });
      expect(r.risk).toBe('safe');
      expect(r.title).toBe(`Send 1.5 to ${SPENDER}`);
    });

    it('decodes approve (unlimited, limited, revoke) and setApprovalForAll', () => {
      const unlimited = tx({ to: TOKEN, data: erc20.encodeFunctionData('approve', [SPENDER, MaxUint256]) });
      expect(unlimited.risk).toBe('review');
      expect(rowOf(unlimited, 'Amount')).toBe('Unlimited');
      expect(rowOf(unlimited, 'Spender')).toBe(SPENDER);
      expect(tx({ to: TOKEN, data: erc20.encodeFunctionData('approve', [SPENDER, 10n]) }).risk).toBe('caution');
      const revoke = tx({ to: TOKEN, data: erc20.encodeFunctionData('approve', [SPENDER, 0n]) });
      expect(revoke.risk).toBe('safe');
      expect(revoke.title).toMatch(/^Revoke/);
      const all = tx({ to: TOKEN2, data: erc20.encodeFunctionData('setApprovalForAll', [SPENDER, true]) });
      expect(all.risk).toBe('review');
      expect(all.title).toMatch(/ALL your NFTs/);
      expect(tx({ to: TOKEN2, data: erc20.encodeFunctionData('setApprovalForAll', [SPENDER, false]) }).risk).toBe('safe');
    });

    it('decodes token transfers and Permit2 approve; names unknown calls', () => {
      expect(tx({ to: TOKEN, data: erc20.encodeFunctionData('transfer', [SPENDER, 5n]) }).title).toBe(`Transfer tokens to ${SPENDER}`);
      const p2 = tx({ to: PERMIT2, data: permit2.encodeFunctionData('approve', [TOKEN, SPENDER, MAX160, 0]) });
      expect(p2.risk).toBe('review');
      expect(rowOf(p2, 'Function')).toBe('Permit2 approve');
      const unknown = tx({ to: TOKEN, data: '0xdeadbeef00' });
      expect(unknown.risk).toBe('caution');
      expect(rowOf(unknown, 'Function')).toBe('unrecognised (0xdeadbeef)');
    });

    it('blocks another chain, another account, and scam recipients', () => {
      expect(tx({ to: SPENDER, value: '0x1', chainId: '0x89' }).blockReason).toMatch(/chain 137/);
      expect(tx({ to: SPENDER, value: '0x1', chainId: '0x89' }).requiredChainId).toBe(137);
      expect(review('eth_sendTransaction', [{ from: SPENDER, to: SPENDER, value: '0x1' }]).blockReason).toMatch(/for account/);
      expect(tx({ to: SCAM, value: '0x1' }).risk).toBe('block');
      expect(tx({ to: TOKEN, data: erc20.encodeFunctionData('approve', [SCAM, 1n]) }).risk).toBe('block');
    });

    it('shows message text, and calls out opaque hashes and eth_sign', () => {
      const text = review('personal_sign', [hexlify(toUtf8Bytes('Sign in to Example\nNonce: 7')), ME]);
      expect(text.risk).toBe('safe');
      expect(rowOf(text, 'Message')).toBe('Sign in to Example\nNonce: 7');
      const hash = review('personal_sign', ['0x' + 'ab'.repeat(32), ME]);
      expect(hash.risk).toBe('review');
      expect(review('personal_sign', ['hello', SPENDER]).risk).toBe('block');
      expect(review('eth_sign', [ME, '0x' + 'cd'.repeat(32)]).risk).toBe('review');
    });
  });
}
