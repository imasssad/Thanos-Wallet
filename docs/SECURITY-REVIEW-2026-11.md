# Security review — Lithic mainnet branch (2026-11-25)

Shipped as `STATUS.md` inside the audit package
(`scripts/audit-package.sh`, commit 138a418) and kept here as the branch's
own record.

Thanos Wallet, branch `feat/lithic-mainnet-support`, 17 commits / 84 files
(+6,037 / −1,822) over `main`.

This package is prepared for an **external security review**. Before packaging,
the same changes were reviewed in-house: once by the engineer who wrote them
(walking the new attack surface deliberately) and once by an independent
automated reviewer working only from the branch diff. Everything found was
fixed on this branch; nothing is left open. The sections below say what was
examined, what was found, and what an external reviewer should concentrate on.

## 1. What is new in this branch, from a security point of view

| Area | New attack surface |
| --- | --- |
| **Lithic / LithoVM gateway support** (`packages/sdk-core/src/clients/native-lithic.ts` and its two copies) | New calldata builder and decoder for native Lithosphere contracts reached through the gateway `0x…f000`; parses attacker-influenced data (chain logs, `eth_call` returns). |
| **Transaction review** (`security/sign-review.ts` ×3) | A gateway call is now decoded and described in the signing sheet ("Send 25 LAX to …"). A wrong description is a signing-spoof risk, so this path was reviewed most closely. |
| **Lithic sends** (web / extension / desktop / mobile) | A new send path, **off by default** behind a per-client build flag (`*_THANOS_LITHIC_SENDS`). |
| **Token auto-discovery** (`portfolio/token-discovery.ts`, `portfolio/discovered-tokens.ts`) | Tokens found on-chain, with names and symbols supplied by arbitrary contracts, are now shown without the user adding them. |
| **MultiSig display addresses** (`packages/multisig`) | Addresses are rendered bech32-only (`litho1…`); the 0x form stays internal. |
| **macOS App Store build** (`entitlements.mas.plist`, `scripts/after-pack.cjs`, `src/main/dapp-browser.ts`) | Camera and location entitlements removed; the App Store build now denies every device permission at runtime. |

## 2. Fixed in this pass

**Look-alike Lithic token could impersonate LAX** — `portfolio/token-discovery.ts`
(and the mobile copy).

Discovery's impersonation rule compares a discovered token's symbol against the
chain's known-token table. Lithosphere (chain 9005) had no entry in that table,
so on that chain the rule had nothing to compare against. In the same change,
holdings on the wallet's home chain became visible by default. Together, a
Lithic contract airdropped to a user and returning `symbol() = "LAX"` would
have passed every check and appeared in the asset list beside the genuine LAX,
with no warning — the setup for a "send your LAX here" swap.

Fixed by registering the real mainnet LAX
(`0x29147bEbb1C49C3a54aA464137611FE708886df3`) as chain 9005's known token, so
any other contract claiming that symbol is now flagged as an impersonation and
withheld. A regression test (`'drops a Lithic contract impersonating LAX on the
home chain'`) was added and confirmed to fail without the fix.

**Unlimited Lithic allowance did not reach the wallet's high-risk state**
(HIGH) — `security/sign-review.ts` and its mobile and desktop-main copies.

The signing sheet's ERC-20 path runs every allowance through a shared
max-value sentinel: at or above 2^240 the amount is printed as the single word
`Unlimited`, the row is toned red, and the warning escalates the sheet's risk
to `review` — which is what makes each client turn the Approve button red and
relabel it "I understand — sign".

The new Lithic branch re-implemented that display by hand and used none of it.
An `approve(attacker, 2^256-1)` on mainnet LAX, sent by a connected dApp,
rendered as a 60-digit number with no "Unlimited" or "forever" wording, capped
at `caution` — amber "Check before signing" behind the ordinary blue button —
so the wallet's main anti-drainer control was fully present for ERC-20 tokens
and absent for the home chain's own token.

Fixed by routing Lithic amounts through the same `amount()` sentinel and
`approvalWarning()` escalation, so the two paths now read and escalate
identically; a zero allowance is shown as a revoke, as it is for ERC-20.

**Gateway calls the wallet could not read back were shown as routine**
(MEDIUM) — same three files.

The Lithic branch reported "described" for every gateway call, including ones
it never interpreted. A `transfer_from(address,address,u256)` — a call that
moves tokens out of an account on an existing allowance — produced a sheet
reading only "Lithic call: transfer_from(…)" with no parties, no amount, no
warning and the sheet's most reassuring `safe` verdict; on the desktop in-app
dApp browser that one line *is* the whole approval dialog. The same applied to
a `transfer` or `approve` whose arguments arrived under an unexpected LVAL
type tag, which silently fell through to that branch. A decoded `transfer` also
lacked the "check the recipient" caution its ERC-20 twin raises.

Fixed by decoding and displaying `transfer_from` in full (both parties, amount,
caution), giving a decoded `transfer` the ERC-20 caution, showing the decoded
arguments for anything else, and warning at `review` whenever a call that moves
or changes tokens cannot be read back — while a plain read (`balance_of`,
`paused`, …) stays quiet, as it should. The Lithic target also moved out of the
"Contract" row, which the gateway address already occupied, into its own
"Lithic contract" row.

Five regression cases were added to the signing-review suite, which runs
against all three copies of the module, and each was confirmed to fail against
the previous behaviour (15 failures across the three clients).

**Critical dependency advisory in the Bitcoin library** (CRITICAL, inherited,
not introduced by this branch) — `bitcoinjs-lib` 6.1.7.

The packaging run's own CI gate (`pnpm audit --prod --audit-level=high`)
failed on GHSA-8vv3-6qpc-gpw6: undetected merkle-node duplication in block
root computation, which lets a forged transaction list validate. It reached
the wallet by 17 paths — directly in `sdk-core`, web, extension and desktop,
and transitively through the Ledger Bitcoin packages.

The declared range (`^6.1.6`) already allowed the patched release; only the
lockfile was pinned behind it. Fixed the way this repo pins every other
security patch, with a pnpm override (`bitcoinjs-lib@<6.1.8` → `^6.1.8`), so
the transitive Ledger paths are lifted too: every path now resolves 6.1.10.
The prod high-severity gate passes, and nothing remains at critical.

Bitcoin had no test anywhere in the repo, so a library bump that changed key
handling or address encoding would have shipped unnoticed — and a wrong
address means funds sent somewhere unspendable. Derivation is now pinned
against the BIP-84 test vectors
(`packages/sdk-core/src/__tests__/bitcoin-derivation.test.ts`).

**Audit-package drift check did not cover the new copies** —
`scripts/audit-package.sh`. `native-lithic.ts` is kept in three places by
`scripts/sync-native-lithic.mjs`, but the packaging script only verified the
multisig and multx-thanos syncs. A drifted copy would have shipped to a
reviewer looking identical to its source. The check now covers all three.

## 3. Properties deliberately preserved (worth an external reviewer's check)

- **Key isolation (H-1) is unchanged.** Building Lithic calldata is secret-free
  and lives in shared code; only each client's existing signer touches key
  material — web's isolated worker, the desktop main-process signer over IPC,
  the extension's offscreen document, mobile's module-scope signer. No new code
  path reads a seed or a private key.
- **No symbol is ever inferred from calldata.** The review sheet names a token
  only when the gateway target matches a token the wallet ships; otherwise it
  shows the raw base-unit amount rather than a number that could be off by
  10^18, and an unrecognised selector is labelled as such with a warning.
- **A Lithic send cannot be aimed at an arbitrary target.** Every send path
  resolves the native target through `findLithicToken`, which only matches
  shipped tokens, and is additionally gated by the off-by-default flag.
- **Read-only RPC methods stay read-only.** The Lithic client's method
  allow-list covers `eth_chainId`, `eth_blockNumber`, `eth_call`, `eth_getLogs`
  and `eth_estimateGas` — deliberately not `eth_sendRawTransaction`.
- **Chain-log parsing is defensive.** Gateway log payloads are raw UTF-8 JSON
  from the chain; every field is type-checked, addresses are re-checksummed,
  and anything malformed is skipped rather than thrown, so one bad log cannot
  take a receipt or a history page down.
- **The App Store build is strictly more restricted**, not less: with the
  entitlements gone, a Mac App Store runtime now refuses every permission,
  device and check request outright.

## 4. Verification run at this commit

Typecheck clean in web, extension, desktop (both the renderer and the main
process), multisig and sdk-core; mobile sits at its 4 long-standing
missing-module errors, unrelated to this branch. Lint: 0 errors. sdk-core:
509 tests pass, including the new Lithic gateway-review, discovery,
Bitcoin-derivation and MultiSig-address suites. The dependency gate
(`pnpm audit --prod --audit-level=high`) passes. The `results/` directory in this package holds the
full output of every check, with SBOMs and dependency vulnerability scans
alongside.
