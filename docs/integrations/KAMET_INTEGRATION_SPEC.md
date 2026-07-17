# Thanos Wallet — Lithosphere Kamet Integration Spec

> **Audience**: Thanos Wallet engineering team
> **From**: Lithosphere Validator Infra Team
> **Status**: Ready to hand over once intro lands
> **Last reviewed**: 2026-05-19

This document is the complete integration brief for adding **Kamet (mainnet)**
support to the Thanos browser extension and mobile wallet. It is meant to
be read end-to-end before our discovery call so we can scope phases in a
single meeting.

---

## 1. Network at a glance

| Field | Value |
|---|---|
| **Chain name** | Lithosphere Kamet |
| **Network type** | EVM-compatible Cosmos chain (Evmos fork) |
| **Cosmos chain ID** | `lithosphere_900523-2` |
| **EVM chain ID (decimal)** | `900523` |
| **EVM chain ID (hex)** | `0xDBDAB` |
| **Native gas token** | `LITHO` (base unit: `ulitho`, 18 decimals) |
| **Bech32 prefix** | `litho` (validator operator: `lithovaloper`) |
| **Block time** | ~525 ms |
| **Consensus** | CometBFT BFT (Cosmos SDK) |
| **EVM** | Ethermint-compatible |
| **Mainnet promoted** | 2026-05-18 (Kamet IS the mainnet) |

Add-to-wallet snippet (matches MetaMask `wallet_addEthereumChain`):

```js
{
  chainId: '0xDBDAB',                   // 900523
  chainName: 'Lithosphere Kamet',
  nativeCurrency: { name: 'LITHO', symbol: 'LITHO', decimals: 18 },
  rpcUrls: ['https://rpc-3.litho.ai'],
  blockExplorerUrls: ['https://kamet.litho.ai'],
  iconUrls: ['https://kamet.litho.ai/logo.png'],   // brand asset — final URL TBD
}
```

---

## 2. RPC endpoints

| Service | URL |
|---|---|
| EVM JSON-RPC (HTTPS) | `https://rpc-3.litho.ai` |
| EVM WebSocket | `wss://rpc-3.litho.ai/websocket` |
| Cosmos REST (LCD) | `https://api-3.litho.ai` |
| CometBFT RPC | `https://rpc-3.litho.ai` (shares port with EVM JSON-RPC, separate path) |
| Block explorer | `https://kamet.litho.ai` |
| Names portal | `https://kamet.litho.ai/names-portal/` |
| Bridge (Kamet side) | `https://kamet.litho.ai/bridge` (UI) + `https://bridge.litho.ai` (API) |
| Faucet | `https://kamet.litho.ai/faucet` |
| Status page | `https://status.litho.ai` |

The CometBFT RPC and the EVM JSON-RPC live behind the same nginx vhost
(`rpc-3.litho.ai`) — they don't conflict because CometBFT uses path-based
routes (`/status`, `/block`, `/tx`, etc.) while EVM JSON-RPC is a POST to
`/`. The wallet should route based on which method it's invoking.

---

## 3. LEP100 token registry

12 production LEP100 ERC20 tokens on Kamet. Source of truth:
[`bridge-api/faucet-assets.json`](../../bridge-api/faucet-assets.json).

| Symbol | Name | Address | Decimals |
|---|---|---|---|
| LITHO | Lithosphere (native) | (native; no contract) | 18 |
| wLITHO | Wrapped Lithosphere | `0xC0FC628e3aB128fe387e7ed5e729bD809C017888` | 18 |
| QTT | Quantts | `0x16EE7127C9E03e29ca5727e23dd7CB03D283cDBe` | 18 |
| COLLE | Colle AI | `0x0573f66cb4bC34618e7AB8a941F7883DD2515dCA` | 18 |
| LitBTC | LitBTC | `0x3A8D5FdC6c8dA9f14C535424b6F7206eC1996016` | 18 |
| LAX | Lithosphere Algo | `0xe8f504f9cE5391Fb5968b317f0b24b8A0306ACeb` | 18 |
| JOT | Jot Art | `0x6AE14CEb3962664b13c5dEF29EB172De76bd0ac9` | 18 |
| IMAGE | Imagen Network | `0x8Ba6E3A0759144245f2939eB54164e32bb78B8E0` | 18 |
| AGII | AGII | `0x17D506aF1d0Dc2f4f64f15748a5aC46FAd3f06D7` | 18 |
| BLDR | Built AI | `0xF05f1F79273874E554F02ce06585E16132a3B62B` | 18 |
| FGPT | FurGPT | `0x2F366c6350A6b211f6D6F847c3D56738C2E847ca` | 18 |
| MUSA | Mansa AI | `0x17A357262097B4e70acFfe8B71bC61e8bBcc3B42` | 18 |
| DOGE | DOGE | `0x72791d72B6097D487cEC58605A62396c50C08b69` | 18 |

We expect Thanos to add a chain-token-registry mechanism — happy to deliver
this list as JSON in whatever shape you currently consume. Open question:
how does your wallet handle a chain announcing a new token mid-release
cycle? Discuss on the call.

---

## 4. MultX Bridge integration

The MultX bridge moves LEP100 tokens between Kamet and external EVM chains
(today: Sepolia + Base Sepolia testnets; soon: Ethereum / BNB Chain / Base
mainnet once audited).

### 4.1 SDK

Use the pre-built `@litho/multx-sdk` (TypeScript). It lives in
`packages/multx-sdk/` of `litho-validator-infra` and we can publish it to
npm or your registry — let us know which.

Surface (high level):

```ts
import { MultXClient } from '@litho/multx-sdk';

const client = new MultXClient({
  bridgeAddress: '0x3a896BDF3a1088287FA84aB5a43bB30e2535F263',   // Kamet
  bridgeApiUrl: 'https://bridge.litho.ai',
  supportedTokens: BRIDGE_TOKENS,                                  // see §3
  destinationChains: [{ chainId: 11155111, name: 'Ethereum Sepolia' }, ...],
});

// Outbound (Kamet → dest)
await client.approveToken({ signer, tokenAddress, amount });
const { txHash } = await client.lockTokens({ signer, tokenAddress, amount, targetChainId });

// Poll status (status → 'completed' when dest-chain release lands)
const status = await client.getStatus(txHash);

// Reverse (dest → Kamet) — same shape with the dest-chain bridge address
```

Full reference: [`packages/multx-sdk/dist/index.d.ts`](../../packages/multx-sdk/dist/index.d.ts).

### 4.2 Bridge UI surface

The on-bridge.litho-explorer page at `kamet.litho.ai/bridge` has:
- Outbound flow (Kamet → dest)
- Inbound flow (dest → Kamet) at `kamet.litho.ai/bridge/inbound`
- Live signature progress bar (polls `/bridge/status/<txHash>` on the API)
- Transaction history

We recommend Thanos either:
- **Embed via deep link** — open `kamet.litho.ai/bridge?token=COLLE&amount=100` and let the explorer drive
- **Native UI using the SDK** — call `MultXClient` directly from the wallet; cleaner UX, more dev effort

Open question for discovery call: which approach does Thanos prefer?

### 4.3 Current state (testnet dry-run complete)

- Kamet bridge: deployed + hardened, validators in 5-of-7 KMS multisig
- Sepolia + Base Sepolia: dest-chain bridges + 12 wrapped tokens each
- ETH / BNB / Base mainnet: pending client audit approval + treasury allocation

---

## 5. Staking via Evmos precompile

Lithosphere staking uses the standard Evmos staking precompile at
`0x0000000000000000000000000000000000000800`. ABI is documented at
[Evmos docs](https://docs.evmos.org/develop/smart-contracts/staking).

Key methods Thanos UI will likely call:

```solidity
function delegate(address validatorAddress, uint256 amount) external returns (bool success);
function undelegate(address validatorAddress, uint256 amount) external returns (int64 completionTime);
function redelegate(address validatorSrcAddress, address validatorDstAddress, uint256 amount) external returns (int64 completionTime);
function withdrawDelegatorRewards(address delegatorAddress, address validatorAddress) external returns (Coin[] memory rewards);
function withdrawValidatorCommission(address validatorAddress) external returns (Coin[] memory commission);
```

Read-side (validator list, delegations, rewards) is easier via the Cosmos
REST/LCD:

- `GET /cosmos/staking/v1beta1/validators` — paginated validator list
- `GET /cosmos/staking/v1beta1/delegations/<delegator-litho1...>` — your delegations
- `GET /cosmos/staking/v1beta1/unbonding_delegations/<delegator>` — pending unbondings
- `GET /cosmos/distribution/v1beta1/delegators/<delegator>/rewards` — claimable rewards

Note: validator addresses in the precompile take the EVM hex form, but the
LCD uses the `lithovaloper1...` bech32 form. The conversion is purely
encoding (same underlying bytes); we can ship a helper if needed.

**Unbonding period**: 21 days (Cosmos default).

---

## 6. Governance via Evmos precompile

Governance precompile at `0x0000000000000000000000000000000000000805`. ABI
documented in [Evmos governance docs](https://docs.evmos.org/develop/smart-contracts/gov).

Key methods:

```solidity
function vote(uint64 proposalId, VoteOption option) external returns (bool success);
function voteWeighted(uint64 proposalId, WeightedVoteOption[] options) external returns (bool success);

enum VoteOption { Unspecified, Yes, Abstain, No, NoWithVeto }
```

Read-side via LCD:

- `GET /cosmos/gov/v1beta1/proposals` — active proposals
- `GET /cosmos/gov/v1beta1/proposals/<id>` — specific proposal details
- `GET /cosmos/gov/v1beta1/proposals/<id>/tally` — current vote tally
- `GET /cosmos/gov/v1beta1/proposals/<id>/votes` — list of votes cast

The existing governance UI at `kamet.litho.ai/governance` is a reference
implementation Thanos can mirror.

---

## 7. DEX swap (Uniswap v3 fork)

```
Factory:                    0xe6c61Ce7Cc92c732A815250d7c2292eD21F6bf85
SwapRouter:                 0x7a067A343e5e94BfDda46df496507eB98c826dA4
NonfungiblePositionManager: 0xB5d58B337128A6aA10494F9cA7cB899A778D00a0
Quoter (V2):                0xcC57C38F6225077464a3cdEaE176D212f839Cf3C
```

Standard Uniswap v3 ABIs — `@uniswap/v3-periphery` works as-is. Example swap:

```ts
import { ethers } from 'ethers';

const ROUTER = '0x7a067A343e5e94BfDda46df496507eB98c826dA4';
const ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
];

// 1. Approve the router to spend tokenIn (standard ERC20.approve)
await tokenIn.approve(ROUTER, amount);

// 2. Get a quote from the Quoter (off-chain)
const quote = await quoter.callStatic.quoteExactInputSingle({
  tokenIn: WLITHO, tokenOut: QTT,
  amountIn: amount, fee: 3000, sqrtPriceLimitX96: 0,
});

// 3. Swap with slippage tolerance
const minOut = quote.amountOut.mul(9950).div(10000); // 0.50% slippage
const swap = await router.exactInputSingle({
  tokenIn: WLITHO,
  tokenOut: QTT,
  fee: 3000,
  recipient: userAddress,
  deadline: Math.floor(Date.now() / 1000) + 600,
  amountIn: amount,
  amountOutMinimum: minOut,
  sqrtPriceLimitX96: 0,
});
```

Active pools (0.30% fee tier): wLITHO/QTT, wLITHO/COLLE, wLITHO/LitBTC.
The explorer's `/dex/pool` page enumerates live pools.

---

## 8. DNNS — `.litho` names

ENS-fork naming service deployed on Kamet. Cross-chain resolution via
CCIP-Read on Sepolia + Base Sepolia.

```
Registry:        0x316dc15bF377F7187e5BE38BA19e673Ca823d1ab
BaseRegistrar:   0xB3D1a8e92FFAD73Ab8a07BF37A8E1374df8B3722
Controller:      0xb042145B0Fd44b53691b59E98bE8F9F9EB0365c5
PublicResolver:  0x54639d978418766ccaD25ffb22C58fd5A5Df8C09 (current; older 0xc0F0849... resolver still active for legacy v0 names)
ReverseRegistrar:0xDeFae50866342C8f72bd03292FFeAeb53eC781C2

CCIP resolver (Sepolia chainId 11155111):       0x90d852D4D3a83618e731CBC1e0505Ded849A50F1
CCIP resolver (Base Sepolia chainId 84532):     0x90d852D4D3a83618e731CBC1e0505Ded849A50F1
Gateway URL:                                    https://kamet.litho.ai/dnns-gateway/
```

ethers v5+ supports CCIP-Read automatically — `provider.resolveName('dex.litho')`
works on a Sepolia provider, returns the Kamet-registered address.

Wallet UI hooks:
- **Address book**: resolve `<name>.litho` → address when user types a name
- **Reverse display**: show `<name>.litho` next to `0x...` in tx history (the kamet-explorer does this on AddressPage and TransactionDetail)
- **Registration flow**: optional; can deep-link to `kamet.litho.ai/names`

---

## 9. Recommended Thanos UI hooks (per page)

Suggested phased rollout — each phase delivers user-visible value independently.

### Phase 1 — Network support (smallest possible MVP)

- [ ] Add Kamet to chain dropdown
- [ ] Show LITHO balance
- [ ] Send LITHO (native EVM transfer)
- [ ] EIP-1193 generic `eth_sendTransaction` for any contract interaction

Acceptance: user can switch to Kamet, see LITHO balance, send LITHO to another address.

### Phase 2 — LEP100 tokens

- [ ] Token registry seeded with 12 LEP100s (see §3)
- [ ] Per-token balance display via multicall
- [ ] Send / receive ERC20 transfers
- [ ] Approval flow
- [ ] "Add custom token" form

Acceptance: all 11 LEP100s show balances and can be sent.

### Phase 3 — MultX Bridge tab (depends on §4)

- [ ] Bridge tab UI
- [ ] Source / destination chain selection
- [ ] Token + amount input
- [ ] Use `@litho/multx-sdk` for the lock → poll → release flow
- [ ] Bridge history (paginated, from bridge-api `/bridge/transactions/<address>`)

### Phase 4 — Staking (depends on §5)

- [ ] Validator list (LCD-based; sort by voting power, commission, APR)
- [ ] Delegate / undelegate / redelegate flows
- [ ] Pending unbondings (with 21-day countdown)
- [ ] Claim rewards (all-validators batch)
- [ ] Per-validator detail page

### Phase 5 — Governance (depends on §6)

- [ ] Active proposals list
- [ ] Proposal detail view (tally bar, description, timeline)
- [ ] Vote button (Yes / No / Abstain / NoWithVeto)
- [ ] Voting history per account

### Phase 6 — DEX swap (depends on §7)

- [ ] Swap tab
- [ ] Token-in / token-out selectors
- [ ] Live quote from Quoter
- [ ] Slippage + deadline controls
- [ ] Approve + swap via SwapRouter

### Phase 7 — DNNS resolution (depends on §8)

- [ ] Name resolution in address inputs (`alice.litho` → addr)
- [ ] Reverse display in tx history / address book
- [ ] Optional: registration flow

---

## 10. Open questions for discovery call

These come from the M5 roadmap (`docs/workstreams/kamet-mainnet-prep/ROADMAP.md`
§5.0). We need answers to scope the integration tightly:

1. **Tech stack** of the extension and mobile app? (React Native / React /
   native iOS+Android / other?)
2. **How are new EVM chains added today?** Config file, on-chain registry,
   code change?
3. **Token list source**: hardcoded, registry contract, or external?
4. **Signing**: same flow for all EVM chains, or per-chain hooks?
5. **Release cadence**: how often does new code ship to users?
6. **PR / code review process**: who approves PRs, what CI gates?
7. **Test coverage and CI/CD** structure?
8. **Mobile build/sign infrastructure**: do we need access to certs for
   builds, or do you handle the builds?
9. **Non-EVM features**: any existing Cosmos-staking-style features we
   need to mimic for Kamet, or is the Evmos precompile route fine?
10. **Embed vs native UI** for MultX bridging, staking, governance, DEX
    swap — do these live inside the wallet UI or as deep links to
    external sites? (See §4.2.)

---

## 11. Brand assets

Available via `kamet.litho.ai/logo.png` (small icon, ~1KB) and the
`kamet-explorer` `public/` directory. We can ship higher-res SVG/PNG sets
on request — please tell us your asset spec (sizes, formats).

---

## 12. Contact + escalation

- **Project channel**: TBD on call (we'll set up a shared Slack / Telegram
  group)
- **Critical infra issues**: Litho infra team escalation matrix at
  [`docs/CUSTODY_CONTACTS.md`](../CUSTODY_CONTACTS.md) (internal)
- **Public status page**: `https://status.litho.ai`

---

*End of spec. We're ready to start the moment the intro lands; this doc
+ a 30-minute discovery call should be enough to scope all 7 phases.*
