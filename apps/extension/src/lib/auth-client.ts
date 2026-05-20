/**
 * Extension auth-client singleton.
 *
 * Popup / content scripts run in a browser context — localStorage is
 * available. Tokens are scoped to the extension origin, not the host page.
 * Switch to chrome.storage.local later if MV3 service-worker auth is needed.
 */
import {
  ThanosApiClient,
  createWebStorageAdapter,
} from '@thanos/api-client';

const baseUrl =
  // WXT exposes import.meta.env.VITE_*
  (import.meta as unknown as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL
  ?? 'https://thanos.fi/api';

export const apiClient = new ThanosApiClient({
  baseUrl,
  platform: 'extension',
  storage:  createWebStorageAdapter(),
});

export type { AuthSuccess, AuthUser, ApiError } from '@thanos/api-client';
