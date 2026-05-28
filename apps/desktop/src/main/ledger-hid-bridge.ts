/**
 * Native HID transport bridge for Ledger.
 *
 * The renderer's primary path is `@ledgerhq/hw-transport-webhid`, which
 * works in Electron's Chromium on macOS and Windows. On Linux (or any
 * environment where WebHID is unavailable / hidden behind a flag),
 * the renderer can fall back to this main-process bridge — it goes
 * through `@ledgerhq/hw-transport-node-hid-noevents`, a native module
 * that talks to the OS HID stack directly.
 *
 * Why a separate bridge instead of using the transport in the renderer?
 *   - node-hid is a native Node addon. It can't be loaded from the
 *     renderer process (contextIsolation: true, no Node access).
 *   - Keeping the transport in main also keeps APDU traffic out of the
 *     renderer's V8 heap, which is consistent with how we already
 *     handle the main-process seed signer.
 *
 * Failure mode: the native module is loaded lazily via `require()`. If
 * the dep isn't installed (or the native build wasn't rebuilt for
 * Electron's Node ABI), every method returns `{ available: false }` or
 * throws `LedgerNativeUnavailable`. The renderer catches that and
 * surfaces a clear message; WebHID stays the primary path.
 *
 * IPC channels exposed (registered in main/index.ts):
 *   ledger-native:available        → boolean — can this path work?
 *   ledger-native:get-address      (hdPath) → 0x address (display: false)
 *   ledger-native:sign-evm-tx      (hdPath, unsignedHex) → { signedHex }
 *
 * Apps that need BTC / SOL native-HID signing can mirror this file —
 * import the relevant hw-app-* module and add a sibling channel.
 */

/* The types here are intentionally `unknown` / structural — the upstream
 * `@ledgerhq/hw-transport-node-hid-noevents` is an OPTIONAL dep loaded via
 * require() at runtime, so we can't statically import its types without
 * making the dep mandatory. Anything we need to call on the transport /
 * eth wrapper is shaped explicitly below. */
type EthLike = {
  getAddress(path: string, display: boolean): Promise<{ address: string }>;
  signTransaction(path: string, hex: string, resolution?: unknown): Promise<{ v: string; r: string; s: string }>;
};
type TransportLike = { close(): Promise<void> };

export class LedgerNativeUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerNativeUnavailable';
  }
}

/** Lazy-load both the transport + the protocol module. Returns null when
 *  the native dep isn't installed or the build wasn't rebuilt for
 *  Electron's ABI; the caller treats null as "not available, fall back". */
function loadTransport(): null | {
  TransportNodeHid: { create(): Promise<TransportLike>; list(): Promise<string[]> };
  EthCtor: new (transport: TransportLike) => EthLike;
} {
  try {
    // require so a missing dep is catchable, and so we don't pull
    // these into the bundle at compile-time (they're optional).
    const TransportNodeHid =
      require('@ledgerhq/hw-transport-node-hid-noevents').default;
    const EthCtor = require('@ledgerhq/hw-app-eth').default;
    return { TransportNodeHid, EthCtor };
  } catch {
    return null;
  }
}

const HD_PATH = "44'/60'/0'/0/0";

let cachedTransport: TransportLike | null = null;

async function getTransport(): Promise<TransportLike> {
  const mod = loadTransport();
  if (!mod) throw new LedgerNativeUnavailable('@ledgerhq/hw-transport-node-hid-noevents is not installed');
  if (cachedTransport) return cachedTransport;
  // Surface "no device" as our typed error rather than node-hid's raw
  // TransportError — the renderer pattern-matches on the name.
  try {
    cachedTransport = await mod.TransportNodeHid.create();
    return cachedTransport;
  } catch (e) {
    throw new LedgerNativeUnavailable((e as Error).message || 'no Ledger device found');
  }
}

async function withFreshTransport<T>(fn: (eth: EthLike) => Promise<T>): Promise<T> {
  const mod = loadTransport();
  if (!mod) throw new LedgerNativeUnavailable('@ledgerhq/hw-transport-node-hid-noevents is not installed');
  const transport = await getTransport();
  try {
    const eth = new mod.EthCtor(transport);
    return await fn(eth);
  } catch (e) {
    // Drop the cached transport on any error so the next call reopens —
    // most node-hid errors leave the device in an unusable state.
    try { await transport.close(); } catch { /* ignore */ }
    cachedTransport = null;
    throw e;
  }
}

/** Cheap probe — returns true if the dep loads. Doesn't open the device. */
export function isAvailable(): boolean {
  return loadTransport() !== null;
}

/** Get the first EVM account address from the Ledger via native HID.
 *  `display: false` — no on-device prompt for this probe. */
export async function getAddress(hdPath = HD_PATH): Promise<string> {
  return withFreshTransport(async (eth) => {
    const { address } = await eth.getAddress(hdPath, false);
    return address;
  });
}

/** Sign an EIP-1559 transaction. `unsignedHex` is the RLP-serialised tx
 *  WITHOUT the type prefix; ethers' `Transaction.unsignedSerialized`
 *  shape — the renderer constructs it before sending. Returns the
 *  device-provided v/r/s as the renderer recombines them with the tx. */
export async function signTransaction(
  hdPath: string,
  unsignedHex: string,
): Promise<{ v: string; r: string; s: string }> {
  return withFreshTransport(async (eth) => {
    const sig = await eth.signTransaction(hdPath, unsignedHex);
    return { v: sig.v, r: sig.r, s: sig.s };
  });
}

/** Close any cached transport. Called on app quit so the device is
 *  released even when Electron lingers on macOS. */
export async function dispose(): Promise<void> {
  if (cachedTransport) {
    try { await cachedTransport.close(); } catch { /* best-effort */ }
    cachedTransport = null;
  }
}
