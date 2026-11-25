# Native Lithic tokens (LAX)

Thanos supports native Lithic tokens on two chains, and they are **not** at the same stage:

| Chain | Token | Read | Send |
| --- | --- | --- | --- |
| LITHO mainnet (9005) | native LAX `0x29147beb…6df3` | yes | **yes** |
| Makalu (700777) | native LAX `0x5803af8a…09ed` | yes | no — read-only |

Makalu stays read-only: native transfers there are still disabled pending authorisation of that
path. Mainnet sending is enabled on the authority of KaJ Labs' mainnet integration docs
(2026-11-21), which document the whole send workflow — gateway calldata, `value` 0, gas estimated
with the real sender, and confirmation by the gateway's `Transfer` event.

`transferEnabled` on each token is the single switch; `encodeNativeTransfer` refuses a token whose
switch is off, so enabling a chain is one deliberate change and cannot be routed around.

This follows Litho's native Lithic handoff (2026-10-26) for the Makalu read path, and the mainnet
integration docs (2026-11-21) for everything mainnet.

## Sending (mainnet)

`prepareNativeTransfer(token, from, to, amountBaseUnits, { rpcUrl })` does everything that has to
happen before a signature:

- **Reads the token first.** A rejected Lithic call carries no reason at all — status 0,
  `execution reverted`, empty revert data, no event. So balance, `paused()` and `is_frozen()` for
  both parties are read and returned as `blockers`, in words, rather than letting the user pay a
  fee to learn nothing.
- **Estimates gas with the real sender** and adds 20%. The chain charges for at least half the gas
  limit, so a generous fixed limit is money burned. A LAX transfer estimates around 326,600.
- **Keeps `value` at 0.** A Lithic call carrying LITHO fails and burns all the gas, and these
  contracts cannot hold LITHO.
- **Checks the chain**, so a mainnet balance cannot be spent against a testnet RPC.

`confirmsNativeTransfer(logs, token, from, to)` then proves the transfer actually happened. Status
1 is not enough on its own: a native function that returns `false` still produces a successful
transaction, and a failed call emits no log at all.

The desktop send path takes this route whenever `sendAsset` is given a `nativeLithicTarget`; it
signs through the same main-process signer as any other EVM transaction (`TxRequest` already
carries `to`, `data` and `gas`), so no new IPC surface was added.

## What's different from an ERC-20

| | Native LAX | Historical EVM LAX |
| --- | --- | --- |
| Address | native target `0x5803af8a82a8ecfb6d6a3b3d64814807b59d09ed` | contract `0x1Cde2Ca6c2ab8622003ebe06e382bC07850d4B8d` |
| Read | `eth_call` to the gateway `0x…f000`: `call(address target, bytes32 selector, bytes arguments)` | ERC-20 `balanceOf` |
| Selector | full 32-byte keccak256 of the native signature, e.g. `balance_of(address)` | 4-byte `balanceOf(address)` |
| Values | LVAL v1 inside one ABI `bytes` wrapper | Solidity ABI |

`eth_getCode` at the native target returns `0x`, and ERC-20 calls sent there return nothing. Adding the native target as a custom ERC-20 token fails, as intended.

## Code

- `packages/sdk-core/src/clients/native-lithic.ts` is the reader. It is a port of the handoff's read path and depends only on ethers. It contains:
  - the LVAL v1 codec, with every rejection rule;
  - gateway calldata;
  - the canonical ABI `bytes` unwrap;
  - `readNativeLaxBalance(owner, { rpcUrl })`.

  `readNativeLaxBalance` checks that the chain is 700777 (it is the Makalu reader). It reads name, symbol, decimals and `balance_of` at one block, from the wallet's own address. It then checks the metadata. Amounts stay as `bigint` or decimal strings. Any RPC failure throws, so a failed read is never shown as 0.
- `packages/sdk-core/src/__tests__/native-lithic.test.ts` checks the reader against the handoff's golden vectors (getters and the six reviewed transfer calls). The vectors are in `fixtures/native-lithic-golden-vectors.json`, unchanged, sha256 `d26feb45…954a`.
- `apps/mobile/lib/native-lithic.ts` is mobile's copy. Mobile builds without the workspace. `node scripts/sync-native-lithic.mjs` writes the copy; CI runs it with `--check`.
- Makalu's row stays view-only (`readOnly`, `nativeTarget`) and never gets a `tokenAddress`, so it cannot reach Send. Tapping it opens a view-only screen. Mainnet LAX reaches Send through `nativeLithicTarget`, which routes to the gateway rather than to the token address.
- `packages/sdk-core/src/__tests__/native-lithic-mainnet.test.ts` covers the mainnet side: the documented worked calldata, transaction decoding for the signing screen, the send gate per token, gas margin, the blocker reads, and confirmation from the gateway log.

  | Client | Files |
  | --- | --- |
  | Extension | `popup/portfolio.ts`, `popup/main.tsx` |
  | Desktop | `renderer/portfolio.ts`, `renderer/main.tsx` |
  | Web | `lib/native-lax.ts`, `components/NativeAssetModal.tsx`, `dashboard.tsx`, `views.tsx` |
  | Mobile | `App.tsx` |

  The web app reaches `rpc.litho.ai` through its same-origin `/rpc/makalu` proxy.

## Tests

```sh
pnpm --filter @thanos/sdk-core test        # reader + golden vectors
node scripts/sync-native-lithic.mjs --check
cd apps/web && npx playwright test e2e/native-lax.spec.ts
```

The web e2e answers `/rpc/makalu` like the live gateway. It checks three cases:

- the view-only row and screen;
- no row and no gateway read without Makalu;
- a failed read shows as unavailable, not 0.

## Not in scope

- Native transfers, approvals and event indexing. The handoff keeps execution separately gated.
- Canonical proofs. A balance is an RPC answer, `canonicalProofVerified: false`.
- Mainnet (9005). This profile is Makalu only.
