# Transaction-signing isolation across surfaces

Each Thanos Wallet client keeps the unlocked seed / private key out of
the main UI thread or process where rendering code runs. The isolation
primitive differs by platform — they all converge on the same property:
**a passive read of UI state or window globals cannot leak the signing
material**. An attacker who fully controls the UI thread can still ask
the signer to sign (that's true of every wallet on every platform); the
goal is to remove the easy XSS / devtools / extension-snoop reads.

Audited at commit `48f1e9c` and later.

## Map

| Surface | Primitive | Where the secret lives | File:line |
|---------|-----------|------------------------|-----------|
| **Web app** | Dedicated Worker | Inside the worker's module scope, set on `init()`; never sent back to the main thread | [apps/web/workers/signer-worker.ts:29-40](apps/web/workers/signer-worker.ts#L29-L40) |
| **Browser extension** | MV3 offscreen document | Loaded into the offscreen doc; popup + content scripts message in, get a signature back, never see the seed | [apps/extension/src/entrypoints/offscreen/main.ts](apps/extension/src/entrypoints/offscreen/main.ts) + [wxt.config.ts:31-34](apps/extension/wxt.config.ts#L31-L34) |
| **Desktop (Electron)** | Main-process IPC | `signer` module in the main process; renderer holds a boolean "unlocked" flag only and calls `signer:*` IPC handlers for every signing op | [apps/desktop/src/main/index.ts:80-91](apps/desktop/src/main/index.ts#L80-L91) + [apps/desktop/src/main/signer.ts](apps/desktop/src/main/signer.ts) |
| **Mobile (React Native)** | Module-private closure | `lib/vault.ts` keeps the decrypted seed in a closure variable cleared on `lock()`; React components import functions, not the variable | [apps/mobile/lib/vault.ts](apps/mobile/lib/vault.ts) |

## Why this isn't only "good practice"

In each surface there's a concrete passive-read attack the isolation
eliminates:

- **Web app** — without the worker, an XSS that scraped
  `__NEXT_DATA__` or any React context would expose the mnemonic.
  Workers don't share memory with the main thread, so even
  `Object.values(window)` from an XSS context can't reach the secret.
- **Extension** — MV3 service workers die after ~30s idle, and popup
  scripts share the page's context for the popup HTML. Keeping the
  signer in an offscreen document gives it its own lifecycle that
  doesn't restart mid-signing and isolates its `globalThis`.
- **Desktop** — `contextIsolation: true` already separates the
  renderer from Node.js, but the renderer can still self-XSS via a
  malicious dApp URL. Putting the signer in the main process means
  the renderer JS context literally cannot construct the signing
  function.
- **Mobile** — JavaScript bundles in RN share a single VM, so module
  privacy is the only available primitive. The closure pattern stops
  unprivileged React components from grabbing the seed via direct
  import — they have to call the public `sign*` functions.

## What this isolation does NOT protect against

- An attacker controlling the UI thread can still call the public
  signing API (e.g. tx → sign → broadcast). The protection is against
  *passive reads* of the key material.
- Memory dumps of the entire process. The seed is unencrypted in
  memory while unlocked — Electron's main process, the worker, and
  the offscreen doc all hold it as plain bytes. That's standard for
  every wallet that supports background signing.
- Phishing the user. If the user pastes their seed into a malicious
  page, no client-side isolation primitive helps. Mitigated separately
  by the phishing classifier ([packages/sdk-core/src/security/phishing.ts](packages/sdk-core/src/security/phishing.ts)).

## Verification

Each surface has tests that assert the seed never crosses the
isolation boundary:

- [apps/web/lib/vault.test.ts](apps/web/lib/vault.test.ts) — vault
  round-trip; the worker contract is exercised via integration tests.
- [services/api/src/__tests__/security.test.ts](services/api/src/__tests__/security.test.ts)
  — logger redaction tests confirm the seed never leaves any client
  via API logs.
- [packages/sdk-core/src/__tests__/multx-client.test.ts](packages/sdk-core/src/__tests__/multx-client.test.ts)
  — asserts no `Authorization` / `x-api-key` header carries any
  client identity that could be a key fragment.

## Migration / rollback notes

If a future refactor wants to remove any of these primitives (e.g.
drop the offscreen doc in favor of MV3 service-worker-only signing),
the change needs:

1. A documented threat-model delta showing what passive-read attack
   becomes possible.
2. A compensating control (e.g. ephemeral keys, hardware-backed
   storage) that closes the same hole.
3. A pre-merge security review by an outside reader.

Don't remove without 1+2+3.
