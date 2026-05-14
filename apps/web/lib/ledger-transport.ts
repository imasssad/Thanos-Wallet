'use client';
/**
 * Shared WebUSB transport singleton for every Ledger hw-app (eth, btc, sol).
 *
 * On a Ledger device only ONE coin app can be running at a time. The user
 * manually switches apps on-device; we just reuse the same WebUSB
 * connection across all three hw-app instances so we don't fight the
 * driver for the interface.
 *
 * lib/ledger.ts (EVM) still has its own internal singletons for back-
 * compat — this module is the new shared path for BTC + SOL and the
 * eventual unified rewrite of lib/ledger.ts.
 */

/* Generic Transport — the WebUSB subclass extends this. */
type GenericTransport = import('@ledgerhq/hw-transport').default;
type AppBtc            = import('@ledgerhq/hw-app-btc').default;
type AppSol            = import('@ledgerhq/hw-app-solana').default;

let _transport: GenericTransport | null = null;
let _btc: AppBtc | null = null;
let _sol: AppSol | null = null;

export class LedgerError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

async function ensureTransport(): Promise<GenericTransport> {
  if (_transport) return _transport;
  if (typeof navigator === 'undefined' || !('usb' in navigator)) {
    throw new LedgerError('webusb_unsupported',
      'WebUSB is not available in this browser. Use Chrome / Edge / Brave, or open the desktop app.');
  }
  try {
    const TransportWebUSB = (await import('@ledgerhq/hw-transport-webusb')).default;
    _transport = await TransportWebUSB.create();
    /* If the user disconnects mid-session we get a transport "disconnect"
       event; null out our cached app instances so the next call re-opens. */
    _transport.on('disconnect', () => {
      _transport = null;
      _btc = null;
      _sol = null;
    });
    return _transport;
  } catch (e) {
    const msg = (e as Error).message || '';
    if (/no device selected/i.test(msg)) throw new LedgerError('no_device', 'No Ledger selected');
    throw new LedgerError('connect_failed', msg || 'Could not connect to Ledger');
  }
}

/* ─── Per-coin app handles ───────────────────────────────────────── */

export async function openBtcTransport(): Promise<AppBtc> {
  const transport = await ensureTransport();
  if (_btc) return _btc;
  const AppBtcCtor = (await import('@ledgerhq/hw-app-btc')).default;
  _btc = new AppBtcCtor({ transport, currency: 'bitcoin' });
  return _btc;
}

export async function openSolTransport(): Promise<AppSol> {
  const transport = await ensureTransport();
  if (_sol) return _sol;
  const AppSolCtor = (await import('@ledgerhq/hw-app-solana')).default;
  _sol = new AppSolCtor(transport);
  return _sol;
}

/** Close the per-app handle (the underlying transport stays open). */
export async function closeBtcTransport(): Promise<void> { _btc = null; }
export async function closeSolTransport(): Promise<void> { _sol = null; }

/** Close everything. Use on a user-triggered Disconnect. */
export async function closeLedgerTransport(): Promise<void> {
  if (_transport) { try { await _transport.close(); } catch {} }
  _transport = null;
  _btc = null;
  _sol = null;
}
