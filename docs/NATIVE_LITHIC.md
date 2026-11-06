# Native Lithic LAX on Makalu (view-only)

Thanos shows the native Lithic LAX balance on Makalu (700777) when the user has added Makalu as a custom network. The balance is read-only: there is no Send, Receive or Swap for it, and native transfers stay disabled until Litho authorises the execution workflow.

This follows Litho's native Lithic handoff (2026-10-26): the integration guide, `native-lithic.cjs` and `reference/GOLDEN_VECTORS.json`.

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

  The reader checks that the chain is 700777. It reads name, symbol, decimals and `balance_of` at one block, from the wallet's own address. It then checks the metadata. Amounts stay as `bigint` or decimal strings. Any RPC failure throws, so a failed read is never shown as 0.
- `packages/sdk-core/src/__tests__/native-lithic.test.ts` checks the reader against the handoff's golden vectors (getters and the six reviewed transfer calls). The vectors are in `fixtures/native-lithic-golden-vectors.json`, unchanged, sha256 `d26feb45…954a`.
- `apps/mobile/lib/native-lithic.ts` is mobile's copy. Mobile builds without the workspace. `node scripts/sync-native-lithic.mjs` writes the copy; CI runs it with `--check`.
- Each client adds one view-only row (`readOnly`, `nativeTarget`). That row never gets a `tokenAddress`, so it can't reach Send. Tapping it opens a view-only screen.

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
