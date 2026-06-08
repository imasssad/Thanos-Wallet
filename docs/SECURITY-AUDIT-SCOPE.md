# Security audit — scope of work

A request-for-quote document the wallet team can paste into outreach
to security firms (Cure53, Trail of Bits, Halborn, OpenZeppelin, NCC,
Doyensec, Quarkslab, Zellic). One scope means every firm bids against
the same surface, so the quotes are comparable.

**Status:** Soliciting bids. Engagement window opens once Esha confirms
budget + which firm(s). Code freeze on commit `3591004` (Jun 2026)
plus any blocker fixes the audit pre-flight finds.

---

## 1. Project summary

Thanos Wallet is a self-custody multi-chain wallet shipping on five
surfaces: web (Next.js 15), browser extension (Chrome MV3 + Brave +
Firefox + Safari), desktop (Electron 33, macOS + Windows), mobile
(React Native via Expo, iOS + Android), and a shared backend
(Node.js + Postgres + Redis + BullMQ).

Supported chains: Lithosphere Makalu + Kamet (lithic), Ethereum + BSC
(EVM), Bitcoin (UTXO via mempool.space), Solana (SPL), Cosmos Hub. Cross-chain
bridging via MultX (bridge.litho.ai) and same-chain swaps via Ignite
DEX (ignite.litho.ai). Hardware-wallet signing via Ledger (EVM/BTC/SOL)
and Trezor (EVM/BTC).

**Total LOC:** ~120K committed (excluding generated). All source open
at https://github.com/imasssad/Thanos-Wallet.

**Repo:** https://github.com/imasssad/Thanos-Wallet (we will grant
audit-team contractors read access during engagement)

**Live production:** https://thanos.fi

---

## 2. Surfaces in scope

Bid on these as a single bundle or separately — please quote both.

| ID | Surface | Lines of code | What it does |
|----|---------|--------------:|--------------|
| **S1** | **sdk-core** | ~14K | Vault crypto (Argon2id + AES-256-GCM), seed derivation, address conversion (litho1 ↔ 0x, bech32), all chain clients, WalletConnect bridge, phishing classifier, transaction simulator |
| **S2** | **Web app** (`apps/web`) | ~32K | Next.js 15, signer Worker, Receive/Send/Swap/DNNS UIs, SIWE flow |
| **S3** | **Browser extension** (`apps/extension`) | ~9K | MV3 service worker + offscreen document + popup + content script + injected provider (EIP-1193 + EIP-6963) |
| **S4** | **Desktop** (`apps/desktop`) | ~17K | Electron 33 — main-process keytar vault, hardware-wallet IPC bridge, WebHID/native-HID Ledger transport, auto-update |
| **S5** | **Mobile** (`apps/mobile`) | ~21K | Expo / React Native — biometric unlock, secure storage (iOS Keychain + Android KeyStore), in-app dApp browser, WalletConnect pairing |
| **S6** | **Backend** (`services/*`) | ~13K | Express API (auth, contacts, DNNS, portfolio), BullMQ worker (queues, indexer, bridge-poll), Postgres schema, Sentry pipeline |

All six share `@thanos/sdk-core` so S1 findings cascade across S2–S6.

---

## 3. Threat-model priorities

We care most about these classes of finding, listed by severity tolerance:

### Tier 1 — zero tolerance
- Recovery of an unlocked wallet's seed phrase by an attacker who controls the page (web), the host page DOM (extension content script), the renderer process (desktop), or a co-installed RN module (mobile).
- Recovery of the encrypted-vault password from any cache, log, breadcrumb, or transport.
- Address substitution on Send (recipient swap by browser extension, malicious dApp, deep-link, or QR injection).
- Cross-app pollution between Thanos and other EIP-1193 wallets (MetaMask, Phantom, Rabby) installed in the same browser.
- Authentication bypass on the backend (`services/api`) — JWT forgery, refresh-token reuse, brute-force on `/auth/login`, contact-decryption-key disclosure.

### Tier 2 — high severity
- WalletConnect v2 session hijacking, including topic-spoofing across sessions.
- Hardware-wallet signing bypass — recovery of seed from Ledger/Trezor IPC, address-substitution on the on-device confirm screen, transport downgrade.
- Phishing classifier bypass — dApp origin spoof that survives our risk score.
- Push-notification token leakage (mobile) — wallet-address ↔ FCM/Expo token correlation.
- Sentry redaction bypass — verify the recursive regex strips every secret class.

### Tier 3 — defense-in-depth review
- CSP regression on web + extension pages.
- MV3 offscreen-document lifecycle abuse (forced reload, message injection, persistence bypass).
- Electron context-isolation + sandbox correctness; preload allowlist review.
- Mobile deep-link surface (claim + JS injection into the in-app WebView).
- Dependency surface — known CVEs in pinned versions, lockfile poisoning risk.

A full mapping of each Tier-1 + Tier-2 item to file:line is at
[docs/SIGNING-ISOLATION.md](SIGNING-ISOLATION.md) for the signing
boundary and [docs/architecture.md](architecture.md) for everything
else. We'll grant repo read access at engagement start.

---

## 4. Engagement type

Whitebox. We provide source, build instructions, staging access, every
internal doc. Hybrid (whitebox source review + targeted black-box
penetration against a staging deployment) is preferred so you can
prove the source-level findings reach a real exploit.

We do **not** want a pure black-box engagement — too many findings
get missed when the auditor can't read the code that's actually
running.

---

## 5. Deliverables expected

1. Weekly status reports (one paragraph plus a delta of new findings).
2. Findings document — one entry per issue with:
   - Severity (CVSS 3.1 + business-impact narrative)
   - Reproduction steps (code path or HTTP trace, video / screenshot
     if it's a UI exploit)
   - Suggested remediation
   - Re-test acceptance criteria
3. Executive summary suitable for sharing with non-technical
   stakeholders (App Store reviewers, customers, the Lithosphere team).
4. Optional but valued: a one-page public attestation we can publish
   at thanos.fi/security/audits after the fixes ship.
5. One re-audit pass after remediation — confirms every finding is
   closed before public release.

---

## 6. Out of scope

- Lithosphere protocol-level security (consensus, validator economics) —
  that's the Lithosphere team's audit, not ours.
- Smart contracts owned by third parties (Ignite DEX pools, MultX
  bridge contracts). The wallet only calls them; their security is the
  protocol team's audit.
- Hardware-wallet device firmware (Ledger / Trezor manufacturer
  responsibility).
- Marketing site SEO / GDPR cookie banner.
- DoS resistance for the public RPC endpoints (rpc.litho.ai etc.) —
  Litho team's infrastructure.

---

## 7. Timeline + format

- Quote window: open today, close 7 calendar days after first contact.
- Earliest start: as soon as code is frozen on the commit named in
  Section 1. We're targeting freeze within 2 weeks of confirming a
  firm.
- Engagement duration: bid your preferred. Wallets at this surface
  area typically run 4–6 weeks for the source review + 1 week for
  remediation re-test.
- Findings format: Markdown or PDF, plus a CSV ledger so we can
  track remediation status. Each finding ID maps to a follow-up
  commit on remediation.

---

## 8. Information we will provide on engagement start

- Repo read access on GitHub.
- Walk-through video of the architecture (recorded, ~45 min).
- Staging environment URL + test accounts (no real funds).
- The SOPS-encrypted prod secrets file (decrypted to a staging
  copy you can run against).
- A pre-existing "known issues" list so you don't bill us for
  re-finding what we already know about.
- Direct Signal / Slack contact for fast questions.

---

## 9. What we want in your bid

Please reply with:

1. Firm name + contact for the engagement lead.
2. Two prior wallet / browser-extension audits — public reports
   preferred, NDA's redacted summary acceptable.
3. Headcount on this engagement + their CVs / GitHub handles.
4. Total cost, broken into (a) source review (b) staging pentest
   (c) re-test.
5. Earliest start date + estimated completion date.
6. Any concerns about the scope — surfaces you'd add, surfaces
   you'd drop, time pressure points.

Send to: **devs@thanos.fi**

We'll evaluate within 3 business days of receipt and pick a firm
(or two — see Section 10).

---

## 10. Two-firm option

For Tier-1 items we're willing to pay for two firms in parallel —
Cure53 + a heavy backend specialist, for example — because (a) the
audit cost is small relative to user-fund risk, and (b) two
independent reviewers catch more than one with longer hours.

If you bid, please quote the **discounted rate for parallel
engagement with one named partner firm**. We don't need their bid
upfront, just yours assuming we pick a second firm independently.

---

## Contact

- Engagement coordination: devs@thanos.fi
- Live wallet: https://thanos.fi
- Source: https://github.com/imasssad/Thanos-Wallet
- Privacy policy: https://thanos.fi/privacy
- Public security disclosure surface: https://thanos.fi/.well-known/security.txt
