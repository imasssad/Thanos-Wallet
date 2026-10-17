# Thanos MultiSig

Shared accounts inside Thanos Wallet that move funds only when enough of their signers approve.
Thanos MultiSig is Thanos Wallet's implementation of LEP100-15 §82–84 on top of **Litho Vault**,
the LEP100-15 smart account (contracts, SDK and audit package: https://github.com/imasssad/litho-vault).

## Where it is

| Client | Entry | Code |
|---|---|---|
| Web (thanos.fi/app) | **MultiSig** in the top navigation, `/app/multisig` | `apps/web/components/MultiSigView.tsx`, `apps/web/lib/multisig.ts` |
| Extension | **MultiSig** tab in the popup | `apps/extension/src/entrypoints/popup/MultiSigScreen.tsx`, `apps/extension/src/lib/multisig.ts` |
| Desktop | **MultiSig** in the navigation | `apps/desktop/src/renderer/multisig.tsx` |
| Mobile | **MultiSig** quick action on the wallet home | `apps/mobile/components/MultiSig.tsx` |

Web, extension and desktop render the same screens (`packages/multisig/src/react`, styled only with
the Thanos palette variables every client defines). Mobile has the same screens in React Native.
All four use the same logic (`packages/multisig/src`; mobile gets a copy kept in step by
`scripts/sync-multisig.mjs`, checked in CI) and the same vendored Litho Vault SDK
(`vendor/litho-vault-sdk-1.0.0.tgz`).

## What a user can do

- **Create MultiSig** (LEP100-15 §82): network, name, signers (typed as `litho1…` or `0x…`; the
  wallet's account is always the first), how many must approve, optional AI protection and
  recovery (off at creation; set up later through an approved proposal), deploy.
- **See their multisigs**: found automatically (the Litho Vault indexer, or the factory's creation
  events), or added by address. Each shows its balance and what needs attention: proposals waiting
  for this account's approval, ones ready to execute, a freeze.
- **Send from a multisig**: LITHO or a verified token; the proposal is reviewed (decoded,
  simulated, checked against the vault's policies) before it is proposed, and proposing records
  the proposer's approval.
- **Review a proposal** (LEP100-15 §83, in that order): action, asset, amount, recipient, network,
  estimated fee, contract, function, calldata (decoded and raw), simulation, approvals, required
  threshold, AI risk assessment, policy warnings, expiration, transaction hash.
- **Approve, approve without gas** (EIP-712 signature shared through the indexer relay, when one is
  configured), **revoke**, **execute** (with relayed signatures when on-chain approvals are not
  enough), **cancel** (the proposer).

Policies, agents, recovery guardians, timelocks and the emergency freeze are managed in the Litho
Vault app; Thanos MultiSig links there when `APP_URL` is set.

## When it turns on

By default Thanos MultiSig runs on **Lithosphere Mainnet (9005)** with the Litho Vault deployment
published in the SDK (`PUBLISHED_DEPLOYMENTS[9005]`). Until the Litho Vault contracts are deployed
and published, every client shows "Thanos MultiSig opens on Lithosphere Mainnet as soon as the Litho
Vault contracts are deployed there" and offers no actions. After the mainnet deployment:

1. In litho-vault: `npm run publish-addresses -w @litho-vault/launch`, then
   `npm run pack -w @litho-vault/sdk`.
2. Here: copy the new `litho-vault-sdk-<version>.tgz` to `vendor/`, run
   `node scripts/sync-multisig.mjs` (copies it to `apps/mobile/vendor/` too), `pnpm install`, and
   update `apps/mobile/package-lock.json`.

A build can point at a testnet or a local chain instead, with the same keys Litho Vault uses,
prefixed per client: `NEXT_PUBLIC_MULTISIG_*` (web), `VITE_MULTISIG_*` (extension, desktop),
`EXPO_PUBLIC_MULTISIG_*` (mobile):

| Key | Meaning |
|---|---|
| `CHAIN_ID`, `CHAIN_NAME`, `RPC_URL`, `EXPLORER_URL` | The network (defaults: Lithosphere Mainnet) |
| `FACTORY`, `LENS`, `AI_GUARD`, `RECOVERY_GUARD`, `FREEZE_GUARD`, `IMPLEMENTATION`, `DEPLOY_BLOCK` | The Litho Vault deployment; when `FACTORY` is set the published one is ignored as a whole |
| `INDEXER_URL` | Litho Vault indexer (https): finds every multisig an account signs for, relays gasless approvals |
| `APP_URL` | Litho Vault app (https), for the settings Thanos MultiSig does not edit |

The web CSP lists `NEXT_PUBLIC_MULTISIG_RPC_URL` and `…_INDEXER_URL` when they are https (or http on
127.0.0.1/localhost for development).

## How signing works

Each client passes a `WalletBridge` to its existing signer; keys never move:

| Client | Signer | Account check |
|---|---|---|
| Web | the signing worker (`signerSignTransaction`, `signerSignTypedData`), in-process fallback as WalletConnect does | the worker's address must equal the account on screen |
| Extension | the offscreen document (`sign.evm-tx`, `sign.evm-typed-data`); requests are JSON, so bigints travel as decimal strings | HD path fixed when the bridge is made for the active account |
| Desktop | the main process (`signer:send-tx`, `signer:typed-data`) | `signer:address(hdPath)` must equal the account on screen |
| Mobile | `lib/signer` | `deriveAddress(hdPath)` must equal the account on screen |

The MultiSig screens show the full review before any wallet action, like Send's confirmation step;
there is no second prompt. Every transaction names its chain and RPC (no default network); gas is
estimated by the RPC with 25% + 20,000 headroom (executions measure token balances). A watch-only
or locked account gets a reason instead of buttons.

## Tests

- `pnpm --filter @thanos/multisig test`: the shared core against the real Litho Vault contracts on a
  local Hardhat chain (pre-built bytecode in `packages/multisig/test/fixtures`; Hardhat is
  installed by npm into `packages/multisig/test/chain`, outside the pnpm workspace): configuration,
  saved list, create (litho1 signers, predicted address), discovery by a co-signer, propose with
  the 14-field review, approve, execute, token transfer, revoke, cancel, refusal for an account
  that cannot sign, JSON-safe typed data. Runs in CI with `node scripts/sync-multisig.mjs --check`.
- `apps/web/e2e/multisig.spec.ts` (Playwright, local): a fresh wallet creates a 2-of-3 multisig
  (one signer typed as litho1), funds it, proposes a payment, a second signer approves, the web
  app executes it; checks the §83 fields and their order.

## For the audit

`scripts/multisig-audit-package.sh` builds the package to send: the in-scope sources of one commit,
the signers the bridges call, the vendored SDK with its SHA-256, every test result and this file,
with checksums, as one zip (`RUN_E2E=1` adds the web end-to-end run).

In scope: `packages/multisig/src` (and its mobile copy), the four bridges listed above,
`apps/mobile/components/MultiSig.tsx`, the CSP change in `apps/web/lib/csp.js`, and the vendored
SDK (`vendor/litho-vault-sdk-1.0.0.tgz`, built from litho-vault by `npm run pack -w @litho-vault/sdk`;
its source and contracts are covered by the Litho Vault audit package).

Properties to check:

1. A signature or transaction is only ever made for the account on screen, on the configured chain.
2. What is signed is what the review showed: the SDK refuses to sign approvals whose calls do not
   hash to the proposal's `callsHash`, and the review is rebuilt from chain data, never from the
   indexer.
3. Data from the indexer (vault lists, relayed signatures, execution hashes) can mislead at most
   the display: relayed signatures are verified against the live digest and signer set before use.
4. Names and token metadata cannot inject control or bidirectional characters.
5. Configuration accepts only https services (http only on this machine).
