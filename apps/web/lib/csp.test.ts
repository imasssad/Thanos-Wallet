import { describe, it, expect } from 'vitest';
import { SUPPORTED_NETWORKS } from '@thanos/sdk-core/src/chains/networks';
import { buildCsp } from './csp';
import { EVM_CHAINS } from './evm-chains';

const directives = (csp: string) => new Map(csp.split(';').map((d) => {
  const [name, ...rest] = d.trim().split(/\s+/);
  return [name, rest.join(' ')] as const;
}));

describe('buildCsp', () => {
  const wallet = directives(buildCsp('abc123'));
  const statik = directives(buildCsp());

  it("gives the wallet a nonce + 'strict-dynamic' script policy with no 'unsafe-inline'", () => {
    expect(wallet.get('script-src')).toBe("'self' 'nonce-abc123' 'strict-dynamic' 'wasm-unsafe-eval'");
  });

  it("keeps 'unsafe-inline' only on the static (pre-rendered pages) policy", () => {
    expect(statik.get('script-src')).toBe("'self' 'unsafe-inline' 'wasm-unsafe-eval'");
  });

  it('differs in script-src only', () => {
    wallet.delete('script-src');
    statik.delete('script-src');
    expect(wallet).toEqual(statik);
  });

  it("never allows 'unsafe-eval', plugins or framing", () => {
    for (const csp of [buildCsp('n'), buildCsp()]) {
      expect(csp).not.toContain("'unsafe-eval'");
      expect(directives(csp).get('object-src')).toBe("'none'");
      expect(directives(csp).get('frame-ancestors')).toBe("'none'");
    }
  });

  it('lets the browser reach every chain RPC the wallet is configured with', () => {
    // A missing host isn't an error anyone sees: the browser blocks the
    // call and the wallet falls back or shows a zero balance.
    const connect = directives(buildCsp()).get('connect-src')!.split(' ');
    const rpcs = [
      ...SUPPORTED_NETWORKS.flatMap((n) => n.rpcUrls),
      ...EVM_CHAINS.map((c) => c.rpcUrl),
    ];
    const blocked = rpcs.map((u) => new URL(u).origin).filter((o) => !connect.includes(o));
    expect(blocked).toEqual([]);
  });

  it('lets Activity read every explorer sdk-core fetchChainHistory calls', () => {
    const connect = directives(buildCsp()).get('connect-src')!.split(' ');
    const explorers = [
      'https://lithoscan.ai', 'https://eth.blockscout.com', 'https://base.blockscout.com',
      'https://arbitrum.blockscout.com', 'https://polygon.blockscout.com', 'https://explorer.optimism.io',
      'https://api.routescan.io', 'https://api.etherscan.io', 'https://mempool.space',
      'https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com', 'https://cosmos-rest.publicnode.com',
    ];
    expect(explorers.filter((o) => !connect.includes(o))).toEqual([]);
  });
  it('lists a MultiSig RPC or indexer the build sets: https, or http only on this machine', () => {
    const saved = { rpc: process.env.NEXT_PUBLIC_MULTISIG_RPC_URL, idx: process.env.NEXT_PUBLIC_MULTISIG_INDEXER_URL };
    try {
      process.env.NEXT_PUBLIC_MULTISIG_RPC_URL = 'http://127.0.0.1:18546';
      process.env.NEXT_PUBLIC_MULTISIG_INDEXER_URL = 'https://multisig-indexer.example/v1';
      const connect = directives(buildCsp('n')).get('connect-src') ?? '';
      expect(connect).toContain(' http://127.0.0.1:18546');
      expect(connect).toContain(' https://multisig-indexer.example');
      process.env.NEXT_PUBLIC_MULTISIG_RPC_URL = 'http://rpc.example';
      expect(directives(buildCsp('n')).get('connect-src')).not.toContain('rpc.example');
    } finally {
      if (saved.rpc === undefined) delete process.env.NEXT_PUBLIC_MULTISIG_RPC_URL; else process.env.NEXT_PUBLIC_MULTISIG_RPC_URL = saved.rpc;
      if (saved.idx === undefined) delete process.env.NEXT_PUBLIC_MULTISIG_INDEXER_URL; else process.env.NEXT_PUBLIC_MULTISIG_INDEXER_URL = saved.idx;
    }
  });
});
