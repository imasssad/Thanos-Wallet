'use client';

import React, { useMemo, useState } from 'react';
import { Button, Card, SectionTitle } from '@thanos/ui';
import {
  BITCOIN_MAINNET,
  KAMET_TESTNET,
  MAKALU_TESTNET,
  SOLANA_MAINNET,
  getDefaultTokensForChain,
  getIgniteDexUrl,
  getVerifiedLep100Tokens,
  MAKALU_TESTNET as MAKALU
} from '@thanos/sdk-core';
import { useWalletEngine, useWalletState } from '@thanos/sdk-react';

const chains = [MAKALU_TESTNET, KAMET_TESTNET, BITCOIN_MAINNET, SOLANA_MAINNET];

export function Dashboard() {
  const engine = useWalletEngine();
  const state = useWalletState();
  const [network, setNetwork] = useState(MAKALU_TESTNET.chainId);
  const [status, setStatus] = useState('Wallet not initialized');
  const [wcUri, setWcUri] = useState('wc:wallet-example@2?relay-protocol=irn');
  const [tokenAddress, setTokenAddress] = useState('0x1234567890abcdef1234567890abcdef12345678');
  const [dnnsName, setDnnsName] = useState('user.litho');
  const [bridgeId, setBridgeId] = useState('exec-demo-001');
  const [lep100Token, setLep100Token] = useState('lep100:makalu:colle');
  const [lep100Recipient, setLep100Recipient] = useState('litho1demoaddress0000000000000000000000000');
  const [lep100Amount, setLep100Amount] = useState('25');
  const [spender, setSpender] = useState('litho1multxrouter00000000000000000000000000');
  const [approveAmount, setApproveAmount] = useState('1000');
  const tokens = useMemo(() => [...getDefaultTokensForChain(network), ...(state?.importedTokens || []).filter((t) => t.chainIds.includes(network))], [network, state?.importedTokens]);
  const lep100Tokens = useMemo(() => getVerifiedLep100Tokens(MAKALU.chainId), []);

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: 24, display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ marginBottom: 4 }}>Wallet v8</h1>
        <p style={{ color: '#9ca3af' }}>
          Multi-surface wallet suite with send and receive flows for BTC, SOL, SPL, EVM, LITHO, Lithic, and expanded LEP100 support including approvals,
          revoke flows, activity indexing, WalletConnect, portfolio indexing, DNNS, MultX swap tracking, token import, and release-ready configs.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <Card title="Wallet Lifecycle">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Button onClick={async () => {
              const next = await engine.createWallet();
              setStatus(`Created wallet ${next.activeAccount?.address}`);
            }}>Create</Button>
            <Button onClick={async () => {
              const result = await engine.simulateCurrentSend({ chainId: MAKALU_TESTNET.chainId, to: 'user.litho', amount: '1' });
              setStatus(result.summary);
            }}>Simulate</Button>
            <Button onClick={async () => {
              const portfolio = await engine.getPortfolio().catch((error) => ({ error: String(error) }));
              setStatus(JSON.stringify(portfolio, null, 2));
            }}>Portfolio</Button>
          </div>
          <p style={{ wordBreak: 'break-word' }}>{status}</p>
          <p style={{ color: '#9ca3af' }}>Primary address: {state?.activeAccount?.address || 'Not initialized'}</p>
        </Card>

        <Card title="Networks + Receive">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {chains.map((chain) => (
              <Button key={chain.chainId} onClick={() => { setNetwork(chain.chainId); engine.setActiveChain(chain.chainId); }} style={{ background: network === chain.chainId ? '#7c3aed' : '#1f1f1f' }}>
                {chain.name}
              </Button>
            ))}
          </div>
          <p>Receive on current chain: {state?.accounts.find((a) => a.chainId === network)?.address || 'Create a wallet first'}</p>
          <p style={{ color: '#9ca3af' }}>Send flows are scaffolded in the shared engine for EVM/Lithic, BTC, SOL/SPL, and LEP100.</p>
        </Card>

        <Card title="Assets + Import">
          <ul>
            {tokens.map((token) => <li key={`${token.symbol}-${token.chainIds.join('-')}`}>{token.symbol} - {token.name}</li>)}
          </ul>
          <input value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)} style={inputStyle} />
          <Button onClick={async () => {
            const token = await engine.importToken({ chainId: network, address: tokenAddress, symbol: 'USER', name: 'User Imported', standard: network === SOLANA_MAINNET.chainId ? 'spl' : 'erc20' });
            setStatus(`Imported ${token.symbol} on ${network}`);
          }}>Import token</Button>
        </Card>

        <Card title="Swap + Bridge Tracking">
          <Button onClick={async () => {
            const result = await engine.executeIntent({
              id: crypto.randomUUID(),
              title: 'MultX route',
              kind: 'swap',
              payload: { fromChainId: MAKALU_TESTNET.chainId, toChainId: SOLANA_MAINNET.chainId, fromToken: 'LITHO', toToken: 'SOL', amount: '25', walletAddress: state?.activeAccount?.address || '0x0' }
            }).catch((error) => ({ error: String(error) }));
            setStatus(JSON.stringify(result, null, 2));
          }}>Get quote + execute</Button>
          <input value={bridgeId} onChange={(e) => setBridgeId(e.target.value)} style={inputStyle} />
          <Button onClick={async () => setStatus(JSON.stringify(await engine.bridgeTracker.poll(bridgeId), null, 2))}>Poll bridge</Button>
          <a href={getIgniteDexUrl({ symbol: 'LITHO', chain: 'makalu' })} target="_blank" rel="noreferrer" style={{ color: '#c4b5fd', display: 'block', marginTop: 12 }}>Launch Ignite DEX</a>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        <Card title="LEP100 Portfolio + Send">
          <SectionTitle>Verified Makalu LEP100 tokens</SectionTitle>
          <ul>
            {lep100Tokens.map((token) => <li key={token.addresses[MAKALU.chainId]}>{token.symbol} - {token.name} ({token.addresses[MAKALU.chainId]})</li>)}
          </ul>
          <input value={lep100Token} onChange={(e) => setLep100Token(e.target.value)} style={inputStyle} />
          <input value={lep100Recipient} onChange={(e) => setLep100Recipient(e.target.value)} style={inputStyle} />
          <input value={lep100Amount} onChange={(e) => setLep100Amount(e.target.value)} style={inputStyle} />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Button onClick={async () => setStatus(JSON.stringify(await engine.getLep100Balance(lep100Token), null, 2))}>Balance</Button>
            <Button onClick={async () => setStatus(JSON.stringify(await engine.sendLep100(lep100Token, lep100Recipient, lep100Amount, 'wallet-ui'), null, 2))}>Send LEP100</Button>
            <Button onClick={async () => setStatus(JSON.stringify(await engine.getLep100Portfolio(), null, 2))}>Portfolio view</Button>
          </div>
        </Card>

        <Card title="LEP100 Approvals">
          <SectionTitle>Approve or revoke spenders</SectionTitle>
          <input value={spender} onChange={(e) => setSpender(e.target.value)} style={inputStyle} />
          <input value={approveAmount} onChange={(e) => setApproveAmount(e.target.value)} style={inputStyle} />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Button onClick={async () => setStatus(JSON.stringify(await engine.getLep100Allowance(lep100Token, spender), null, 2))}>Allowance</Button>
            <Button onClick={async () => setStatus(JSON.stringify(await engine.approveLep100(lep100Token, spender, approveAmount), null, 2))}>Approve</Button>
            <Button onClick={async () => setStatus(JSON.stringify(await engine.revokeLep100(lep100Token, spender), null, 2))}>Revoke</Button>
          </div>
        </Card>

        <Card title="LEP100 Sync Jobs">
          <SectionTitle>Indexer sync controls</SectionTitle>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Button onClick={async () => setStatus(JSON.stringify(await engine.queueLep100Sync('incremental'), null, 2))}>Queue incremental</Button>
            <Button onClick={async () => setStatus(JSON.stringify(await engine.queueLep100Sync('bootstrap'), null, 2))}>Queue bootstrap</Button>
            <Button onClick={async () => setStatus(JSON.stringify(await engine.queueLep100Sync('backfill'), null, 2))}>Queue backfill</Button>
          </div>
        </Card>

        <Card title="WalletConnect / dApp Sessions">
          <SectionTitle>Pair with dApps</SectionTitle>
          <input value={wcUri} onChange={(e) => setWcUri(e.target.value)} style={inputStyle} />
          <Button onClick={async () => {
            const session = await engine.pairWalletConnect(wcUri).catch((error) => ({ error: String(error) }));
            setStatus(JSON.stringify(session, null, 2));
          }}>Pair session</Button>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#d1d5db' }}>{JSON.stringify(state?.walletConnectSessions || [], null, 2)}</pre>
        </Card>

        <Card title="DNNS Flows">
          <SectionTitle>Resolve or register</SectionTitle>
          <input value={dnnsName} onChange={(e) => setDnnsName(e.target.value)} style={inputStyle} />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Button onClick={async () => setStatus(JSON.stringify(await engine.resolveDnns(dnnsName), null, 2))}>Resolve</Button>
            <Button onClick={async () => setStatus(JSON.stringify(await engine.registerDnns(dnnsName), null, 2))}>Register</Button>
          </div>
        </Card>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = { width: '100%', padding: 12, borderRadius: 12, border: '1px solid #333', background: '#050505', color: '#fff', margin: '8px 0 12px' };
