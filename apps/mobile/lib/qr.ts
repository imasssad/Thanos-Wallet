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
