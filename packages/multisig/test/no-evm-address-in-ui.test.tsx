/**
 * Thanos MultiSig shows bech32 litho1… addresses and nothing else.
 *
 * Client rule, 2026-11-24, the same one Litho Vault follows: the 0x form is
 * internal — contract calls, signing, RPC, storage keys — and must never
 * reach the screen, the clipboard, a tooltip or an accessibility label. This
 * suite is the guard: it renders the components that actually print an
 * address and fails on a raw EVM address anywhere in their markup.
 *
 * TRANSACTION HASHES ARE NOT ADDRESSES and are deliberately left alone
 * (ProposalScreen's "Transaction hash" row). A hash is 0x + 64 hex, so a
 * naive /0x[0-9a-fA-F]{40}/ matches its first 42 characters — hence the
 * negative lookahead in EVM_ADDRESS below. The case at the end of this file
 * pins that distinction, so tightening the pattern can't silently start
 * failing on hashes.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evmToLitho } from '@thanos/sdk-core/src/utils/litho-address';
import { AddressInput, AddressText } from '../src/react/ui';

/** A raw EVM address: 0x + exactly 40 hex, NOT the head of a 64-hex hash. */
const EVM_ADDRESS = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;

const ADDRESS = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
const LITHO = evmToLitho(ADDRESS);

function markup(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

describe('MultiSig address rendering', () => {
  it('shows the litho1 form in the full view, with no 0x line', () => {
    const html = markup(createElement(AddressText, { address: ADDRESS, full: true, testId: 'tms-vault-address' }));
    expect(html).toContain(LITHO);
    expect(html).not.toMatch(EVM_ADDRESS);
    // The second line and its "Copy 0x address" button are gone for good.
    expect(html).not.toContain('Copy 0x address');
    expect(html).not.toContain('tms-address-evm');
  });

  it('shows the litho1 form in the compact view, with no 0x switch', () => {
    const html = markup(createElement(AddressText, { address: ADDRESS }));
    expect(html).toContain(LITHO.slice(0, 12));
    expect(html).not.toMatch(EVM_ADDRESS);
    expect(html).not.toContain('tms-address-switch');
    // …and nothing offers the 0x form behind a title or aria-label either.
    expect(html).not.toMatch(/Show the 0x address|Copy 0x/);
  });

  it('renders an unparseable value as given rather than guessing', () => {
    const html = markup(createElement(AddressText, { address: 'treasury.litho' }));
    expect(html).toContain('treasury.litho');
  });

  it('accepts a pasted 0x but echoes back litho1', () => {
    const html = markup(createElement(AddressInput, { value: ADDRESS, onChange: () => {}, testId: 'tms-recipient' }));
    // The input's own value is what the user typed — taking that away mid-paste
    // would be hostile — but the hint under it, which is what they read, is litho1.
    expect(html).toContain(LITHO);
    expect(html).not.toContain('EVM:');
    const hint = html.slice(html.indexOf('tms-recipient-hint'));
    expect(hint).not.toMatch(EVM_ADDRESS);
  });

  it('leaves a litho1 input alone instead of echoing it back', () => {
    const html = markup(createElement(AddressInput, { value: LITHO, onChange: () => {}, testId: 'tms-recipient' }));
    expect(html).not.toContain('tms-recipient-hint');
  });
});

/* The screens themselves need a client and a context to render, so they are
   covered the other way round: no MultiSig source may reach for a helper
   whose whole job is to produce a 0x string for display, and none may carry
   a hardcoded one. That is how a stray 0x would come back — someone imports
   evmAddress() for "just this one row". */
describe('MultiSig sources', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const roots = [
    join(here, '..', 'src', 'react'),
    join(here, '..', '..', '..', 'apps', 'mobile', 'components', 'MultiSig.tsx'),
  ];
  const BANNED = /\b(evmAddress|shortEvmAddress)\b/;

  function sources(path: string): string[] {
    if (statSync(path).isFile()) return /\.(ts|tsx)$/.test(path) ? [path] : [];
    return readdirSync(path).flatMap((entry) => sources(join(path, entry)));
  }

  const files = roots.flatMap(sources);

  it('finds the MultiSig UI sources', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((f) => [f.slice(f.indexOf('Thanos-Wallet') + 14) || f, f]))(
    'no 0x display helper or hardcoded address in %s',
    (_label, file) => {
      const src = readFileSync(file, 'utf8');
      // Strip comments: they explain the rule and name the banned helpers.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toMatch(BANNED);
      expect(code).not.toMatch(EVM_ADDRESS);
    },
  );
});

describe('the transaction-hash exception', () => {
  it('does not treat a tx hash as an address', () => {
    const hash = `0x${'ab'.repeat(32)}`;
    expect(hash).toHaveLength(66);
    expect(hash).not.toMatch(EVM_ADDRESS);
    // Shown truncated by ProposalScreen; still not an address.
    expect(`${hash.slice(0, 12)}…${hash.slice(-8)}`).not.toMatch(EVM_ADDRESS);
  });
});
