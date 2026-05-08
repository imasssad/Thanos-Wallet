## v8 branch

- Adds LEP100 activity history, approve/revoke UI hooks, and backend sync-job scaffolding.
- Adds indexer DB schema for lep100 tokens, balances, allowances, events, and sync jobs.
- Keeps seeded Makalu LEP100 registry and prepares for live explorer/RPC discovery.

# Thanos Wallet v3

ThanosWallet.ai monorepo for a Lithosphere-first wallet suite spanning web, extension, mobile, desktop, and backend indexing.

## New in v3

- Full send and receive flow scaffolding for BTC, SOL, SPL, EVM, LITHO, and Lithic
- WalletConnect pairing layer and dApp session handling
- Portfolio balance and activity backend indexer
- MultX swap UI and bridge status tracker
- Real desktop secure key vault integration via `keytar`
- Token import flows for ERC-20 and SPL
- DNNS resolve and register flows
- Release configs for browser stores, mobile stores, and desktop packaging

## Apps

- `apps/web` - web wallet dashboard
- `apps/extension` - Chrome, Brave, and Safari extension source
- `apps/mobile` - iOS and Android wallet
- `apps/desktop` - macOS and Windows wallet
- `services/indexer` - portfolio and history backend

## Packages

- `packages/sdk-core` - shared wallet, chain, security, WalletConnect, DNNS, and portfolio clients
- `packages/sdk-react` - React provider and hooks
- `packages/ui` - shared components

## Quick start

```bash
pnpm install
pnpm dev
```

## Notes

This repo now includes broader end-to-end flows, but several integrations still need live environment credentials and production endpoint confirmation before shipping, including final Lithic runtime RPC names, MultX production credentials, WalletConnect Cloud configuration, Ledger/Trezor app details, and store signing certificates.


## v7 Highlights

- Full LEP100 module scaffold in SDK and wallet engine
- Verified Makalu LEP100 token registry excluding LitBtc2
- LEP100 balance/send UI on the web app
- Indexer spec endpoints for LEP100 metadata and event ingestion


## v8.1 Makalu LEP100 sync wiring

This branch wires LEP100 sync to the Makalu RPC (`https://rpc.litho.ai`) and explorer token index (`https://makalu.litho.ai/tokens`). Seeded Makalu tokens are registry-backed with explorer address previews and can be upgraded to full RPC-readable contracts by supplying verified full addresses via environment variables.
