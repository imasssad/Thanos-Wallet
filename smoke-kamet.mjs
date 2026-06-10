// Layer-2 smoke test: verify the patched SDK's Kamet wiring end-to-end.
// Pulls all values FROM the built SDK (no hardcoding), then does a real
// balance read against the RPC the SDK itself points at.
import { getNetworkByChainId } from './packages/sdk-core/src/chains/networks.ts';
import { getDefaultTokensForChain, getVerifiedLep100Tokens } from './packages/sdk-core/src/tokens/registry.ts';
import { KAMET_MULTX_BRIDGE } from './packages/sdk-core/src/bridge/kamet-config.ts';
import { Lep100Client } from './packages/sdk-core/src/clients/lep100-client.ts';

const KAMET = 900523;
const OWNER = '0x10ed4F004Fe708014ae27Bcc20c9Ed9df3f4eadF'; // deployer (holds LEP100 supply)
let pass = 0, fail = 0;
const ok = (c, m) => { console.log(`${c ? '  ✅' : '  ❌'} ${m}`); c ? pass++ : fail++; };

async function ethCall(rpc, to, data) {
  const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) });
  return (await r.json()).result;
}
async function ethChainId(rpc) {
  const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
  return parseInt((await r.json()).result, 16);
}

console.log('\n[1] Network config from SDK');
const net = getNetworkByChainId(KAMET);
ok(net.chainId === 900523, `chainId = ${net.chainId} (expect 900523)`);
ok(net.rpcUrls[0] === 'https://rpc-3.litho.ai', `rpc = ${net.rpcUrls[0]}`);
ok(net.extras?.restUrl === 'https://api-3.litho.ai', `rest = ${net.extras?.restUrl}`);
ok(net.nativeCurrency.symbol === 'LITHO', `native = ${net.nativeCurrency.symbol}`);

console.log('\n[2] Token registry from SDK');
const toks = getDefaultTokensForChain(KAMET);
const lep = getVerifiedLep100Tokens(KAMET);
ok(lep.length === 12, `verified LEP100 count = ${lep.length} (expect 12)`);
const allHaveAddr = lep.every(t => /^0x[0-9a-fA-F]{40}$/.test(t.addresses[KAMET] || ''));
ok(allHaveAddr, `every LEP100 has a real 0x address on ${KAMET}`);
const qtt = toks.find(t => t.symbol === 'QTT');
ok(!!qtt?.addresses[KAMET], `QTT address = ${qtt?.addresses[KAMET]}`);

console.log('\n[3] Bridge config from SDK');
ok(KAMET_MULTX_BRIDGE.bridgeAddress === '0x3a896BDF3a1088287FA84aB5a43bB30e2535F263',
  `bridge = ${KAMET_MULTX_BRIDGE.bridgeAddress}`);

console.log('\n[4] Live RPC read using ONLY SDK-provided values');
const liveId = await ethChainId(net.rpcUrls[0]);
ok(liveId === net.chainId, `live eth_chainId = ${liveId} matches SDK config`);
// balanceOf(OWNER) on the QTT address the SDK gave us
const data = '0x70a08231' + OWNER.slice(2).padStart(64, '0');
const raw = await ethCall(net.rpcUrls[0], qtt.addresses[KAMET], data);
const bal = BigInt(raw) / (10n ** BigInt(qtt.decimals));
ok(bal > 0n, `QTT balanceOf(deployer) = ${bal.toString()} (read via SDK's rpc+address)`);

console.log('\n[5] Default Lep100Client transport (eth_call mapping)');
try {
  const res = await new Lep100Client().balanceOf({ chainId: KAMET, contractAddress: qtt.addresses[KAMET], owner: OWNER });
  ok(BigInt(res.balance) > 0n, `Lep100Client.balanceOf = ${res.balance} (via EvmLithicTransport -> eth_call)`);
  ok(res.token.symbol === 'QTT' && res.token.decimals === 18, `metadata: ${res.token.symbol}/${res.token.decimals}`);
} catch (e) {
  ok(false, `Lep100Client default transport FAILED: ${String(e.message).slice(0, 80)}`);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed${fail ? ' ❌' : ' ✅'}\n`);
process.exit(fail ? 1 : 0);
