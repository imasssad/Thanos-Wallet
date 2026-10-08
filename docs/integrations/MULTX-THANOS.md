# MultX in Thanos Wallet

How every Thanos client (web, desktop, extension, mobile) runs MultX bridge
transfers, what the bridge backend has to publish, and how to switch the
bridge on. The bridge is **off in every build** until the steps under
"Turning it on" are done.

## What the user sees

- **Web, desktop, extension:** Swap → **Bridge** tab.
- **Mobile:** Home → **Bridge**. It's a separate screen so that it works on
  iOS, which doesn't show Swap.
- The user picks From, To and Asset from the routes the manifest approves,
  then enters an amount. Thanos checks the amount against the token's
  decimals, the route's cap and the user's balance.
- Progress shows each step: checking balance → approving → locking →
  validators signing.
- Recent transfers lists each transfer with its lock and release
  transactions. A transfer that was still in flight when the app closed is
  picked up again the next time the Bridge opens.
- Bridged funds arrive at the user's **own address** on the destination
  chain, because `lockTokens` releases to the sender. Thanos refuses any
  other recipient.

## Flow

1. Fetch the release manifest and check its SHA-256 against the pinned
   value. Any difference refuses the bridge ("Bridge unavailable").
2. Check that the route and token are listed. If they aren't, refuse.
3. Check the signer is on the route's source chain. If not, refuse.
4. On the source bridge, check `supportedTokens(token)`, `balanceOf`, then
   `allowance`. Call `approve(bridge, amount)` if needed, then
   `lockTokens(token, amount, destinationChainId)`. The lock hash is saved
   as soon as it is broadcast.
5. Poll `GET {apiUrl}/bridge/status/{lockTxHash}`:
   - `404` means the lock isn't indexed yet, so keep polling.
   - `pending`, `locked`, `signing` and `signed` mean keep polling.
   - `failed` ends the transfer as **Failed**.
   - `completed` must include `releaseTxHash`; `destinationTxHash` is also
     accepted.
6. Verify the release on the destination chain using Thanos's own RPC. The
   receipt must succeed and contain an ERC-20 `Transfer` of exactly the
   locked amount of the route's destination token to the user.
   - Only then is the transfer shown as **Arrived**.
   - Anything else is **Needs review** and is re-checked later. Funds are
     never shown as arrived on the API's word alone.

## What the backend needs to provide

| Item | Notes |
|---|---|
| Manifest URL (https) | Served as-is. Its bytes must not change, because the SHA-256 is pinned in each build. |
| Manifest SHA-256 | 64 hex characters, of the exact bytes served. |
| `apiUrl` in the manifest | Today `https://bridge.litho.ai`, which the web CSP already allows. Another host also needs adding to `apps/web/lib/csp.js`. |
| `GET /bridge/status/:txHash` | Must return `404` until the lock is seen, then `{ status, releaseTxHash }`. |
| Routes | `sourceChainId`, `sourceBridge`, `destinationChainId`, `destinationBridge`, `tokens[{ symbol, sourceAddress, destinationAddress, decimals }]`, and optionally `maxAmountBaseUnits`. |
| Release tag + 40-hex commit | Shown in the Bridge footer and saved with each transfer. |
| Release = ERC-20 `Transfer` | The release tx must emit `Transfer(bridge → user, amount)` on the destination token. A mint (`from` = 0x0) also passes, because only the token, recipient and amount are checked. |

Manifest shape:

```json
{
  "tag": "2026.10.1",
  "commit": "<40 hex>",
  "disabled": false,
  "apiUrl": "https://bridge.litho.ai",
  "routes": [{
    "sourceChainId": 9005, "sourceBridge": "0x…",
    "destinationChainId": 8453, "destinationBridge": "0x…",
    "tokens": [{ "symbol": "LAX", "sourceAddress": "0x…", "destinationAddress": "0x…", "decimals": 18 }],
    "maxAmountBaseUnits": "1000000000000000000000"
  }]
}
```

Thanos needs an RPC for both chains of a route. That means a built-in
network (Lithosphere 9005, Ethereum, BNB, Polygon, Base, Arbitrum, Linea,
Optimism, Avalanche) or one the user added in Settings.

### Pinned hash: what it means for changes

Because each build pins the manifest's SHA-256, **any** change to the
manifest needs new builds with the new hash. That includes a new route, a
new token, or flipping `disabled`.

- Until the new builds ship, the old builds see a hash mismatch and refuse
  the bridge, so they fail closed.
- This makes any manifest change an emergency off switch for every
  installed app.
- It also means turning routes **on** takes a release, which for mobile is
  a store review.

If routes need to change without app releases, the manifest would need a
signature instead, checked against a pinned public key. That is a backend
decision.

## Turning it on

All three values are needed. With any one missing or malformed, the bridge
stays off.

- **Web** (VPS `.env`, then rebuild):
  - `NEXT_PUBLIC_MULTX_ENABLED=true`
  - `NEXT_PUBLIC_MULTX_MANIFEST_URL=…`
  - `NEXT_PUBLIC_MULTX_MANIFEST_SHA256=…`
  - The web CSP allows the manifest's origin automatically.
- **Desktop, extension, mobile** (GitHub → Settings → Secrets and variables
  → Actions → Variables):
  - Set `MULTX_ENABLED=true`, `MULTX_MANIFEST_URL` and `MULTX_MANIFEST_SHA256`.
  - `release.yml` passes them as `VITE_MULTX_*`; `mobile-release.yml`
    writes them into the EAS profile as `EXPO_PUBLIC_MULTX_*`.
  - Then run the release workflows.

## Code

| Part | Path |
|---|---|
| Adapter (canonical) | `packages/multx-adapter/src` |
| Thanos service | `packages/sdk-core/src/multx-thanos/service.ts` |
| Copies | `packages/sdk-core/src/multx-thanos/adapter/`, `apps/mobile/lib/multx-thanos/` — written by `node scripts/sync-multx-thanos.mjs`; the sdk-core tests fail if a copy drifts |
| App glue | `apps/web/lib/multx-thanos.ts`, `apps/desktop/src/renderer/multx-thanos.ts`, `apps/extension/src/lib/multx-thanos.ts`, `apps/mobile/lib/thanos-bridge.ts` |
| Screens | `apps/web/components/MultXBridge.tsx`, `apps/desktop/src/renderer/MultXBridgePanel.tsx`, `apps/extension/src/entrypoints/popup/MultXBridgePanel.tsx`, `BridgeScreen` in `apps/mobile/App.tsx` |
| Tests | `packages/multx-adapter/src/*.test.ts`; `packages/sdk-core/src/__tests__/multx-thanos.test.ts`, which runs real ethers signing against a local JSON-RPC chain |
