/**
 * Web auth-client singleton.
 *
 * Wraps @thanos/api-client with a localStorage adapter and the right
 * x-platform header. Existing local-only onboarding (BIP39 mnemonic +
 * password) keeps working — this is additive, for future server-side
 * accounts (sync, multi-device, recovery).
 */
import {
  ThanosApiClient,
  createWebStorageAdapter,
} from '@thanos/api-client';

const baseUrl =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (typeof process !== 'undefined' && (process as any).env?.NEXT_PUBLIC_API_BASE_URL) || '/api';

export const apiClient = new ThanosApiClient({
  baseUrl,
  platform: 'web',
  storage:  createWebStorageAdapter(),
});

export type { AuthSuccess, AuthUser, ApiError } from '@thanos/api-client';
