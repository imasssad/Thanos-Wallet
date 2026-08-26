# MultX Internal Partner Integration Plan

**Audience:** KaJ Labs, Ignite.trade, MagmaDEX.trade, and Quantts.ai engineering.

**Classification:** Internal pre-release integration material. Do not publish
this file as public developer documentation.

**Status:** MultX disabled; Autha final fix review pending. No production
addresses, credentials, or activation values are approved by this document.

## Objective

Integrate a single reviewed MultX adapter into the three partner applications
without coupling bridge behavior to each application's swap/order engine.

The common adapter owns:

- authenticated release-manifest loading and validation;
- wallet/network preflight;
- token approval and bridge lock;
- source transaction persistence;
- status polling and independent receipt reconciliation;
- feature-disable and emergency behavior;
- normalized telemetry and error categories.

Each product owns only its entry point, user experience, authorization context,
and product-specific post-completion workflow.

## Product integration boundaries

### Ignite.trade

Use MultX only as a funding/withdrawal rail. Keep pool discovery, quotes, swap
execution, liquidity operations, and Ignite fees outside the MultX adapter.

Required product fields:

- authenticated Ignite user/account reference;
- source wallet and selected source network;
- approved destination network/asset;
- bridge transfer ID and source transaction hash;
- final destination transaction hash;
- resulting account-credit state, if Ignite credits balances after bridging.

Ignite must not credit a user from `locked` or `signing`; credit only after its
own independent destination settlement rule passes.

### MagmaDEX.trade

Treat bridging and swapping as two separately confirmed operations. Do not
construct an atomic-looking UI that hides the boundary.

Required flow:

1. Bridge completes on the selected destination.
2. Refresh destination token balance.
3. Obtain a new MagmaDEX quote.
4. Obtain separate user authorization for the swap.

Never reuse a pre-bridge quote after bridge completion. Slippage, deadline,
route, and DEX contract checks belong to MagmaDEX, not MultX.

### Quantts.ai

Expose MultX as a controlled funding action in the agent execution system, not
as an implicit part of a trading decision. The public Quantts site describes
multi-chain autonomous execution, risk checks, telemetry, and a kill switch;
the MultX adapter must preserve those controls.

Required workflow:

1. Agent proposes a bridge intent.
2. Quantts risk policy validates asset, amount, source/destination, caps, and
   approved manifest version.
3. The configured authorization policy approves the state-changing action.
4. Adapter submits approval/lock and records the complete transfer identity.
5. Agent remains blocked from spending expected destination funds.
6. Independent destination reconciliation confirms settlement.
7. Quantts updates available balance and may create a separate trade proposal.

The current `https://quantts.ai/docs` content was not accessible during this
draft review. Quantts must provide its current OpenAPI/Swagger export and event
schema before field-level mapping is finalized. Do not invent or depend on
unverified Quantts endpoint paths.

## Common normalized record

```ts
type InternalMultXTransfer = {
  integration: 'ignite' | 'magmadex' | 'quantts';
  integrationRequestId: string;
  manifestTag: string;
  manifestCommit: string;
  sourceChainId: number;
  sourceBridge: string;
  sourceToken: string;
  sourceTxHash: string;
  sourceNonce?: string;
  userAddress: string;
  amountBaseUnits: string;
  destinationChainId: number;
  destinationBridge: string;
  destinationToken: string;
  status: 'SUBMITTED' | 'FINALIZING' | 'SIGNING' | 'RELEASED' | 'FAILED' | 'REVIEW';
  destinationTxHash?: string;
  createdAt: string;
  updatedAt: string;
};
```

Use a database uniqueness constraint on the complete authenticated source-event
identity. An integration request ID alone is not replay protection.

## Environment template

Placeholders only; secret values belong in each application's secret manager.

```dotenv
MULTX_ENABLED=false
MULTX_MANIFEST_URL=<AUTHENTICATED_RELEASE_MANIFEST_URL>
MULTX_MANIFEST_SHA256=<APPROVED_SHA256>
MULTX_API_URL=<APPROVED_API_ORIGIN>
MULTX_SOURCE_RPC_URL=<APPROVED_RPC_SECRET_REFERENCE>
MULTX_DESTINATION_RPC_URLS_JSON=<APPROVED_SECRET_REFERENCE>
MULTX_RELEASE_TAG=<AUTHA_APPROVED_IMMUTABLE_TAG>
MULTX_RELEASE_COMMIT=<40_CHARACTER_COMMIT_SHA>
```

No signer, validator, admin, recovery, or deployment private key is required by
the partner application.

## Delivery stages

1. **Contract freeze:** wait for Autha's accepted release identity.
2. **Adapter freeze:** rebuild SDK/OpenAPI from that release and pin integrity.
3. **Partner mapping:** finalize each product's auth, data, and event mappings.
4. **Testnet integration:** run positive and negative acceptance suites.
5. **Security review:** verify feature flags, logs, reconciliation, and rollback.
6. **Production canary:** disabled by default, bounded users/amounts, monitored.
7. **Activation:** only after written KaJ Labs approval.

## Acceptance evidence required from each team

- commit SHA and dependency lockfile;
- exact MultX release tag/commit and package integrity;
- completed test matrix with transaction references from the authorized test
  network;
- screenshots or recordings of wrong-network, paused, failed, delayed, and
  emergency-disable behavior;
- log-redaction evidence;
- rollback/disable test;
- named technical owner and incident contact;
- final KaJ Labs approval reference.

## Inputs still required

- Autha final accepted fix review and exact approved release identity;
- final public deployment manifest and generated SDK/OpenAPI artifacts;
- approved production routes, caps, and finality depths;
- Ignite integration/auth schema and responsible owner;
- MagmaDEX integration/auth schema and responsible owner;
- Quantts current Swagger/OpenAPI and event schema;
- testnet and production activation windows;
- partner-specific security and release approvals.

