# Integrating Thanos Wallet for authentication

This document is for developers building third-party apps that want to
use Thanos Wallet as the authentication layer — Sign-In With Thanos
(SIWT), tx signing, identity, etc. Two integration paths are supported:

1. **Browser dApp** with the Thanos browser extension installed (or
   another EIP-1193 wallet). Direct injection — sub-millisecond latency.
2. **Mobile / cross-device dApp** via WalletConnect v2 (Reown relay).
   No extension required — works on iOS, Android, desktop wallets.

Both paths converge on the same signature primitives, so the backend
verification code is identical.

---

## TL;DR — Sign-In With Thanos in 30 lines

Front-end:

```ts
import { BrowserProvider } from 'ethers'; // or viem / wagmi

async function signInWithThanos() {
  // 1. Discover provider (EIP-6963 first, fallback to window.thanos)
  const provider = await getThanosProvider();
  if (!provider) throw new Error('Thanos Wallet not detected');

  // 2. Connect — opens the wallet approval popup
  const ethers = new BrowserProvider(provider);
  const [account] = await provider.request({ method: 'eth_requestAccounts' });

  // 3. Pull a one-time nonce from your backend
  const nonce = await fetch(`/api/auth/nonce?address=${account}`).then(r => r.text());

  // 4. Build a SIWE-style message and sign it (uses Thanos's personal_sign)
  const message = `Sign in to ${location.host}\n\nAddress: ${account}\nNonce: ${nonce}\nIssued: ${new Date().toISOString()}`;
  const signature = await provider.request({
    method: 'personal_sign',
    params: [message, account],
  });

  // 5. Send (message, signature) to your backend — it verifies + issues a session
  const res = await fetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, signature, address: account }),
  });
  return res.json(); // { sessionToken, ... }
}
```

Backend (Node / TypeScript):

```ts
import { verifyMessage } from 'ethers';

app.post('/api/auth/verify', async (req, res) => {
  const { message, signature, address } = req.body;

  // 1. Recover the signer from the signature.
  const recovered = verifyMessage(message, signature);
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return res.status(401).json({ error: 'signature does not match address' });
  }

  // 2. Validate the nonce you issued is fresh + un-spent (prevents replay).
  const nonce = parseNonceFromMessage(message);
  if (!await consumeNonce(address, nonce)) {
    return res.status(401).json({ error: 'nonce expired or already used' });
  }

  // 3. Issue your app's session token.
  const session = await issueSession(address);
  res.json({ sessionToken: session.token });
});
```

That's it. Sections below cover discovery, multi-chain handling,
WalletConnect, and method reference.

---

## 1. Discovering the Thanos provider

The browser extension injects two surfaces in parallel:

| Surface | Identifier | Use when |
|---------|-----------|----------|
| `window.thanos` | EIP-1193 provider | You explicitly want Thanos and not other wallets |
| EIP-6963 event | `rdns: "fi.thanos.wallet"` | You want multi-wallet support (preferred) |

`window.ethereum` is **NOT** stomped by Thanos — if a user has
MetaMask + Thanos both installed, MetaMask keeps `window.ethereum` and
Thanos exposes itself via `window.thanos` + EIP-6963 announce.

```ts
async function getThanosProvider(): Promise<EIP1193Provider | null> {
  // Path A (preferred) — EIP-6963 discovery
  return new Promise<EIP1193Provider | null>((resolve) => {
    let resolved = false;
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        info: { rdns: string };
        provider: EIP1193Provider;
      };
      if (detail.info.rdns === 'fi.thanos.wallet') {
        resolved = true;
        window.removeEventListener('eip6963:announceProvider', onAnnounce);
        resolve(detail.provider);
      }
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    // Path B (fallback) — direct property after 100ms
    setTimeout(() => {
      if (resolved) return;
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      resolve((window as unknown as { thanos?: EIP1193Provider }).thanos ?? null);
    }, 100);
  });
}
```

### Detecting installation without a wallet popup

If you want a "Install Thanos" CTA when the extension isn't installed,
the same probe returns `null` cleanly. Don't call `eth_requestAccounts`
to test — that opens a popup.

---

## 2. Sign-In With Thanos (SIWT) — full message format

Follow the [EIP-4361](https://eips.ethereum.org/EIPS/eip-4361) (SIWE)
shape for maximum tool compatibility — Thanos's `personal_sign` produces
identical signatures to MetaMask + Rainbow + Coinbase Wallet.

Recommended message template:

```
{domain} wants you to sign in with your Ethereum account:
{address}

{statement}

URI: {uri}
Version: 1
Chain ID: {chainId}
Nonce: {nonce}
Issued At: {issuedAt}
Expiration Time: {expirationTime}
```

The `siwe` npm package builds this for you and handles parsing on the
backend:

```ts
import { SiweMessage } from 'siwe';

const msg = new SiweMessage({
  domain:         location.host,
  address:        userAddress,
  statement:      'Sign in to MyApp with Thanos Wallet',
  uri:            location.origin,
  version:        '1',
  chainId:        700777,                          // Lithosphere Makalu
  nonce:          serverNonce,
  issuedAt:       new Date().toISOString(),
  expirationTime: new Date(Date.now() + 10*60*1000).toISOString(),
});

const signature = await provider.request({
  method: 'personal_sign',
  params: [msg.prepareMessage(), userAddress],
});
```

Backend verify with the same package:

```ts
import { SiweMessage } from 'siwe';

const siwe = new SiweMessage(messageString);
const result = await siwe.verify({ signature, nonce: storedNonce, domain: 'myapp.example' });
if (!result.success) throw new Error(`SIWE verify failed: ${result.error?.type}`);
// result.data.address — the verified signer
```

Use this over hand-rolled message strings — covers domain binding,
nonce checks, replay windows, and chain-ID anchoring without you
having to think about them.

---

## 3. WalletConnect v2 — mobile & desktop wallets

For dApps that need to authenticate users on mobile (Thanos iOS /
Android, or any other WalletConnect-compatible wallet), use the
WalletConnect v2 protocol via Reown.

Thanos uses the **public Reown relay** — `wss://relay.walletconnect.com`
— so no relay credentials are required for your integration. You only
need a Reown project ID (free at https://cloud.reown.com).

```ts
import { SignClient } from '@walletconnect/sign-client';

const signClient = await SignClient.init({
  projectId: 'your-reown-project-id',
  metadata: {
    name:        'MyApp',
    description: 'My awesome app',
    url:         'https://myapp.example',
    icons:       ['https://myapp.example/icon.png'],
  },
});

// 1. Build a pairing URI and show as QR (or deep-link on mobile).
const { uri, approval } = await signClient.connect({
  requiredNamespaces: {
    eip155: {
      chains:   ['eip155:700777'],         // Makalu — change as needed
      methods:  ['personal_sign', 'eth_sendTransaction', 'eth_signTypedData_v4'],
      events:   ['chainChanged', 'accountsChanged'],
    },
  },
});

// Render `uri` as a QR code (use qrcode.js, etc.)

// 2. Wait for the user to scan + approve in their Thanos mobile app.
const session = await approval();
const account = session.namespaces.eip155.accounts[0].split(':')[2]; // eip155:700777:0xABC

// 3. Sign the SIWE message — identical message format to the
//    browser path above.
const signature = await signClient.request({
  topic:   session.topic,
  chainId: 'eip155:700777',
  request: { method: 'personal_sign', params: [siweMessage, account] },
});
```

The backend `verify` step is identical regardless of which path the
user took — same signature format, same message, same SIWE library.

---

## 4. Supported chains & methods

### Chains Thanos can sign on

| Chain | Chain ID | EIP-155 namespace |
|-------|---------:|-------------------|
| **Lithosphere Makalu** | 700777 | `eip155:700777` |
| **Lithosphere Kamet** | 900523 | `eip155:900523` |
| Ethereum mainnet | 1 | `eip155:1` |
| BSC | 56 | `eip155:56` |
| Polygon | 137 | `eip155:137` |
| Base | 8453 | `eip155:8453` |
| Arbitrum | 42161 | `eip155:42161` |
| Optimism | 10 | `eip155:10` |
| Avalanche C-Chain | 43114 | `eip155:43114` |
| Linea | 59144 | `eip155:59144` |

Non-EVM chains (Bitcoin, Solana, Cosmos Hub) are signed in-wallet but
not exposed through the EIP-1193 provider — they're not part of the
EIP-155 namespace. Integrations that need BTC/SOL/ATOM signing should
use WalletConnect's `cip-x`/`bip122:*`/`cosmos:*` namespaces.

### EIP-1193 methods supported

| Method | Behaviour |
|--------|-----------|
| `eth_requestAccounts` | Opens connect approval. Returns `[address]`. |
| `eth_accounts` | Returns connected accounts without prompting. |
| `eth_chainId` | Returns `0xab09f9` (Makalu default) or active chain. |
| `wallet_switchEthereumChain` | Switches the active chain. Prompts if untrusted. |
| `wallet_addEthereumChain` | Adds a chain to the wallet's known list. |
| `eth_sendTransaction` | Opens tx approval with simulator + risk score. |
| `eth_signTransaction` | Returns a signed tx without broadcasting. |
| `personal_sign` | EIP-191 message signing. Use for SIWT. |
| `eth_signTypedData_v4` | EIP-712 structured signing. Use for permits / orders. |

### Events emitted

| Event | Payload | When |
|-------|---------|------|
| `accountsChanged` | `string[]` | User switches account or disconnects |
| `chainChanged` | `0x…` chain id | User switches chain |
| `disconnect` | `{ code, message }` | Session ended |
| `connect` | `{ chainId }` | Initial connection settled |

---

## 5. Lithosphere-specific authentication

### Dual address format (litho1 ↔ 0x)

Lithosphere accounts have two valid string representations: the EVM
`0x…` hex form (used by all the methods above), and a Cosmos-style
`litho1…` bech32 form (used by Cosmos SDK tooling). Both map to the
same underlying 20-byte public-key hash.

Your dApp can accept either format from the user — use the conversion
helpers in `@thanos/sdk-core`:

```ts
import { evmToLitho, lithoToEvm, normaliseLithoAddress } from '@thanos/sdk-core';

evmToLitho('0x742d35Cc6634C0532925a3b844Bc454e4438f44e');
// → 'litho1wglp4tq...'

lithoToEvm('litho1wglp4tq...');
// → '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'

normaliseLithoAddress(userInput);
// → { evm: '0x…', litho: 'litho1…' }
```

### DNNS — Lithosphere's name service

Thanos resolves `.litho` names to addresses via the DNNS contracts on
Kamet (chain 900523). Your dApp can take a `.litho` name as input
without your users needing to know the underlying EVM address:

```ts
import { DnnsService } from '@thanos/sdk-core';

const dnns = new DnnsService();

// Forward: name → address
const record = await dnns.resolve(900523, 'alice.litho');
// → { name: 'alice.litho', address: '0x...', chainId: 900523 }

// Reverse: address → name (forward-verified)
const name = await dnns.reverseResolve(900523, '0x...');
// → 'alice.litho' | null
```

Or use the hosted resolver:
```
GET https://thanos.fi/api/dnns/resolve?name=alice.litho
GET https://thanos.fi/api/dnns/lookup?address=0x...
```

---

## 6. Server-side verification — common pitfalls

| Pitfall | Fix |
|---------|-----|
| `verifyMessage` returns wrong address | The message you pass must be byte-identical to what was signed. Don't trim whitespace, change encoding, or rebuild from parts. |
| Replay attack: same signature accepted twice | Issue single-use nonces, stored server-side with a TTL (5–10 min). Consume on first verify. |
| Chain confusion | Bind chainId into the SIWE message. Different chain → different message → different signature. |
| Domain hijack | Bind `domain` into the SIWE message. Verify it matches your host on the backend. |
| Long-lived sessions on compromised keys | Issue short-lived JWT (15 min) + rotating refresh token. Force re-signature on refresh expiry. |
| Lower-case address comparison | Always lowercase before comparing — EIP-55 checksum is presentation-only. |

---

## 7. End-to-end auth lifecycle

```
   ┌───────────┐     1. eth_requestAccounts        ┌─────────────┐
   │   dApp    │ ─────────────────────────────────►│   Thanos    │
   │  frontend │◄───── address ───────────────────│   Wallet    │
   └─────┬─────┘                                   └─────────────┘
         │
         │   2. POST /auth/nonce
         ▼
   ┌──────────────┐                                ┌──────────────┐
   │   dApp API   │ ── nonce ──────────────────────►│   dApp UI    │
   └──────────────┘                                └───────┬──────┘
                                                          │
                                                          │   3. personal_sign(siwe(nonce))
                                                          ▼
                                                   ┌─────────────┐
                                                   │   Thanos    │
                                                   │   Wallet    │
                                                   └──────┬──────┘
                                                          │ 4. signature
   ┌──────────────┐                                       ▼
   │   dApp API   │ ◄── POST /auth/verify ──────── ┌──────────────┐
   │              │      { message, signature }    │   dApp UI    │
   │              │ ─── { sessionToken } ─────────►│              │
   └──────────────┘                                └──────────────┘
```

5-minute total integration. The signature is sufficient — no
additional handshake, no shared secrets, no API keys.

---

## 8. Reference implementations

| Stack | Snippet |
|-------|---------|
| **viem** (recommended) | https://viem.sh/docs/clients/wallet#eip-1193-compatible-providers |
| **wagmi** (React hooks) | https://wagmi.sh/react/connectors/walletConnect — change `walletConnect` to `injected` for the extension path |
| **ethers v6** | All examples above use ethers v6 |
| **siwe-js** | https://github.com/spruceid/siwe — handles the message + verification |
| **WalletConnect v2** | https://docs.reown.com/walletkit/web/installation |

---

## Contact

Issues or integration questions:
- security: security@thanos.fi
- integrations: devs@thanos.fi
- Repo: https://github.com/imasssad/Thanos-Wallet

All examples in this doc are MIT-licensed for integration use.
