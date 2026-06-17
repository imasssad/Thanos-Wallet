/**
 * thanos.fi/download — stable, branded Android APK download link.
 *
 * Redirects to the current EAS build artifact so we don't commit a ~40 MB
 * binary to the repo or bake it into the web image. Update APK_URL to the
 * new artifact whenever a fresh production-apk build lands
 * (eas build:view <id> → "Application Archive URL").
 */
import { NextResponse } from 'next/server';

// Latest production-apk build (2026-06-17, commit 427db10 — 9 parity
// features + Discover logos + LITHO 𝕃 font).
const APK_URL = 'https://expo.dev/artifacts/eas/LRCGLXdWw4uuqXLaJurf6xlLu7yGrw_bZfCTSyivwjM.apk';

export function GET() {
  // 307 keeps it a temporary redirect so browsers re-resolve when we ship
  // a new build, and the download starts immediately.
  return NextResponse.redirect(APK_URL, 307);
}
