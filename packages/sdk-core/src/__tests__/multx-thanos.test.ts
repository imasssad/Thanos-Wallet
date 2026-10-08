import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Interface, Wallet } from 'ethers';
import {
  createThanosBridge, multxThanosConfig, parseBridgeAmount, formatBridgeAmount, bridgeTransferLabel,
  bridgeErrorMessage, bridgeSigner, MULTX_HISTORY_KEY, MultXAdapterError,
  type MultXBridgeTransfer, type MultXKeyValueStore,
} from '../multx-thanos/service';
import { startMockEvm, type MockEvm } from './support/mock-evm';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const SRC = 9005;   // Lithosphere Mainnet
const DST = 8453;   // Base
const SRC_BRIDGE = '0x1000000000000000000000000000000000000001';
const DST_BRIDGE = '0x2000000000000000000000000000000000000002';
const SRC_LAX = '0x3000000000000000000000000000000000000003';
const DST_LAX = '0x4000000000000000000000000000000000000004';
const MANIFEST_URL = 'https://releases.example/multx/manifest.json';
const API = 'https://bridge.example';
const KEY = '0x' + '11'.repeat(32);
const USER = new Wallet(KEY).address;
const E18 = 10n ** 18n;

const MANIFEST = {
  tag: '2026.10.1', commit: 'c'.repeat(40), disabled: false, apiUrl: API,
  routes: [{
    sourceChainId: SRC, sourceBridge: SRC_BRIDGE, destinationChainId: DST, destinationBridge: DST_BRIDGE,
    tokens: [{ symbol: 'LAX', sourceAddress: SRC_LAX, destinationAddress: DST_LAX, decimals: 18 }],
    maxAmountBaseUnits: (1000n * E18).toString(),
  }],
};

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function memoryStore(seed?: MultXBridgeTransfer[]): MultXKeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>(seed ? [[MULTX_HISTORY_KEY, JSON.stringify(seed)]] : []);
  return { data, get: async (key) => data.get(key) ?? null, set: async (key, v) => { data.set(key, v); } };
}

describe('multxThanosConfig', () => {
  const HASH = 'AB'.repeat(32);
  it('is on only with the flag, an https manifest URL and a 64-hex SHA-256', () => {
    expect(multxThanosConfig('true', MANIFEST_URL, HASH)).toEqual({ enabled: true, manifestUrl: MANIFEST_URL, manifestSha256: HASH.toLowerCase() });
    expect(multxThanosConfig(true, ` ${MANIFEST_URL} `, ` ${HASH} `).enabled).toBe(true);
    expect(multxThanosConfig(undefined, MANIFEST_URL, HASH).enabled).toBe(false);
    expect(multxThanosConfig('1', MANIFEST_URL, HASH).enabled).toBe(false);
    expect(multxThanosConfig('true', 'http://releases.example/m.json', HASH).enabled).toBe(false);
    expect(multxThanosConfig('true', '', HASH).enabled).toBe(false);
    expect(multxThanosConfig('true', MANIFEST_URL, 'abc').enabled).toBe(false);
  });
});

describe('amounts and labels', () => {
  const lax = { symbol: 'LAX', decimals: 18, maxAmountBaseUnits: (1000n * E18).toString() };
  it('parses what people type into base units', () => {
    expect(parseBridgeAmount('12.5', lax)).toBe(125n * E18 / 10n);
    expect(parseBridgeAmount(' 1,000 ', lax)).toBe(1000n * E18);
    expect(parseBridgeAmount('.5', lax)).toBe(E18 / 2n);
    expect(parseBridgeAmount('3.', lax)).toBe(3n * E18);
  });
  it('refuses empty, zero, too precise, malformed and over-cap amounts', () => {
    for (const bad of ['', '0', '0.0', 'abc', '1.2.3', '-1', '1e3']) {
      expect(() => parseBridgeAmount(bad, lax)).toThrowError(MultXAdapterError);
    }
    expect(() => parseBridgeAmount('1.1234567', { symbol: 'USDC', decimals: 6 })).toThrow('USDC has 6 decimal places at most.');
    expect(() => parseBridgeAmount('1000.01', lax)).toThrow('This route takes at most 1000 LAX per transfer.');
  });
  it('formats base units briefly', () => {
    expect(formatBridgeAmount(125n * E18 / 10n, 18)).toBe('12.5');
    expect(formatBridgeAmount('1234567890', 6)).toBe('1234.56789');
    expect(formatBridgeAmount(1n, 18)).toBe('0');
    expect(formatBridgeAmount(10n * E18, 18)).toBe('10');
  });
  it('labels each status', () => {
    expect(bridgeTransferLabel({ status: 'RELEASED', sourceTxHash: '0x1' })).toEqual({ label: 'Arrived', tone: 'ok' });
    expect(bridgeTransferLabel({ status: 'SIGNING', sourceTxHash: '0x1' }).label).toBe('Validators signing');
    expect(bridgeTransferLabel({ status: 'REVIEW', sourceTxHash: '0x1' }).tone).toBe('warn');
    expect(bridgeTransferLabel({ status: 'SUBMITTED', sourceTxHash: '' }).label).toBe('Not sent');
    expect(bridgeErrorMessage(new Error('raw rpc text'))).toBe('Something went wrong with the bridge. Please try again.');
  });
});

describe('the mobile copy', () => {
  it('matches packages/multx-adapter and sdk-core (node scripts/sync-multx-thanos.mjs --check)', () => {
    expect(() => execFileSync(process.execPath, ['scripts/sync-multx-thanos.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' })).not.toThrow();
  });
});

describe('Thanos bridge against a local chain', () => {
  let evm: MockEvm;
  let manifestRaw: string;
  let statusCalls: Map<string, number>;
  let relayer: (lock: { from: string; amount: bigint }) => string;
  let fetchImpl: typeof fetch;
  const sleep = vi.fn(async () => undefined);

  beforeEach(async () => {
    evm = await startMockEvm([SRC, DST]);
    evm.chain(SRC).supported.add(`${SRC_BRIDGE}:${SRC_LAX}`.toLowerCase());
    evm.setBalance(SRC, SRC_LAX, USER, 100n * E18);
    manifestRaw = JSON.stringify(MANIFEST);
    statusCalls = new Map();
    relayer = (lock) => evm.release(DST, { token: DST_LAX, from: DST_BRIDGE, to: lock.from, amount: lock.amount });
    // The release manifest and bridge.litho.ai's status API; RPC goes to the local chain.
    fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === MANIFEST_URL) return new Response(manifestRaw);
      if (url.startsWith(`${API}/bridge/status/`)) {
        const hash = decodeURIComponent(url.slice(`${API}/bridge/status/`.length));
        const lock = evm.chain(SRC).locks.get(hash);
        const n = (statusCalls.get(hash) ?? 0) + 1;
        statusCalls.set(hash, n);
        if (!lock || n === 1) return new Response('{"error":"not found"}', { status: 404 });
        if (n === 2) return Response.json({ status: 'signing' });
        return Response.json({ status: 'completed', releaseTxHash: relayer(lock), sourceTxHash: hash });
      }
      return fetch(input, init);
    }) as typeof fetch;
  });
  afterEach(async () => { await evm.close(); sleep.mockClear(); });

  function bridge(store = memoryStore(), cfg = multxThanosConfig('true', MANIFEST_URL, sha(manifestRaw))) {
    return { store, bridge: createThanosBridge({ config: cfg, store, rpcUrlFor: (id) => evm.url(id), fetchImpl, sleep }) };
  }
  const signer = () => bridgeSigner(KEY, evm.url(SRC), SRC);

  it('offers nothing and fetches nothing when the build has the bridge off', async () => {
    const { bridge: b } = bridge(memoryStore(), multxThanosConfig('false', MANIFEST_URL, sha(manifestRaw)));
    await expect(b.load()).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    const s = signer();
    await expect(b.send({ signer: s.signer, option: { key: 'x', sourceChainId: SRC, destinationChainId: DST, symbol: 'LAX', decimals: 18, sourceToken: SRC_LAX, destinationToken: DST_LAX }, amount: '1' }))
      .rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
    s.destroy();
  });

  it('approves, locks, waits for the release and verifies it on the destination chain', async () => {
    const { bridge: b } = bridge();
    const [option] = await b.load();
    expect(option).toMatchObject({ key: `${SRC}>${DST}:LAX`, symbol: 'LAX', decimals: 18, sourceToken: SRC_LAX, destinationToken: DST_LAX });
    expect(b.release()).toEqual({ tag: '2026.10.1', commit: 'c'.repeat(40) });
    await expect(b.balanceOf(option, USER)).resolves.toBe(100n * E18);

    const steps: string[] = [];
    const updates: string[] = [];
    const s = signer();
    const done = await b.send({
      signer: s.signer, option, amount: '12.5',
      onStep: (st) => steps.push(st), onUpdate: (t) => updates.push(t.status),
    });
    s.destroy();

    expect(done).toMatchObject({ status: 'RELEASED', symbol: 'LAX', decimals: 18, userAddress: USER, amountBaseUnits: (125n * E18 / 10n).toString(), integration: 'thanos' });
    expect(done.destinationTxHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(steps).toEqual(['checking', 'approving', 'locking', 'bridging']);
    expect(updates[0]).toBe('SUBMITTED');
    expect(updates).toContain('FINALIZING');
    expect(updates).toContain('SIGNING');
    expect(updates.at(-1)).toBe('RELEASED');

    // On-chain: one approve to the bridge, then lockTokens(token, amount, 8453).
    const src = evm.chain(SRC);
    expect(src.sent.map((t) => t.to?.toLowerCase())).toEqual([SRC_LAX.toLowerCase(), SRC_BRIDGE.toLowerCase()]);
    expect([...src.locks.values()]).toEqual([{ from: USER, token: SRC_LAX, amount: 125n * E18 / 10n, targetChain: BigInt(DST), bridge: SRC_BRIDGE.toLowerCase() }]);
    expect(done.sourceTxHash).toBe(src.sent[1].hash);
    await expect(b.balanceOf(option, USER)).resolves.toBe(875n * E18 / 10n);
    // Polled through the 404 and "signing".
    expect(statusCalls.get(done.sourceTxHash)).toBe(3);

    const history = await b.history(USER.toLowerCase());
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: 'RELEASED', symbol: 'LAX', sourceTxHash: done.sourceTxHash });
    await expect(b.history('0x' + '99'.repeat(20))).resolves.toEqual([]);
  });

  it('skips the approval when the allowance already covers the amount', async () => {
    evm.chain(SRC).allowances.set(`${SRC_LAX}:${USER}:${SRC_BRIDGE}`.toLowerCase(), 50n * E18);
    const { bridge: b } = bridge();
    const [option] = await b.load();
    const s = signer();
    await expect(b.send({ signer: s.signer, option, amount: '5' })).resolves.toMatchObject({ status: 'RELEASED' });
    s.destroy();
    expect(evm.chain(SRC).sent.map((t) => t.to?.toLowerCase())).toEqual([SRC_BRIDGE.toLowerCase()]);
  });

  it('stops before sending anything when the balance is short, and keeps no history entry', async () => {
    const { bridge: b, store } = bridge();
    const [option] = await b.load();
    const s = signer();
    await expect(b.send({ signer: s.signer, option, amount: '101' })).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    s.destroy();
    expect(evm.chain(SRC).sent).toHaveLength(0);
    expect(JSON.parse(store.data.get(MULTX_HISTORY_KEY) ?? '[]')).toEqual([]);
  });

  it('never shows a release that paid the wrong amount as arrived', async () => {
    relayer = (lock) => evm.release(DST, { token: DST_LAX, from: DST_BRIDGE, to: lock.from, amount: lock.amount - 1n });
    const { bridge: b } = bridge();
    const [option] = await b.load();
    const s = signer();
    const done = await b.send({ signer: s.signer, option, amount: '1' });
    s.destroy();
    expect(done.status).toBe('REVIEW');
    expect(bridgeTransferLabel(done).label).toBe('Needs review');
  });

  it('records a lock that reverted on-chain as failed', async () => {
    evm.chain(SRC).revertLocks = true;
    const { bridge: b } = bridge();
    const [option] = await b.load();
    const s = signer();
    await expect(b.send({ signer: s.signer, option, amount: '1' })).rejects.toMatchObject({ code: 'EXECUTION_REVERTED' });
    s.destroy();
    const [t] = await b.history();
    expect(t).toMatchObject({ status: 'FAILED', sourceTxHash: evm.chain(SRC).sent[1].hash });
  });

  it('honours the manifest kill switch and refuses a manifest that fails its hash', async () => {
    manifestRaw = JSON.stringify({ ...MANIFEST, disabled: true });
    const off = bridge().bridge;
    await expect(off.load()).resolves.toEqual([]);
    const s = signer();
    await expect(off.send({ signer: s.signer, option: { key: 'x', sourceChainId: SRC, destinationChainId: DST, symbol: 'LAX', decimals: 18, sourceToken: SRC_LAX, destinationToken: DST_LAX }, amount: '1' }))
      .rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
    s.destroy();
    expect(evm.chain(SRC).sent).toHaveLength(0);

    const tampered = createThanosBridge({
      config: multxThanosConfig('true', MANIFEST_URL, sha(JSON.stringify(MANIFEST))),
      store: memoryStore(), rpcUrlFor: (id) => evm.url(id), fetchImpl, sleep,
    });
    await expect(tampered.load()).rejects.toMatchObject({ code: 'MANIFEST_INVALID' });
  });

  it('refuses a route or token the manifest does not list', async () => {
    const { bridge: b } = bridge();
    const [option] = await b.load();
    const s = signer();
    await expect(b.send({ signer: s.signer, option: { ...option, symbol: 'USDT' }, amount: '1' })).rejects.toMatchObject({ code: 'UNSUPPORTED_TOKEN' });
    await expect(b.send({ signer: s.signer, option: { ...option, destinationChainId: 1 }, amount: '1' })).rejects.toMatchObject({ code: 'UNSUPPORTED_ROUTE' });
    s.destroy();
    expect(evm.chain(SRC).sent).toHaveLength(0);
  });

  it('finishes a transfer the app closed on, after a restart', async () => {
    // The lock went out, then the app was closed before the release.
    const { bridge: first } = bridge();
    const [option] = await first.load();
    evm.chain(SRC).allowances.set(`${SRC_LAX}:${USER}:${SRC_BRIDGE}`.toLowerCase(), 10n * E18);
    const s = signer();
    const lockTx = await s.signer.sendTransaction({
      to: SRC_BRIDGE,
      data: new Interface(['function lockTokens(address,uint256,uint256)']).encodeFunctionData('lockTokens', [SRC_LAX, 2n * E18, DST]),
    });
    s.destroy();
    const saved: MultXBridgeTransfer = {
      integration: 'thanos', integrationRequestId: 'thanos-before-restart', manifestTag: '2026.10.1', manifestCommit: 'c'.repeat(40),
      sourceChainId: SRC, sourceBridge: SRC_BRIDGE, sourceToken: option.sourceToken, sourceTxHash: lockTx.hash,
      userAddress: USER, amountBaseUnits: (2n * E18).toString(), destinationChainId: DST, destinationBridge: DST_BRIDGE,
      destinationToken: DST_LAX, status: 'FINALIZING', createdAt: '2026-10-08T10:00:00.000Z', updatedAt: '2026-10-08T10:00:00.000Z',
      symbol: 'LAX', decimals: 18,
    };
    const other = { ...saved, integrationRequestId: 'thanos-other-wallet', userAddress: '0x' + '77'.repeat(20) };
    const notSent = { ...saved, integrationRequestId: 'thanos-never-sent', sourceTxHash: '', status: 'SUBMITTED' as const };

    const { bridge: second, store } = bridge(memoryStore([saved, other, notSent]));
    const seen: string[] = [];
    await second.resumePending(USER, (t) => seen.push(`${t.integrationRequestId}:${t.status}`));
    expect(seen).toEqual(['thanos-before-restart:RELEASED']);

    const all = JSON.parse(store.data.get(MULTX_HISTORY_KEY)!) as MultXBridgeTransfer[];
    expect(all.map((t) => [t.integrationRequestId, t.status])).toEqual([
      ['thanos-before-restart', 'RELEASED'], ['thanos-other-wallet', 'FINALIZING'], ['thanos-never-sent', 'SUBMITTED'],
    ]);
    expect(all[0]).toMatchObject({ symbol: 'LAX', createdAt: saved.createdAt });
    expect(all[0].destinationTxHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
