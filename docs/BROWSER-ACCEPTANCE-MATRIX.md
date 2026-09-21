# Browser Acceptance Matrix — Thanos Wallet Extension

Checklist for validating the **currently published** Chrome Web Store build
before it's cited as accepted/production-ready. Run against the live listing,
not a local dev build, so the record reflects what real users actually have
installed.

**Scope for this run:** extension **v0.9.35** (published, live on the Chrome
Web Store as of 2026-08-17) — https://chromewebstore.google.com/detail/thanos-wallet/jajfgpnlaoakklhnnchdpiglmkkpcehj

> Note: v0.9.35 predates the custom-network/token UI (0.9.36), hide/show
> networks (0.9.37), and the larger toolbar icon (0.9.38) already committed
> to `main`. Those aren't covered by this run — only what's actually live.

## Supported install surface

The extension only ships (and only installs) on **Chromium-based desktop
browsers** — Chrome, Brave, Edge, Opera. Firefox (AMO) and Safari builds exist
in the repo but are **not published**; don't include them in a "published
build" acceptance run.

| Browser | OS | Included |
|---|---|---|
| Chrome (latest stable) | Windows | ✅ |
| Chrome (latest stable) | macOS | ✅ |
| Brave (latest stable) | Windows or macOS | ✅ |
| Edge (latest stable) | Windows | ✅ |
| Firefox | — | ❌ not published |
| Safari | — | ❌ not published |

Fill in the actual browser/OS build numbers used for the run in the
acceptance record (see `ACCEPTANCE-RECORD-TEMPLATE.md`).

## Test scenarios

Each row should be run per browser in the matrix above. Capture a screenshot
(or short screen recording) for every ✅/❌.

| # | Scenario | Steps | Expected result |
|---|---|---|---|
| 1 | Install from the Chrome Web Store | Install the published listing (not a sideloaded zip) | Installs cleanly, icon appears in the toolbar at correct size |
| 2 | First-run / create wallet | Open the extension → Create wallet → set password → back up phrase | Wallet created, address shown, no errors |
| 3 | Unlock | Close and reopen the extension, enter password | Unlocks to Home within a few seconds |
| 4 | Home renders live data | View Home | Balance, "Synced" status, and asset list render without indexer errors |
| 5 | EIP-6963 dApp connect | Visit a real dApp (e.g. an Ignite/Makalu-compatible site) → Connect wallet | Thanos appears in the wallet picker, connects, correct address exposed |
| 6 | Sign a message | Trigger `personal_sign` or `eth_signTypedData_v4` from the connected dApp | Approval sheet shows human-readable request; signing succeeds |
| 7 | **Send ONE approved low-value Makalu transaction** | From Home → Send → pick LITHO (or a Makalu LEP-100 token) → a pre-approved recipient address → a low value amount (client/team pre-approves the exact amount + recipient before running this) → confirm | Transaction broadcasts; a real tx hash is returned |
| 8 | Explorer confirmation | Open the tx hash on `https://makalu.litho.ai/txs/<hash>` | Transaction appears confirmed on-chain, amount/recipient match what was sent |
| 9 | Activity + balance update | Return to the extension | Activity list shows the new Sent row; balance reflects the debit (+ gas) |
| 10 | Lock / re-unlock | Lock the wallet, reopen, unlock again | Locks correctly; unlocking again restores the same state |

## What this run must NOT include

- **No seed phrase, private key, or password** in any screenshot, log, or
  attached evidence.
- **No unapproved amount or recipient** — the low-value Makalu send in
  scenario 7 must use a recipient and amount the team has pre-approved
  before the run starts, so there's no ambiguity about what "approved"
  means after the fact.
- Public evidence (tx hash, explorer link, screenshots of the app UI) is
  fine to attach — it contains no secrets.

## Output

Record results in `ACCEPTANCE-RECORD-TEMPLATE.md` (copy it to a dated file,
e.g. `ACCEPTANCE-RECORD-2026-08-19.md`), attach the evidence, and have an
authorized team member sign it.
