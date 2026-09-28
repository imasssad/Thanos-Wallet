import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp } from './lib/csp';

/**
 * Per-request nonce Content-Security-Policy for the wallet (/app/*) — no
 * 'unsafe-inline' scripts there, see lib/csp.js.
 *
 * Next reads the nonce from the request's Content-Security-Policy header and
 * stamps it on the scripts it renders, which is why app/app/layout.tsx forces
 * dynamic rendering: a pre-rendered page would carry no nonce.
 */
export function middleware(request: NextRequest) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = btoa(String.fromCharCode(...bytes));
  const csp = buildCsp(nonce);

  const headers = new Headers(request.headers);
  headers.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/app/:path*',
      // Router prefetches aren't documents: no policy to deliver.
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
