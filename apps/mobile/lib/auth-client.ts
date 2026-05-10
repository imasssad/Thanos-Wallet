/**
 * Mobile auth-client singleton.
 *
 * The mobile app is workspace-detached for EAS Cloud compatibility, so
 * it carries its own copy of api-client.ts (kept in sync manually with
 * packages/api-client/src/index.ts).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ThanosApiClient,
  createAsyncStorageAdapter,
} from './api-client';

export const apiClient = new ThanosApiClient({
  baseUrl:  'https://devapp.thanos.fi/api',
  platform: 'mobile',
  storage:  createAsyncStorageAdapter(AsyncStorage),
});

export type { AuthSuccess, AuthUser, ApiError } from './api-client';
