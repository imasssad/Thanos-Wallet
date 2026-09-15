/**
 * GET /api/version — the currently DEPLOYED app version, read fresh per
 * request (not baked into any cached bundle). Polled by UpdateBanner to
 * detect when a newer build has gone live than the one the browser has
 * loaded — a plain page refresh doesn't help here on its own since
 * / (and other public pages) are cached at the edge for up to an hour
 * (see next.config.js's CACHE_PUBLIC_PAGE), so a visitor's tab can sit on
 * a stale bundle well after a deploy.
 */
import { NextResponse } from 'next/server';
import pkg from '../../../package.json';

export async function GET() {
  return NextResponse.json(
    { version: pkg.version },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
