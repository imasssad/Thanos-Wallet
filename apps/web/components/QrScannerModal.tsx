'use client';
/**
 * QR scanner — camera-based recipient input.
 *
 * Wraps qr-scanner (a tiny pure-JS decoder built on getUserMedia). Opens a
 * live preview, decodes the first valid frame, and hands the string back
 * via onResult. Common payload shapes the scanner accepts and we forward:
 *   - plain address      0x1234… / litho1…
 *   - ethereum: URI      ethereum:0x1234@700777?value=… (we parse the address)
 *   - bitcoin: URI       bitcoin:bc1…?amount=… (parsed for bech32 host wallets later)
 *
 * Camera permission is granted by the browser the first time we call
 * QrScanner.start(). When denied, we surface the error state so the user
 * can fall back to pasting the address.
 */
import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  open:     boolean;
  onClose:  () => void;
  onResult: (decoded: string) => void;
}

/**
 * Normalise common QR payload formats down to either a bare address or
 * the full payload (when caller dispatches on prefix).
 *
 * Returns the *exact* `wc:` URI unmodified — the SendModal autocomplete
 * won't see it (it's not an address) but the WalletConnect host watches
 * for the `wc:` prefix in the onResult callback and pairs accordingly,
 * so single-scanner UX flows route to the right handler.
 */
export function extractAddress(raw: string): string {
  const s = raw.trim();
  // WalletConnect v2 pairing URI — pass through unchanged for the WC host.
  if (/^wc:[a-z0-9-]+@\d+/i.test(s)) return s;
  // ethereum:0xABC@<chainId>?value=...
  const ethMatch = s.match(/^ethereum:(0x[a-fA-F0-9]{40})/);
  if (ethMatch) return ethMatch[1];
  // bitcoin:bc1... / litho1...
  const cosmosMatch = s.match(/^(litho1|bc1|tb1)[0-9a-z]+/i);
  if (cosmosMatch) return cosmosMatch[0];
  return s;
}

/** True when the QR payload is a WalletConnect v2 pairing URI. Callers
 *  can dispatch on this to route to the WalletConnect host's `pair()`
 *  instead of the recipient field. */
export function isWalletConnectUri(s: string): boolean {
  return /^wc:[a-z0-9-]+@\d+/i.test(s.trim());
}

export function QrScannerModal({ open, onClose, onResult }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<{ stop: () => void; destroy: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  // Latest callbacks in refs so the camera effect can depend on `open` ALONE.
  // If it also depended on onResult/onClose (fresh closures the parent makes
  // each render), every parent re-render would tear the scanner down and
  // restart it — and an interrupted QrScanner.start() rejects on Safari with
  // "The operation was aborted."
  const onResultRef = useRef(onResult);
  const onCloseRef = useRef(onClose);
  onResultRef.current = onResult;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setStarting(true);

    (async () => {
      try {
        // Lazy import — qr-scanner pulls in a Worker bundle, we don't want
        // it in the initial route chunk.
        const QrScanner = (await import('qr-scanner')).default;
        if (cancelled || !videoRef.current) return;

        const scanner = new QrScanner(
          videoRef.current,
          (result: { data: string }) => {
            scanner.stop();
            onResultRef.current(extractAddress(result.data));
            onCloseRef.current();
          },
          {
            returnDetailedScanResult: true,
            preferredCamera: 'environment',
            highlightScanRegion: true,
            highlightCodeOutline: true,
            maxScansPerSecond: 10,
            // Scan the largest CENTRED SQUARE of the frame, not qr-scanner's
            // default 2/3 sub-square. A QR held close enough to fill the camera
            // (e.g. another phone's receive screen) overflows that small region
            // and never decodes — exactly the "camera works but it never reads
            // the code / times out" symptom. A full-width square keeps the
            // region square (no distortion) so dense codes still decode.
            calculateScanRegion: (v: HTMLVideoElement) => {
              const w = v.videoWidth || 640;
              const h = v.videoHeight || 480;
              const size = Math.min(w, h);
              return {
                x: Math.round((w - size) / 2),
                y: Math.round((h - size) / 2),
                width: size,
                height: size,
                downScaledWidth: 500,
                downScaledHeight: 500,
              };
            },
          },
        );
        scannerRef.current = scanner;
        await scanner.start();
        if (cancelled) { scanner.stop(); return; }
        setStarting(false);
      } catch (err) {
        if (cancelled) return;
        const msg = (err as Error).message || 'Camera unavailable';
        if (/Permission|denied|NotAllowed/i.test(msg)) {
          setError('Camera permission denied. Enable it in your browser settings and try again.');
        } else if (/NotFound|no camera/i.test(msg)) {
          setError('No camera detected on this device.');
        } else if (/abort/i.test(msg)) {
          setError('Camera was interrupted — close and reopen the scanner to retry.');
        } else {
          setError(msg);
        }
        setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      scannerRef.current?.stop();
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
    // onResult/onClose read via refs (above), so the scanner starts once per
    // open and isn't restarted mid-flight (which is what aborted it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div className="modal-header">
          <span className="modal-title">Scan QR</span>
          <button className="modal-close" onClick={onClose}><X size={16}/></button>
        </div>
        <div className="modal-body" style={{ padding: 0 }}>
          <div style={{
            position: 'relative', width: '100%', aspectRatio: '1 / 1',
            background: '#000', borderRadius: 10, overflow: 'hidden',
          }}>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline/>
            {starting && !error && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'rgba(255,255,255,0.7)', fontSize: 12,
              }}>
                Starting camera…
              </div>
            )}
            {error && (
              <div style={{
                position: 'absolute', inset: 0, padding: 16,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                textAlign: 'center', color: 'var(--red)', fontSize: 12, lineHeight: 1.5,
              }}>
                {error}
              </div>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, textAlign: 'center' }}>
            Point the camera at a QR code containing a wallet address.
          </div>
        </div>
      </div>
    </div>
  );
}
