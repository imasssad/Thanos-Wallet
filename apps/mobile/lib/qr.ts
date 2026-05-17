/**
 * QR-code generation helpers for the mobile wallet.
 *
 * Uses the same `qrcode` library as the web app so both surfaces render
 * identical codes. The library outputs plain SVG XML which we hand to
 * react-native-svg's <SvgXml/> in the Receive screen.
 */
import QRCode from 'qrcode';

export interface QrOptions {
  size?:           number;   // SVG width/height in px
  darkColor?:      string;   // foreground module color
  lightColor?:     string;   // background color ('#00000000' = transparent)
}

/**
 * Render an address (or any string payload) as an inline SVG QR code.
 * Returns null on encode failure — callers should fall back to a plain
 * address display in that case.
 */
export async function makeAddressQrSvg(payload: string, opts: QrOptions = {}): Promise<string | null> {
  if (!payload) return null;
  try {
    const svg = await QRCode.toString(payload, {
      type:    'svg',
      margin:  1,
      width:   opts.size      ?? 220,
      color:   {
        dark:  opts.darkColor  ?? '#0a0a0f',
        light: opts.lightColor ?? '#ffffff',
      },
    });
    return svg;
  } catch {
    return null;
  }
}

/**
 * Normalise a scanned QR payload into a bare address.
 *
 * Wallets encode addresses in several forms:
 *   - bare:            `0xABC…` / `litho1…` / `bc1q…` / base58 / `cosmos1…`
 *   - EIP-681 URI:     `ethereum:0xABC…@1?value=…`
 *   - BIP-21 URI:      `bitcoin:bc1q…?amount=…`
 *   - chain-prefixed:  `litho:litho1…`, `solana:…`, `cosmos:…`
 *   - WalletConnect:   `wc:…` (returned untouched — caller routes it)
 *
 * Strategy: keep `wc:` URIs intact (they're not addresses), strip any
 * `scheme:` prefix off everything else, drop `@chainId` and `?query`
 * tails, and trim. Returns the cleaned string; the caller validates it
 * against the active chain.
 */
export function parseScannedAddress(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';

  // WalletConnect pairing URIs are handled by the WC flow, not the
  // address field — hand them back verbatim.
  if (trimmed.toLowerCase().startsWith('wc:')) return trimmed;

  let body = trimmed;

  // Strip a leading `scheme:` (ethereum:, bitcoin:, litho:, solana:,
  // cosmos:). Guard against accidentally eating a bech32 string that
  // has no scheme — only strip when the prefix is a known scheme word.
  const schemeMatch = body.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):(.+)$/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    const KNOWN = ['ethereum', 'bitcoin', 'litho', 'lithosphere', 'solana', 'cosmos'];
    if (KNOWN.includes(scheme)) body = schemeMatch[2];
  }

  // Drop an EIP-681 `@chainId` segment and any `?query` tail.
  body = body.split('?')[0];
  body = body.split('@')[0];
  return body.trim();
}

/** True when a scanned payload is a WalletConnect pairing URI. */
export function isWalletConnectUri(raw: string): boolean {
  return (raw || '').trim().toLowerCase().startsWith('wc:');
}
