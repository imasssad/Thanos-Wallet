import { describe, it, expect, vi } from 'vitest';
import { Interface, MaxUint256 } from 'ethers';
import { createSessionRequestHandler, type ConfirmEntry, type WcSessionRequest } from './wc-requests';

const ME = '0x1111111111111111111111111111111111111111';
const ATTACKER = '0x9999999999999999999999999999999999999999';
const MAINNET = 9005;

function setup(opts: { sessionChain?: number; phishing?: boolean; signFails?: boolean } = {}) {
  const confirms: ConfirmEntry<WcSessionRequest>[] = [];
  const deps = {
    account: () => ME,
    sessionChainId: () => opts.sessionChain ?? MAINNET,
    setSessionChainId: vi.fn(),
    supportedChainIds: new Set([MAINNET, 1, 137]),
    respond: vi.fn(async () => {}),
    respondError: vi.fn(async () => {}),
    emitChainChanged: vi.fn(async () => {}),
    signMessage: vi.fn(async () => { if (opts.signFails) throw new Error('worker down'); return '0xsig'; }),
    signTypedData: vi.fn(async () => '0xtypedsig'),
    sendTransaction: vi.fn(async () => '0xhash'),
    confirm: (e: ConfirmEntry<WcSessionRequest>) => { confirms.push(e); },
    blockedOrigin: (origin: string) => (opts.phishing && origin.includes('evil') ? 'Known phishing site: evil.example' : null),
  };
  let n = 0;
  const handle = createSessionRequestHandler(deps);
  const send = (method: string, params: unknown[], origin = 'https://dapp.example', chainId?: string) =>
    handle({ topic: 't1', id: ++n, params: { request: { method, params }, chainId }, verifyContext: { verified: { origin } } });
  return { deps, confirms, send };
}

describe('web WalletConnect requests', () => {
  it('never sends a transaction before the user approves — even a "harmless" coin transfer', async () => {
    const { deps, confirms, send } = setup();
    await send('eth_sendTransaction', [{ from: ME, to: ATTACKER, value: '0xde0b6b3a7640000' }]);
    expect(deps.sendTransaction).not.toHaveBeenCalled();
    expect(deps.respond).not.toHaveBeenCalled();
    expect(confirms).toHaveLength(1);
    expect(confirms[0].review.title).toBe(`Send 1.0 to ${ATTACKER}`);
    await confirms[0].reject();
    expect(deps.respondError).toHaveBeenCalledWith('t1', 1, 4001, 'User rejected the transaction');
    expect(deps.sendTransaction).not.toHaveBeenCalled();
  });

  it('signs a message only after approval, then answers the dApp', async () => {
    const { deps, confirms, send } = setup();
    await send('personal_sign', ['0x68656c6c6f', ME]);
    expect(deps.signMessage).not.toHaveBeenCalled();
    expect(confirms[0].review.rows.find((r) => r.label === 'Message')?.value).toBe('hello');
    await confirms[0].approve();
    expect(deps.signMessage).toHaveBeenCalledWith('0x68656c6c6f');
    expect(deps.respond).toHaveBeenCalledWith('t1', 1, '0xsig');
  });

  it('shows typed data decoded and strips EIP712Domain before signing', async () => {
    const { deps, confirms, send } = setup();
    const typed = {
      domain: { name: 'USD Coin', chainId: MAINNET, verifyingContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
      types: { EIP712Domain: [{ name: 'name', type: 'string' }], Permit: [{ name: 'owner', type: 'address' }] },
      primaryType: 'Permit',
      message: { owner: ME, spender: ATTACKER, value: MaxUint256.toString(), nonce: 0, deadline: 1_900_000_000 },
    };
    await send('eth_signTypedData_v4', [ME, JSON.stringify(typed)]);
    expect(confirms[0].review.risk).toBe('review');
    expect(confirms[0].review.rows.find((r) => r.label === 'Amount')?.value).toBe('Unlimited');
    await confirms[0].approve();
    expect(deps.signTypedData).toHaveBeenCalledWith({ domain: typed.domain, types: { Permit: typed.types.Permit }, message: typed.message });
  });

  it('a blocked request cannot be approved', async () => {
    const { deps, confirms, send } = setup();
    const other = { domain: { name: 'X', chainId: 1 }, types: { A: [] }, primaryType: 'A', message: {} };
    await send('eth_signTypedData_v4', [ME, JSON.stringify(other)]);
    expect(confirms[0].review.risk).toBe('block');
    await expect(confirms[0].approve()).rejects.toThrow(/chain 1/);
    expect(deps.signTypedData).not.toHaveBeenCalled();
  });

  it('sends a transaction on exactly the chain the request names', async () => {
    const { deps, confirms, send } = setup();
    await send('eth_sendTransaction', [{ from: ME, to: ATTACKER, value: '0x1' }], 'https://dapp.example', 'eip155:137');
    expect(confirms[0].review.risk).not.toBe('block');
    await confirms[0].approve();
    expect(deps.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ to: ATTACKER, value: '0x1' }), 137);
    // No chain named → the session's chain (Lithosphere Mainnet by default).
    await send('eth_sendTransaction', [{ from: ME, to: ATTACKER, value: '0x2' }]);
    await confirms[1].approve();
    expect(deps.sendTransaction).toHaveBeenLastCalledWith(expect.objectContaining({ value: '0x2' }), MAINNET);
  });

  it('blocks a transaction on a chain the wallet cannot send on, and phishing origins', async () => {
    const offChain = setup();
    await offChain.send('eth_sendTransaction', [{ from: ME, to: ATTACKER, value: '0x1' }], 'https://dapp.example', 'eip155:700777');
    expect(offChain.confirms[0].review.blockReason).toMatch(/can't send on chain 700777/);
    await expect(offChain.confirms[0].approve()).rejects.toThrow();
    expect(offChain.deps.sendTransaction).not.toHaveBeenCalled();

    const phish = setup({ phishing: true });
    await phish.send('personal_sign', ['0x68656c6c6f', ME], 'https://evil.example');
    expect(phish.confirms[0].review.blockReason).toMatch(/phishing/);
    await expect(phish.confirms[0].approve()).rejects.toThrow();
    expect(phish.deps.signMessage).not.toHaveBeenCalled();
  });

  it('decodes an unlimited approve for the sheet', async () => {
    const { confirms, send } = setup();
    const data = new Interface(['function approve(address,uint256)']).encodeFunctionData('approve', [ATTACKER, MaxUint256]);
    await send('eth_sendTransaction', [{ from: ME, to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', data }]);
    expect(confirms[0].review.risk).toBe('review');
    expect(confirms[0].review.rows.find((r) => r.label === 'Spender')?.value).toBe(ATTACKER);
  });

  it('answers the dApp when signing fails after approval', async () => {
    const { deps, confirms, send } = setup({ signFails: true });
    await send('personal_sign', ['0x68656c6c6f', ME]);
    await expect(confirms[0].approve()).rejects.toThrow('worker down');
    expect(deps.respondError).toHaveBeenCalledWith('t1', 1, -32603, 'worker down');
  });

  it('answers read-only methods directly, dedups spam, and rejects unknown methods', async () => {
    const { deps, confirms, send } = setup();
    await send('eth_accounts', []);
    expect(deps.respond).toHaveBeenCalledWith('t1', 1, [ME]);
    await send('personal_sign', ['0x01', ME]);
    await send('personal_sign', ['0x01', ME]);
    expect(confirms).toHaveLength(1);
    expect(deps.respondError).toHaveBeenCalledWith('t1', 3, -32002, expect.stringMatching(/Duplicate/));
    await send('eth_signTransaction', [{}]);
    expect(deps.respondError).toHaveBeenCalledWith('t1', 4, 4200, 'Method not supported: eth_signTransaction');
  });

  it('switches to a supported chain and refuses unknown ones', async () => {
    const { deps, send } = setup();
    await send('wallet_switchEthereumChain', [{ chainId: '0x89' }]);
    expect(deps.setSessionChainId).toHaveBeenCalledWith('t1', 137);
    expect(deps.respond).toHaveBeenCalledWith('t1', 1, null);
    await send('wallet_switchEthereumChain', [{ chainId: '0x5' }]);
    expect(deps.respondError).toHaveBeenCalledWith('t1', 2, 4902, expect.any(String));
    await send('wallet_addEthereumChain', [{ chainId: '0x5' }]);
    expect(deps.respondError).toHaveBeenCalledWith('t1', 3, 4001, expect.any(String));
  });
});
