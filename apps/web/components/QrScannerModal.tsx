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

/** Normalise common QR payload formats down to a bare address string. */
function extractAddress(raw: string): string {
  const s = raw.trim();
  // ethereum:0xABC@<chainId>?value=...
  const ethMatch = s.match(/^ethereum:(0x[a-fA-F0-9]{40})/);
  if (ethMatch) return ethMatch[1];
  // bitcoin:bc1... / litho1...
  const cosmosMatch = s.match(/^(litho1|bc1|tb1)[0-9a-z]+/i);
  if (cosmosMatch) return cosmosMatch[0];
  return s;
}

export function QrScannerModal({ open, onClose, onResult }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<{ stop: () => void; destroy: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

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
            const value = extractAddress(result.data);
            onResult(value);
            scanner.stop();
            onClose();
          },
          {
            highlightScanRegion: true,
            highlightCodeOutline: true,
            preferredCamera: 'environment',
          },
        );
        scannerRef.current = scanner;
        await scanner.start();
        if (cancelled) scanner.stop();
        setStarting(false);
      } catch (err) {
        if (cancelled) return;
        const msg = (err as Error).message || 'Camera unavailable';
        if (/Permission|denied|NotAllowed/i.test(msg)) {
          setError('Camera permission denied. Enable it in your browser settings and try again.');
        } else if (/NotFound|no camera/i.test(msg)) {
          setError('No camera detected on this device.');
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
  }, [open, onClose, onResult]);

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
