import { describe, expect, inject, it } from 'vitest';
import { Contract, JsonRpcProvider, getAddress, parseEther } from 'ethers';
import { NATIVE_TOKEN, ProposalState, toLithoAddress } from '@litho-vault/sdk';
import { MultisigClient, multisigNetwork, type BridgeTransaction, type KeyValueStore, type WalletBridge } from '../src';

const chain = inject('chain');
const provider = new JsonRpcProvider(chain.rpcUrl, 31337, { staticNetwork: true });

function network() {
  return multisigNetwork({
    CHAIN_ID: '31337',
    RPC_URL: chain.rpcUrl,
    FACTORY: chain.factory,
    LENS: chain.lens,
    AI_GUARD: chain.aiGuard,
    RECOVERY_GUARD: chain.recoveryGuard,
    FREEZE_GUARD: chain.freezeGuard,
    IMPLEMENTATION: chain.implementation,
  });
}

function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
}

/** A wallet bridge backed by one of the local chain's unlocked accounts, recording what it was asked to send. */
async function bridgeFor(index: number, canSign = true) {
  const signer = await provider.getSigner(index);
  const sent: BridgeTransaction[] = [];
  const bridge: WalletBridge = {
    address: await signer.getAddress(),
    canSign,
    cannotSignReason: canSign ? undefined : 'This is a watch-only account',
    async sendTransaction(tx) {
      sent.push(tx);
      const r = await signer.sendTransaction({ to: tx.to, data: tx.data, value: tx.value, gasLimit: tx.gasLimit, chainId: tx.chainId });
      return r.hash;
    },
    signTypedData: ({ domain, types, message }) => signer.signTypedData(domain, types, message),
  };
  return { bridge, sent, address: bridge.address };
}

describe('network configuration', () => {
  it('defaults to Lithosphere Mainnet, unavailable until Litho Vault is published there', () => {
    const n = multisigNetwork();
    expect(n.chain.id).toBe(9005);
    expect(n.chain.rpcUrl).toBe('https://rpc-mainnet.litho.ai');
    expect(n.factory).toBeNull();
    expect(new MultisigClient(n, null, { store: memoryStore() }).available).toBe(false);
  });

  it('takes a testnet or local deployment from the build environment, and only https services', () => {
    const n = network();
    expect(n.chain.id).toBe(31337);
    expect(n.factory).toBe(getAddress(chain.factory));
    expect(multisigNetwork({ INDEXER_URL: 'https://indexer.example/' }).indexerUrl).toBe('https://indexer.example');
    expect(multisigNetwork({ INDEXER_URL: 'http://127.0.0.1:8080' }).indexerUrl).toBe('http://127.0.0.1:8080');
    expect(() => multisigNetwork({ INDEXER_URL: 'http://indexer.example' })).toThrow(/https/);
    expect(() => multisigNetwork({ APP_URL: 'javascript:alert(1)' })).toThrow(/https/);
    expect(multisigNetwork({ RPC_URL: 'https://rpc-mainnet.litho.ai' }, { browserRpcUrl: (u) => `/rpc?u=${u}` }).readRpcUrl).toBe('/rpc?u=https://rpc-mainnet.litho.ai');
  });
});

describe('saved multisigs', () => {
  it('keeps names clean, refuses bad addresses and treats litho1 and 0x as one entry', async () => {
    const client = new MultisigClient(network(), null, { store: memoryStore() });
    const a = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
    await client.saved.add(a, 'Treasury‮');
    await client.saved.add(toLithoAddress(a), 'Treasury desk');
    const list = await client.saved.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('Treasury desk');
    await expect(client.saved.add('litho1notanaddress')).rejects.toThrow(/valid address/);
    await client.saved.remove(a);
    expect(await client.saved.list()).toHaveLength(0);
  });
});

describe('a 2-of-3 Thanos MultiSig, end to end', () => {
  it('creates, finds, proposes, reviews, approves and executes', async () => {
    const alice = await bridgeFor(1);
    const bob = await bridgeFor(2);
    const carol = await bridgeFor(3);
    const aliceClient = new MultisigClient(network(), alice.bridge, { store: memoryStore() });

    // Create: Alice is always the first signer; the others may be typed as litho1 (as Thanos shows them).
    const draft = aliceClient.draftMultisig({ others: [toLithoAddress(bob.address), carol.address], threshold: 2 });
    expect(draft.errors).toEqual([]);
    expect(draft.config.signers.map((s) => s.address)).toEqual([alice.address, bob.address, carol.address]);
    const predicted = await aliceClient.predictAddress(draft.config);
    const created = await aliceClient.create(draft.config, 'Team treasury');
    expect(created.address).toBe(predicted);
    expect(alice.sent.at(-1)).toMatchObject({ chainId: 31337, rpcUrl: chain.rpcUrl, to: getAddress(chain.factory), value: 0n });

    // Bob's wallet finds it from the factory's events without being told the address.
    const bobClient = new MultisigClient(network(), bob.bridge, { store: memoryStore() });
    const [found] = await bobClient.summaries(bob.address);
    expect(found).toMatchObject({ address: created.address, threshold: 2n, isSigner: true, open: 0 });

    // Fund it, then Alice proposes sending 1.5 LITHO to a litho1 recipient.
    const funder = await provider.getSigner(0);
    await (await funder.sendTransaction({ to: created.address, value: parseEther('10') })).wait();
    const recipient = getAddress('0x00000000000000000000000000000000000beef1');
    const calls = aliceClient.transferCalls({ asset: NATIVE_TOKEN, amount: '1.5', recipient: toLithoAddress(recipient) });
    const draftReview = await aliceClient.reviewDraft(created.address, calls);
    expect(draftReview.fields.map((f) => f.key)).toEqual([
      'actionType', 'asset', 'amount', 'recipient', 'contract', 'function', 'decoded', 'raw',
      'simulation', 'required', 'current', 'timing', 'warnings', 'fee',
    ]);
    expect(draftReview.review.simulation.status).toBe('success');
    // Review data keeps the 0x form; every screen shows it as litho1 (SDK displayAccount).
    expect(draftReview.review.recipients).toEqual([recipient]);
    expect(draftReview.fields.find((f) => f.key === 'recipient')!.value).toBe(toLithoAddress(recipient));
    const { id } = await aliceClient.propose(created.address, calls);
    expect(id).toBe(1n);

    // Bob sees it waiting for him, reviews it and approves.
    const [bobView] = await bobClient.summaries(bob.address);
    expect(bobView).toMatchObject({ open: 1, needsMyApproval: 1, readyToExecute: 0 });
    const pending = await bobClient.proposal(created.address, id);
    expect(pending.details.state).toBe(ProposalState.PENDING);
    expect(pending.fields.find((f) => f.key === 'amount')!.value).toBe('1.5 LITHO');
    await bobClient.approve(created.address, id);

    // Ready: Carol (who never approved) can execute it; it lands and moves to the closed list.
    const carolClient = new MultisigClient(network(), carol.bridge, { store: memoryStore() });
    const ready = await carolClient.proposal(created.address, id);
    expect(ready.details.state).toBe(ProposalState.READY);
    await carolClient.execute(created.address, id, ready);
    expect(await provider.getBalance(recipient)).toBe(parseEther('1.5'));
    const lists = await carolClient.proposals(created.address);
    expect(lists.open).toHaveLength(0);
    expect(lists.closed[0]!.state).toBe(ProposalState.EXECUTED);
  });

  it('sends tokens, revokes, cancels, and refuses to act for an account that cannot sign', async () => {
    const alice = await bridgeFor(4);
    const bob = await bridgeFor(5);
    const aliceClient = new MultisigClient(network(), alice.bridge, { store: memoryStore() });
    const draft = aliceClient.draftMultisig({ others: [bob.address], threshold: 2 });
    const { address } = await aliceClient.create(draft.config, 'Ops');

    const token = new Contract(chain.token, ['function mint(address,uint256)', 'function balanceOf(address) view returns (uint256)'], await provider.getSigner(0));
    await (await token.getFunction('mint')(address, 1000n)).wait();
    const mlep = { address: getAddress(chain.token), kind: 'erc20' as const, symbol: 'MLEP', name: 'Mock LEP100', decimals: 0 };
    const { id } = await aliceClient.propose(address, aliceClient.transferCalls({ asset: mlep, amount: '250', recipient: bob.address }));

    const bobClient = new MultisigClient(network(), bob.bridge, { store: memoryStore() });
    await bobClient.approve(address, id);
    expect((await bobClient.proposal(address, id)).details.state).toBe(ProposalState.READY);
    await bobClient.revoke(address, id);
    expect((await bobClient.proposal(address, id)).details.state).toBe(ProposalState.PENDING);

    // Only the proposer cancels directly.
    await expect(bobClient.cancel(address, id)).rejects.toThrow();
    await aliceClient.cancel(address, id);
    expect((await aliceClient.proposal(address, id)).details.state).toBe(ProposalState.CANCELLED);
    expect(await token.getFunction('balanceOf')(bob.address)).toBe(0n);

    const watcher = await bridgeFor(5, false);
    const watchOnly = new MultisigClient(network(), watcher.bridge, { store: memoryStore() });
    await expect(watchOnly.propose(address, aliceClient.transferCalls({ asset: NATIVE_TOKEN, amount: '1', recipient: bob.address }))).rejects.toThrow(/watch-only/);
    expect(watcher.sent).toHaveLength(0);
  });

  it('checks a multisig before adding it, and reports invalid signer lists', async () => {
    const alice = await bridgeFor(6);
    const client = new MultisigClient(network(), alice.bridge, { store: memoryStore() });
    await expect(client.addExisting(chain.token)).rejects.toThrow(/No Litho Vault multisig/);
    expect(client.draftMultisig({ others: ['litho1bad'], threshold: 1 }).errors[0]).toMatch(/not a valid address/);
    expect(client.draftMultisig({ others: [alice.address], threshold: 1 }).errors.join()).toMatch(/listed twice/);
    expect(client.draftMultisig({ others: [], threshold: 2 }).errors.join()).toMatch(/Threshold must be between 1 and 1/);
  });
});

describe('bridges that pass requests as JSON', () => {
  it('jsonSafe keeps an approval signature identical', async () => {
    const { jsonSafe } = await import('../src');
    const { TypedDataEncoder } = await import('ethers');
    const domain = { name: 'LithoVault', version: '1', chainId: 9005n, verifyingContract: '0x5FbDB2315678afecb367f032d93F642f64180aa3' };
    const types = { Approval: [{ name: 'proposalId', type: 'uint256' }, { name: 'validUntil', type: 'uint64' }] };
    const message = { proposalId: 7n, validUntil: 1_800_000_000n };
    const safe = jsonSafe({ domain, types, message });
    expect(safe.domain.chainId).toBe('9005');
    expect(safe.message.proposalId).toBe('7');
    expect(TypedDataEncoder.hash(safe.domain, safe.types, safe.message)).toBe(TypedDataEncoder.hash(domain, types, message));
  });
});
