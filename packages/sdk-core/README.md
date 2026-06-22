# @thanos/sdk-core

The framework-agnostic engine that powers all four Thanos Wallet clients (web,
mobile, browser extension, desktop). Multi-chain key management, sending,
portfolio, swaps + bridge, DNNS names, and transaction security — most of it
behind a single `WalletEngine` facade, with lower-level clients and building
blocks exposed when you need them.

- **Chains:** Lithosphere Makalu (`700777`) + Kamet (`900523`), Ethereum, BNB
  Chain, plus Bitcoin, Solana, and Cosmos.
- **No UI, no framework lock-in.** Pure TypeScript + `ethers` v6. Bring your own
  storage (`SecureStore`) and your own React/RN/DOM layer.

> **Status:** internal monorepo package today (consumed as TypeScript source by
> the Thanos apps). It builds to `dist/` with `npm run build` — see
> [Packaging](#packaging) to publish it for external use.

---

## Install

Inside this monorepo it's a workspace dependency — just import it:

```ts
import { WalletEngine } from '@thanos/sdk-core';
```

---

## Quick start — `WalletEngine`

`WalletEngine` is the recommended entry point. It wraps key derivation,
per-chain signing, portfolio, and security so you don't touch the lower-level
clients unless you want to.

```ts
import { WalletEngine } from '@thanos/sdk-core';

// Optionally pass your own SecureStore; defaults to an in-memory one.
const engine = new WalletEngine();

await engine.bootstrap();                 // load any persisted state

// Create a new wallet (returns a fresh mnemonic in state) …
const state = await engine.createWallet();
// … or import one:
// await engine.importWallet('word word word …');

engine.unlock(password);                  // cache the derived key for signing
```

### Sending

One method for every EVM chain (native coin or any ERC-20 / LEP100 token):

```ts
const hash = await engine.sendAsset({
  chainId:      700777,        // Lithosphere Makalu
  to:           '0x…',         // 0x… or litho1… — normalised for you
  amount:       '1.5',         // human-readable
  tokenAddress: '0x…',         // omit for the native coin
});
```

Bitcoin and Solana have dedicated methods (different address + fee models):

```ts
await engine.sendBitcoin({ networkId: 'bitcoin-mainnet', to: 'bc1…', amountSats: 50_000 });
await engine.sendSolana({ chainId: 900, to: '…', amount: '0.5' /* , mintAddress, decimals */ });
```

### Portfolio

```ts
const portfolio = await engine.getPortfolio();   // balances + activity across chains
```

### Addresses (Lithosphere ↔ EVM)

A Lithosphere `litho1…` address and its `0x…` form are the same 20 bytes:

```ts
engine.evmToLitho('0x…');         // → 'litho1…'
engine.lithoToEvm('litho1…');     // → '0x…'
engine.normaliseAddress(addr);    // → { evm, litho }
engine.validateAddress(addr, chainId);
```

### High-level intents

`executeIntent` is a single "do this" entry point that routes to the right
subsystem (swap, bridge, stake, contract call, or a plain send):

```ts
await engine.executeIntent({
  id:      crypto.randomUUID(),
  title:   'Bridge LITHO to Kamet',
  kind:    'bridge',            // 'swap' | 'bridge' | 'stake' | 'contract' | 'send' | 'send-btc' | 'send-sol' | 'lep100-transfer'
  payload: { /* kind-specific */ },
});
```

Other engine helpers: `importToken`, `pairWalletConnect(uri)`,
`resolveDnns(name)` / `registerDnns(name)`, `simulateCurrentSend(req)`,
`inspectConnectedSite(hostname)`, `changePassword`, `lock`.

---

## Lower-level clients

When you don't want the full engine (e.g. a stateless server signing one tx),
use a client directly. Each takes the key material per call — it holds no state.

```ts
import { EvmClient, BitcoinClient, SolanaClient, Lep100Client } from '@thanos/sdk-core';

await new EvmClient().sendAsset(privateKey, { chainId, to, amount, tokenAddress });
await new BitcoinClient().send(mnemonic, { networkId: 'bitcoin-mainnet', to, amountSats });
await new SolanaClient().send(mnemonic, { chainId: 900, to, amount });
await new Lep100Client(/* … */).transfer({ /* … */ });   // LEP100 = ERC-20 + burn
```

---

## Building blocks

Everything the engine uses is exported individually if you want to compose your
own flow:

| Area | Key exports | Source |
|---|---|---|
| **Chains** | `SUPPORTED_NETWORKS`, `MAKALU_TESTNET`, `KAMET_MAINNET`, `ETHEREUM`, `BSC` | `chains/networks` |
| **Providers** | `getEvmProvider(chainId)`, `getMakaluProvider()`, `getKametProvider()`, `setRpcUrls()` | `chains/provider` |
| **Gas** | gas estimation helpers | `chains/gas` |
| **Tokens** | token registry, LEP100 sources, logos | `tokens/registry`, `tokens/lep100-registry` |
| **Pricing** | `fetchEcosystemPrices()` (CoinGecko, cached) | `tokens/pricing` |
| **Security** | phishing checks, pre-send transaction simulation, WalletConnect risk | `security/*` |
| **Bridge** | MultX Makalu↔Kamet bridge + status polling | `swaps/multx`, `bridge/status` |
| **DEX** | Ignite swap client | `dex/ignite` |
| **DNNS** | `.litho` name resolve/register (lives on Kamet) | `dnns/service` |
| **WalletConnect** | pairing client | `walletconnect/client` |
| **Hardware** | Ledger + Trezor signing | `hardware/*` |
| **Storage** | `MemorySecureStore`, browser store (implement `SecureStore` for your platform) | `storage/*` |
| **Utils** | key derivation, mnemonic, litho-address | `utils/*` |

The public surface is grouped the same way in `src/index.ts`.

---

## Chains supported (out of the box)

| Network | Chain ID | Notes |
|---|---|---|
| Lithosphere Makalu | `700777` | `rpc.litho.ai` — native LITHO, indexer-backed |
| Lithosphere Kamet | `900523` | `rpc-3.litho.ai` — sister chain, hosts DNNS |
| Ethereum | `1` | |
| BNB Chain | `56` | |
| Bitcoin | — | mempool.space transport |
| Solana | `900` | |

> The Thanos apps layer additional external EVM chains (Polygon, Base, Arbitrum,
> Optimism, Linea, Avalanche) on top — add them to `chains/networks` to surface
> them here too.

---

## Packaging

`package.json` `main`/`types` currently point at `src/index.ts` so the monorepo
consumes the SDK as TypeScript source (zero build step in dev). To publish it
for external consumers:

1. `npm run build` → emits `dist/` (compiled JS + `.d.ts`).
2. Point `main` → `./dist/index.js`, `types` → `./dist/index.d.ts`, and add
   `"files": ["dist"]` + an `"exports"` map (mirror `packages/connect`).
3. `npm pack` (or `npm publish`).

Keep the source-resolution working for the in-repo apps (e.g. via the `exports`
`development` condition or `transpilePackages`) so you don't break their builds.

---

## License

MIT.
