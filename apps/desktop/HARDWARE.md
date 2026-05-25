# Desktop hardware-wallet transport

This document captures the deliberate choice between WebHID-in-renderer
and native-USB-in-main for the desktop's hardware-wallet path, so the
next reviewer doesn't accidentally undo it.

## What we ship today

**WebHID in the renderer process**, gated by an explicit vendor allowlist
in [`src/main/index.ts`](src/main/index.ts):

| Vendor | Vendor IDs |
| ------ | ---------- |
| Ledger | `0x2c97` |
| Trezor | `0x534c`, `0x1209` |

Any other USB device asking for HID access is silently denied by
`setDevicePermissionHandler`. Both Ledger
(`@ledgerhq/hw-transport-webhid`) and Trezor (`@trezor/connect-web` via
its iframe pop-up) work over this transport.

## Why not native USB on the main process

`@ledgerhq/hw-transport-node-hid` and the underlying `node-hid` native
addon would technically give us a Node-side transport, bypassing
Chromium's WebHID layer. We chose WebHID anyway:

- **Same transport every major Electron wallet uses.** MetaMask, Rabby,
  Frame, and Phantom all ship WebHID-in-renderer on Electron. It's
  battle-tested across thousands of installs.
- **Native USB adds significant build complexity.** `node-hid` is a
  node-gyp native module — Windows installs need MS Visual C++,
  macOS needs Xcode CLT, Linux needs `libudev-dev`. The compiled binary
  must be rebuilt for Electron's specific Node ABI via
  `electron-rebuild`, and shipped as a `.node` per (platform, arch)
  combination. Electron-builder then needs to bundle each one. Cross-
  platform CI cost goes up considerably.
- **No reported reliability advantage.** The cases where WebHID is
  flaky are mostly Linux distros with unusual udev rules, where native
  HID would face the *same* udev permission issue.
- **Vendor allowlist is enforced at the same layer.** The
  `setDevicePermissionHandler` check is at the Chromium permission
  layer, identical to what a browser-extension wallet has.

## When to switch (and how)

If we see a concrete reliability issue traced to WebHID — not to
`node-hid` — that we can't fix any other way, switch:

1. `pnpm add -F @thanos/desktop @ledgerhq/hw-transport-node-hid node-hid`
2. Add `electron-rebuild` as a postinstall: `electron-rebuild -f -w node-hid`
3. Create `src/main/hw-bridge.ts` that:
   - opens the transport in the main process via `TransportNodeHid.create()`,
   - exposes a typed IPC API over `ipcMain` (`hw.list` / `hw.open` /
     `hw.exchange` / `hw.close`),
4. In the renderer, add a thin Transport-shaped wrapper that proxies
   to that IPC bridge so `@ledgerhq/hw-app-eth` works unchanged.
5. Update `electron-builder.yml` `extraResources` + `asarUnpack` to
   ship the `.node` binary per platform.
6. Add a CI build matrix step that runs `electron-rebuild` for each
   target.

Estimated effort: ~2 days plus a CI run-through.

## What this means for the audit

Audit items 6.10 and 9.13 (Native USB transport on Electron main side)
should be read as **"decision recorded, alternative path documented"** —
the current WebHID-only setup is intentional, not a missing feature.
