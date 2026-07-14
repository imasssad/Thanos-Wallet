# Thanos Wallet — Google Play "Sign in details" / Reviewer Access Instructions

> Resolves the Play Console rejection: *"You didn't provide an active demo/guest
> account or a valid username and password which we need to access your app."*
> No rebuild required — this is entirely a Play Console **App access** declaration.
> Every label below was verified against the actual onboarding code in
> `apps/mobile/App.tsx` (component `OnboardingScreen`).

## Why there is no login
Thanos Wallet is a **self-custodial (non-custodial)** crypto wallet. There is no
server-side account, no login screen, no username, and no backend password —
nothing to authenticate against a remote service. By design the app never holds
user keys or credentials: the recovery phrase / private key and the encrypted
vault live only on the user's device. The only thing that gates access is
(a) creating or importing a wallet on the device and (b) a **device-local
password (minimum 8 characters)** the user chooses on the device to encrypt that
vault. Because that password is generated on-device and never leaves it, we
cannot pre-set it for a reviewer — they set it themselves during the steps below.
(Google confirmed in Aug 2025 that **non-custodial wallets are out of scope** of
the Crypto Exchanges & Software Wallets policy — so this is purely an
App-access/review-access issue, not a licensing one.)

## What to do in Play Console
1. **All apps → Thanos Wallet → Policy and programs → App content → App access → Manage.**
   (This is the section Google's email calls the **"Sign in details"** page.)
2. Choose **"All or some functionality is restricted"** → **+ Add new instructions**.
   > Do **not** choose *"All functionality is available without special access."*
   > From a reviewer's seat, first-run wallet setup + the device password reads as a
   > gate — that's exactly what triggered the rejection.
3. Fill the fields (next section), **Save**, then **Publishing overview → Send for review.**

### App access form fields
- **Name of restricted content:** `Wallet home, balances, and Send/Receive (behind first-run wallet setup + device-local password)`
- **Username:** leave blank; if the field is required, enter `N/A - no account/username (non-custodial, device-local only)`
- **Password:** leave blank; if the field is required, enter `N/A - password is user-chosen on device, see instructions`
- **Instructions:** paste the Preamble + Option A + Option B below.

> **Do not tell the reviewer to enter a 6-digit PIN.** The app uses an **8+
> character alphanumeric password** with a *Confirm password* field — a value
> shorter than 8 characters fails the gate and causes a repeat rejection.

---

## Instructions to paste

**Preamble — read first**
- Thanos Wallet is a self-custodial (non-custodial) crypto wallet. There is NO server account, NO login, NO username, and NO password to authenticate against a backend — by design we never hold user keys or credentials.
- The only access gate is (a) creating or importing a wallet on the device and (b) a device-local password (minimum 8 characters) that you set on the device itself. This password encrypts the local vault; it is NOT a credential we hold and cannot be pre-set by us.
- No biometric (Face ID / Fingerprint) prompt appears during first-run create or import — there is nothing to skip. There is no terms checkbox to tick, no numeric PIN, and no network/region choice during onboarding.
- Two ways to reach full functionality are below. **Option B (import the demo key) is the fastest** because it skips the recovery-phrase verification quiz.

**Option A — Create a new wallet (no credentials needed)**
1. Launch the app. On the Welcome screen, tap **"Create a new wallet"**.
2. On **"Choose phrase length"**, tap the **left card** (shows a large **"12"** / **"words"** / **"Recommended · 128-bit entropy"**).
3. On **"Save your recovery phrase"**, tap **"I understand"**.
4. On **"Your recovery phrase"**, write the 12 words down in order (you may tap **"Copy phrase"**), then tap **"I've saved it"**.
5. On **"Verify your phrase"**, tap the 4 missing words from the pool into the blank slots **in the correct order** (tap a filled slot to undo). When all 4 are correct, tap **"Continue"**.
6. On **"Set a password"**, enter an 8+ character password in the **"Password"** field, then re-enter the identical value in **"Confirm password"** (example: `Review1234`). This is a device-local password, not a server/account login. Tap **"Create wallet"** (the button briefly shows **"Encrypting…"**).
7. You land on the wallet **Home**. A one-time **"Welcome to Thanos Wallet"** modal appears — tap **"Got it"** to dismiss it. Send, Receive, and balances are now fully accessible.

**Option B — Import the demo wallet (fastest; skips the quiz)**
1. Launch the app. On the Welcome screen, tap **"I already have a wallet"**.
2. On the **"Import wallet"** chooser, tap the **"Private key"** card (labeled *"Single EVM account (Makalu) · no BTC/SOL/Cosmos"*).
3. On **"Import private key"**, paste the demo key below into the **"0x…"** field. The **"Continue"** button stays disabled until a valid 64-character hex key is entered; once accepted, tap **"Continue"**.
   Demo private key: `0xc82813c04ea8b0b0d2db85d1bc808db94de4d2161aff6a5e1b008360be5dccf0`
4. On **"Set a password"**, enter an 8+ character password in **"Password"** and the identical value in **"Confirm password"** (example: `Review1234`). This password is created locally on the device — it is not a credential we hold. Tap **"Import wallet"** (button briefly shows **"Encrypting…"**).
5. You land on the wallet **Home**. Dismiss the one-time **"Welcome to Thanos Wallet"** modal by tapping **"Got it"**. Send, Receive, and balances are now fully accessible. No biometric prompt appears during this flow.

---

```
┌────────────────────────────────────────────────────────────────────────────┐
│  DEMO WALLET — review use only, no personal funds                            │
│                                                                              │
│  Demo private key:                                                           │
│      0xc82813c04ea8b0b0d2db85d1bc808db94de4d2161aff6a5e1b008360be5dccf0      │
│                                                                              │
│  Derived address (auto-shown in-app after import):                           │
│      0xD4dA17DD383cA23582B1eAe470Ce79298421190A                              │
│                                                                              │
│  Network: Lithosphere Makalu (chain 700777) — the app's fixed default.       │
│  This is a throwaway test key. Do not send real/personal assets to it.       │
└────────────────────────────────────────────────────────────────────────────┘
```

> **RECOMMENDED — fund the demo wallet before submitting.** Send a small amount of
> **Makalu (LITHO) native token** to `0xD4dA17DD383cA23582B1eAe470Ce79298421190A`
> so the reviewer sees a **non-zero balance** and can actually exercise **Send**.
> An **empty** demo wallet is the single most common cause of a *repeat* rejection:
> the reviewer imports it, sees 0 balance and a greyed-out Send, and concludes
> "functionality still not accessible." Keep it topped up — Google requires the
> access be reusable and valid at all times. (The app opens on Makalu by default,
> so funding on Makalu is what the reviewer will see — no wrong-network trap.)
>
> Tip: also attach the demo key as a **static URL** (a plain-text file or private
> gist) in the App access resource, in case the instructions field mangles spacing.

---

## Reviewer reply (paste into the appeal / instructions note)
Thank you for the review. Thanos Wallet is a self-custodial (non-custodial) crypto
wallet. It has no server-side account system, no login, no username, and no password
to authenticate against a backend, and by design we never hold user keys or
credentials (non-custodial wallets are out of scope of the Crypto Exchanges &
Software Wallets policy). The only access gate is a locally created or imported
wallet plus a device-local password (8+ characters) that the user sets on their own
device. We have set this app's App access to "All or some functionality is
restricted" and provided step-by-step instructions plus a funded demo wallet.
Fastest path: on the Welcome screen tap "I already have a wallet", tap the
"Private key" card, paste the supplied demo key, tap "Continue", then on "Set a
password" enter an 8+ character password (for example Review1234) in both
"Password" and "Confirm password" and tap "Import wallet". You will reach the wallet
Home, where Send, Receive, and balances are fully accessible. Note: the gate is an
8+ character password, not a 6-digit PIN, and no biometric prompt appears during
first-run setup — there is nothing to skip. There are no further credentials because
none exist in a non-custodial design. Please let us know if anything is unclear and
we will respond promptly.

---

## Gotchas that cause *repeat* rejections (avoid these)
- **Empty demo wallet** → fund it (see box above). Top repeat-rejection cause.
- **Telling them "enter a 6-digit PIN / 123456"** → the gate is an **8+ char password**; a 6-char value is rejected by the app.
- **Routing them through "Create a new wallet"** → that path has a **recovery-phrase quiz** they can get stuck on. Use **Option B (import)**.
- **Claiming a biometric "Skip" step** → there is **no biometric prompt** on first run; don't mention one.
- **Draining/rotating the demo wallet** → Google requires access to be reusable and valid at all times; keep the key and its funds stable.
