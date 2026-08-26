# multx-adapter

Shared MultX bridge adapter for **Ignite.trade**, **MagmaDEX.trade**, **Quantts.ai**,
and KaJ Labs products — implementing `INTERNAL_PARTNER_INTEGRATION_PLAN.md` and
`PARTNER_ACCEPTANCE_CHECKLIST.md` (repo root).

**Status: pre-release.** MultX is disabled by default. This package does not
ship, hardcode, or assume any production bridge address, token address, or
API endpoint — every one of those comes from a signed release manifest you
provide at runtime. There is no working integration until:

1. Autha's security review of the bridge contract is accepted, and
2. KaJ Labs publishes an approved release manifest (tag + commit + SHA-256).

Building/importing this package before then is safe — it will simply refuse
to run (`FEATURE_DISABLED` / `MANIFEST_INVALID`) against any manifest that
isn't correctly signed off.

## What this package owns

- authenticated release-manifest loading + SHA-256 integrity check
- wallet/network preflight (exact source-chain match, fail closed)
- route + token resolution against the manifest (fail closed on anything
  not explicitly listed — no historical/hardcoded addresses, ever)
- token approval + bridge lock (on-chain, via a `Signer` your app already has
  connected — this package never touches a private key)
- bridge status polling + **independent destination-receipt verification**
  (a `completed` status from the bridge API alone is never enough to report
  `RELEASED` — see `VerifyDestinationReceipt`)
- normalized error categories (`MultXErrorCode`) and telemetry events, so a
  partner app never has to parse a raw ethers/RPC error string

## What your app owns

- your own product entry point, UX, and authorization
- persistence (`PersistTransfer` — you get a fully-formed
  `InternalMultXTransfer` record at every state transition; store it however
  you already store transactions)
- **crediting a balance / unblocking a trade / releasing funds only after
  `status === 'RELEASED'`** — never on `SUBMITTED`, `FINALIZING`, or
  `SIGNING`. This is the single most important rule in the integration plan.
- your own destination-chain receipt check, passed in as
  `verifyDestinationReceipt` — the adapter calls it, but it doesn't know how
  to read your destination chain's RPC, so you supply that.

## Install

Not published to a public registry (marked `"private": true"` — internal
component, same as `@litho/multx-sdk`). Build a tarball from this repo and
install it directly:

```bash
cd packages/multx-adapter
pnpm build
npm pack   # produces multx-adapter-0.1.0-pre.tgz
```

```bash
npm install ./multx-adapter-0.1.0-pre.tgz
npm install ethers@^6   # peer dependency — you likely already have this
```

## Usage

```ts
import { MultXAdapter } from 'multx-adapter';

const adapter = new MultXAdapter({
  integration: 'ignite',                       // or 'magmadex' | 'quantts' | 'kajlabs'
  enabled: process.env.MULTX_ENABLED === 'true', // defaults to disabled — see env template below
  manifestUrl: process.env.MULTX_MANIFEST_URL!,
  manifestSha256: process.env.MULTX_MANIFEST_SHA256!,
  persist: async (record) => db.multxTransfers.upsert(record),
  onEvent: (event) => telemetry.emit('multx', event),
});

const record = await adapter.transfer({
  integrationRequestId: crypto.randomUUID(),
  signer,                          // an ethers v6 Signer already connected in your app
  sourceChainId: 700777,
  destinationChainId: 900523,
  tokenSymbol: 'wLITHO',
  amountBaseUnits: '100000000000000000000', // base units — never a float
  recipient: userAddress,
  verifyDestinationReceipt: async ({ destinationChainId, destinationTxHash, expectedRecipient, expectedAmountBaseUnits, expectedTokenAddress }) => {
    // Read the destination chain yourself and confirm the receipt really
    // matches — do not just trust that the bridge API said "completed".
    return myOwnDestinationChainCheck({ destinationChainId, destinationTxHash, expectedRecipient, expectedAmountBaseUnits, expectedTokenAddress });
  },
});

if (record.status === 'RELEASED') {
  // only now is it safe to credit anything
}
```

### Environment template (from the integration plan)

```dotenv
MULTX_ENABLED=false
MULTX_MANIFEST_URL=<AUTHENTICATED_RELEASE_MANIFEST_URL>
MULTX_MANIFEST_SHA256=<APPROVED_SHA256>
```

No signer, validator, admin, recovery, or deployment private key is ever
required by this package.

## Product-specific boundaries

See `INTERNAL_PARTNER_INTEGRATION_PLAN.md` for the full per-product rules
(Ignite: funding rail only, no swap logic; MagmaDEX: bridge and swap are two
separately-confirmed operations, never an atomic-looking UI; Quantts: bridge
intents go through the agent's own risk policy + authorization step before
this adapter ever runs). None of that product-specific glue lives in this
package on purpose — it's each product's own responsibility.

## Status

`adapter.ts`, `manifest.ts`, `preflight.ts`, `bridge.ts`, `status.ts`, and
`errors.ts` are implemented and typechecked. Still blocked on (see the
integration plan's "Inputs still required"):

- Autha's accepted release identity → a real manifest to point at
- Ignite / MagmaDEX auth + data mapping (their side)
- Quantts' current OpenAPI/event schema (not available at time of writing —
  nothing in this package assumes or invents a Quantts endpoint)

Once those land, the per-partner glue code is a thin layer on top of
`MultXAdapter` — this package doesn't need to change.
