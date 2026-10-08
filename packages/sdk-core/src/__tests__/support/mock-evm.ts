/**
 * A small in-process EVM JSON-RPC node for bridge tests: enough of the API
 * for an ethers v6 Wallet to estimate, sign, broadcast and wait, with ERC-20
 * balances/allowances and a MultX bridge's lockTokens/supportedTokens. Each
 * chain is served at http://127.0.0.1:<port>/<chainId>.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Interface, Transaction, getAddress, id, toBeHex, zeroPadValue } from 'ethers';

const ERC20 = new Interface([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
]);
const BRIDGE = new Interface([
  'function lockTokens(address token, uint256 amount, uint256 targetChain) returns (bytes32)',
  'function supportedTokens(address token) view returns (bool)',
]);
export const TRANSFER_TOPIC = id('Transfer(address,address,uint256)');

const GWEI = '0x3b9aca00';
const HASH_ZERO = '0x' + '00'.repeat(32);

interface Log { address: string; topics: string[]; data: string }
interface Receipt { hash: string; from: string; to: string; status: 0 | 1; block: number; logs: Log[] }

export interface Lock { from: string; token: string; amount: bigint; targetChain: bigint; bridge: string }

export interface MockChain {
  chainId: number;
  balances: Map<string, bigint>;
  allowances: Map<string, bigint>;
  /** `${bridge}:${token}` pairs the bridge reports as supported. */
  supported: Set<string>;
  locks: Map<string, Lock>;
  receipts: Map<string, Receipt>;
  nonces: Map<string, number>;
  /** Every transaction broadcast, decoded. */
  sent: Transaction[];
  block: number;
  /** Mine lock transactions as reverted (status 0). */
  revertLocks: boolean;
}

const k = (...parts: string[]) => parts.map((p) => p.toLowerCase()).join(':');

export interface MockEvm {
  url(chainId: number): string;
  chain(chainId: number): MockChain;
  setBalance(chainId: number, token: string, owner: string, amount: bigint): void;
  /** Mines a transaction on `chainId` that emitted one ERC-20 Transfer — the
   *  bridge relayer's release. Returns its hash. */
  release(chainId: number, t: { token: string; from: string; to: string; amount: bigint }): string;
  close(): Promise<void>;
}

class RpcError extends Error {
  constructor(readonly code: number, message: string) { super(message); }
}

export async function startMockEvm(chainIds: number[]): Promise<MockEvm> {
  const chains = new Map<number, MockChain>(chainIds.map((chainId) => [chainId, {
    chainId, balances: new Map(), allowances: new Map(), supported: new Set(), locks: new Map(),
    receipts: new Map(), nonces: new Map(), sent: [], block: 100, revertLocks: false,
  }]));
  let synthetic = 0;

  const getChain = (chainId: number) => {
    const c = chains.get(chainId);
    if (!c) throw new Error(`mock-evm: no chain ${chainId}`);
    return c;
  };

  function block(c: MockChain) {
    return {
      number: toBeHex(c.block), hash: zeroPadValue(toBeHex(c.block), 32), parentHash: zeroPadValue(toBeHex(c.block - 1), 32),
      nonce: '0x0000000000000000', sha3Uncles: HASH_ZERO, logsBloom: '0x' + '00'.repeat(256), transactionsRoot: HASH_ZERO,
      stateRoot: HASH_ZERO, receiptsRoot: HASH_ZERO, miner: '0x' + '00'.repeat(20), difficulty: '0x0', totalDifficulty: '0x0',
      extraData: '0x', size: '0x100', gasLimit: '0x1c9c380', gasUsed: '0x0',
      timestamp: toBeHex(Math.floor(Date.now() / 1000)), transactions: [], uncles: [], baseFeePerGas: GWEI,
    };
  }

  function receiptJson(r: Receipt) {
    const blockHash = zeroPadValue(toBeHex(r.block), 32);
    return {
      transactionHash: r.hash, transactionIndex: '0x0', blockHash, blockNumber: toBeHex(r.block),
      from: r.from, to: r.to, cumulativeGasUsed: '0x30d40', gasUsed: '0x30d40', effectiveGasPrice: GWEI,
      contractAddress: null, logsBloom: '0x' + '00'.repeat(256), status: r.status ? '0x1' : '0x0', type: '0x2',
      logs: r.logs.map((l, i) => ({
        ...l, blockNumber: toBeHex(r.block), blockHash, transactionHash: r.hash,
        transactionIndex: '0x0', logIndex: toBeHex(i), removed: false,
      })),
    };
  }

  /** Runs a call/transaction against the chain's state. `commit` applies it. */
  function execute(c: MockChain, from: string, to: string, data: string, commit: boolean): { ret: string; lock?: Lock; revert?: string } {
    const sel = data.slice(0, 10);
    const tokenFn = (() => { try { return ERC20.parseTransaction({ data }); } catch { return null; } })();
    const bridgeFn = (() => { try { return BRIDGE.parseTransaction({ data }); } catch { return null; } })();
    if (tokenFn?.name === 'balanceOf') return { ret: ERC20.encodeFunctionResult('balanceOf', [c.balances.get(k(to, tokenFn.args[0])) ?? 0n]) };
    if (tokenFn?.name === 'allowance') return { ret: ERC20.encodeFunctionResult('allowance', [c.allowances.get(k(to, tokenFn.args[0], tokenFn.args[1])) ?? 0n]) };
    if (tokenFn?.name === 'approve') {
      if (commit) c.allowances.set(k(to, from, tokenFn.args[0]), tokenFn.args[1]);
      return { ret: ERC20.encodeFunctionResult('approve', [true]) };
    }
    if (bridgeFn?.name === 'supportedTokens') return { ret: BRIDGE.encodeFunctionResult('supportedTokens', [c.supported.has(k(to, bridgeFn.args[0]))]) };
    if (bridgeFn?.name === 'lockTokens') {
      const [token, amount, targetChain] = bridgeFn.args as unknown as [string, bigint, bigint];
      if (!c.supported.has(k(to, token))) return { ret: '0x', revert: 'token not supported' };
      const allowance = c.allowances.get(k(token, from, to)) ?? 0n;
      const balance = c.balances.get(k(token, from)) ?? 0n;
      if (allowance < amount) return { ret: '0x', revert: 'insufficient allowance' };
      if (balance < amount) return { ret: '0x', revert: 'insufficient balance' };
      if (commit) {
        c.allowances.set(k(token, from, to), allowance - amount);
        c.balances.set(k(token, from), balance - amount);
      }
      return { ret: HASH_ZERO, lock: { from: getAddress(from), token, amount, targetChain, bridge: to } };
    }
    return { ret: '0x', revert: `unknown selector ${sel}` };
  }

  function handle(c: MockChain, method: string, params: unknown[]): unknown {
    switch (method) {
      case 'eth_chainId': return toBeHex(c.chainId);
      case 'net_version': return String(c.chainId);
      case 'eth_blockNumber': return toBeHex(c.block);
      case 'eth_getBlockByNumber': return block(c);
      case 'eth_gasPrice':
      case 'eth_maxPriorityFeePerGas': return GWEI;
      case 'eth_getTransactionCount': return toBeHex(c.nonces.get(String(params[0]).toLowerCase()) ?? 0);
      case 'eth_getCode': return '0x60';
      case 'eth_call':
      case 'eth_estimateGas': {
        const tx = params[0] as { from?: string; to: string; data?: string; input?: string };
        const out = execute(c, tx.from ?? '0x' + '00'.repeat(20), tx.to, tx.data ?? tx.input ?? '0x', false);
        if (out.revert) throw new RpcError(3, `execution reverted: ${out.revert}`);
        return method === 'eth_call' ? out.ret : '0x30d40';
      }
      case 'eth_sendRawTransaction': {
        const tx = Transaction.from(String(params[0]));
        if (Number(tx.chainId) !== c.chainId) throw new RpcError(-32000, 'invalid chain id for signer');
        const from = tx.from!.toLowerCase();
        const nonce = c.nonces.get(from) ?? 0;
        if (tx.nonce !== nonce) throw new RpcError(-32000, `invalid nonce; got ${tx.nonce}, expected ${nonce}`);
        c.nonces.set(from, nonce + 1);
        c.block += 1;
        c.sent.push(tx);
        let status: 0 | 1 = 1;
        let lockOut: Lock | undefined;
        const isLock = tx.data.startsWith(BRIDGE.getFunction('lockTokens')!.selector);
        if (isLock && c.revertLocks) status = 0;
        else {
          const out = execute(c, from, tx.to!, tx.data, true);
          if (out.revert) status = 0;
          lockOut = out.lock;
        }
        c.receipts.set(tx.hash!, { hash: tx.hash!, from: tx.from!, to: tx.to!, status, block: c.block, logs: [] });
        if (lockOut) c.locks.set(tx.hash!, lockOut);
        return tx.hash;
      }
      case 'eth_getTransactionReceipt': {
        const r = c.receipts.get(String(params[0]));
        return r ? receiptJson(r) : null;
      }
      case 'eth_getTransactionByHash': {
        const tx = c.sent.find((t) => t.hash === params[0]);
        if (!tx) return null;
        const r = c.receipts.get(tx.hash!);
        return {
          hash: tx.hash, from: tx.from, to: tx.to, nonce: toBeHex(tx.nonce), input: tx.data, value: toBeHex(tx.value),
          gas: toBeHex(tx.gasLimit), maxFeePerGas: toBeHex(tx.maxFeePerGas ?? 0n), maxPriorityFeePerGas: toBeHex(tx.maxPriorityFeePerGas ?? 0n),
          gasPrice: GWEI, type: toBeHex(tx.type ?? 2), chainId: toBeHex(c.chainId), v: '0x0', r: HASH_ZERO, s: HASH_ZERO,
          blockNumber: r ? toBeHex(r.block) : null, blockHash: r ? zeroPadValue(toBeHex(r.block), 32) : null, transactionIndex: r ? '0x0' : null,
          accessList: [],
        };
      }
      default: throw new RpcError(-32601, `method ${method} not supported`);
    }
  }

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const c = chains.get(Number((req.url ?? '/').slice(1)));
      const answer = (call: { id: unknown; method: string; params?: unknown[] }) => {
        try {
          if (!c) throw new RpcError(-32000, 'unknown chain');
          return { jsonrpc: '2.0', id: call.id, result: handle(c, call.method, call.params ?? []) };
        } catch (err) {
          const e = err as RpcError;
          return { jsonrpc: '2.0', id: call.id, error: { code: e.code ?? -32603, message: e.message, ...(e.code === 3 ? { data: '0x' } : {}) } };
        }
      };
      const parsed = JSON.parse(body);
      const out = Array.isArray(parsed) ? parsed.map(answer) : answer(parsed);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;

  return {
    url: (chainId) => `http://127.0.0.1:${port}/${chainId}`,
    chain: getChain,
    setBalance(chainId, token, owner, amount) { getChain(chainId).balances.set(k(token, owner), amount); },
    release(chainId, t) {
      const c = getChain(chainId);
      synthetic += 1;
      c.block += 1;
      const hash = zeroPadValue(toBeHex(0xfeed0000 + synthetic), 32);
      c.receipts.set(hash, {
        hash, from: t.from, to: t.token, status: 1, block: c.block,
        logs: [{ address: t.token, topics: [TRANSFER_TOPIC, zeroPadValue(t.from, 32), zeroPadValue(t.to, 32)], data: zeroPadValue(toBeHex(t.amount), 32) }],
      });
      return hash;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
