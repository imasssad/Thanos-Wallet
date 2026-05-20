/**
 * Desktop renderer auth-client singleton.
 *
 * Electron renderer is a Chromium process — localStorage works fine.
 * Sensitive secrets (private keys / mnemonic) should still go through
 * the keytar bridge, not this storage. This is for auth tokens only.
 */
import {
  ThanosApiClient,
  createWebStorageAdapter,
} from '@thanos/api-client';

const baseUrl =
  // Electron + Vite: VITE_API_BASE_URL injected at build time, fallback to prod
  (import.meta as unknown as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL
  ?? 'https://thanos.fi/api';

export const apiClient = new ThanosApiClient({
  baseUrl,
  platform: 'desktop',
  storage:  createWebStorageAdapter(),
});

export type { AuthSuccess, AuthUser, ApiError } from '@thanos/api-client';
