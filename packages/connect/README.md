# thanos-connect

Drop-in Sign-In With Thanos integration for third-party dApps.

```
npm install thanos-connect
# or
pnpm add thanos-connect
# or
yarn add thanos-connect
```

Zero runtime dependencies. Tree-shakeable. Works with any frontend
framework (React component shipped separately at `thanos-connect/react`).

## Why this exists

If you want to add "Sign in with Thanos" to your dApp, you need:
- EIP-6963 discovery (multi-wallet safe)
- A SIWE-compatible message format
- `personal_sign` round-trip
- Backend verify endpoint contract
- Sensible error handling (user cancels, no wallet, etc.)

This package collapses all of that into a single class and one method.
Pairs with the wallet's own backend at https://thanos.fi but works with
your own auth server too.

## 60-second integration (vanilla JS / TypeScript)

```ts
import { ThanosConnect } from 'thanos-connect';

const thanos = new ThanosConnect({
  appName: 'Ignite DEX',
  chainId: 700777, // Lithosphere Makalu — default
});

// Click handler
document.getElementById('signin').addEventListener('click', async () => {
  try {
    const { address, sessionToken } = await thanos.signIn();
    console.log('signed in as', address);
    // sessionToken is what your /api/auth/verify endpoint returned
  } catch (err) {
    console.error('sign-in failed:', err);
  }
});
```

That's the whole flow. The package handles discovery, fallback,
nonce fetch, signature, and backend verify.

## 60-second integration (React)

```tsx
import { ThanosConnectButton } from 'thanos-connect/react';

export function Header() {
  return (
    <ThanosConnectButton
      config={{ appName: 'EGO Exchange', chainId: 700777 }}
      onSignIn={(session) => {
        console.log('signed in:', session.address);
        // Persist session.sessionToken in your auth context
      }}
      onError={(err) => console.error(err)}
    />
  );
}
```

The button auto-detects whether Thanos is installed and switches to an
"Install Thanos Wallet" CTA when it isn't.

For custom UI, use the hook:

```tsx
import { useThanos } from 'thanos-connect/react';

export function MyConnect() {
  const { signIn, signOut, session, isSigningIn, isAvailable } = useThanos({
    appName: 'AGII',
    chainId: 700777,
  });

  if (!isAvailable) return <a href="https://thanos.fi/app">Install Thanos</a>;
  if (session)     return <button onClick={signOut}>Sign out</button>;
  return <button onClick={() => signIn()} disabled={isSigningIn}>Sign in</button>;
}
```

## Backend contract

By default the package calls two endpoints on your server. Override
the paths via `nonceEndpoint` / `verifyEndpoint`, or set them to `null`
to handle the round-trip yourself.

### `GET /api/auth/nonce?address=0x…` → `text/plain`

Issue a fresh nonce keyed by `address` with a 5-10 min TTL. Return as
plain text (not JSON). Example (Express):

```ts
import crypto from 'crypto';

app.get('/api/auth/nonce', (req, res) => {
  const address = req.query.address as string;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return res.status(400).end();
  const nonce = crypto.randomBytes(16).toString('hex');
  storeNonce(address, nonce, { ttlSec: 300 });
  res.type('text/plain').send(nonce);
});
```

### `POST /api/auth/verify` → `application/json`

Recover the address from the signed message, validate the nonce, issue
a session.

```ts
import { verifyMessage } from 'ethers';
import { parseSiweMessage } from 'thanos-connect';

app.post('/api/auth/verify', async (req, res) => {
  const { message, signature, address } = req.body;

  // Recover signer
  const recovered = verifyMessage(message, signature);
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return res.status(401).json({ error: 'signature mismatch' });
  }

  // Validate the nonce came from us + hasn't been used
  const parsed = parseSiweMessage(message);
  if (!parsed) return res.status(400).json({ error: 'malformed message' });
  if (!await consumeNonce(address, parsed.nonce)) {
    return res.status(401).json({ error: 'nonce invalid or already used' });
  }

  // Issue your session token
  const sessionToken = await issueSession(address);
  res.json({ sessionToken });
});
```

`parseSiweMessage()` and `buildSiweMessage()` are exported from the
package — use them to keep the wire format identical on both sides.

## Configuration reference

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `appName` | string | **required** | Shown in the SIWE message statement |
| `appUrl` | string | `window.location.origin` | Canonical URL anchor |
| `chainId` | number | `700777` (Makalu) | Chain ID for the sign-in |
| `statement` | string | `Sign in to {appName} with your Thanos Wallet.` | Custom SIWE statement |
| `nonceEndpoint` | string \| null | `/api/auth/nonce` | Set `null` to generate nonce client-side |
| `verifyEndpoint` | string \| null | `/api/auth/verify` | Set `null` to skip backend round-trip |
| `fetch` | typeof fetch | global | Override for SSR / RN / edge runtimes |
| `walletRdns` | string | `fi.thanos.wallet` | Loosen for any EIP-6963 wallet |
| `debug` | boolean | `false` | Log discovery + flow steps |

## Errors

```ts
import { ThanosUnavailable, SignInRejected } from 'thanos-connect';

try {
  await thanos.signIn();
} catch (err) {
  if (err instanceof ThanosUnavailable) {
    // Show install CTA
  } else if (err instanceof SignInRejected) {
    // User cancelled in the wallet — silent recovery, no banner needed
  } else {
    // Network / backend / unexpected
  }
}
```

## Multi-chain example

```ts
const thanos = new ThanosConnect({
  appName: 'COLLE AI',
  chainId: 1, // sign in on Ethereum mainnet
});
```

Switch chains after sign-in:

```ts
const provider = await thanos.getProvider();
await provider.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0xab169' }], // 700777
});
```

## Per-app drop-in snippets

Literal copy-paste hooks for the 9 apps in the integration wave. Each
< 15 lines. The Lithosphere ecosystem catalogue lives at
https://ecosystem.litho.ai — these are the apps already wired into
the Thanos Discover screen, so consistency matters across both.

### Ignite DEX — https://ignite.litho.ai

```tsx
import { ThanosConnectButton } from 'thanos-connect/react';

<ThanosConnectButton
  config={{ appName: 'Ignite DEX', chainId: 700777 }}
  onSignIn={({ address, sessionToken }) => {
    localStorage.setItem('ignite.session', sessionToken!);
    location.reload();
  }}
/>
```

### EGO Exchange — *URL TBD with Esha*

```tsx
<ThanosConnectButton
  config={{ appName: 'EGO Exchange', chainId: 700777 }}
  onSignIn={(s) => myAuthStore.setSession(s)}
/>
```

### COLLE AI — https://colle.ai

```tsx
<ThanosConnectButton
  config={{ appName: 'COLLE AI', chainId: 700777 }}
  onSignIn={(s) => router.push('/dashboard?token=' + s.sessionToken)}
/>
```

### AGII — https://agii.app

```tsx
<ThanosConnectButton
  config={{ appName: 'AGII', chainId: 700777 }}
  onSignIn={(s) => useAuthStore.getState().setSession(s)}
/>
```

### ATUA AI — https://atua.ai

```tsx
<ThanosConnectButton
  config={{ appName: 'ATUA AI', chainId: 700777 }}
  onSignIn={(s) => signInToAtua(s.address, s.sessionToken)}
/>
```

### Imagen Network — https://imagen.network

```tsx
<ThanosConnectButton
  config={{ appName: 'Imagen Network', chainId: 700777 }}
  onSignIn={(s) => attachSession(s)}
/>
```

### Mansa AI — https://mansa.world

```tsx
<ThanosConnectButton
  config={{ appName: 'Mansa AI', chainId: 700777 }}
  onSignIn={(s) => persistMansaSession(s)}
/>
```

### Makalu Explorer — https://makalu.litho.ai

Makalu is the Lithosphere main chain — use the default chainId:

```tsx
<ThanosConnectButton
  config={{ appName: 'Makalu Explorer', chainId: 700777 }}
  onSignIn={(s) => loginExplorer(s)}
/>
```

### Kamet Explorer — https://kamet.litho.ai

Kamet is the sister chain (DNNS lives here) — use chainId 900523:

```tsx
<ThanosConnectButton
  config={{ appName: 'Kamet Explorer', chainId: 900523 }}
  onSignIn={(s) => loginExplorer(s)}
/>
```

### Bonus: ecosystem.litho.ai itself

The ecosystem directory has no wallet-connect flow today. If you wire
one, the snippet is identical:

```tsx
<ThanosConnectButton
  config={{ appName: 'Lithosphere Ecosystem', chainId: 700777 }}
  onSignIn={(s) => /* gate the listing dashboard */ null}
/>
```

## SSR / Next.js

The wallet only exists in the browser. Wrap the button in a
client-only boundary:

```tsx
'use client';
import { ThanosConnectButton } from 'thanos-connect/react';
// ... use as normal
```

For Next.js app router, the component is already marked `use client`
on import — no extra setup needed.

## Pairing with WalletConnect for mobile users

If your dApp also supports mobile wallets via WalletConnect, route
non-extension users through that flow and reuse the same SIWE
message format. See
[INTEGRATE-THANOS-AUTH.md](https://github.com/imasssad/Thanos-Wallet/blob/main/docs/INTEGRATE-THANOS-AUTH.md)
in the main repo for the WC integration sample.

## License

MIT. Use everywhere.

## Source / issues

https://github.com/imasssad/Thanos-Wallet/tree/main/packages/connect
