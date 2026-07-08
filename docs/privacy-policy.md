# Privacy Policy

**Effective date:** June 2026
**ThanosWallet.ai** · Maintained by **KaJ Labs**

Thanos Wallet is a self-custodial, multi-chain cryptocurrency wallet.
This policy explains what information we collect, why we collect it,
and how we use it. We have written it to be read by a person, not a
lawyer.

> The short version: your private keys and seed phrase never leave
> your device. We do not sell your data. We collect only what we need
> to make the wallet work.

---

## 1. What We Collect

### Information you provide

- An email address and password, only if you choose to create the
  **optional cloud account** offered in the web and mobile apps. The
  wallet is fully functional without one — the account exists solely
  to sync your address book and preferences across devices. Your
  password is hashed with Argon2id before storage and is never
  readable by us.
- Address book contacts you choose to save. Without a cloud account
  they stay on your device only. If you sign in, they sync to our
  servers: contact names and notes are encrypted on your device before
  upload (we cannot read them); the addresses themselves are stored so
  sync can work.
- DNNS (.litho) names you register or resolve through the wallet.
  Registrations are submitted directly to the Lithosphere blockchain,
  where they are public; name lookups may pass through and be cached
  by our servers.

### Information collected automatically

- On-chain data: wallet addresses, transaction hashes, token balances,
  and block events. This data is public on the blockchain by its
  nature.
- If you sign in to a cloud account: session records including your
  IP address, your browser/device user-agent string, your platform
  (iOS, Android, web, desktop, extension), and hashed session tokens
  used to keep you signed in securely. Sign-in attempts — including
  failed ones — are logged with IP address and user-agent for
  security auditing.
- If you enable push notifications in the mobile app: your device
  push token (issued by Expo, Apple, or Google), your wallet address,
  and your platform, stored on our servers so we can notify you about
  wallet activity. The token is removed when you turn notifications
  off.
- Error and crash reports via Sentry in the **web and mobile apps**,
  which may include the app version, device OS, and stack trace.
  Crash reports do not include your seed phrase, private keys, or
  wallet balances. The desktop app and browser extension do not send
  crash reports.

### What we never collect

- Your seed phrase or private keys. These are generated on your
  device, encrypted with your own password, and stored only on your
  device. They are never transmitted to our servers.
- The contents of transactions you have not yet broadcast.
- Your location.
- Any data from websites you visit outside of the wallet.
- Usage analytics or behavioural tracking of any kind. The apps
  contain no analytics or advertising SDKs — we do not track which
  features you use.

## 2. How We Use Your Information

We use the information we collect to:

- Run the wallet and keep it secure, including securing the optional
  cloud account, syncing your address book, and resolving names.
- Index token balances and transaction history from public blockchain
  data so your portfolio stays up to date.
- Send you the push notifications you have enabled, such as
  transaction confirmations and WalletConnect requests.
- Detect and fix bugs using crash reports and error logs.
- Communicate with you about important security updates if you have
  provided an email address.

**We do not use your information to show you advertisements. We do not
sell your data to third parties. We do not use your data to train AI
models.**

## 3. How Your Keys and Seed Phrase Are Stored

Thanos Wallet is non-custodial. This means:

- Your seed phrase is shown to you once during wallet creation. After
  that, it is encrypted on your device using a key derived from your
  password via Argon2id. The encrypted vault is stored in your
  device's secure storage (Keychain on iOS, Keystore on Android, OS
  vault on desktop, encrypted localStorage on web).
- We cannot recover your seed phrase if you forget your password.
  There is no "forgot password" for the seed. Keep your seed phrase
  written down somewhere safe.
- Your vault is never uploaded anywhere. There is no cloud backup of
  your seed phrase or private keys — the optional cloud account syncs
  only your address book and preferences, never wallet keys.

## 4. Third-Party Services

The wallet interacts with the following external services:

- **Blockchain RPC nodes** (rpc.litho.ai, rpc-2.litho.ai,
  rpc-3.litho.ai, public Ethereum/Solana/Bitcoin nodes): used to
  read balances and broadcast transactions. These services receive
  your wallet address and transaction data as part of normal
  blockchain operation.
- **CoinGecko**: used to fetch token prices. Requests do not include
  your wallet address or identity.
- **bridge.litho.ai**: used for cross-chain bridge operations.
  Transaction details are shared only when you initiate a bridge.
- **Sentry**: used for crash reporting in the web and mobile apps.
  See Section 1 for what is included.
- **Expo, Apple (APNs), and Google (FCM) push services**: deliver the
  push notifications you enable in the mobile app.
- **WalletConnect** (Reown relay): used to connect the wallet to
  decentralised applications. Session metadata is relayed through
  Reown's infrastructure.

We are not responsible for the privacy practices of these third
parties. We recommend reviewing their policies if you have concerns.

## 5. Data Retention

- Cloud-account data (email, hashed password, session records):
  retained while your account is active, and deleted on request — see
  Section 7 (Data Deletion).
- Push notification tokens: retained until you disable notifications
  or request deletion.
- Blockchain index data (balances, transaction history): retained to
  power your portfolio view. This data is derived from public
  blockchain records.
- Crash reports: retained for 90 days.

## 6. Your Rights

Depending on where you live, you may have the right to access,
correct, or delete the personal data we hold about you. To exercise
any of these rights, contact us at the address in Section 11.

- **Access:** you can request a copy of the data we hold about your
  account.
- **Correction:** to correct account data such as your email address,
  contact support@thanos.fi.
- **Deletion:** you can erase your wallet from the device and have
  all associated server-side data deleted — see Section 7 (Data
  Deletion) for exactly how.
- **Portability:** you can request an export of your synced address
  book by emailing support@thanos.fi.
- **Objection:** we collect no usage analytics or behavioural data,
  so there is no tracking to opt out of.

## 7. Data Deletion

You can delete the data Thanos Wallet holds about you at any time.
What can be deleted — and how — depends on where the data lives:

- **Local wallet vault (your device).** Go to **Settings → Reset
  Wallet** (also available as "Forgot password? Reset wallet" on the
  unlock screen). This permanently erases the encrypted vault — your
  seed phrase, private keys, and wallet settings — from the device.
  Uninstalling the app removes it too; on iOS, run Reset Wallet
  before uninstalling for guaranteed removal, as Keychain entries can
  otherwise survive a reinstall. Back up your seed phrase first: a
  reset is irreversible, and we cannot recover a wallet without its
  seed.
- **Server-side data.** Data associated with your wallet address on
  the Thanos backend — synced address-book contacts, device sessions,
  push-notification tokens, and WalletConnect session metadata — is
  deleted on request. Email support@thanos.fi with the wallet address
  you want removed; we complete deletion within 30 days and confirm
  by reply. Device sessions also expire automatically.
- **On-chain data.** Wallet addresses, balances, and transactions
  recorded on a blockchain are public by design and cannot be
  deleted — by us or by anyone else. Resetting your wallet removes
  your keys from the device but does not remove history already
  recorded on-chain.
- **Manual requests.** For deletion of any other personal data, or if
  you cannot use the in-app option, email support@thanos.fi. We
  respond to all deletion requests within 30 days.

## 8. Security

We take security seriously. Key measures include:

- All data in transit is encrypted with TLS 1.3.
- Passwords are hashed with Argon2id (t=3, m=64MB, p=4) before storage.
- Authentication tokens use short-lived JWTs (15 minutes) with
  rotating refresh tokens.
- Rate limiting is enforced on all authentication endpoints.
- Private keys and seed phrases are never transmitted to our servers
  under any circumstances.
- We conduct regular dependency audits and maintain a security
  incident runbook.

No system is perfectly secure. If you discover a vulnerability,
please report it responsibly to our security contact before disclosing
it publicly.

## 9. Children

Thanos Wallet is not intended for use by anyone under the age of 18.
We do not knowingly collect personal information from children. If
you believe a child has provided us with personal information, please
contact us and we will delete it promptly.

## 10. Changes to This Policy

We may update this policy from time to time. When we do, we will
update the effective date at the top of this page and, for
significant changes, notify users who have provided an email address.
Continued use of the wallet after changes are posted constitutes
acceptance of the updated policy.

## 11. Contact

If you have questions about this policy or want to exercise your data
rights, you can reach us at:

- Thanos Wallet by KaJ Labs
- Website: ThanosWallet.ai
- Support: support@thanos.fi

---

Thanos Wallet is self-custodial. Your keys, your crypto.
